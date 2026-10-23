// Business logo / banner intake. FAKE storage / imaging / Vision / database: these tests prove the control flow — what is
// published, what stays private, and that every failure publishes nothing. They do NOT prove Cloudflare R2, the Images
// binding or Google Vision behave this way (docs/STOREFRONTS_0054_OWNER_DECISIONS.md §Business media: unverified list).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runBusinessMediaScan, scanExistingBusinessImage, isBusinessImageKey, businessMediaKey, normalizePublicBase, MEDIA_LIMITS, type BackfillDeps, type MediaDeps, type MediaStatus } from '../workers/image-scan/src/businessMedia';
import { ScanError } from '../workers/image-scan/src/pipeline';
import { jpegMetaReport } from '../lib/jpegMeta';
import type { ProviderSignals } from '../lib/imageSafety';
import { avatarPresignGate, businessMediaPresignGate, mediaScanRequired, isAvatarFolder, isBusinessMediaFolder, isListingFolder, readClosedFlag, presignKillSwitchGate } from '../supabase/functions/_shared/scanPolicy';
import { isAllowedFolder } from '../supabase/functions/_shared/uploadPaths';
import { BUSINESS_MEDIA_MESSAGES, BusinessMediaError, interpretBusinessMediaResponse, parseBusinessMediaFolder } from '../lib/businessMedia';

const U = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const root = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

function jpeg(seed: number): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x02, seed, seed ^ 0x55, (seed * 3) & 0xff, 0xff, 0xd9]);
}
function withExif(b: Uint8Array, orientation: number, gps = false): Uint8Array {
  const entries = [[0x0112, 3, 1, orientation], ...(gps ? [[0x8825, 4, 1, 26]] : [])];
  const tiff: number[] = [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, entries.length, 0];
  for (const [tag, type, count, value] of entries) tiff.push(tag & 255, tag >> 8, type, 0, count, 0, 0, 0, value & 255, value >> 8, 0, 0);
  tiff.push(0, 0, 0, 0);
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = payload.length + 2;
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...payload, ...b.subarray(2)]);
}

const SAFE = { adult: 'VERY_UNLIKELY', violence: 'VERY_UNLIKELY', racy: 'VERY_UNLIKELY' } as const;
const clean: ProviderSignals = { safeSearch: { ...SAFE }, labels: [{ name: 'Logo', score: 0.9 }], text: 'Habiba Fashion' };

type Opts = {
  signals?: ProviderSignals;
  vision?: (call: number, signal: AbortSignal) => Promise<ProviderSignals>;
  recent?: number;
  leakMetadata?: boolean;
  sideways?: boolean;
  failPutPublic?: boolean;
  failFinishApproved?: boolean;
  visionTimeoutMs?: number;
};

function harness(o: Opts = {}) {
  const events: string[] = [];
  const log = { visionCalls: 0, begun: 0, publicPuts: [] as { key: string; bytes: Uint8Array }[], privatePuts: [] as string[], finishes: [] as { status: string; publicKey: string | null; issues: string[] }[] };
  let n = 0;
  const deps: MediaDeps = {
    sha256Hex: async (b) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join(''),
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    normalize: async (bytes) => ({ bytes: o.sideways ? withExif(bytes, 6) : o.leakMetadata ? withExif(bytes, 1, true) : bytes, width: 640, height: 480 }),
    info: async () => ({ width: 640, height: 480 }),
    vision: {
      analyze: async (_b, signal) => {
        log.visionCalls++;
        return o.vision ? o.vision(log.visionCalls, signal) : o.signals ?? clean;
      },
    },
    storage: {
      putPrivate: async (key) => { events.push('private'); log.privatePuts.push(key); },
      putPublic: async (key, bytes) => {
        if (o.failPutPublic) throw new Error('r2 down');
        events.push('public');
        log.publicPuts.push({ key, bytes });
        return `https://media.test/${key}`;
      },
    },
    db: {
      begin: async () => { log.begun++; return { scanId: 'scan-1' }; },
      recentCount: async () => o.recent ?? 0,
      finish: async (a) => {
        if (o.failFinishApproved && a.status === 'approved') throw new Error('db down');
        events.push(`row:${a.status}`);
        log.finishes.push({ status: a.status, publicKey: a.publicKey, issues: a.issues });
      },
    },
    now: () => 1_000_000,
    visionTimeoutMs: o.visionTimeoutMs,
  };
  return { deps, log, events };
}

const run = (h: ReturnType<typeof harness>, over: Partial<{ userId: string; kind: unknown; bytes: Uint8Array }> = {}) =>
  runBusinessMediaScan({ userId: U, kind: 'logo', bytes: jpeg(7), ...over }, h.deps);
const last = <T,>(a: T[]) => a[a.length - 1];
const code = async (p: Promise<unknown>) => { try { await p; return 'none'; } catch (e) { return e instanceof ScanError ? e.code : `other:${String(e)}`; } };

// ── approved ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test('approved image: private original first, DB row approved BEFORE the public object, key is the only shape the database accepts', async () => {
  const h = harness();
  const r = await run(h, { kind: 'banner' });
  assert.equal(r.status, 'approved');
  assert.equal(r.key, businessMediaKey(U, 'banner', '00000000-0000-4000-8000-000000000001'));
  assert.match(r.key!, new RegExp(`^business/${U}/banner/[0-9a-f-]{36}\\.jpg$`));
  assert.equal(r.url, `https://media.test/${r.key}`);
  assert.deepEqual(h.events, ['private', 'row:approved', 'public']);
  assert.equal(h.log.publicPuts.length, 1);
  assert.equal(h.log.publicPuts[0].key, r.key);
  assert.ok(h.log.privatePuts[0].startsWith(`orig-media/${U}/banner/`), 'the original is kept under a PRIVATE prefix');
  assert.equal(JSON.stringify(r).includes('orig-media'), false, 'private keys never reach the client');
});

