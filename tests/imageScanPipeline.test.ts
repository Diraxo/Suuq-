// Orchestration tests with FAKE storage / imaging / Vision / database. They prove the control flow (idempotency,
// rate limit, retries, timeouts, failure handling, what gets published and what stays private). They do NOT
// prove Cloudflare R2, the Images binding or Google Vision behave this way — see docs/IMAGE_SAFETY.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScan, promoteHeld, markIsPresent, ScanError, LIMITS, type Deps, type PublicResult, type SaveResult } from '../workers/image-scan/src/pipeline';
import { mapVisionResponse, needsObjectPass, createVision } from '../workers/image-scan/src/vision';
import type { ProviderSignals, DuplicateMatch } from '../lib/imageSafety';
import { jpegMetaReport } from '../lib/jpegMeta';

// A structurally valid JPEG (SOI, APP0, SOF0 640x480, SOS, seed bytes, EOI). `seed` stands in for picture content.
function jpeg(seed: number): Uint8Array {
  const body = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x02, seed, seed ^ 0x55, seed * 3 & 0xff, 0xff, 0xd9];
  return new Uint8Array(body);
}
/** An APP1 "Exif" segment with an orientation tag (and optionally a GPS IFD pointer), inserted right after SOI. */
function withExif(b: Uint8Array, orientation: number, gps = false): Uint8Array {
  const entries = [[0x0112, 3, 1, orientation], ...(gps ? [[0x8825, 4, 1, 26]] : [])];
  const tiff: number[] = [0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, entries.length, 0];
  for (const [tag, type, count, value] of entries) tiff.push(tag & 255, tag >> 8, type, 0, count, 0, 0, 0, value & 255, value >> 8, 0, 0);
  tiff.push(0, 0, 0, 0);
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = payload.length + 2;
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...payload, ...b.subarray(2)]);
}
const MARK = 0x4d;
const seedOf = (b: Uint8Array) => b[b.length - 5];
const isMarked = (b: Uint8Array) => b[b.length - 3] === MARK;

const SAFE = { adult: 'VERY_UNLIKELY', violence: 'VERY_UNLIKELY', racy: 'VERY_UNLIKELY' } as const;
const phone: ProviderSignals = { safeSearch: { ...SAFE }, labels: [{ name: 'Mobile phone', score: 0.96 }], text: '' };

type Opts = {
  vision?: (seed: number, call: number, signal: AbortSignal) => Promise<ProviderSignals>;
  similar?: DuplicateMatch[];
  scansLastHour?: number;
  existing?: PublicResult;
  breakWatermark?: boolean;
  dupHits?: number;
  /** normalize() hands back a JPEG that still needs rotating via its EXIF tag */
  sidewaysNormalize?: boolean;
  /** the watermarked output still carries EXIF + GPS */
  leakMetadata?: boolean;
  /** the watermarked output is a different size than its input */
  resizeOutput?: boolean;
  /** the watermarked output is not a JPEG at all */
  garbageOutput?: boolean;
  rejectedOriginal?: 'retain' | 'delete';
};

