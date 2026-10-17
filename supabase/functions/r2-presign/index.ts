// Issues short-lived presigned Cloudflare R2 (S3-compatible) PUT URLs so the
// client can upload an image directly to R2 without ever holding the R2
// secret access key — mirrors the ownership-scoped JWT pattern the old
// cloudinary-delete function used: verify the caller's Supabase JWT, then
// perform the privileged (credentialed) step server-side.
//
// Called once per photo by lib/r2.ts's uploadToR2() (listing photos,
// avatar, business logo/banner, review images).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';
import { isAllowedFolder } from '../_shared/uploadPaths.ts';
import { presignPut } from '../_shared/presign.ts';
import { listingPresignGate, readClosedFlag, isListingFolder } from '../_shared/scanPolicy.ts';

// URLs are short-lived (300 s, see _shared/presign.ts) and bound to
// Content-Type image/jpeg, which every client sends after re-encoding.
const MAX_KEYS_PER_REQUEST = 10;

function log(event: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ scope: 'r2-presign', event, ...data }));
}

// The web app calls this from the browser, so the OPTIONS preflight must be
// answered (and verify_jwt must be off at the gateway — a preflight carries no
// Authorization header). The handler below verifies the caller's JWT itself.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Missing Authorization header' }, 401);
    }
    const jwt = authHeader.slice('Bearer '.length);

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(jwt);
    if (userError || !user) {
      return json({ error: 'Not authenticated' }, 401);
    }

    const { folder, count } = (await req.json()) as { folder?: string; count?: number };
    if (!folder || typeof folder !== 'string') {
      return json({ error: 'folder is required' }, 400);
    }
    const n = Math.min(Math.max(Math.trunc(Number(count)) || 1, 1), MAX_KEYS_PER_REQUEST);

    // Ownership + shape guard. The folder must be exactly one of the
    // app's known layouts and contain the caller's own user id as a whole
    // segment:
    //   listings/{uid}[/{draftId}]   avatars/{uid}   business/{uid}/(logo|banner)
    // (no chat/ folder: chat is text-only)
    // A looser "contains my uid somewhere" check is not enough: the object URL
    // is built by string concatenation and then normalised by the URL parser,
    // so a crafted folder like `x/{myUid}/../../listings/{victimUid}` would
    // collapse into another user's namespace. Every segment is therefore
    // restricted to [A-Za-z0-9_-] — no '.', '..', empty segments or slashes
    // beyond the allowed layouts.
    if (!isAllowedFolder(folder, user.id)) {
      return json({ error: 'folder is not allowed for this user' }, 403);
    }

    // Once photo checks are enforced, listing photos must arrive through the scan Worker as watermarked derivatives;
    // a presigned PUT into the public listings/ folder would bypass that (migration 0050, _shared/scanPolicy.ts).
    if (isListingFolder(folder)) {
      const gate = listingPresignGate(folder, readClosedFlag(await supabaseAdmin.rpc('legacy_presign_closed')));
      if (!gate.allow) {
        log('listing-presign-refused', { userId: user.id, code: gate.code });
        return json({ error: gate.message, code: gate.code }, gate.status);
      }
    }

    const accountId = Deno.env.get('R2_ACCOUNT_ID');
    const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID');
    const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
    const bucket = Deno.env.get('R2_BUCKET_NAME');
    // Public delivery base for this bucket — either R2's own pub-*.r2.dev
    // Public Development URL, or a custom domain connected to the bucket in
    // the Cloudflare dashboard. Never the private S3 API endpoint.
    const publicBaseUrl = Deno.env.get('R2_PUBLIC_URL');
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
      throw new Error('R2 Edge Function secrets are not fully set (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME/R2_PUBLIC_URL)');
    }

    const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });

    const uploads = [];
    for (let i = 0; i < n; i++) {
      // Never trust a device filename for the object key — generate a
      // collision-proof id server-side instead.
      const key = `${folder}/${crypto.randomUUID()}.jpg`;
      const objectUrl = `${endpoint}/${bucket}/${key}`;
      // Content-Type is signed (it becomes part of the signature) so an
      // upload can't claim to be text/html, image/svg+xml etc. Size/format of
      // the bytes themselves can't be bound into a presigned PUT; clients
      // re-encode to JPEG first. (r2-verify-images would re-check server-side
      // but is not deployed or called yet.)
      const uploadUrl = await presignPut(client, objectUrl);
      uploads.push({
        key,
        uploadUrl,
        publicUrl: `${publicBaseUrl.replace(/\/$/, '')}/${key}`,
      });
    }

    log('presigned', { count: uploads.length, userId: user.id, folder });
    return json({ uploads }, 200);
  } catch (err) {
    log('error', { message: String(err) });
    // Logged in full above; the caller only gets a generic message (the raw error can name secrets/config).
    return json({ error: 'Could not prepare image upload. Try again.' }, 500);
  }
});