test('the published derivative carries no EXIF / GPS (stripped from the exact bytes published)', async () => {
  const h = harness({ leakMetadata: true });
  await run(h);
  const rep = jpegMetaReport(h.log.publicPuts[0].bytes);
  assert.equal(rep.valid, true);
  assert.deepEqual([rep.hasExif, rep.hasGps, rep.hasXmp, rep.hasIptc], [false, false, false, false]);
});

test('a derivative that still needs rotating is never published', async () => {
  const h = harness({ sideways: true });
  assert.equal(await code(run(h)), 'internal');
  assert.equal(h.log.publicPuts.length, 0);
  assert.equal(last(h.log.finishes)?.status, 'unavailable', 'the row is closed, never left processing');
});

// ── rejected / held ──────────────────────────────────────────────────────────────────────────────────────────────────

test('rejected image: nothing is published, the original stays private, the row says rejected', async () => {
  const h = harness({ signals: { safeSearch: { adult: 'VERY_LIKELY', violence: 'VERY_UNLIKELY', racy: 'VERY_LIKELY' }, labels: [], text: '' } });
  const r = await run(h);
  assert.equal(r.status, 'rejected');
  assert.equal(r.key, null);
  assert.equal(r.url, null);
  assert.ok(r.issues.includes('prohibited_content'));
  assert.equal(h.log.publicPuts.length, 0);
  assert.equal(h.log.privatePuts.length, 1);
  assert.equal(last(h.log.finishes)?.status, 'rejected');
  assert.equal(last(h.log.finishes)?.publicKey, null);
});

test('uncertain image (needs a human): not published — there is no business-media review queue yet', async () => {
  const h = harness({ signals: { safeSearch: { adult: 'LIKELY', violence: 'VERY_UNLIKELY', racy: 'LIKELY' }, labels: [], text: '' } });
  const r = await run(h);
  assert.equal(r.status, 'held');
  assert.equal(r.url, null);
  assert.equal(h.log.publicPuts.length, 0);
});

test('a weapon in a logo is rejected, and text naming another marketplace is not published either', async () => {
  const weapon = harness({ signals: { safeSearch: { ...SAFE }, labels: [{ name: 'Assault rifle', score: 0.95 }], text: '' } });
  assert.equal((await run(weapon)).status, 'rejected');
  const other = harness({ signals: { safeSearch: { ...SAFE }, labels: [], text: 'jiji.com olx.com' } });
  const r = await run(other);
  assert.notEqual(r.status, 'approved');
  assert.equal(other.log.publicPuts.length, 0);
});

// ── scan failures fail closed ────────────────────────────────────────────────────────────────────────────────────────

test('provider outage: retried once, then nothing published and the client gets a retryable "unavailable"', async () => {
  const h = harness({ vision: async () => { throw new Error('vision 500'); } });
  assert.equal(await code(run(h)), 'unavailable');
  assert.equal(h.log.visionCalls, MEDIA_LIMITS.visionRetries + 1);
  assert.equal(h.log.publicPuts.length, 0);
  assert.deepEqual(h.log.finishes.map((f) => f.status), ['unavailable']);
});

test('provider timeout is a failure, never "safe"', async () => {
  const h = harness({ visionTimeoutMs: 5, vision: (_c, signal) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))) });
  assert.equal(await code(run(h)), 'unavailable');
  assert.equal(h.log.publicPuts.length, 0);
});

test('a provider answer without signals counts as a failure', async () => {
  const h = harness({ vision: async () => undefined as unknown as ProviderSignals });
  assert.equal(await code(run(h)), 'unavailable');
  assert.equal(h.log.publicPuts.length, 0);
});

test('recovers: a transient first failure followed by a clean answer is approved', async () => {
  const h = harness({ vision: async (call) => { if (call === 1) throw new Error('blip'); return clean; } });
  assert.equal((await run(h)).status, 'approved');
});

test('if the approval row cannot be written, the image is never published', async () => {
  const h = harness({ failFinishApproved: true });
  assert.equal(await code(run(h)), 'internal');
  assert.equal(h.log.publicPuts.length, 0);
});

test('if the public write fails after approval, the row is downgraded so the key can never be saved', async () => {
  const h = harness({ failPutPublic: true });
  assert.equal(await code(run(h)), 'internal');
  assert.deepEqual(h.log.finishes.map((f) => f.status), ['approved', 'unavailable']);
  assert.equal(last(h.log.finishes)?.publicKey, null);
});

// ── invalid input and abuse ──────────────────────────────────────────────────────────────────────────────────────────

test('unknown kind, wrong casing, path-like kind and missing kind are refused before any work', async () => {
  for (const kind of ['AVATAR', 'avatars', 'LOGO', 'logo/../banner', '../x', '', undefined, 5, null]) {
    const h = harness();
    assert.equal(await code(run(h, { kind })), 'bad_request', String(kind));
    assert.deepEqual([h.log.begun, h.log.visionCalls, h.log.privatePuts.length, h.log.publicPuts.length], [0, 0, 0, 0]);
  }
});

test('non-images are refused by file signature, whatever the client claims: html, svg, text, empty', async () => {
  for (const bytes of [new TextEncoder().encode('<html><script>alert(1)</script></html>'), new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), new TextEncoder().encode('hello'), new Uint8Array(0)]) {
    const h = harness();
    const c = await code(run(h, { bytes }));
    assert.ok(c === 'unsupported_image' || c === 'bad_request', c);
    assert.deepEqual([h.log.begun, h.log.visionCalls, h.log.privatePuts.length, h.log.publicPuts.length], [0, 0, 0, 0]);
  }
});