function harness(o: Opts = {}) {
  const log = { visionCalls: 0, publicPuts: [] as string[], privatePuts: [] as string[], privateDeletes: [] as string[], saved: [] as SaveResult[], inflight: 0, maxInflight: 0 };
  const privateStore = new Map<string, Uint8Array>();
  const calls = new Map<number, number>();
  let uuidN = 0;
  const deps: Deps = {
    sha256Hex: async (b) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join(''),
    uuid: () => `00000000-0000-4000-8000-${String(++uuidN).padStart(12, '0')}`,
    normalize: async (bytes) => ({ bytes: o.sidewaysNormalize ? withExif(bytes, 6) : bytes, width: 640, height: 480 }),
    info: async () => (o.resizeOutput ? { width: 320, height: 240 } : { width: 640, height: 480 }),
    thumbGray: async (bytes, w, h) => {
      const s = seedOf(bytes);
      const lift = isMarked(bytes) ? 6 : 0;
      return Uint8Array.from({ length: w * h }, (_, k) => {
        let x = Math.imul(s + 1, 73856093) ^ Math.imul(k + 1, 19349663);
        x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
        return Math.min(255, ((x >>> 8) % 200) + lift);
      });
    },
    watermark: async (n) => {
      if (o.garbageOutput) return new TextEncoder().encode('not a jpeg');
      const stamped = o.breakWatermark ? n.bytes : Uint8Array.from([...n.bytes.subarray(0, n.bytes.length - 3), MARK, 0xff, 0xd9]);
      return o.leakMetadata ? withExif(stamped, 1, true) : stamped;
    },
    vision: {
      analyze: async (bytes, signal) => {
        log.visionCalls++;
        log.inflight++;
        log.maxInflight = Math.max(log.maxInflight, log.inflight);
        try {
          const seed = seedOf(bytes);
          const n = (calls.get(seed) ?? 0) + 1;
          calls.set(seed, n);
          await new Promise((r) => setTimeout(r, 2));
          return await (o.vision ? o.vision(seed, n, signal) : Promise.resolve(phone));
        } finally {
          log.inflight--;
        }
      },
    },
    storage: {
      putPrivate: async (k, b) => { log.privatePuts.push(k); privateStore.set(k, b); },
      putPublic: async (k) => { log.publicPuts.push(k); return `https://cdn.test/${k}`; },
      publicUrl: (k) => `https://cdn.test/${k}`,
      deletePrivate: async (k) => { log.privateDeletes.push(k); privateStore.delete(k); },
    },
    db: {
      openScan: async () => ({ scanId: 'scan-1', existing: o.existing }),
      recentScanCount: async () => o.scansLastHour ?? 0,
      recentDuplicateHits: async () => o.dupHits ?? 0,
      findSimilar: async () => o.similar ?? [],
      saveResult: async (r) => { log.saved.push(r); },
    },
    now: () => 1_000_000,
    visionTimeoutMs: 30,
    rejectedOriginal: o.rejectedOriginal,
  };
  return { deps, log, privateStore };
}
const req = (photos: Uint8Array[], category = 'phones') => ({
  userId: 'user-1', listingId: 'listing-1', context: { categoryId: category, categoryLabel: 'Phones', title: 'iPhone 13' }, photos: photos.map((bytes) => ({ bytes })),
});

test('clean listing: approved, watermarked derivatives published, originals private, answer sanitised', async () => {
  const h = harness();
  const r = await runScan(req([jpeg(10), jpeg(20), jpeg(30)]), h.deps);
  assert.equal(r.outcome, 'approved');
  assert.equal(r.images.length, 3);
  assert.ok(r.images.every((i) => i.verdict === 'pass' && i.url?.startsWith('https://cdn.test/wm/listings/user-1/listing-1/')));
  assert.equal(h.log.publicPuts.length, 3);
  assert.ok(h.log.publicPuts.every((k) => k.startsWith('wm/')), 'only watermarked derivatives are public');
  assert.equal(h.log.privatePuts.filter((k) => k.startsWith('orig/')).length, 3, 'originals kept private');
  assert.ok(!h.log.publicPuts.some((k) => k.startsWith('orig/')));
  const json = JSON.stringify(r);
  assert.equal(/sha|phash|orig\/|score|vision|google/i.test(json), false, 'no internals in the seller response');
  assert.equal(h.log.saved.length, 1);
  assert.equal(h.log.saved[0].images[0].sourceKey?.startsWith('orig/user-1/listing-1/'), true);
});

test('every published byte is the WATERMARKED derivative, never the original', async () => {
  const h = harness();
  const bytes = jpeg(11);
  await runScan(req([bytes]), h.deps);
  assert.equal(h.log.publicPuts.length, 1);
  // the fake putPublic doesn't keep bytes; re-run capturing them
  const captured: Uint8Array[] = [];
  h.deps.storage.putPublic = async (k, b) => { captured.push(b); return `https://cdn.test/${k}`; };
  const h2 = harness();
  h2.deps.storage.putPublic = h.deps.storage.putPublic;
  await runScan(req([jpeg(12)]), h2.deps);
  assert.equal(isMarked(captured[0]), true);
  assert.equal(isMarked(jpeg(12)), false);
});

