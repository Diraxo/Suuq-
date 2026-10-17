// HTTP entry for the listing-photo scan Worker. UNVERIFIED against real Cloudflare (see cloudflare.ts).
//
//   POST /v1/scans    multipart: listingId, categoryId, title, [description], photo0..photo7   (Bearer <Supabase JWT>)
//   POST /v1/promote  json: { imageId }                                                         (staff JWT)
//   GET  /v1/evidence?imageId=…   the stored photo for a flagged image, for staff review only       (staff JWT)
//
// The caller is authenticated by asking Supabase who the JWT belongs to; scan results are written with the
// service key, which only ever lives in Worker secrets.

import { CATEGORY_POLICY } from '../../../lib/imageSafety';
import { createBulkDb, createDb, createImaging, createStorage, type Env } from './cloudflare';
import { processBulkQueue } from './bulk';
import { promoteHeld, runScan, ScanError, type Deps } from './pipeline';
import { createVision } from './vision';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 8 * 10 * 1024 * 1024 + 64 * 1024;

const STATUS: Record<ScanError['code'], number> = { bad_request: 400, unsupported_image: 422, rate_limited: 429, in_progress: 409, internal: 500 };
// Only these short, user-safe strings ever leave the Worker.
const MESSAGE: Record<ScanError['code'], string> = {
  bad_request: 'Invalid request.',
  unsupported_image: 'One of the photos could not be read. Please choose a different photo.',
  rate_limited: 'Too many checks. Please try again in a little while.',
  in_progress: 'Your photos are already being checked.',
  internal: 'We couldn’t finish checking your photos. Your draft is safe. Please try again.',
};

function cors(env: Env, req: Request): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get('origin');
  return {
    ...(origin && allowed.includes(origin) ? { 'access-control-allow-origin': origin, vary: 'origin' } : {}),
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  };
}

/** Everything runScan needs, wired to real Cloudflare/Supabase/Vision. Shared by the interactive endpoint and the bulk consumer. */
function buildDeps(env: Env, categoryId: string): Deps {
  return {
    sha256Hex: async (b) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b as unknown as BufferSource))).map((x) => x.toString(16).padStart(2, '0')).join(''),
    uuid: () => crypto.randomUUID(),
    ...createImaging(env),
    vision: createVision(env.VISION_API_KEY, categoryId),
    storage: createStorage(env),
    db: createDb(env),
    now: () => Date.now(),
    rejectedOriginal: env.REJECTED_ORIGINAL_POLICY === 'delete' ? 'delete' : 'retain',
  };
}

const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });

async function authenticate(env: Env, req: Request): Promise<{ id: string; jwt: string } | null> {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const jwt = auth.slice(7);
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${jwt}` } });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: string };
  return user.id && UUID.test(user.id) ? { id: user.id, jwt } : null;
}

export default {
  /** Cron: drains a few bulk-queue rows. Inert unless BULK_ENABLED=true (and the database switch is on). */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    if (env.BULK_ENABLED !== 'true') return;
    const summary = await processBulkQueue(
      {
        db: createBulkDb(env),
        fetch: (url, init) => fetch(url, init),
        scan: (req) => runScan(req, buildDeps(env, req.context.categoryId)),
        log: (event, data) => console.log(JSON.stringify({ scope: 'image-scan', event, ...data })),
      },
      Number(env.BULK_CLAIM_LIMIT ?? 4) || 4,
    );
    console.log(JSON.stringify({ scope: 'image-scan', event: 'bulk-run', ...summary }));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const headers = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(req.url);
    try {
      if (req.method !== 'POST' && !(req.method === 'GET' && url.pathname === '/v1/evidence')) return json({ error: 'not_found' }, 404, headers);
      const user = await authenticate(env, req);
      if (!user) return json({ error: 'unauthorized' }, 401, headers);

      if (url.pathname === '/v1/evidence') {
        const imageId = url.searchParams.get('imageId') ?? '';
        if (!UUID.test(imageId)) throw new ScanError('bad_request', 'bad imageId');
        // RLS on listing_scan_images lets only moderators/admins read the row; no row → no access.
        const res = await fetch(`${env.SUPABASE_URL}/rest/v1/listing_scan_images?id=eq.${imageId}&select=public_key,source_key`, {
          headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${user.jwt}` },
        });
        const row = res.ok ? ((await res.json()) as { public_key: string | null; source_key: string | null }[])[0] : undefined;
        if (!row) return json({ error: 'forbidden' }, 403, headers);
        const store = createStorage(env);
        // Prefer the watermarked held copy; fall back to the original. Purged evidence is simply gone.
        const bytes = (row.public_key && (await store.getPrivate(`pending/${row.public_key}`))) || (row.source_key && (await store.getPrivate(row.source_key))) || null;
        console.log(JSON.stringify({ scope: 'image-scan', event: 'evidence-viewed', staff: user.id, imageId, found: !!bytes }));
        if (!bytes) return json({ error: 'gone' }, 404, headers);
        return new Response(bytes as unknown as BodyInit, { status: 200, headers: { ...headers, 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
      }

      if (url.pathname === '/v1/scans') {
        if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return json({ code: 'bad_request', message: MESSAGE.bad_request }, 413, headers);
        const form = await req.formData();
        const listingId = String(form.get('listingId') ?? '');
        const categoryId = String(form.get('categoryId') ?? '').slice(0, 40);
        const title = String(form.get('title') ?? '').slice(0, 200);
        const description = String(form.get('description') ?? '').slice(0, 5000);
        if (!UUID.test(listingId) || !categoryId || !title.trim()) throw new ScanError('bad_request', 'bad fields');
        const photos: { bytes: Uint8Array }[] = [];
        for (let i = 0; i < 9; i++) {
          const f = form.get(`photo${i}`);
          if (f && typeof f !== 'string') photos.push({ bytes: new Uint8Array(await (f as File).arrayBuffer()) });
        }
        const result = await runScan(
          { userId: user.id, listingId, context: { categoryId, categoryLabel: CATEGORY_POLICY[categoryId] ? categoryId : 'category', title, description }, photos },
          buildDeps(env, categoryId),
        );
        return json(result, 200, headers);
      }

      if (url.pathname === '/v1/promote') {
        const body = (await req.json()) as { imageId?: string };
        if (!body.imageId || !UUID.test(body.imageId)) throw new ScanError('bad_request', 'bad imageId');
        // The caller's own JWT is used so RLS decides: only staff can read listing_scan_images at all.
        const res = await fetch(`${env.SUPABASE_URL}/rest/v1/listing_scan_images?id=eq.${body.imageId}&select=public_key,review_status`, {
          headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${user.jwt}` },
        });
        const row = res.ok ? ((await res.json()) as { public_key: string | null; review_status: string }[])[0] : undefined;
        if (!row?.public_key) return json({ error: 'forbidden' }, 403, headers);
        const publicUrl = await promoteHeld({ publicKey: row.public_key, reviewApproved: row.review_status === 'approved' }, { storage: createStorage(env) });
        return json({ url: publicUrl }, 200, headers);
      }
      return json({ error: 'not_found' }, 404, headers);
    } catch (e) {
      const code = e instanceof ScanError ? e.code : 'internal';
      // Full detail goes to the Worker log only; the caller gets a short generic message.
      console.log(JSON.stringify({ scope: 'image-scan', code, message: String(e), detail: e instanceof ScanError ? e.detail : undefined }));
      return json({ code, message: MESSAGE[code] }, STATUS[code], headers);
    }
  },
};
