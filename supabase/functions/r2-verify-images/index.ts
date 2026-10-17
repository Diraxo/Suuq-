// Server-side check of what actually landed in R2 after a client-side upload.
//
// WHY THIS EXISTS: r2-presign hands out a presigned PUT URL, and a presigned
// PUT can bind the Content-Type but not the *bytes* — so a modified client can
// still PUT a text file, a script, an SVG or a 500 MB blob to a key that is
// then served from the public bucket URL. Everything the apps do before upload
// (image-only pickers, extension checks, re-encoding to JPEG) is a usability
// layer a hand-written request simply skips. This function is the trusted
// boundary: it reads the stored object back with the R2 credential (which only
// lives in Edge Function secrets) and applies the format/size/structure
// allowlist in _shared/imageBytes.ts. Anything that is not a complete, sane
// JPEG is DELETED from the bucket and reported as invalid.
//
// STATUS: written but NOT deployed and NOT yet called by the apps — wiring it
// into the publish paths (and optionally closing the "skip the verify call"
// gap with a staging prefix + server-side copy, see docs/SELL_AUDIT.md §5) is a
// coordinated deploy that needs approval. Nothing here changes behavior until
// then.
//
// Request:  POST { keys: string[] }   (Authorization: Bearer <user JWT>)
// Response: { verified: string[], invalid: { key, reason }[], missing: string[] }

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';
import { checkImageBytes, MAX_IMAGE_BYTES } from '../_shared/imageBytes.ts';
import { isOwnedKey } from '../_shared/uploadPaths.ts';

const MAX_KEYS_PER_REQUEST = 10;
function log(event: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ scope: 'r2-verify-images', event, ...data }));
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Missing Authorization header' }, 401);

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(authHeader.slice('Bearer '.length));
    if (userError || !user) return json({ error: 'Not authenticated' }, 401);

    const { keys } = (await req.json()) as { keys?: unknown };
    if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_KEYS_PER_REQUEST || keys.some((k) => typeof k !== 'string')) {
      return json({ error: `keys must be 1-${MAX_KEYS_PER_REQUEST} strings` }, 400);
    }
    if (!(keys as string[]).every((k) => isOwnedKey(k, user.id))) return json({ error: 'key is not owned by this user' }, 403);

    const accountId = Deno.env.get('R2_ACCOUNT_ID');
    const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID');
    const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
    const bucket = Deno.env.get('R2_BUCKET_NAME');
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) throw new Error('R2 Edge Function secrets are not fully set');

    const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });

    const verified: string[] = [];
    const invalid: { key: string; reason: string }[] = [];
    const missing: string[] = [];

    for (const key of keys as string[]) {
      const url = `${endpoint}/${bucket}/${key}`;
      let reason: string | null = null;

      const head = await client.fetch(url, { method: 'HEAD' });
      if (head.status === 404) {
        missing.push(key);
        continue;
      }
      if (!head.ok) throw new Error(`HEAD ${key} failed with ${head.status}`);

      const declared = Number(head.headers.get('content-length') ?? '0');
      if (declared > MAX_IMAGE_BYTES) {
        reason = 'too-large';
      } else {
        const res = await client.fetch(url, { method: 'GET' });
        if (!res.ok) throw new Error(`GET ${key} failed with ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        // Everything the apps upload is re-encoded JPEG, so anything else at
        // an "<uuid>.jpg" key is by definition not what the apps produced.
        const check = checkImageBytes(bytes, { allowed: ['jpeg'] });
        if (!check.ok) reason = check.reason;
      }

      if (reason) {
        // Remove the offending object so the public URL stops serving it.
        const del = await client.fetch(url, { method: 'DELETE' });
        log('rejected', { userId: user.id, key, reason, deleted: del.ok });
        invalid.push({ key, reason });
      } else {
        verified.push(key);
      }
    }

    return json({ verified, invalid, missing });
  } catch (err) {
    log('error', { message: String(err) });
    // Never echo internals (bucket names, stack traces) to the caller.
    return json({ error: 'Could not verify images. Try again.' }, 500);
  }
});