test('an unchanged derivative (watermark failed) is never published; nothing is left public', async () => {
  const h = harness({ breakWatermark: true });
  await assert.rejects(() => runScan(req([jpeg(10), jpeg(20)]), h.deps), (e: unknown) => e instanceof ScanError && e.code === 'internal');
  assert.equal(h.log.publicPuts.length, 0);
  assert.equal(h.log.saved.length, 0);
  assert.equal(markIsPresent(Uint8Array.from([1, 2, 3, 4]), Uint8Array.from([1, 2, 3, 4])), false);
  assert.equal(markIsPresent(Uint8Array.from([10, 10, 10, 10]), Uint8Array.from([200, 200, 200, 200])), false); // replaced, not marked
  assert.equal(markIsPresent(Uint8Array.from([10, 10, 10, 10]), Uint8Array.from([16, 16, 16, 16])), true);
});

test('idempotent: an identical finished scan returns the stored result without provider calls or new files', async () => {
  const prior: PublicResult = { scanId: 'old', outcome: 'approved', canRetry: false, issues: [], images: [{ slot: 0, verdict: 'pass', issues: [], url: 'https://cdn.test/wm/a.jpg', held: false }] };
  const h = harness({ existing: prior });
  const r = await runScan(req([jpeg(10)]), h.deps);
  assert.equal(r, prior);
  assert.equal(h.log.visionCalls, 0);
  assert.equal(h.log.publicPuts.length + h.log.privatePuts.length, 0);
});

test('rate limit stops the request before any paid provider call', async () => {
  const h = harness({ scansLastHour: LIMITS.scansPerHour + 1 });
  await assert.rejects(() => runScan(req([jpeg(10)]), h.deps), (e: unknown) => e instanceof ScanError && e.code === 'rate_limited');
  assert.equal(h.log.visionCalls, 0);
});

test('bad input is refused before storage or provider: empty, text, truncated, HEIC, 0 and 9 photos', async () => {
  const h = harness();
  const text = new TextEncoder().encode('<html>not an image</html>');
  const trunc = jpeg(5).subarray(0, jpeg(5).length - 2);
  const heic = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  for (const bad of [new Uint8Array(0), text, trunc, heic]) {
    await assert.rejects(() => runScan(req([jpeg(1), bad]), h.deps), (e: unknown) => e instanceof ScanError && e.code === 'unsupported_image');
  }
  await assert.rejects(() => runScan(req([]), h.deps), (e: unknown) => e instanceof ScanError && e.code === 'bad_request');
  await assert.rejects(() => runScan(req(Array.from({ length: 9 }, (_, i) => jpeg(i + 1))), h.deps), (e: unknown) => e instanceof ScanError && e.code === 'bad_request');
  assert.equal(h.log.visionCalls + h.log.privatePuts.length + h.log.publicPuts.length, 0);
});

test('all batch sizes 1..8 complete, keep photo order and respect the concurrency bound', async () => {
  for (let n = 1; n <= 8; n++) {
    const h = harness();
    const r = await runScan(req(Array.from({ length: n }, (_, i) => jpeg(10 + i * 7))), h.deps);
    assert.equal(r.images.length, n);
    assert.deepEqual(r.images.map((i) => i.slot), Array.from({ length: n }, (_, i) => i));
    assert.ok(h.log.maxInflight <= LIMITS.concurrency, `in flight ${h.log.maxInflight}`);
    assert.equal(r.outcome, 'approved');
  }
});

test('provider outage: nothing is called safe — held for review, retry offered, derivative stays private', async () => {
  const h = harness({ vision: async () => { throw new Error('503'); } });
  const r = await runScan(req([jpeg(10)]), h.deps);
  assert.equal(r.outcome, 'pending_review');
  assert.equal(r.canRetry, true);
  assert.deepEqual(r.issues.map((i) => i.code), ['check_failed']);
  assert.equal(r.images[0].held, true);
  assert.equal(h.log.publicPuts.length, 0, 'nothing is public while held');
  assert.ok(h.log.privatePuts.some((k) => k.startsWith('pending/wm/')));
  assert.equal(h.log.saved[0].images[0].verdict, 'review');
});