test('oversized uploads are refused before any work', async () => {
  const h = harness();
  assert.equal(await code(run(h, { bytes: new Uint8Array(MEDIA_LIMITS.maxBytes + 1) })), 'bad_request');
  assert.equal(h.log.begun, 0);
});

test('rate limit applies before any paid call or storage write', async () => {
  const h = harness({ recent: MEDIA_LIMITS.scansPerHour });
  assert.equal(await code(run(h)), 'rate_limited');
  assert.deepEqual([h.log.begun, h.log.visionCalls, h.log.privatePuts.length, h.log.publicPuts.length], [0, 0, 0, 0]);
});

// A shared fake "database" so several runs can interleave like real concurrent requests (the plain harness gives every run its own state).
function sharedRig() {
  const rows: { scanId: string; userId: string; kind: string; sha: string; status: string; publicKey: string | null }[] = [];
  const published = new Map<string, Uint8Array>();
  let visionCalls = 0;
  let n = 0;
  const depsFor = (): MediaDeps => ({
    sha256Hex: async (b) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join(''),
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    normalize: async (bytes) => ({ bytes, width: 640, height: 480 }),
    info: async () => ({ width: 640, height: 480 }),
    vision: { analyze: async () => { visionCalls++; await Promise.resolve(); return clean; } },
    storage: {
      putPrivate: async () => undefined,
      putPublic: async (key, bytes) => { published.set(key, bytes); return `https://media.test/${key}`; },
    },
    db: {
      begin: async (a) => { await Promise.resolve(); const scanId = `scan-${rows.length + 1}`; rows.push({ scanId, userId: a.userId, kind: a.kind, sha: a.sha256, status: 'processing', publicKey: null }); return { scanId }; },
      recentCount: async (userId) => { await Promise.resolve(); return rows.filter((r) => r.userId === userId).length; },
      finish: async (a) => { const r = rows.find((x) => x.scanId === a.scanId)!; r.status = a.status; r.publicKey = a.publicKey; },
    },
    now: () => 1_000_000,
  });
  return { rows, published, depsFor, vision: () => visionCalls };
}

test('a burst of parallel uploads cannot slip past the hourly limit: the limit is re-checked once our own row exists', async () => {
  const rig = sharedRig();
  const results = await Promise.all(
    Array.from({ length: MEDIA_LIMITS.scansPerHour + 15 }, (_, i) => code(runBusinessMediaScan({ userId: U, kind: 'logo', bytes: jpeg(i + 1) }, rig.depsFor()))),
  );
  // Fails safe: when every request sees the whole burst, all of them lose. The guarantee is "never more than the allowance", not "exactly the allowance".
  assert.ok(results.filter((c) => c === 'none').length <= MEDIA_LIMITS.scansPerHour);
  assert.ok(rig.vision() <= MEDIA_LIMITS.scansPerHour, 'paid Vision calls never exceed the allowance');
  assert.ok(rig.published.size <= MEDIA_LIMITS.scansPerHour);
  assert.ok(results.every((c) => c === 'none' || c === 'rate_limited'), 'every loser is told it was rate limited, nothing else');
  assert.equal(rig.rows.filter((r) => r.status === 'processing').length, 0, 'no row is left in processing');
  assert.equal(rig.rows.filter((r) => r.status === 'approved').length, rig.published.size, 'one approval row per published object, no more');
});

test('a normal small parallel burst (two tabs, a retry) is not penalised', async () => {
  const rig = sharedRig();
  const results = await Promise.all([1, 2, 3, 4].map((i) => code(runBusinessMediaScan({ userId: U, kind: 'logo', bytes: jpeg(i) }, rig.depsFor()))));
  assert.deepEqual(results, ['none', 'none', 'none', 'none']);
  assert.equal(rig.published.size, 4);
});

test('the same image uploaded twice (duplicate or retried request) gets two independent keys and two approval rows', async () => {
  const rig = sharedRig();
  const a = await runBusinessMediaScan({ userId: U, kind: 'logo', bytes: jpeg(9) }, rig.depsFor());
  const b = await runBusinessMediaScan({ userId: U, kind: 'logo', bytes: jpeg(9) }, rig.depsFor());
  assert.notEqual(a.key, b.key);
  assert.equal(rig.rows.filter((r) => r.status === 'approved').length, 2);
  assert.equal(new Set(rig.rows.map((r) => r.publicKey)).size, 2, 'one approval per key: a key is never shared between rows');
});

test('an approval is bound to the exact image: each key maps to one row whose hash is that image, so approving A authorises no key holding B', async () => {
  const rig = sharedRig();
  const imgA = jpeg(11);
  const imgB = jpeg(12);
  const ra = await runBusinessMediaScan({ userId: U, kind: 'logo', bytes: imgA }, rig.depsFor());
  const rb = await runBusinessMediaScan({ userId: U, kind: 'logo', bytes: imgB }, rig.depsFor());
  const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
  const rowA = rig.rows.find((r) => r.publicKey === ra.key)!;
  const rowB = rig.rows.find((r) => r.publicKey === rb.key)!;
  assert.equal(rowA.sha, hex(imgA));
  assert.equal(rowB.sha, hex(imgB));
  assert.deepEqual(rig.published.get(ra.key!), imgA);
  assert.deepEqual(rig.published.get(rb.key!), imgB);
  assert.notEqual(ra.key, rb.key, 'B can never be published under the key approved for A');
  // a replacement for an existing logo is a NEW key: the old one stays valid only until the owner replaces it, and is never overwritten
  assert.equal(rig.published.size, 2);
});

