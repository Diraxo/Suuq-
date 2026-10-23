// delete-account key ownership (supabase/functions/_shared/accountKeys.ts).
// JavaScript-level tests of the pure validator + static checks of delete-account/index.ts.
// They do NOT execute the edge function, Deno, Supabase or R2.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isKeyForKind, selectOwnedKeys, type KeyCandidate } from '../supabase/functions/_shared/accountKeys';
import { isOwnedKey } from '../supabase/functions/_shared/uploadPaths';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const F = '33333333-3333-4333-8333-333333333333.jpg';

test('own keys of every kind are kept', () => {
  const cands: KeyCandidate[] = [
    { kind: 'avatar', key: `avatars/${A}/${F}` },
    { kind: 'logo', key: `business/${A}/logo/${F}` },
    { kind: 'banner', key: `business/${A}/banner/${F}` },
    { kind: 'listing', key: `listings/${A}/${F}` },
    { kind: 'listing', key: `listings/${A}/draft-1_x/${F}` },
    { kind: 'chat', key: `chat/conv-1/${A}/${F}` },
  ];
  const { keys, skipped } = selectOwnedKeys(cands, A);
  assert.deepEqual(keys.sort(), cands.map((c) => c.key as string).sort());
  assert.equal(skipped, 0);
});

test("another user's keys are skipped for every kind", () => {
  const cands: KeyCandidate[] = [
    { kind: 'avatar', key: `avatars/${B}/${F}` },
    { kind: 'logo', key: `business/${B}/logo/${F}` },
    { kind: 'banner', key: `business/${B}/banner/${F}` },
    { kind: 'listing', key: `listings/${B}/${F}` },
    { kind: 'listing', key: `listings/${B}/d1/${F}` },
    { kind: 'chat', key: `chat/c1/${B}/${F}` },
  ];
  assert.deepEqual(selectOwnedKeys(cands, A), { keys: [], skipped: cands.length });
});

test('traversal, encoding, URLs and malformed filenames are skipped', () => {
  const bad = [
    `listings/${A}/../${B}/${F}`,
    `listings/${A}/../../listings/${B}/${F}`,
    `avatars/${A}/../../avatars/${B}/${F}`,
    `listings/${A}/%2e%2e/${B}/${F}`,
    `listings/${A}/..%2f${B}/${F}`,
    `listings/${A}\${F}`,
    `/listings/${A}/${F}`,
    `listings/${A}//${F}`,
    `listings/${A}/${F}/`,
    `listings/${A}/${F}?x=1`,
    `listings/${A}/${F}#x`,
    `listings/${A}/ ${F}`,
    `listings/${A}/${F}\n`,
    `listings/${A}/33333333-3333-4333-8333-333333333333Xjpg`,
    `listings/${A}/33333333-3333-4333-8333-333333333333.png`,
    `listings/${A}/not-a-uuid.jpg`,
    `https://cdn.example.com/listings/${A}/${F}`,
    `listings/${A}/${'a'.repeat(65)}/${F}`,
    `listings/${A}/a/b/${F}`,
    `${A}/${F}`,
    'some_cloudinary_public_id',
  ];
  for (const key of bad) assert.equal(isKeyForKind(key, 'listing', A), false, JSON.stringify(key));
});

test('a key is only valid for the column it came from (no cross-kind deletes)', () => {
  assert.equal(isKeyForKind(`listings/${A}/${F}`, 'avatar', A), false);
  assert.equal(isKeyForKind(`avatars/${A}/${F}`, 'listing', A), false);
  assert.equal(isKeyForKind(`business/${A}/banner/${F}`, 'logo', A), false);
  assert.equal(isKeyForKind(`business/${A}/logo/${F}`, 'banner', A), false);
  assert.equal(isKeyForKind(`chat/c/${A}/${F}`, 'listing', A), false);
});

test('empty / null / non-string values are ignored or skipped, never returned', () => {
  const { keys, skipped } = selectOwnedKeys(
    [
      { kind: 'avatar', key: null },
      { kind: 'avatar', key: undefined },
      { kind: 'logo', key: '' },
      { kind: 'listing', key: 42 },
      { kind: 'listing', key: { a: 1 } },
      { kind: 'listing', key: [`listings/${A}/${F}`] },
    ],
    A
  );
  assert.deepEqual(keys, []);
  assert.equal(skipped, 3);
});

test('non-UUID or hostile user ids authorize nothing', () => {
  for (const uid of ['', 'abc', `${A}/..`, '.*', `${A}|${B}`, `(${A})`]) {
    assert.equal(isKeyForKind(`avatars/${A}/${F}`, 'avatar', uid), false, uid);
    assert.equal(isKeyForKind(`avatars/${uid}/${F}`, 'avatar', uid), false, uid);
  }
});

test('de-duplicates, and the owner-writable column cannot smuggle a foreign key alongside a real one', () => {
  const { keys, skipped } = selectOwnedKeys(
    [
      { kind: 'listing', key: `listings/${A}/${F}` },
      { kind: 'listing', key: `listings/${A}/${F}` },
      { kind: 'listing', key: `listings/${B}/${F}` },
    ],
    A
  );
  assert.deepEqual(keys, [`listings/${A}/${F}`]);
  assert.equal(skipped, 1);
});

