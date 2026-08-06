// Deletes Cloudinary assets on the caller's behalf. This is the ONLY place
// that ever touches CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET — they're read
// from Edge Function secrets (`supabase secrets set CLOUDINARY_API_KEY=...
// CLOUDINARY_API_SECRET=...`) and never sent to the client. Mirrors
// supabase/functions/stream-token's shape: verify the caller's Supabase JWT,
// then perform the privileged third-party call server-side.
//
// Called when a listing/avatar/business photo is removed or replaced, to
// keep Cloudinary storage in sync — the equivalent of the old
// supabase.storage.from('listing-images').remove() cleanup calls.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const MAX_RETRIES = 3;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);

function log(event: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ scope: 'cloudinary-delete', event, ...data }));
}

// Cloudinary's batch delete-by-public_id endpoint accepts many ids in a
// single request (they're processed together server-side, not sequentially
// on our end), so no additional client-side parallelization is needed here.
async function cloudinaryBatchDelete(cloudName: string, apiKey: string, apiSecret: string, publicIds: string[]) {
  const params = new URLSearchParams();
  for (const id of publicIds) params.append('public_ids[]', id);
  const basicAuth = btoa(`${apiKey}:${apiSecret}`);
  const url = `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload?${params.toString()}`;

  let lastErrorMessage = 'Cloudinary delete failed';
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Basic ${basicAuth}` } });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data as { deleted?: Record<string, string> };

    lastErrorMessage = data?.error?.message ?? `Cloudinary delete failed (HTTP ${res.status})`;
    const canRetry = RETRYABLE_STATUSES.has(res.status) && attempt < MAX_RETRIES;
    if (!canRetry) {
      throw new Error(lastErrorMessage);
    }
    const backoffMs = 500 * 2 ** attempt; // 500ms, 1000ms, 2000ms
    log('retry', { attempt: attempt + 1, status: res.status, backoffMs });
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }
  throw new Error(lastErrorMessage);
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

    const { publicIds: rawPublicIds } = (await req.json()) as { publicIds?: string[] };
    if (!Array.isArray(rawPublicIds) || rawPublicIds.length === 0) {
      return new Response(JSON.stringify({ error: 'publicIds must be a non-empty array' }), { status: 400 });
    }
    // Dedupe to avoid redundant Cloudinary API calls when a caller (or a
    // retried client request) sends the same id more than once.
    const publicIds = [...new Set(rawPublicIds.filter(Boolean))];

    // Ownership guard: every asset this function is allowed to delete must
    // live under a folder scoped to the caller's own user id (matches the
    // suuqplus/{listings,avatars,business}/{userId}/... upload convention in
    // lib/cloudinary.ts / hooks/useImageUpload.ts). Matched as a whole path
    // segment (not a substring) so a crafted id can't smuggle another user's
    // real segment alongside a coincidental match of the caller's own uuid.
    const owned = publicIds.every((id) => id.split('/').includes(user.id));
    if (!owned) {
      return new Response(JSON.stringify({ error: 'One or more assets are not owned by this user' }), { status: 403 });
    }

    const cloudName = Deno.env.get('CLOUDINARY_CLOUD_NAME') ?? Deno.env.get('EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME');
    const apiKey = Deno.env.get('CLOUDINARY_API_KEY');
    const apiSecret = Deno.env.get('CLOUDINARY_API_SECRET');
    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error('Cloudinary Edge Function secrets are not set (CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET)');
    }

    log('deleting', { count: publicIds.length, userId: user.id });
    const data = await cloudinaryBatchDelete(cloudName, apiKey, apiSecret, publicIds);

    // Cloudinary's batch endpoint returns HTTP 200 with a per-id status map
    // even when some/all ids are already gone — "not_found" is treated as a
    // successful (idempotent) delete, not an error, same as "deleted".
    const deleted = data.deleted ?? {};
    const succeeded: string[] = [];
    const failed: string[] = [];
    for (const id of publicIds) {
      const status = deleted[id];
      if (status === 'deleted' || status === 'not_found') succeeded.push(id);
      else failed.push(id);
    }
    log('result', {
      succeeded: succeeded.length,
      failed: failed.length,
      notFound: Object.values(deleted).filter((s) => s === 'not_found').length,
      failedIds: failed.length ? failed : undefined,
    });

    return new Response(JSON.stringify({ deleted, succeeded, failed }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    log('error', { message: String(err) });
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