test('approvals are per user and per slot: the same bytes uploaded as another user or slot never reuse a key', async () => {
  const rig = sharedRig();
  const x = await runBusinessMediaScan({ userId: U, kind: 'logo', bytes: jpeg(5) }, rig.depsFor());
  const y = await runBusinessMediaScan({ userId: OTHER, kind: 'logo', bytes: jpeg(5) }, rig.depsFor());
  const z = await runBusinessMediaScan({ userId: U, kind: 'banner', bytes: jpeg(5) }, rig.depsFor());
  assert.ok(x.key!.startsWith(`business/${U}/logo/`));
  assert.ok(y.key!.startsWith(`business/${OTHER}/logo/`));
  assert.ok(z.key!.startsWith(`business/${U}/banner/`));
  assert.equal(new Set([x.key, y.key, z.key]).size, 3);
});

test('the owner is always the authenticated user: the output key carries exactly that user id', async () => {
  const h = harness();
  const r = await run(h, { userId: OTHER });
  assert.ok(r.key!.startsWith(`business/${OTHER}/logo/`));
});

// ── presigned PUT can no longer bypass the scan ──────────────────────────────────────────────────────────────────────

test('r2-presign refuses every business folder, once MEDIA_SCAN_REQUIRED is on, with a structured answer', () => {
  for (const f of [`business/${U}/logo`, `business/${U}/banner`, 'business', `business/${U}`, `business/${U}/logo/extra`]) {
    assert.deepEqual(businessMediaPresignGate(f), { allow: true }, `${f}: open while the scan Worker is not deployed`);
    const g = businessMediaPresignGate(f, true);
    assert.equal(g.allow, false, f);
    if (!g.allow) assert.deepEqual([g.status, g.code], [426, 'media_scan_required']);
    assert.equal(isBusinessMediaFolder(f), true);
  }
  for (const f of [`avatars/${U}`, `listings/${U}`, `listings/${U}/d1`]) assert.deepEqual(businessMediaPresignGate(f, true), { allow: true }, f); // avatars have their own gate (avatarPresignGate)
  assert.equal(isBusinessMediaFolder('businessx/y'), false);
});

test('case games cannot dodge the gates: any folder isAllowedFolder accepts as business/ or listings/ is gated too (R2 keys are case-sensitive, so a "Business/" object would be an unscanned public file)', () => {
  const uid = '33333333-3333-4333-8333-333333333333';
  for (const f of [`BUSINESS/${uid}/logo`, `Business/${uid}/banner`, `bUsInEsS/${uid}/logo`]) {
    assert.equal(isAllowedFolder(f, uid), true, `precondition: the folder allow-list accepts ${f} (it matches case-insensitively)`);
    assert.equal(businessMediaPresignGate(f, true).allow, false, `${f} must be refused`);
    assert.equal(isBusinessMediaFolder(f), true);
  }
  for (const f of [`LISTINGS/${uid}`, `Listings/${uid}/draft_1`]) {
    assert.equal(isAllowedFolder(f, uid), true);
    assert.equal(isListingFolder(f), true, `${f} must be treated as a listing folder`);
  }
});

test('r2-presign no longer refuses avatar or business folders (profile photos are not scanned)', () => {
  const src = read('supabase/functions/r2-presign/index.ts');
  assert.ok(!src.includes('businessMediaPresignGate') && !src.includes('avatarPresignGate'));
  assert.ok(src.includes('isAllowedFolder(folder, user.id)'), 'ownership check stays');
});