test('timeout is bounded and retried once; a slow first attempt followed by a good one passes', async () => {
  const h = harness({
    vision: (seed, call, signal) =>
      call === 1
        ? new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))))
        : Promise.resolve(phone),
  });
  const r = await runScan(req([jpeg(10)]), h.deps);
  assert.equal(r.outcome, 'approved');
  assert.equal(h.log.visionCalls, 2);
  // always timing out → bounded to 1 + retries attempts, then held
  const h2 = harness({ vision: (_s, _c, signal) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))) });
  const r2 = await runScan(req([jpeg(10)]), h2.deps);
  assert.equal(h2.log.visionCalls, 1 + LIMITS.visionRetries);
  assert.equal(r2.outcome, 'pending_review');
});

test('one failing photo does not fail the others', async () => {
  const h = harness({ vision: async (seed) => { if (seed === 20) throw new Error('boom'); return phone; } });
  const r = await runScan(req([jpeg(10), jpeg(20), jpeg(30)]), h.deps);
  assert.deepEqual(r.images.map((i) => i.verdict), ['pass', 'review', 'pass']);
  assert.equal(r.outcome, 'pending_review');
  assert.equal(r.canRetry, true);
});

test('prohibited image: rejected, no derivative, no URL returned; the private original is RETAINED by default (deletion needs counsel)', async () => {
  const h = harness({ vision: async (seed) => (seed === 20 ? { ...phone, safeSearch: { ...SAFE, adult: 'VERY_LIKELY' } } : phone) });
  const r0 = await runScan(req([jpeg(10), jpeg(20)]), h.deps);
  assert.equal(r0.images[1].url, null);
  assert.equal(h.log.privateDeletes.length, 0, 'no automatic deletion unless explicitly enabled');
  assert.equal(h.log.saved[0].images[1].sourceKey?.startsWith('orig/user-1/listing-1/'), true, 'original still referenced for staff / counsel handling');
});

test('prohibited image: with rejectedOriginal="delete" explicitly enabled the original is removed at once', async () => {
  const h = harness({ rejectedOriginal: 'delete', vision: async (seed) => (seed === 20 ? { ...phone, safeSearch: { ...SAFE, adult: 'VERY_LIKELY' } } : phone) });
  const r = await runScan(req([jpeg(10), jpeg(20)]), h.deps);
  assert.equal(r.outcome, 'needs_changes');
  assert.deepEqual(r.images.map((i) => [i.verdict, i.url === null, i.held]), [['pass', false, false], ['reject', true, false]]);
  assert.equal(h.log.publicPuts.length, 1);
  assert.equal(h.log.privateDeletes.filter((k) => k.startsWith('orig/')).length, 1);
  assert.equal(h.log.saved[0].images[1].sourceKey, null);
  assert.equal(h.log.saved[0].flagged, true);
});

test('weapon: rejected; uncertain weapon is held privately for a human', async () => {
  const gun = (score: number): ProviderSignals => ({ ...phone, labels: [...phone.labels, { name: 'Firearm', score }] });
  const hard = harness({ vision: async () => gun(0.95) });
  const rHard = await runScan(req([jpeg(10)]), hard.deps);
  assert.equal(rHard.outcome, 'needs_changes');
  assert.equal(hard.log.publicPuts.length, 0);
  const soft = harness({ vision: async () => gun(0.7) });
  const rSoft = await runScan(req([jpeg(10)]), soft.deps);
  assert.equal(rSoft.outcome, 'pending_review');
  assert.equal(soft.log.publicPuts.length, 0);
  assert.ok(soft.log.privatePuts.some((k) => k.startsWith('pending/wm/')));
});

test('duplicates: similar photo in another listing → review (still published as private-safe wm), same photo twice in a batch → fix', async () => {
  const h = harness({ similar: [{ distance: 2, sameOwner: false }] });
  const r = await runScan(req([jpeg(10)]), h.deps);
  assert.equal(r.outcome, 'pending_review');
  assert.equal(r.issues[0].code, 'duplicate_listing');
  assert.equal(JSON.stringify(r).includes('distance'), false);

  const h2 = harness();
  const r2 = await runScan(req([jpeg(10), jpeg(40), jpeg(10)]), h2.deps);
  assert.equal(r2.outcome, 'needs_changes');
  assert.deepEqual(r2.issues.find((i) => i.code === 'duplicate_in_batch')?.indexes, [2]);
  assert.equal(r2.images[0].verdict, 'pass');
});

