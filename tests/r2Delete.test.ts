import test from 'node:test';
import assert from 'node:assert/strict';
import { handleR2Delete, MAX_KEYS_PER_REQUEST, type R2DeleteDeps } from '../supabase/functions/_shared/r2DeleteHandler';
import { isOwnedKey } from '../supabase/functions/_shared/uploadPaths';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const F = '33333333-3333-4333-8333-333333333333.jpg';
const SECRET = 'hook-secret';

function setup(over: Partial<R2DeleteDeps> = {}) {
  const deleted: string[] = [];
  const deps: R2DeleteDeps = {
    verifyJwt: async (jwt) => (jwt === 'jwt-a' ? A : jwt === 'jwt-b' ? B : null),
    isTrustedWebhook: (v) => v === SECRET,
    isAuthorizedKey: (key, uid) => (uid ? isOwnedKey(key, uid) : false), // mirrors r2-delete/index.ts
    deleteObject: async (key) => (deleted.push(key), true),
    ...over,
  };
  const call = (keys: unknown, headers: Record<string, string> = { Authorization: 'Bearer jwt-a' }, rawBody?: string) =>
    handleR2Delete(new Request('https://x/r2-delete', { method: 'POST', headers, body: rawBody ?? JSON.stringify({ keys }) }), deps);
  return { deleted, call };
}

test('legitimate user deletes each real key layout (response shape preserved)', async () => {
  const keys = [
    `listings/${A}/${F}`,
    `listings/${A}/draft-1_x/${F}`,
    `avatars/${A}/${F}`,
    `business/${A}/logo/${F}`,
    `business/${A}/banner/${F}`,
    `chat/conv-1/${A}/${F}`,
  ];
  const { deleted, call } = setup();
  const res = await call(keys);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['failed', 'succeeded']);
  assert.deepEqual([...body.succeeded].sort(), [...keys].sort());
  assert.deepEqual(body.failed, []);
  assert.equal(deleted.length, keys.length);
});

test('failed deletes are reported in `failed`', async () => {
  const { call } = setup({ deleteObject: async () => false });
  const body = await (await call([`listings/${A}/${F}`, `listings/${A}/${F}`])).json();
  assert.deepEqual(body, { succeeded: [], failed: [`listings/${A}/${F}`] });
});

test("user A cannot delete user B's photos", async () => {
  for (const key of [`listings/${B}/${F}`, `listings/${B}/d1/${F}`, `avatars/${B}/${F}`, `business/${B}/logo/${F}`, `chat/c1/${B}/${F}`]) {
    const { deleted, call } = setup();
    assert.equal((await call([key])).status, 403, key);
    assert.deepEqual(deleted, []);
  }
});

test('one foreign key rejects the whole batch - nothing is deleted', async () => {
  const { deleted, call } = setup();
  assert.equal((await call([`listings/${A}/${F}`, `listings/${B}/${F}`])).status, 403);
  assert.deepEqual(deleted, []);
});

const rejected: [string, string][] = [
  ['reported traversal', `x/${A}/../../listings/${B}/f.jpg`],
  ['traversal under valid prefix', `listings/${A}/../${B}/${F}`],
  ['traversal into victim', `listings/${A}/../../listings/${B}/${F}`],
  ['trailing traversal', `listings/${A}/${F}/..`],
  ['dot segment', `listings/${A}/./${F}`],
  ['absolute https URL', `https://evil.example/listings/${A}/${F}`],
  ['protocol-relative URL', `//evil.example/listings/${A}/${F}`],
  ['leading slash', `/listings/${A}/${F}`],
  ['backslash separators', `listings\\${A}\\${F}`],
  ['backslash traversal', `listings/${A}\\..\\${B}/${F}`],
  ['encoded traversal %2e%2e', `listings/${A}/%2e%2e/${B}/${F}`],
  ['encoded slash %2f', `listings%2f${A}%2f${F}`],
  ['encoded dot-dot variant', `listings/${A}/%2E%2E%2F${B}/${F}`],
  ['double-encoded', `listings/${A}/%252e%252e/${B}/${F}`],
  ['repeated separators', `listings//${A}/${F}`],
  ['repeated separators 2', `listings/${A}//${F}`],
  ['trailing slash', `listings/${A}/${F}/`],
  ['uid only appears somewhere', `x/${A}/${F}`],
  ['unexpected prefix', `staging/${A}/${F}`],
  ['uid in wrong position', `avatars/x/${A}/${F}`],
  ['bare uid', A],
  ['no file name', `listings/${A}`],
  ['non-uuid file name', `listings/${A}/photo.jpg`],
  ['non-jpg extension', `listings/${A}/${F.replace('.jpg', '.html')}`],
  ['NUL byte', `listings/${A}/${F}\0`],
  ['query string', `listings/${A}/${F}?x=1`],
  ['fragment', `listings/${A}/${F}#x`],
  ['whitespace', `listings/${A}/ ${F}`],
  ['unknown business subfolder', `business/${A}/other/${F}`],
  ['newline suffix', `listings/${A}/${F}\n`],
];
for (const [name, key] of rejected) {
  test(`rejects: ${name}`, async () => {
    const { deleted, call } = setup();
    const res = await call([key]);
    assert.ok([400, 403].includes(res.status), `status ${res.status}`);
    assert.deepEqual(deleted, [], 'no R2 DELETE may be signed or sent');
  });
}