test('only the two uploadToR2 helpers call r2-presign, and neither diverts profile photos to the Worker', () => {
  for (const f of ['lib/r2.ts', 'web/src/services/r2.ts']) {
    assert.ok(!read(f).includes('uploadBusinessMedia(uri') && !read(f).includes('if (business'), f);
  }
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (['node_modules', '.next', '.test-build', '.git', 'supabase', 'docs', 'tests', 'scripts'].includes(e.name)) continue;
      const rel = `${dir}/${e.name}`.replace(/^\.\//, '');
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(e.name) && /r2-presign/.test(read(rel)) && !['lib/r2.ts', 'web/src/services/r2.ts'].includes(rel) && !/^\s*(\/\/|\*)/m.test('')) offenders.push(rel);
    }
  };
  walk('.');
  const real = offenders.filter((f) => /functions\.invoke\(\s*['"]r2-presign/.test(read(f)) || /fetch\([^)]*r2-presign/.test(read(f)));
  assert.deepEqual(real, [], 'no other client code may request a presigned URL');
});

test('the Worker route sits behind authentication and the DB records exist for it', () => {
  const src = read('workers/image-scan/src/index.ts');
  assert.ok(src.indexOf("'/v1/business-media'") > src.indexOf('const user = await authenticate(env, req)'));
  const mig = read('supabase/migrations/0057_business_media_scans.sql');
  assert.ok(mig.includes('business_media_scans') && mig.includes('business_media_enforced'));
});

// ── client interpretation fails closed ───────────────────────────────────────────────────────────────────────────────

test('client: folder parsing is exact', () => {
  assert.deepEqual(parseBusinessMediaFolder(`business/${U}/logo`), { userId: U, kind: 'logo' });
  assert.deepEqual(parseBusinessMediaFolder(`business/${U}/banner`), { userId: U, kind: 'banner' });
  assert.deepEqual(parseBusinessMediaFolder(`avatars/${U}`), { userId: U, kind: 'avatar' });
  for (const f of [`business/${U}/logo/x`, `business/${U}/avatar`, `business/../logo`, `business//logo`, `avatars/${U}/x`, `avatars/../${U}`, 'avatars/', `Avatars/${U}`, `listings/${U}`, '']) assert.equal(parseBusinessMediaFolder(f), null, f);
});

test('client: an approved answer is accepted only when key and URL belong to THIS user and slot', () => {
  const key = `business/${U}/logo/00000000-0000-4000-8000-000000000001.jpg`;
  const expect: { userId: string; kind: 'logo' | 'banner' } = { userId: U, kind: 'logo' };
  assert.deepEqual(interpretBusinessMediaResponse(200, { status: 'approved', key, url: `https://media.test/${key}` }, expect), { ok: true, key, url: `https://media.test/${key}` });
  const bad = (body: unknown, e = expect) => interpretBusinessMediaResponse(200, body, e);
  assert.equal(bad({ status: 'approved', key, url: `https://media.test/${key}` }, { userId: U, kind: 'banner' }).ok, false, 'logo key in the banner slot');
  assert.equal(bad({ status: 'approved', key, url: `https://media.test/${key}` }, { userId: OTHER, kind: 'logo' }).ok, false, "someone else's key");
  assert.equal(bad({ status: 'approved', key, url: `http://media.test/${key}` }).ok, false, 'http');
  assert.equal(bad({ status: 'approved', key, url: 'https://media.test/other.jpg' }).ok, false, 'URL does not end with the key');
  assert.equal(bad({ status: 'approved', key: `business/${U}/logo/../../x.jpg`, url: 'https://media.test/x.jpg' }).ok, false, 'traversal');
  assert.equal(bad({ status: 'approved' }).ok, false);
  assert.equal(bad({ status: 'ok', key, url: `https://media.test/${key}` }).ok, false, 'unknown status');
  assert.equal(bad(null).ok, false);
});

test('client: rejected, held and every error status give a clear message and no image', () => {
  const e = { userId: U, kind: 'logo' as const };
  const M = BUSINESS_MEDIA_MESSAGES;
  const msg = (status: number, body: unknown = {}) => { const o = interpretBusinessMediaResponse(status, body, e); return o.ok ? 'OK' : o.message; };
  assert.equal(msg(200, { status: 'rejected' }), M.rejected);
  assert.equal(msg(200, { status: 'held' }), M.held);
  assert.equal(msg(429), M.rateLimited);
  assert.equal(msg(422), M.unreadable);
  assert.equal(msg(503), M.unavailable);
  for (const s of [400, 401, 403, 404, 413, 500, 502]) assert.equal(msg(s), M.failed, String(s));
  for (const s of [201, 204, 302]) assert.equal(msg(s), M.failed, String(s));
});

test('statuses are typed: nothing but approved/rejected/held can come back', () => {
  const all: MediaStatus[] = ['approved', 'rejected', 'held'];
  assert.equal(all.length, 3);
});

// ── localisation ──────────────────────────────────────────────────────────────────────────────────────────────────────
test('every business-media error code has a translation in en, so and am, and none leaks internal detail', () => {
  const codes = Object.keys(BUSINESS_MEDIA_MESSAGES).sort();
  const en = JSON.parse(read('locales/en/translation.json')).errors.businessMedia as Record<string, string>;
  for (const lang of ['en', 'so', 'am']) {
    const t = JSON.parse(read(`locales/${lang}/translation.json`)).errors.businessMedia as Record<string, string>;
    assert.deepEqual(Object.keys(t).sort(), codes, `${lang} has exactly the codes the client can throw`);
    for (const c of codes) {
      assert.ok(t[c] && t[c].trim().length > 10, `${lang}.${c} is filled in`);
      if (lang !== 'en') assert.notEqual(t[c], en[c], `${lang}.${c} is translated, not copied from English`);
      assert.doesNotMatch(t[c], /vision|safesearch|score|orig-media|sha|bucket|r2|worker|policy|watermark/i, `${lang}.${c} reveals no internal logic`);
    }
  }
});

test('BusinessMediaError carries the code the screen translates, with the English text as the fallback', () => {
  const e = new BusinessMediaError('rejected');
  assert.equal(e.code, 'rejected');
  assert.equal(e.message, BUSINESS_MEDIA_MESSAGES.rejected);
  assert.ok(e instanceof Error);
  const out = interpretBusinessMediaResponse(200, { status: 'held' }, { userId: U, kind: 'logo' });
  assert.deepEqual(out.ok ? null : out.code, 'held');
});

test('the mobile upload hook shows the translated message for a BusinessMediaError', () => {
  assert.match(read('hooks/useImageUpload.ts'), /instanceof BusinessMediaError[\s\S]*errors\.businessMedia\./);
});

// ── backfill of existing images ───────────────────────────────────────────────────────────────────────────────────────
const LEGACY = `business/${U}/logo/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
function backfillRig(o: Opts & { stored?: Uint8Array | null; readThrows?: boolean } = {}) {
  const h = harness(o);
  const reads: string[] = [];
  const deps: BackfillDeps = {
    ...h.deps,
    readPublic: async (key) => {
      reads.push(key);
      if (o.readThrows) throw new Error('r2 down');
      return o.stored === undefined ? jpeg(3) : o.stored;
    },
  };
  return { h, deps, reads };
}
const bf = (r: ReturnType<typeof backfillRig>, over: Partial<{ ownerId: string; kind: unknown; originalKey: unknown }> = {}) =>
  scanExistingBusinessImage({ ownerId: U, kind: 'logo', originalKey: LEGACY, ...over }, r.deps);

test('backfill: a clean legacy image is rescanned through the SAME pipeline and republished under a NEW key; the old object is never touched', async () => {
  const r = backfillRig();
  const out = await bf(r);
  assert.equal(out.outcome, 'approved');
  if (out.outcome !== 'approved') return;
  assert.notEqual(out.key, LEGACY);
  assert.match(out.key, new RegExp(`^business/${U}/logo/[0-9a-f-]{36}\.jpg$`));
  assert.deepEqual(r.reads, [LEGACY]);
  assert.deepEqual(r.h.events, ['private', 'row:approved', 'public'], 'same order as a fresh upload: private original, approval row, then public');
  assert.equal(r.h.log.publicPuts.length, 1);
  assert.notEqual(r.h.log.publicPuts[0].key, LEGACY, 'the legacy key is never overwritten');
});

test('backfill: rejected and held legacy images publish nothing and report their status', async () => {
  const bad = backfillRig({ signals: { safeSearch: { adult: 'VERY_LIKELY', violence: 'VERY_UNLIKELY', racy: 'VERY_UNLIKELY' }, labels: [], text: '' } });
  assert.equal((await bf(bad)).outcome, 'rejected');
  assert.equal(bad.h.log.publicPuts.length, 0);
  const maybe = backfillRig({ signals: { safeSearch: { adult: 'LIKELY', violence: 'VERY_UNLIKELY', racy: 'LIKELY' }, labels: [], text: '' } });
  assert.equal((await bf(maybe)).outcome, 'held');
  assert.equal(maybe.h.log.publicPuts.length, 0);
});

test('backfill: a missing object, an unreadable file and a storage error are distinguished; none publishes', async () => {
  const missing = backfillRig({ stored: null });
  assert.equal((await bf(missing)).outcome, 'missing');
  const junk = backfillRig({ stored: new TextEncoder().encode('<html>not an image</html>') });
  assert.equal((await bf(junk)).outcome, 'unreadable');
  const empty = backfillRig({ stored: new Uint8Array(0) });
  assert.equal((await bf(empty)).outcome, 'unreadable');
  const storage = backfillRig({ readThrows: true });
  assert.equal((await bf(storage)).outcome, 'unavailable');
  for (const r of [missing, junk, empty, storage]) assert.equal(r.h.log.publicPuts.length, 0);
});

test('backfill: a provider outage or timeout is retryable ("unavailable"), never an approval', async () => {
  const down = backfillRig({ vision: async () => { throw new Error('vision 503'); } });
  assert.equal((await bf(down)).outcome, 'unavailable');
  assert.equal(down.h.log.publicPuts.length, 0);
  const limited = backfillRig({ recent: MEDIA_LIMITS.scansPerHour });
  assert.equal((await bf(limited)).outcome, 'unavailable', 'a rate-limited owner is retried later');
});

test('backfill cannot be used to read arbitrary objects: only the owner business image key for this slot is read', async () => {
  for (const key of [
    `business/${OTHER}/logo/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`, // another user's image
    `business/${U}/banner/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`, // wrong slot
    `orig-media/${U}/logo/${'a'.repeat(64)}.bin`, // the private-original prefix
    `wm/listings/${U}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`,
    `business/${U}/logo/../../${OTHER}/logo/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`,
    `Business/${U}/logo/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`,
    '', 'business', null, 42,
  ]) {
    const r = backfillRig();
    assert.equal(await code(bf(r, { originalKey: key })), 'bad_request', String(key));
    assert.equal(r.reads.length, 0, 'nothing is read for a refused key');
  }
  assert.equal(await code(bf(backfillRig(), { kind: 'avatar' })), 'bad_request');
  assert.equal(await code(bf(backfillRig(), { ownerId: '../etc' })), 'bad_request');
  assert.equal(isBusinessImageKey(LEGACY, U, 'logo'), true);
});

test('the backfill route is secret-gated, constant-time compared and does not exist unless BACKFILL_SECRET is set', () => {
  const idx = read('workers/image-scan/src/index.ts');
  const at = idx.indexOf("url.pathname === '/v1/business-media/backfill'");
  assert.ok(at > 0);
  const beforeAuth = idx.indexOf('await authenticate(env, req)');
  assert.ok(at < beforeAuth, 'handled before (and independently of) user JWT authentication');
  const block = idx.slice(at, beforeAuth);
  assert.match(block, /if \(!secret\) return json\(\{ error: 'not_found' \}, 404/);
  assert.match(block, /sameSecret\(req\.headers\.get\('x-backfill-secret'\)/);
  assert.match(block, /401/);
  assert.match(idx, /diff \|= x\[i\] \^ y\[i\]/);
  assert.doesNotMatch(read('workers/image-scan/wrangler.toml'), /BACKFILL_SECRET\s*=/, 'the secret is never committed in wrangler.toml');
});

// ── known limitation, pinned so it cannot change silently ─────────────────────────────────────────────────────────────
test('KNOWN LIMITATION (owner decision pending): a legitimate logo whose text contains a listed marketplace word is held and, with no staff queue, cannot be published', async () => {
  // OTHER_MARKETS (lib/imageSafety.ts) is matched as plain substrings and includes generic words ('marketplace', 'amazon', 'jiji', 'fursad').
  // One mention is "uncertain" → 'held' → nothing is published. The safety rule is deliberately NOT weakened here; the options (a staff review
  // queue for held business media, or a narrower business-specific list) are listed in docs/BUSINESS_MEDIA_DECISION_REQUEST.md.
  for (const text of ['Hargeisa Marketplace', 'Amazon Fashion', 'Fursad Tailoring']) {
    const h = harness({ signals: { ...clean, text } });
    const r = await run(h);
    assert.equal(r.status, 'held', text);
    assert.equal(r.url, null);
    assert.equal(h.log.publicPuts.length, 0, 'fails closed: nothing published');
  }
  const ok = harness({ signals: { ...clean, text: 'Habiba Fashion House' } });
  assert.equal((await run(ok)).status, 'approved', 'ordinary shop names are unaffected');
});

// ── profile avatars: same pipeline, key under avatars/{uid}/ ─────────────────────────────────────────────────────────

test('avatar: approved image is published at avatars/{uid}/{uuid}.jpg, row approved BEFORE the public object, original kept private', async () => {
  const h = harness();
  const r = await run(h, { kind: 'avatar' });
  assert.equal(r.status, 'approved');
  assert.equal(r.key, `avatars/${U}/00000000-0000-4000-8000-000000000001.jpg`);
  assert.equal(r.key, businessMediaKey(U, 'avatar', '00000000-0000-4000-8000-000000000001'));
  assert.equal(r.url, `https://media.test/${r.key}`);
  assert.deepEqual(h.events, ['private', 'row:approved', 'public']);
  assert.ok(h.log.privatePuts[0].startsWith(`orig-media/${U}/avatar/`));
  assert.equal(JSON.stringify(r).includes('orig-media'), false);
  const rep = jpegMetaReport(h.log.publicPuts[0].bytes);
  assert.deepEqual([rep.valid, rep.hasExif, rep.hasGps], [true, false, false]);
});

