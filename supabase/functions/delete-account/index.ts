// Suuq+ permanent account deletion (Google Play requirement). Verifies the
// caller's JWT, best-effort cleans up everything Postgres's cascade deletes
// can't reach (R2 images, rate_limit_events — see that table's note in
// 0019_security_hardening.sql), then hard-deletes the auth.users row. Every
// other user-owned table (profiles, listings, favorites, recently_viewed,
// followers, reviews, saved_searches, notifications, device_tokens,
// notification_preferences, blocked_users, saved_addresses, reports (as
// reporter), conversations, conversation_participants, messages,
// message_reactions, offers, price_drops) has `references public.profiles
// (id) on delete cascade`, and profiles cascades from auth.users — so
// deleting the auth user is what actually removes them.
//
// R2 chat-image cleanup (0025_chat_image_r2_cleanup.sql) is folded into the
// same "gather every owned R2 key, then delete them all" pass below, rather
// than routed through delete_message()'s webhook — this function already
// holds the R2 credentials directly, so there's no need for the extra hop.
//
// Mirrors the auth/logging pattern of r2-delete (self-contained; this repo
// doesn't share code between edge functions).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

// Page size for paginating this user's messages when collecting chat-image
// R2 keys, and the concurrency cap for the final R2 delete pass — a user
// with a very large chat history (thousands of image messages) shouldn't
// force thousands of simultaneous R2 requests.
const MESSAGE_PAGE_SIZE = 1000;
const R2_DELETE_CONCURRENCY = 25;

function log(event: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ scope: 'delete-account', event, ...data }));
}

// Every R2 image key this user sent in chat, across every conversation,
// paginated so an account with many chat images never loads them all into
// memory in one round trip.
async function collectChatImageKeys(supabaseAdmin: ReturnType<typeof createClient>, userId: string): Promise<string[]> {
  const keys: string[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('messages')
      .select('image_keys')
      .eq('sender_id', userId)
      .range(from, from + MESSAGE_PAGE_SIZE - 1);
    if (error) {
      log('chat_image_keys_query_failed', { message: error.message });
      break;
    }
    const rows = (data as { image_keys: string[] | null }[] | null) ?? [];
    for (const row of rows) {
      for (const key of row.image_keys ?? []) {
        if (key) keys.push(key);
      }
    }
    if (rows.length < MESSAGE_PAGE_SIZE) break;
    from += MESSAGE_PAGE_SIZE;
  }
  return keys;
}

async function deleteAllWithConcurrency(client: AwsClient, endpoint: string, bucket: string, keys: string[]): Promise<number> {
  let failedCount = 0;
  for (let i = 0; i < keys.length; i += R2_DELETE_CONCURRENCY) {
    const batch = keys.slice(i, i + R2_DELETE_CONCURRENCY);
    const results = await Promise.all(batch.map((key) => r2Delete(client, `${endpoint}/${bucket}/${key}`)));
    failedCount += results.filter((ok) => !ok).length;
  }
  return failedCount;
}

// R2/S3 DELETE is idempotent (404 for an already-gone object is treated as
// success), so this doesn't need cloudinary-delete's old retry/backoff loop
// here — best-effort cleanup on account deletion, never blocks the deletion
// itself either way.
async function r2Delete(client: AwsClient, objectUrl: string): Promise<boolean> {
  const signedReq = await client.sign(objectUrl, { method: 'DELETE' });
  const res = await fetch(signedReq);
  return res.ok || res.status === 404;
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

    // 1. Gather every R2 object key this user owns (profile + listings).
    // Pre-migration rows may hold a Cloudinary public_id here instead of a
    // real R2 key (see docs/cloudinary-to-r2-migration.md) — harmless to
    // include below, since deleting a nonexistent R2 key is a no-op (404 ->
    // treated as success), and this function no longer holds any Cloudinary
    // credential to call Cloudinary with anyway.
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('avatar_public_id, business_logo_public_id, business_banner_public_id')
      .eq('id', user.id)
      .maybeSingle();

    const { data: listings } = await supabaseAdmin.from('listings').select('image_public_ids').eq('user_id', user.id);

    // Chat-image R2 keys (0025_chat_image_r2_cleanup.sql) — every image this
    // user ever sent in chat, across every conversation, paginated so a very
    // active chat history is never loaded in one shot.
    const chatImageKeys = await collectChatImageKeys(supabaseAdmin, user.id);

    const objectKeys = new Set<string>();
    if (profile) {
      for (const key of [profile.avatar_public_id, profile.business_logo_public_id, profile.business_banner_public_id]) {
        if (key) objectKeys.add(key);
      }
    }
    for (const listing of listings ?? []) {
      for (const key of listing.image_public_ids ?? []) {
        if (key) objectKeys.add(key);
      }
    }
    for (const key of chatImageKeys) objectKeys.add(key);

    // 2. Best-effort R2 cleanup — never blocks account deletion. Deleted in
    // capped-concurrency batches (not one giant Promise.all) so an account
    // with many chat images can't fan out thousands of simultaneous R2
    // requests.
    if (objectKeys.size > 0) {
      const accountId = Deno.env.get('R2_ACCOUNT_ID');
      const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID');
      const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
      const bucket = Deno.env.get('R2_BUCKET_NAME');
      if (accountId && accessKeyId && secretAccessKey && bucket) {
        const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
        const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
        const failedCount = await deleteAllWithConcurrency(client, endpoint, bucket, [...objectKeys]);
        log('r2_deleted', { count: objectKeys.size, chatImageCount: chatImageKeys.length, failedCount });
      } else {
        log('r2_skipped', { reason: 'secrets not set' });
      }
    }

    // 3. rate_limit_events has no FK to profiles (see 0019_security_hardening.sql) — clean it up explicitly.
    await supabaseAdmin.from('rate_limit_events').delete().eq('user_id', user.id);

    // 4. Hard-delete the auth user — cascades through every FK'd table.
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