test('agrees with r2-delete: anything accepted here is also accepted by uploadPaths.isOwnedKey', () => {
  const keys = [
    ...[`avatars/${A}/${F}`, `business/${A}/logo/${F}`, `listings/${A}/${F}`, `listings/${A}/d/${F}`, `chat/c/${A}/${F}`],
    ...[`avatars/${B}/${F}`, `listings/${A}/../${B}/${F}`, 'x', `listings/${A}/${F}.bak`],
  ];
  for (const kind of ['avatar', 'logo', 'banner', 'listing', 'chat'] as const) {
    for (const key of keys) {
      if (isKeyForKind(key, kind, A)) assert.equal(isOwnedKey(key, A), true, `${kind} ${key}`);
    }
  }
});

// --- static checks of the edge function source (no execution) ------------------------
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase/functions/delete-account/index.ts'), 'utf8');

test('static: delete-account routes every key column through the validator', () => {
  assert.match(src, /from '\.\.\/_shared\/accountKeys\.ts'/);
  for (const col of ['avatar_public_id', 'business_logo_public_id', 'business_banner_public_id', 'image_public_ids']) {
    assert.ok(src.includes(col), col);
  }
  assert.match(src, /selectOwnedKeys\(candidates, user\.id\)/);
  assert.match(src, /isKeyForKind\(key, 'chat', userId\)/);
});