test('avatar: an ordinary face photo (no logo, no text) is approved — avatars are not held for lacking business labels', async () => {
  const h = harness({ signals: { safeSearch: { ...SAFE }, labels: [{ name: 'Face', score: 0.97 }, { name: 'Smile', score: 0.9 }, { name: 'Person', score: 0.95 }], text: '' } });
  assert.equal((await run(h, { kind: 'avatar' })).status, 'approved');
});

test('avatar: rejected, held and a provider outage publish nothing (fail closed), exactly like logos', async () => {
  const rejected = harness({ signals: { safeSearch: { adult: 'VERY_LIKELY', violence: 'VERY_UNLIKELY', racy: 'VERY_LIKELY' }, labels: [], text: '' } });
  const r1 = await run(rejected, { kind: 'avatar' });
  assert.equal(r1.status, 'rejected');
  assert.equal(r1.key, null);
  assert.equal(rejected.log.publicPuts.length, 0);
  const held = harness({ signals: { safeSearch: { adult: 'LIKELY', violence: 'VERY_UNLIKELY', racy: 'LIKELY' }, labels: [], text: '' } });
  assert.equal((await run(held, { kind: 'avatar' })).status, 'held');
  assert.equal(held.log.publicPuts.length, 0);
  const down = harness({ vision: async () => { throw new Error('vision 500'); } });
  assert.equal(await code(run(down, { kind: 'avatar' })), 'unavailable');
  assert.equal(down.log.publicPuts.length, 0);
  assert.equal(last(down.log.finishes)?.status, 'unavailable');
  const r2down = harness({ failPutPublic: true });
  assert.equal(await code(run(r2down, { kind: 'avatar' })), 'internal');
  assert.equal(last(r2down.log.finishes)?.status, 'unavailable', 'an approved row is downgraded when the object could not be published');
});

