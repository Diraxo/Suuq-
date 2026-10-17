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
import { handleR2Delete } from '../_shared/r2DeleteHandler.ts';
import { isOwnedKey } from '../_shared/uploadPaths.ts';

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

Deno.serve((req) => {
  const expectedWebhookSecret = Deno.env.get('R2_DELETE_WEBHOOK_SECRET');
  return handleR2Delete(req, {
    log,
    // Strict key shape + ownership (see _shared/uploadPaths.ts). Chat is
    // text-only, so the trusted Postgres webhook (no user id to compare
    // against) is authorized for NO keys; it can authenticate but not delete.
    isAuthorizedKey: (key, userId) => (userId ? isOwnedKey(key, userId) : false),
    // The Postgres secret is still verified; no current database code calls this.
    isTrustedWebhook: (value) => !!value && !!expectedWebhookSecret && timingSafeEqual(value, expectedWebhookSecret),
    verifyJwt: async (jwt) => {
      const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data, error } = await supabaseAdmin.auth.getUser(jwt);
      return error || !data?.user ? null : data.user.id;
    },
    // Called only for keys that already passed the check above. Bucket and
    // host come from server secrets, never from the request.
    deleteObject: async (key) => {
      const accountId = Deno.env.get('R2_ACCOUNT_ID');
      const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID');
      const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
      const bucket = Deno.env.get('R2_BUCKET_NAME');
      if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
        throw new Error('R2 Edge Function secrets are not fully set');
      }
      const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
      return deleteOneWithRetry(client, `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`);
    },
  });
});
