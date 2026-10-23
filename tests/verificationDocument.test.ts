// B2: verification-document request handling. Unit level only (injected authorize/sign). NOT proven here: a real staff JWT, the real
// admin_authorize_verification_document audit write, real Storage signing/expiry, direct-Storage denial — those are staging gate S3
// (docs/STOREFRONTS_0054_OWNER_DECISIONS.md). The SQL side (role matrix, path ownership, one audit row per view) is in storefronts.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleVerificationDocument, TTL_SECONDS, type VerificationDocumentDeps } from '../supabase/functions/_shared/verificationDocumentHandler';

const REQ = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const PATH = `${OWNER}/33333333-3333-4333-8333-333333333333.jpg`;

function setup(over: Partial<VerificationDocumentDeps> = {}) {
  const signed: string[] = [];
  const authorized: { auth: string; request: string; path: string }[] = [];
  const deps: VerificationDocumentDeps = {
    authorize: async (auth, request, path) => (authorized.push({ auth, request, path }), { data: path, error: null }),
    sign: async (path) => (signed.push(path), { signedUrl: `https://storage/sign/${path}?token=t`, error: null }),
    ...over,
  };
  const call = (body: unknown, headers: Record<string, string> = { Authorization: 'Bearer staff-jwt' }, method = 'POST', raw?: string) =>
    handleVerificationDocument(new Request('https://x/verification-document', { method, headers, body: method === 'POST' ? (raw ?? JSON.stringify(body)) : undefined }), deps);
  return { signed, authorized, call };
}
const good = { requestId: REQ, path: PATH };

test('authorized staff: audited RPC runs with the caller JWT, THEN the path is signed for 120 s', async () => {
  const { call, signed, authorized } = setup();
  const res = await call(good);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = await res.json();
  assert.equal(body.expiresInSeconds, 120);
  assert.equal(TTL_SECONDS, 120);
  assert.match(body.signedUrl, /^https:\/\/storage\/sign\//);
  assert.deepEqual(authorized, [{ auth: 'Bearer staff-jwt', request: REQ, path: PATH }]);
  assert.deepEqual(signed, [PATH]);
});

test('unauthorized role (42501): 403 and nothing is signed', async () => {
  const { call, signed } = setup({ authorize: async () => ({ data: null, error: { code: '42501', message: 'Not authorized' } }) });
  assert.equal((await call(good)).status, 403);
  assert.deepEqual(signed, []);
});

test('expired / invalid JWT: 401 and nothing is signed', async () => {
  for (const error of [{ status: 401, message: 'x' }, { code: 'PGRST301', message: 'x' }, { message: 'JWT expired' }]) {
    const { call, signed } = setup({ authorize: async () => ({ data: null, error }) });
    assert.equal((await call(good)).status, 401, JSON.stringify(error));
    assert.deepEqual(signed, []);
  }
});

test('missing / non-bearer Authorization: 401 without calling anything', async () => {
  const { call, signed, authorized } = setup();
  for (const h of [{} as Record<string, string>, { Authorization: 'Basic abc' }, { Authorization: 'Bearer ' }]) assert.equal((await call(good, h)).status, 401);
  assert.deepEqual(authorized, []);
  assert.deepEqual(signed, []);
});

test('cross-request or cross-owner path / missing document (RPC says not found): 404, nothing signed', async () => {
  const { call, signed } = setup({ authorize: async () => ({ data: null, error: { code: 'P0002', message: 'Document not found' } }) });
  assert.equal((await call(good)).status, 404);
  assert.deepEqual(signed, []);
});

test('AUDIT WRITE FAILURE: the RPC errors, so NO signed URL is issued', async () => {
  // The audit insert is inside the RPC; if it fails Postgres raises and the call returns an error (any code other than 42501/auth).
  const { call, signed } = setup({ authorize: async () => ({ data: null, error: { code: '23514', message: 'audit insert failed' } }) });
  const res = await call(good);
  assert.notEqual(res.status, 200);
  assert.deepEqual(signed, []);
  assert.doesNotMatch(JSON.stringify(await res.json()), /storage|token|audit insert/i, 'no internals leaked');
});

test('RPC that throws (network) fails closed: 503, nothing signed', async () => {
  const { call, signed } = setup({ authorize: async () => { throw new Error('boom'); } });
  assert.equal((await call(good)).status, 503);
  assert.deepEqual(signed, []);
});

test('RPC returning a different path than requested (or a non-string) is never signed', async () => {
  for (const data of [`${OWNER}/other.jpg`, null, 42, {}]) {
    const { call, signed } = setup({ authorize: async () => ({ data, error: null }) });
    assert.equal((await call(good)).status, 404);
    assert.deepEqual(signed, []);
  }
});

test('signing failure (error, empty URL, throw): 502 and no URL in the body', async () => {
  const signers: VerificationDocumentDeps['sign'][] = [
    async () => ({ signedUrl: null, error: { m: 'x' } }),
    async () => ({ signedUrl: '', error: null }),
    async () => { throw new Error('x'); },
  ];
  for (const sign of signers) {
    const { call } = setup({ sign });
    const res = await call(good);
    assert.equal(res.status, 502);
    assert.equal((await res.json()).signedUrl, undefined);
  }
});

test('malformed input is rejected before any RPC: bad JSON, missing fields, non-uuid request, traversal / odd paths / disallowed extensions', async () => {
  const { call, authorized, signed } = setup();
  assert.equal((await call(null, undefined, 'POST', '{nope')).status, 400);
  assert.equal((await call({ requestId: REQ })).status, 400);
  assert.equal((await call({ requestId: 'x', path: PATH })).status, 400);
  const badPaths = [`${OWNER}/../${REQ}/a.jpg`, `${OWNER}/a/b.jpg`, `${OWNER}/a.html`, `${OWNER}/a.svg`, 'a.jpg', `/${OWNER}/a.jpg`, `${OWNER}/${'a'.repeat(200)}.jpg`];
  for (const path of badPaths) assert.equal((await call({ requestId: REQ, path })).status, 400, path);
  assert.deepEqual(authorized, []);
  assert.deepEqual(signed, []);
});

test('non-POST is refused', async () => {
  const { call, authorized } = setup();
  assert.equal((await call(null, { Authorization: 'Bearer t' }, 'GET')).status, 405);
  assert.deepEqual(authorized, []);
});

test('static: index.ts authorizes with the anon key + the CALLER JWT and uses the service role only inside sign', () => {
  const src = fs.readFileSync('supabase/functions/verification-document/index.ts', 'utf8');
  assert.match(src, /handleVerificationDocument\(/);
  assert.match(src, /SUPABASE_ANON_KEY[\s\S]*Authorization: authHeader/);
  assert.equal((src.match(/SUPABASE_SERVICE_ROLE_KEY/g) ?? []).length, 1);
  assert.ok(src.indexOf('SUPABASE_SERVICE_ROLE_KEY') > src.indexOf('sign: async'));
});
