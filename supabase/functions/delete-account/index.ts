// Suuq+ permanent account deletion (Google Play requirement). Verifies the
// caller's JWT, best-effort cleans up everything Postgres's cascade deletes
// can't reach (Cloudinary images, the Stream Chat user, rate_limit_events —
// see that table's note in 0019_security_hardening.sql), then hard-deletes
// the auth.users row. Every other user-owned table (profiles, listings,
// favorites, recently_viewed, followers, reviews, saved_searches,
// notifications, device_tokens, notification_preferences, blocked_users,
// saved_addresses, reports (as reporter), conversations,
// conversation_participants, offers, price_drops) has `references
// public.profiles (id) on delete cascade`, and profiles cascades from
// auth.users — so deleting the auth user is what actually removes them.
//
// Mirrors the auth/logging pattern of cloudinary-delete and stream-token
// (self-contained; this repo doesn't share code between edge functions).

import { createClient } from 'jsr:@supabase/supabase-js@2';

const MAX_RETRIES = 3;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);

function log(event: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ scope: 'delete-account', event, ...data }));
}

// Same fallback lib/cloudinary.ts's extractPublicId() uses for rows written
// before the public_id columns existed (0018_cloudinary_public_ids.sql).
function extractPublicId(url: string): string | null {
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+(?:\?.*)?$/);
  return match ? match[1] : null;
}

async function cloudinaryBatchDelete(cloudName: string, apiKey: string, apiSecret: string, publicIds: string[]) {
  const params = new URLSearchParams();
  for (const id of publicIds) params.append('public_ids[]', id);
  const basicAuth = btoa(`${apiKey}:${apiSecret}`);
  const url = `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload?${params.toString()}`;

  let lastErrorMessage = 'Cloudinary delete failed';
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Basic ${basicAuth}` } });
    if (res.ok) return;

    const data = await res.json().catch(() => ({}));
    lastErrorMessage = data?.error?.message ?? `Cloudinary delete failed (HTTP ${res.status})`;
    const canRetry = RETRYABLE_STATUSES.has(res.status) && attempt < MAX_RETRIES;
    if (!canRetry) throw new Error(lastErrorMessage);

    const backoffMs = 500 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }
  throw new Error(lastErrorMessage);
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlFromString(input: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(input));
}

// Same HMAC-SHA256 JWT signing as stream-token/index.ts's user tokens, but
// with Stream's documented `server: true` claim (no exp) for server-side REST
// calls. Best-effort only — never blocks account deletion if it fails.
async function deleteStreamUser(userId: string, secret: string): Promise<void> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const claims = { server: true };
  const unsigned = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned));
  const token = `${unsigned}.${base64UrlFromBytes(new Uint8Array(signature))}`;

  const apiKey = Deno.env.get('EXPO_PUBLIC_STREAM_API_KEY');
  if (!apiKey) throw new Error('EXPO_PUBLIC_STREAM_API_KEY secret is not set');

  const params = new URLSearchParams({ api_key: apiKey, user_ids: userId, user: 'hard', messages: 'hard', conversations: 'hard' });
  const res = await fetch(`https://chat.stream-io-api.com/users/delete?${params.toString()}`, {
    method: 'POST',
    headers: { Authorization: token, 'stream-auth-type': 'jwt', 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Stream delete failed: HTTP ${res.status} ${await res.text()}`);
}

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401 });
    }
    const jwt = authHeader.slice('Bearer '.length);

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(jwt);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
    }

    log('start', { userId: user.id });

    // 1. Gather every Cloudinary public_id this user owns (profile + listings).
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('avatar_url, avatar_public_id, business_logo_url, business_logo_public_id, business_banner_url, business_banner_public_id')
      .eq('id', user.id)
      .maybeSingle();

    const { data: listings } = await supabaseAdmin.from('listings').select('images, image_public_ids').eq('user_id', user.id);

    const publicIds = new Set<string>();
    if (profile) {
      const pairs: [string | null | undefined, string | null | undefined][] = [
        [profile.avatar_public_id, profile.avatar_url],
        [profile.business_logo_public_id, profile.business_logo_url],
        [profile.business_banner_public_id, profile.business_banner_url],
      ];
      for (const [publicId, url] of pairs) {
        const id = publicId || (url ? extractPublicId(url) : null);
        if (id) publicIds.add(id);
      }
    }
    for (const listing of listings ?? []) {
      const images: string[] = listing.images ?? [];
      const imagePublicIds: string[] = listing.image_public_ids ?? [];
      images.forEach((url, i) => {
        const id = imagePublicIds[i] || extractPublicId(url);
        if (id) publicIds.add(id);
      });
    }

    // 2. Best-effort Cloudinary cleanup — never blocks account deletion.
    if (publicIds.size > 0) {
      const cloudName = Deno.env.get('CLOUDINARY_CLOUD_NAME') ?? Deno.env.get('EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME');
      const apiKey = Deno.env.get('CLOUDINARY_API_KEY');
      const apiSecret = Deno.env.get('CLOUDINARY_API_SECRET');
      if (cloudName && apiKey && apiSecret) {
        try {
          await cloudinaryBatchDelete(cloudName, apiKey, apiSecret, [...publicIds]);
          log('cloudinary_deleted', { count: publicIds.size });
        } catch (err) {
          log('cloudinary_delete_failed', { message: String(err) });
        }
      } else {
        log('cloudinary_skipped', { reason: 'secrets not set' });
      }
    }

    // 3. Best-effort Stream Chat user cleanup — never blocks account deletion.
    const streamSecret = Deno.env.get('STREAM_API_SECRET');
    if (streamSecret) {
      try {
        await deleteStreamUser(user.id, streamSecret);
        log('stream_deleted');
      } catch (err) {
        log('stream_delete_failed', { message: String(err) });
      }
    }

    // 4. rate_limit_events has no FK to profiles (see 0019_security_hardening.sql) — clean it up explicitly.
    await supabaseAdmin.from('rate_limit_events').delete().eq('user_id', user.id);

    // 5. Hard-delete the auth user — cascades through every FK'd table.
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      log('auth_delete_failed', { message: deleteError.message });
      return new Response(JSON.stringify({ error: deleteError.message }), { status: 500 });
    }

    log('done', { userId: user.id });
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    log('error', { message: String(err) });
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
