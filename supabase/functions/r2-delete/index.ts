// Deletes Cloudflare R2 objects on the caller's behalf. This is the ONLY
// place (besides r2-presign) that ever touches R2_ACCESS_KEY_ID /
// R2_SECRET_ACCESS_KEY — they're read from Edge Function secrets
// (`supabase secrets set R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=...
// R2_SECRET_ACCESS_KEY=... R2_BUCKET_NAME=...`) and never sent to the
// client. Replaces the old cloudinary-delete function; same pattern: verify
// the caller's Supabase JWT, then perform the privileged call server-side.
//
// Called when a listing/avatar/business photo is removed or replaced, to
// keep R2 storage in sync. Also called by public.delete_message() (see
// 0025_chat_image_r2_cleanup.sql) via a shared-secret webhook header instead
// of a user JWT — Postgres has no user session to present, but it has
// already verified message ownership itself before making the call, so the
// per-key `owned` folder check below is skipped for that trusted path only
// (identical pattern to send-push-notification's X-Push-Webhook-Secret).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

const MAX_RETRIES = 3;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);

function log(event: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ scope: 'r2-delete', event, ...data }));
}

// Constant-time comparison so a mismatched secret can't be brute-forced via
// response-time differences (same helper as send-push-notification).
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

// R2/S3 DELETE is idempotent and returns 204 whether or not the object
// existed, so "already gone" and "just deleted" are both treated as success
// — same idempotent-delete semantics the old Cloudinary batch endpoint had.
async function deleteOneWithRetry(client: AwsClient, objectUrl: string): Promise<boolean> {
  let lastStatus = 0;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const signedReq = await client.sign(objectUrl, { method: 'DELETE' });
    const res = await fetch(signedReq);
    if (res.ok || res.status === 404) return true;

    lastStatus = res.status;
    const canRetry = RETRYABLE_STATUSES.has(res.status) && attempt < MAX_RETRIES;
    if (!canRetry) return false;

    const backoffMs = 500 * 2 ** attempt; // 500ms, 1000ms, 2000ms
    log('retry', { attempt: attempt + 1, status: lastStatus, backoffMs });
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }
  return false;
}

Deno.serve(async (req) => {
  try {
    // Trusted internal path: only public.delete_message() (Postgres, via
    // net.http_post) can present this header, since the value only lives in
    // private.settings and this function's own Edge Function secret — never
    // sent to or reachable from the client. Ownership was already verified
    // in SQL (the message row's sender_id = auth.uid()) before this call was
    // made, so the folder-ownership check below is intentionally skipped
    // only on this branch — it never trusts a client-supplied path.
    const webhookSecret = req.headers.get('X-R2-Delete-Webhook-Secret');
    const expectedWebhookSecret = Deno.env.get('R2_DELETE_WEBHOOK_SECRET');
    const isTrustedWebhookCall = !!webhookSecret && !!expectedWebhookSecret && timingSafeEqual(webhookSecret, expectedWebhookSecret);

    let userId: string | null = null;
    if (!isTrustedWebhookCall) {
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
      userId = user.id;
    }

    const { keys: rawKeys } = (await req.json()) as { keys?: string[] };
    if (!Array.isArray(rawKeys) || rawKeys.length === 0) {
      return new Response(JSON.stringify({ error: 'keys must be a non-empty array' }), { status: 400 });
    }
    // Dedupe to avoid redundant R2 calls when a caller (or a retried client
    // request) sends the same key more than once.
    const keys = [...new Set(rawKeys.filter(Boolean))];

    // Ownership guard (client-JWT path only): every object this function is
    // allowed to delete must live under a path scoped to the caller's own
    // user id (matches the listings/{userId}/..., avatars/{userId},
    // business/{userId}/logo|banner, chat/{conversationId}/{userId}
    // convention from r2-presign / lib/r2.ts). Matched as a whole path
    // segment (not a substring) so a crafted key can't smuggle another
    // user's real segment alongside a coincidental match of the caller's own uuid.
    if (userId) {
      const owned = keys.every((key) => key.split('/').includes(userId as string));
      if (!owned) {
        return new Response(JSON.stringify({ error: 'One or more assets are not owned by this user' }), { status: 403 });
      }
    }

    const accountId = Deno.env.get('R2_ACCOUNT_ID');
    const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID');
    const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
    const bucket = Deno.env.get('R2_BUCKET_NAME');
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
      throw new Error('R2 Edge Function secrets are not fully set (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME)');
    }

    const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });

    log('deleting', { count: keys.length, userId: userId ?? 'webhook:delete_message' });
    const succeeded: string[] = [];
    const failed: string[] = [];
    // R2's batch delete endpoint requires signing an XML body, which is more
    // moving parts than this repo's typical upload batches (at most 8
    // listing photos + a handful of profile images) justify — per-key
    // signed DELETE requests in parallel keep this as simple/self-contained
    // as cloudinary-delete was.
    await Promise.all(
      keys.map(async (key) => {
        const ok = await deleteOneWithRetry(client, `${endpoint}/${bucket}/${key}`);
        (ok ? succeeded : failed).push(key);
      })
    );

    log('result', { succeeded: succeeded.length, failed: failed.length, failedKeys: failed.length ? failed : undefined });

    return new Response(JSON.stringify({ succeeded, failed }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    log('error', { message: String(err) });
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
