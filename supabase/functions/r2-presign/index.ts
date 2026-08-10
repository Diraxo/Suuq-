// Issues short-lived presigned Cloudflare R2 (S3-compatible) PUT URLs so the
// client can upload an image directly to R2 without ever holding the R2
// secret access key — mirrors the ownership-scoped JWT pattern the old
// cloudinary-delete function used: verify the caller's Supabase JWT, then
// perform the privileged (credentialed) step server-side.
//
// Called once per photo by lib/r2.ts's uploadToR2() (listing photos,
// avatar, business logo/banner, review/chat images).

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

// Presigned URLs are single-purpose and short-lived on purpose — long enough
// to cover a slow upload, short enough that a leaked URL isn't useful later.
const PRESIGN_EXPIRES_SECONDS = 300;
const MAX_KEYS_PER_REQUEST = 10;

function log(event: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ scope: 'r2-presign', event, ...data }));
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

    const { folder, count } = (await req.json()) as { folder?: string; count?: number };
    if (!folder || typeof folder !== 'string') {
      return new Response(JSON.stringify({ error: 'folder is required' }), { status: 400 });
    }
    const n = Math.min(Math.max(Math.trunc(Number(count)) || 1, 1), MAX_KEYS_PER_REQUEST);

    // Ownership guard: the caller may only request keys under a folder that
    // contains their own user id as a whole path segment — matches the
    // listings/{userId}/..., avatars/{userId}, business/{userId}/logo|banner
    // convention used across the app. Matched as a whole segment (not a
    // substring) so a crafted folder can't smuggle another user's real
    // segment alongside a coincidental match of the caller's own uuid.
    if (!folder.split('/').includes(user.id)) {
      return new Response(JSON.stringify({ error: 'folder is not owned by this user' }), { status: 403 });
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
      // No headers signed here on purpose — a presigned PUT with only `host`
      // in its signed headers still lets the client set Content-Type freely
      // on the actual upload (R2 records whatever value is sent; it's just
      // not cryptographically bound to the signature), which keeps this
      // robust to lib/r2.ts always sending 'image/jpeg' without the two
      // sides needing to agree on a byte-for-byte identical header set.
      const signed = await client.sign(objectUrl, {
        method: 'PUT',
        aws: { signQuery: true, expires: PRESIGN_EXPIRES_SECONDS },
      });
      uploads.push({
        key,
        uploadUrl: signed.url,
        publicUrl: `${publicBaseUrl.replace(/\/$/, '')}/${key}`,
      });
    }

    log('presigned', { count: uploads.length, userId: user.id, folder });
    return new Response(JSON.stringify({ uploads }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    log('error', { message: String(err) });
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