test('static: no unvalidated key reaches the R2 delete set', () => {
  // The only adds to objectKeys are the validated set and validated chat keys.
  assert.equal((src.match(/objectKeys\.add\(/g) ?? []).length, 1);
  assert.match(src, /new Set<string>\(ownedKeys\)/);
  assert.doesNotMatch(src, /objectKeys\.add\(profile/);
  assert.doesNotMatch(src, /for \(const key of \[profile\./);
});

test('static: skipped keys are logged by count/reason only, never the key value', () => {
  const logs = src.match(/log\('r2_key[^\n]*\n/g) ?? [];
  assert.ok(logs.length >= 2);
  for (const l of logs) assert.doesNotMatch(l, /\bkey\b\s*[,}]/, l);
});

test('static: auth + response contract preserved', () => {
  assert.match(src, /auth\.getUser\(jwt\)/);
  assert.match(src, /JSON\.stringify\(\{ success: true, cleanup \}\)/); // additive: clients read only `success`/`error`
  assert.match(src, /auth\.admin\.deleteUser\(user\.id\)/);
});

// --- URL fallback for listings without stored image_public_ids -----------------------
import { listingKeyCandidatesFromUrls } from '../supabase/functions/_shared/accountKeys';

const BASE = 'https://pub-abc123.r2.dev';
const derive = (urls: unknown, base: string | undefined | null = BASE) => selectOwnedKeys(listingKeyCandidatesFromUrls(urls, base), A);

test('url fallback: legacy valid URLs (own namespace, with/without draft folder, trailing-slash base) yield keys', () => {
  const k1 = `listings/${A}/${F}`;
  const k2 = `listings/${A}/draft-1/${F}`;
  assert.deepEqual(derive([`${BASE}/${k1}`, `${BASE}/${k2}`]).keys.sort(), [k1, k2].sort());
  assert.deepEqual(derive([`${BASE}/${k1}`], `${BASE}/`).keys, [k1]);
});

test("url fallback: another user's URL is skipped, not returned", () => {
  assert.deepEqual(derive([`${BASE}/listings/${B}/${F}`]), { keys: [], skipped: 1 });
});

test('url fallback: wrong hosts, schemes, lookalike prefixes and non-listing paths are skipped', () => {
  const k = `listings/${A}/${F}`;
  const bad = [
    `https://evil.example/${k}`,
    `http://pub-abc123.r2.dev/${k}`, // scheme differs
    `https://pub-abc123.r2.dev.evil.example/${k}`, // base is a prefix of the host
    `https://pub-abc123.r2.dev@evil.example/${k}`,
    `https://res.cloudinary.com/x/image/upload/${k}`,
    `https://picsum.photos/seed/1/600/400`,
    `${BASE}/avatars/${A}/${F}`, // own, but not a listing key
    `${BASE}/chat/c1/${A}/${F}`,
  ];
  assert.deepEqual(derive(bad), { keys: [], skipped: bad.length });
});

test('url fallback: malformed paths are skipped', () => {
  const bad = [
    `${BASE}/listings/${A}/../${B}/${F}`,
    `${BASE}/listings/${B}/../${A}/${F}`,
    `${BASE}/listings/${A}/%2e%2e/${B}/${F}`,
    `${BASE}/listings/${A}/${F}?x=1`,
    `${BASE}/listings/${A}/${F}#frag`,
    `${BASE}/listings/${A}//${F}`,
    `${BASE}/listings/${A}/${F}/`,
    `${BASE}/listings/${A}/not-a-uuid.jpg`,
    `${BASE}/listings/${A}/${F.replace('.jpg', '.png')}`,
    `${BASE}/${A}/${F}`,
    BASE,
  ];
  assert.deepEqual(derive(bad), { keys: [], skipped: bad.length });
  assert.deepEqual(derive([`${BASE}/`]), { keys: [], skipped: 0 }); // empty remainder = no key, nothing to delete
});

test('url fallback: no configured base, or non-array input, derives nothing (and never throws)', () => {
  const u = [`${BASE}/listings/${A}/${F}`];
  assert.deepEqual(listingKeyCandidatesFromUrls(u, undefined), []);
  assert.deepEqual(listingKeyCandidatesFromUrls(u, ''), []);
  assert.deepEqual(listingKeyCandidatesFromUrls(null, BASE), []);
  assert.deepEqual(listingKeyCandidatesFromUrls('x', BASE), []);
  assert.deepEqual(derive([null, 5, '', {}]), { keys: [], skipped: 0 });
});

test('url fallback: stored key + matching URL de-duplicate; a forged stored key still cannot ride along', () => {
  const k = `listings/${A}/${F}`;
  const cands: KeyCandidate[] = [{ kind: 'listing', key: k }, { kind: 'listing', key: `listings/${B}/${F}` }, ...listingKeyCandidatesFromUrls([`${BASE}/${k}`], BASE)];
  assert.deepEqual(selectOwnedKeys(cands, A), { keys: [k], skipped: 1 });
});

test('static: delete-account feeds URL-derived keys through the same validator', () => {
  assert.match(src, /listingKeyCandidatesFromUrls\(listing\.images, publicBaseUrl\)/);
  assert.match(src, /select\('images, image_public_ids'\)/);
  assert.equal((src.match(/objectKeys\.add\(/g) ?? []).length, 1);
});

// --- B1 ledger ordering in delete-account (0055). Static: the behaviour itself is covered by supabase/tests/account_deletion.test.mjs ---
test('static: the ledger is written before any destructive step and aborts the request if it cannot be', () => {
  const begin = src.indexOf('recordVerificationObjects(rpc, user.id)');
  assert.ok(begin > 0);
  for (const marker of ['revokeAppleToken(body', 'await deleteAllWithConcurrency(client, endpoint', "from('rate_limit_events').delete()", 'auth.admin.deleteUser(user.id)']) {
    const at = src.indexOf(marker);
    assert.ok(at > begin, `${marker} must come after the ledger is recorded`);
  }
  assert.match(src, /ledger_begin_failed[\s\S]{0,400}status: 500/);
});

test('static: a failed auth delete cancels the ledger job; completion is only reported when the drain says so', () => {
  assert.match(src, /account_deletion_cancel/);
  assert.match(src, /outcome === 'completed'\) cleanup = 'complete'/);
  assert.match(src, /let cleanup: 'complete' \| 'in_progress' = 'in_progress'/);
});

// --- Scan-Worker derivatives and storefront media (R2 audit, 2026-10-19) ---------------------------------------------
const L = '44444444-4444-4444-8444-444444444444';

test('listing kind accepts the scan Worker derivative wm/listings/{uid}/{listingId}/{uuid}.jpg, own namespace only', () => {
  const own = `wm/listings/${A}/${L}/${F}`;
  assert.equal(isKeyForKind(own, 'listing', A), true);
  assert.equal(isOwnedKey(own, A), true, 'r2-delete and delete-account must agree on this shape');
  assert.deepEqual(selectOwnedKeys([{ kind: 'listing', key: own }], A), { keys: [own], skipped: 0 });
  const bad = [
    `wm/listings/${B}/${L}/${F}`, // someone else's
    `wm/listings/${A}/not-a-uuid/${F}`,
    `wm/listings/${A}/${L}/../${F}`,
    `wm/listings/${A}/${L}/${F.replace('.jpg', '.png')}`,
    `wm/listings/${A}/${F}`, // listing segment missing
    `wm/avatars/${A}/${F}`,
    `orig/${A}/${L}/${'a'.repeat(64)}.bin`, // private original: a different bucket, never deleted by this path
    `pending/wm/listings/${A}/${L}/${F}`, // private held derivative: same
  ];
  for (const key of bad) assert.equal(isKeyForKind(key, 'listing', A), false, key);
  assert.equal(isKeyForKind(own, 'avatar', A), false);
});

test('url fallback: a wm/ derivative URL under the configured public base now yields its key', () => {
  const k = `wm/listings/${A}/${L}/${F}`;
  assert.deepEqual(derive([`${BASE}/${k}`]), { keys: [k], skipped: 0 });
});

test('static: storefront logo/banner are read from the storefronts row, not only the (cleared) profile mirror', () => {
  assert.match(src, /from\('storefronts'\)\.select\('logo_public_id, banner_public_id'\)\.eq\('owner_id', user\.id\)/);
  assert.match(src, /kind: 'logo', key: storefront\?\.logo_public_id/);
  assert.match(src, /kind: 'banner', key: storefront\?\.banner_public_id/);
  const read = src.indexOf("from('storefronts')");
  assert.ok(read > 0 && read < src.indexOf('auth.admin.deleteUser(user.id)'), 'must be read before the cascade');
});