test('avatar: the owner is the authenticated user, and a client-chosen kind outside logo|banner|avatar is refused', async () => {
  const h = harness();
  const r = await run(h, { kind: 'avatar', userId: OTHER });
  assert.ok(r.key!.startsWith(`avatars/${OTHER}/`));
  for (const kind of ['selfie', 'Avatar', 'avatars', '', undefined, null, 5]) assert.equal(await code(run(harness(), { kind })), 'bad_request', String(kind));
});

test('avatar: the backfill route can still only touch business objects (it never accepts kind avatar)', async () => {
  assert.equal(await code(scanExistingBusinessImage({ ownerId: U, kind: 'avatar', originalKey: `avatars/${U}/00000000-0000-4000-8000-000000000001.jpg` }, backfillRig().deps)), 'bad_request');
});

test('avatar presign gate: refused with a structured 426 once MEDIA_SCAN_REQUIRED is on; other folders are untouched', () => {
  for (const f of [`avatars/${U}`, `Avatars/${U}`, 'AVATARS', 'avatars']) {
    assert.equal(isAvatarFolder(f), true, f);
    assert.deepEqual(avatarPresignGate(f), { allow: true }, `${f}: open by default`);
    const g = avatarPresignGate(f, true);
    assert.equal(g.allow, false, f);
    if (!g.allow) assert.deepEqual([g.status, g.code], [426, 'media_scan_required']);
  }
  assert.equal(isAvatarFolder('avatarsx/y'), false);
  for (const f of [`listings/${U}`, `business/${U}/logo`, 'other']) assert.deepEqual(avatarPresignGate(f, true), { allow: true }, f);
  for (const on of ['true', ' TRUE ', '1', 'on', 'yes']) assert.equal(mediaScanRequired(on), true, on);
  for (const off of ['', 'false', '0', undefined, null, 'tru']) assert.equal(mediaScanRequired(off), false, String(off));
  // the listing-gate flag reader is unchanged: function missing = open (ladder absent); other errors = unknown
  assert.equal(readClosedFlag({ data: null, error: { code: '42883' } }), false);
  assert.equal(readClosedFlag({ data: null, error: { code: 'XX000', message: 'boom' } }), null);
  assert.equal(readClosedFlag({ data: true, error: null }), true);
});

test('avatar client: an approved answer is accepted only for THIS user under avatars/, never a business key', () => {
  const key = `avatars/${U}/00000000-0000-4000-8000-000000000001.jpg`;
  const expect = { userId: U, kind: 'avatar' as const };
  assert.deepEqual(interpretBusinessMediaResponse(200, { status: 'approved', key, url: `https://media.test/${key}` }, expect), { ok: true, key, url: `https://media.test/${key}` });
  const bad = (body: unknown, e: { userId: string; kind: 'avatar' | 'logo' } = expect) => interpretBusinessMediaResponse(200, body, e);
  assert.equal(bad({ status: 'approved', key, url: `https://media.test/${key}` }, { userId: OTHER, kind: 'avatar' }).ok, false, "someone else's avatar");
  assert.equal(bad({ status: 'approved', key, url: `https://media.test/${key}` }, { userId: U, kind: 'logo' }).ok, false, 'avatar key in a logo slot');
  const biz = `business/${U}/logo/00000000-0000-4000-8000-000000000001.jpg`;
  assert.equal(bad({ status: 'approved', key: biz, url: `https://media.test/${biz}` }).ok, false, 'business key in the avatar slot');
  assert.equal(bad({ status: 'approved', key, url: `http://media.test/${key}` }).ok, false, 'http');
  assert.equal(bad({ status: 'approved', key, url: 'https://media.test/x.jpg' }).ok, false, 'URL does not end with the key');
  assert.equal(bad({ status: 'approved', key: `avatars/${U}/../x.jpg`, url: 'https://media.test/x.jpg' }).ok, false, 'traversal');
});