test('own watermark and other-marketplace watermark are rejected with the friendly code', async () => {
  const h = harness({ vision: async (seed) => ({ ...phone, text: seed === 10 ? 'Suuqiye Suuqiye' : 'jiji.so jiji.so' }) });
  const r = await runScan(req([jpeg(10), jpeg(50)]), h.deps);
  assert.deepEqual(r.issues.map((i) => i.code).sort(), ['watermark_other', 'watermark_own']);
  assert.equal(h.log.publicPuts.length, 0);
});

test('repeated duplicate hits flag staff without rejecting', async () => {
  const h = harness({ dupHits: 5 });
  const r = await runScan(req([jpeg(10)]), h.deps);
  assert.equal(r.outcome, 'approved');
  assert.equal(h.log.saved[0].flagged, true);
});

test('promoteHeld publishes only approved, well-formed keys and removes the private copy', async () => {
  const h = harness();
  const key = 'wm/listings/user-1/listing-1/00000000-0000-4000-8000-000000000001.jpg';
  h.privateStore.set(`pending/${key}`, jpeg(9));
  const storage = { ...h.deps.storage, getPrivate: async (k: string) => h.privateStore.get(k) ?? null };
  await assert.rejects(() => promoteHeld({ publicKey: key, reviewApproved: false }, { storage }), ScanError);
  await assert.rejects(() => promoteHeld({ publicKey: '../../etc/passwd', reviewApproved: true }, { storage }), ScanError);
  const url = await promoteHeld({ publicKey: key, reviewApproved: true }, { storage });
  assert.equal(url, `https://cdn.test/${key}`);
  assert.equal(h.privateStore.has(`pending/${key}`), false);
  await assert.rejects(() => promoteHeld({ publicKey: key, reviewApproved: true }, { storage }), ScanError); // already promoted
});

// ───────────── Vision adapter (canned responses; the real service was NOT called) ─────────────

test('Vision response mapping', () => {
  const s = mapVisionResponse({
    labelAnnotations: [{ description: 'Mobile phone', score: 0.97 }],
    textAnnotations: [{ description: 'Suuqiye\nSuuqiye' }],
    safeSearchAnnotation: { adult: 'VERY_UNLIKELY', violence: 'UNLIKELY', racy: 'WEIRD' },
    localizedObjectAnnotations: [{ name: 'Phone', score: 0.9, boundingPoly: { normalizedVertices: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.5, y: 0.6 }, { x: 0.1, y: 0.6 }] } }],
  });
  assert.equal(s.safeSearch?.racy, 'UNKNOWN');
  assert.equal(s.labels[0].name, 'Mobile phone');
  assert.ok(Math.abs((s.objects?.[0].area ?? 0) - 0.2) < 1e-9);
  assert.equal(s.text.includes('Suuqiye'), true);
  assert.deepEqual(mapVisionResponse({}).labels, []);
  assert.throws(() => mapVisionResponse({ error: { code: 429 } }), /vision error/);
});

