// Request handling for verification-document (B2), side effects injected so it is unit-tested in node without Deno or Supabase.
// Order is the security property: authorize + audit (under the CALLER's JWT, in one RPC) -> only then sign. Nothing is signed if the
// RPC fails for ANY reason (not staff, wrong path, audit insert failed, expired JWT, network error).

export const TTL_SECONDS = 120;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH = /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,100}\.(jpe?g|png|webp|pdf)$/i;

export type RpcError = { code?: string; status?: number; message?: string } | null;
export type VerificationDocumentDeps = {
  /** Calls admin_authorize_verification_document under the caller's JWT. Returns the authorized path, or an error. */
  authorize: (authHeader: string, requestId: string, path: string) => Promise<{ data: unknown; error: RpcError }>;
  /** Signs with the service role. Called only after authorize succeeded. */
  sign: (path: string, ttlSeconds: number) => Promise<{ signedUrl: string | null; error: unknown }>;
  log?: (event: string, data?: Record<string, unknown>) => void;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function handleVerificationDocument(req: Request, deps: VerificationDocumentDeps): Promise<Response> {
  const log = deps.log ?? (() => {});
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ') || auth.trim().length <= 'Bearer'.length) return json(401, { error: 'Unauthorized' });

  let body: { requestId?: unknown; path?: unknown };
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid JSON' }); }
  if (typeof body?.requestId !== 'string' || typeof body?.path !== 'string') return json(400, { error: 'requestId and path are required' });
  if (!UUID.test(body.requestId) || !PATH.test(body.path) || body.path.includes('..')) return json(400, { error: 'Invalid requestId or path' });

  let authorized: { data: unknown; error: RpcError };
  try {
    authorized = await deps.authorize(auth, body.requestId, body.path);
  } catch {
    log('authorize_threw');
    return json(503, { error: 'Authorization unavailable' });
  }
  const { data, error } = authorized;
  if (error) {
    // 42501 = not staff; 401 / PGRST301 / JWT* = missing, expired or invalid token; anything else (P0002 not found, an audit insert
    // failure, ...) = no URL. The body never echoes the database error.
    const msg = `${error.message ?? ''}`;
    const unauthenticated = error.status === 401 || error.code === 'PGRST301' || error.code === 'PGRST303' || /jwt/i.test(msg);
    log('authorize_refused', { code: error.code ?? null, status: error.status ?? null });
    if (unauthenticated) return json(401, { error: 'Unauthorized' });
    return error.code === '42501' ? json(403, { error: 'Not authorized' }) : json(404, { error: 'Document not found' });
  }
  // The RPC returns exactly the path it authorized; never sign anything else.
  if (typeof data !== 'string' || data !== body.path) return json(404, { error: 'Document not found' });

  let signed: { signedUrl: string | null; error: unknown };
  try {
    signed = await deps.sign(data, TTL_SECONDS);
  } catch {
    log('sign_threw');
    return json(502, { error: 'Could not sign the document' });
  }
  if (signed.error || !signed.signedUrl) {
    log('sign_failed');
    return json(502, { error: 'Could not sign the document' });
  }
  return json(200, { signedUrl: signed.signedUrl, expiresInSeconds: TTL_SECONDS });
}