test('malformed bodies are rejected with no deletes', async () => {
  const tooMany = Array.from({ length: MAX_KEYS_PER_REQUEST + 1 }, (_, i) => `listings/${A}/${i}`);
  for (const keys of [undefined, null, 'listings', {}, [], [1], [null], [{}], [[`listings/${A}/${F}`]], [''], tooMany]) {
    const { deleted, call } = setup();
    assert.equal((await call(keys)).status, 400, JSON.stringify(keys)?.slice(0, 40));
    assert.deepEqual(deleted, []);
  }
  const { deleted, call } = setup();
  assert.equal((await call(undefined, undefined, '{not json')).status, 400);
  assert.deepEqual(deleted, []);
});

test('a user id supplied in the request body is ignored (identity comes from the JWT)', async () => {
  const { deleted, call } = setup();
  const res = await call(undefined, { Authorization: 'Bearer jwt-a' }, JSON.stringify({ keys: [`listings/${B}/${F}`], userId: B, user_id: B }));
  assert.equal(res.status, 403);
  assert.deepEqual(deleted, []);
});

test('missing / invalid / throwing authentication is rejected', async () => {
  const key = [`listings/${A}/${F}`];
  const throwing = {
    verifyJwt: async () => {
      throw new Error('auth down');
    },
  };
  const cases: [Record<string, string>, Partial<R2DeleteDeps>?][] = [
    [{}],
    [{ Authorization: 'jwt-a' }],
    [{ Authorization: 'Basic abc' }],
    [{ Authorization: 'Bearer ' }],
    [{ Authorization: 'Bearer bogus' }],
    [{ Authorization: 'Bearer jwt-a' }, throwing],
    [{ 'X-R2-Delete-Webhook-Secret': 'wrong' }],
    [{ 'X-R2-Delete-Webhook-Secret': '' }],
  ];
  for (const [headers, over] of cases) {
    const { deleted, call } = setup(over);
    assert.equal((await call(key, headers)).status, 401, JSON.stringify(headers));
    assert.deepEqual(deleted, []);
  }
});

test('fails closed when the authorization check itself throws (no delete, generic 500)', async () => {
  const { deleted, call } = setup({
    isAuthorizedKey: () => {
      throw new Error('lookup failed: secret-detail');
    },
  });
  const res = await call([`listings/${A}/${F}`]);
  assert.equal(res.status, 500);
  assert.deepEqual(deleted, []);
  assert.ok(!JSON.stringify(await res.json()).includes('secret-detail'), '500 body must not leak the error');
});

test('a throwing R2 call is reported as failed, not as success', async () => {
  const { call } = setup({
    deleteObject: async () => {
      throw new Error('R2 down');
    },
  });
  const body = await (await call([`listings/${A}/${F}`])).json();
  assert.deepEqual(body, { succeeded: [], failed: [`listings/${A}/${F}`] });
});

test('trusted webhook authenticates but is authorized for NO keys (chat is text-only)', async () => {
  const hook = { 'X-R2-Delete-Webhook-Secret': SECRET };
  for (const key of [`chat/conv-1/${A}/${F}`, `chat/conv-2/${B}/${F}`, `listings/${A}/${F}`, `avatars/${A}/${F}`, `chat/c/../../listings/${B}/${F}`]) {
    const bad = setup();
    assert.equal((await bad.call([key], hook)).status, 403, key);
    assert.deepEqual(bad.deleted, []);
  }
});

test('ownership helpers: uid format and prefix confusion', () => {
  assert.equal(isOwnedKey(`listings/${A}/${F}`, A), true);
  assert.equal(isOwnedKey(`listings/${A}/${F}`, 'not-a-uuid'), false);
  assert.equal(isOwnedKey(`listings/${A}/${F}`, ''), false);
  assert.equal(isOwnedKey(`listings/${A}x/${F}`, A), false);
  assert.equal(isOwnedKey(`xlistings/${A}/${F}`, A), false);
});