test('Vision cost control: object localization only when labels do not already show the category', async () => {
  const calls: string[][] = [];
  const mk = (labels: { description: string; score: number }[]) =>
    (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body.requests[0].features.map((f: { type: string }) => f.type));
      assert.equal(String(_url).includes('key='), false, 'API key must be a header, not in the URL');
      assert.ok((init?.headers as Record<string, string>)['x-goog-api-key']);
      return new Response(JSON.stringify({ responses: [{ labelAnnotations: labels, safeSearchAnnotation: { adult: 'VERY_UNLIKELY', violence: 'VERY_UNLIKELY', racy: 'VERY_UNLIKELY' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
  const signal = new AbortController().signal;
  await createVision('k', 'phones', mk([{ description: 'Mobile phone', score: 0.95 }])).analyze(jpeg(1), signal);
  assert.deepEqual(calls, [['LABEL_DETECTION', 'SAFE_SEARCH_DETECTION', 'TEXT_DETECTION']]);
  calls.length = 0;
  await createVision('k', 'phones', mk([{ description: 'Photograph', score: 0.6 }])).analyze(jpeg(1), signal);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], ['OBJECT_LOCALIZATION']);
  calls.length = 0;
  await createVision('k', 'services', mk([{ description: 'Photograph', score: 0.6 }])).analyze(jpeg(1), signal); // lenient category: never pay for the extra pass
  assert.equal(calls.length, 1);
  await assert.rejects(() => createVision('k', 'phones', (async () => new Response('x', { status: 500 })) as unknown as typeof fetch).analyze(jpeg(1), signal), /vision http 500/);
  assert.equal(needsObjectPass({ labels: [], text: '' }, 'unknown-category'), false);
});

// ── derivative integrity: orientation, metadata, size, format ───────────────────────────────────────────────────
test('a derivative that would still depend on an EXIF orientation tag is never published', async () => {
  const h = harness({ sidewaysNormalize: true });
  await assert.rejects(() => runScan(req([jpeg(10)]), h.deps), (e: unknown) => e instanceof ScanError && e.code === 'internal');
  assert.equal(h.log.publicPuts.length, 0);
  assert.equal(h.log.saved.length, 0);
});

test('EXIF/GPS left in the watermarked output is stripped from the bytes that are actually published', async () => {
  const captured: Uint8Array[] = [];
  const h = harness({ leakMetadata: true });
  h.deps.storage.putPublic = async (k, b) => { captured.push(b); return `https://cdn.test/${k}`; };
  const r = await runScan(req([jpeg(10)]), h.deps);
  assert.equal(r.outcome, 'approved');
  const report = jpegMetaReport(captured[0]);
  assert.deepEqual([report.valid, report.hasExif, report.hasGps, report.orientation], [true, false, false, 1]);
  assert.equal(isMarked(captured[0]), true, 'stripping must not lose the mark');
});

test('a derivative whose size changed, or that is not a JPEG, is never published', async () => {
  for (const o of [{ resizeOutput: true }, { garbageOutput: true }]) {
    const h = harness(o);
    await assert.rejects(() => runScan(req([jpeg(10)]), h.deps), (e: unknown) => e instanceof ScanError && e.code === 'internal');
    assert.equal(h.log.publicPuts.length, 0);
    assert.equal(h.log.saved.length, 0);
  }
});

// ── bulk source, and recovery after a provider outage ───────────────────────────────────────────────────────────
test('bulk scans carry source "bulk" and are NOT stopped by the interactive hourly limit; interactive still is', async () => {
  const opened: string[] = [];
  const bulk = harness({ scansLastHour: LIMITS.scansPerHour + 50 });
  const realOpen = bulk.deps.db.openScan;
  bulk.deps.db.openScan = async (a) => (opened.push(a.source), realOpen(a));
  const r = await runScan({ ...req([jpeg(10)]), source: 'bulk' }, bulk.deps);
  assert.equal(r.outcome, 'approved');
  assert.deepEqual(opened, ['bulk']);

  const interactive = harness({ scansLastHour: LIMITS.scansPerHour + 50 });
  interactive.deps.db.openScan = async (a) => (opened.push(a.source), { scanId: 's' });
  await assert.rejects(() => runScan(req([jpeg(10)]), interactive.deps), (e: unknown) => e instanceof ScanError && e.code === 'rate_limited');
  assert.deepEqual(opened, ['bulk', 'interactive'], 'a request without a source is interactive');
});

test('a stored "provider was unavailable, retry" answer is NOT returned again — a retry really re-scans and can recover', async () => {
  const outage: PublicResult = { scanId: 'old', outcome: 'pending_review', canRetry: true, issues: [{ code: 'check_failed', severity: 'review', indexes: [0], messageKey: 'imageScan.issue.check_failed' }], images: [{ slot: 0, verdict: 'review', issues: ['check_failed'], url: 'https://cdn.test/wm/a.jpg', held: true }] };
  const h = harness({ existing: outage });
  const r = await runScan(req([jpeg(10)]), h.deps);
  assert.equal(h.log.visionCalls, 1, 'the provider is asked again');
  assert.equal(r.outcome, 'approved');
  assert.equal(r.canRetry, false);
  assert.equal(h.log.saved.length, 1, 'the improved result is saved');
});