test('MEDIA POLICY (2026-10-21): profile photos, logos and banners are not scanned and go through the presigned path', () => {
  assert.equal(read('web/src/lib/businessMedia.ts'), read('lib/businessMedia.ts'), 'web copy identical');
  const presign = read('supabase/functions/r2-presign/index.ts');
  assert.ok(!presign.includes('MEDIA_SCAN_REQUIRED'));
  for (const f of ['lib/r2.ts', 'web/src/services/r2.ts']) assert.ok(!read(f).includes('parseBusinessMediaFolder(folder)'), f);
  // listing photos are untouched: still gated by the listing ladder
  assert.equal(listingGateStillWired(presign), true);
});
const listingGateStillWired = (src: string) => src.includes('listingPresignGate(folder') && src.includes("legacy_presign_closed");

test('avatar wiring: migration 0059 shares the 0057 switch (shipped as an explicit OFF row; missing/NULL/default reads as ON)', () => {
  const mig = read('supabase/migrations/0059_avatar_media_scans.sql');
  assert.ok(mig.includes('_bm_check_avatar') && mig.includes('business_media_enforced') && mig.includes("'avatar'"));
  const m57 = read('supabase/migrations/0057_business_media_scans.sql');
  assert.ok(m57.includes('where id), true)'), 'a missing/NULL enforce value must read as ENFORCED');
  assert.ok(!m57.includes('where id), false)'), 'the fail-open reading must not come back');
  assert.ok(/enforce boolean not null default true/.test(m57), 'column default must be ON');
  assert.ok(m57.includes('alter column enforce set default true'), 'an older draft with default OFF must be corrected');
  assert.ok(m57.includes('insert into public.business_media_config (id, enforce) values (true, false) on conflict do nothing'), 'OFF must be an explicit seeded row');
});

test('isBusinessImageKey: the dot before "jpg" is a literal dot (a template-literal \. would silently be a wildcard)', () => {
  const ok = `business/${U}/logo/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
  assert.equal(isBusinessImageKey(ok, U, 'logo'), true);
  for (const bad of [ok.replace('.jpg', 'Xjpg'), ok.replace('.jpg', '-jpg'), ok.replace('.jpg', '/jpg'), ok + 'x', ok.replace('.jpg', '.JPG')]) {
    assert.equal(isBusinessImageKey(bad, U, 'logo'), false, bad);
  }
});

test('normalizePublicBase: an empty, missing, non-https or path-carrying public base URL is refused instead of producing relative or foreign URLs', () => {
  assert.equal(normalizePublicBase('https://media.example.com'), 'https://media.example.com');
  assert.equal(normalizePublicBase('https://media.example.com/'), 'https://media.example.com');
  for (const bad of [undefined, null, '', '   ', 'http://media.example.com', 'media.example.com', 'https://', 'https://media.example.com/sub', 'https://REPLACE-WITH-PUBLIC-BUCKET-URL', 'https://user@media.example.com', 'javascript:alert(1)']) {
    assert.throws(() => normalizePublicBase(bad as string), /public base/i, String(bad));
  }
});

test('wrangler.toml: the [env.staging] block holds only placeholders - no production bucket, project or public URL can leak into a staging deploy', () => {
  const toml = read('workers/image-scan/wrangler.toml');
  const at = toml.indexOf('[env.staging]');
  assert.ok(at > 0, 'a staging environment exists');
  const staging = toml.slice(at);
  for (const prod of ['fursad-media', 'waksddinkjbrggxkfofk', 'pub-82d788c4a57e4172aecc99a383616935', 'suuqiye-web.vercel.app', 'suuqiye-private', 'suuqiye-images']) {
    assert.ok(!staging.includes(prod), `staging block must not name production resource ${prod}`);
  }
  for (const need of ['bucket_name = "REPLACE-STAGING-PRIVATE-BUCKET"', 'bucket_name = "REPLACE-STAGING-PUBLIC-BUCKET"', 'SUPABASE_URL = "https://REPLACE-STAGING-PROJECT.supabase.co"', 'BULK_ENABLED = "false"']) {
    assert.ok(staging.includes(need), need);
  }
  assert.doesNotMatch(staging, /SECRET|SERVICE_KEY|VISION_API_KEY\s*=|ANON_KEY\s*=/, 'no secret is ever written into wrangler.toml');
});

test('presign kill switch: unset/false-like values allow, anything else pauses uploads (a typo fails closed)', () => {
  for (const v of [undefined, null, '', ' ', 'false', '0', 'off', 'NO']) assert.deepEqual(presignKillSwitchGate(v), { allow: true }, String(v));
  for (const v of ['true', '1', 'yes', 'on', 'pause', 'tru']) {
    const g = presignKillSwitchGate(v);
    assert.equal(g.allow, false, v);
    if (!g.allow) assert.equal(g.status, 503);
  }
  const src = read('supabase/functions/r2-presign/index.ts');
  assert.ok(src.indexOf('presignKillSwitchGate(Deno.env.get') < src.indexOf('supabaseAdmin.auth.getUser'), 'kill switch runs before any database call');
});
