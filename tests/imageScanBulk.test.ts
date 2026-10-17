// Bulk queue consumer with FAKE network, scan pipeline and database. Proves the control flow and the fetch guards
// (redirect re-checking, size caps, timeouts, failure classification). It does NOT prove behaviour against real remote
// hosts, Cloudflare, or the database — the SQL side is supabase/tests/bulk_queue.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BulkFetchError, processBulkQueue, processBulkRow, safeFetchImage, BULK_LIMITS, type BulkDeps, type BulkRow, type FetchLike } from '../workers/image-scan/src/bulk';
import { ScanError, type PublicResult, type ScanRequest } from '../workers/image-scan/src/pipeline';

const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);
const ok = (body: Uint8Array, headers: Record<string, string> = {}) => new Response(body as unknown as BodyInit, { status: 200, headers });
const redirect = (to: string, status = 302) => new Response(null, { status, headers: { location: to } });
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof BulkFetchError, `expected BulkFetchError, got ${e}`);
    return (e as BulkFetchError).failure;
  }
  assert.fail('expected a failure');
};

// ── fetch guard ─────────────────────────────────────────────────────────────────────────────────────────────────
test('safeFetchImage returns the bytes of a plain https image and sends no credentials', async () => {
  let seen: { url: string; init: Parameters<FetchLike>[1] } | null = null;
  const f: FetchLike = async (url, init) => {
    seen = { url, init };
    return ok(bytes(100));
  };
  const out = await safeFetchImage(f, 'https://shop.example.com/a.jpg');
  assert.equal(out.length, 100);
  assert.equal(seen!.init.redirect, 'manual');
  assert.deepEqual(Object.keys(seen!.init.headers).sort(), ['accept', 'user-agent']);
});

test('an unsafe URL is refused before any request is made', async () => {
  let calls = 0;
  const f: FetchLike = async () => (calls++, ok(bytes(10)));
  for (const u of ['http://shop.example.com/a.jpg', 'https://127.0.0.1/a.jpg', 'https://169.254.169.254/x', 'https://localhost/x', 'https://shop.example.com:8443/x', 'https://u:p@shop.example.com/x']) {
    const failure = await code(safeFetchImage(f, u));
    assert.equal(failure.retryable, false, u);
    assert.match(failure.code, /^image_url_/);
  }
  assert.equal(calls, 0);
});

test('redirects are followed manually and EVERY hop is re-validated (no redirect into internal space)', async () => {
  const hosts: string[] = [];
  const f: FetchLike = async (url) => {
    hosts.push(new URL(url).host);
    if (url === 'https://a.example.com/x') return redirect('https://b.example.com/y');
    if (url === 'https://b.example.com/y') return redirect('/z'); // relative
    return ok(bytes(5));
  };
  assert.equal((await safeFetchImage(f, 'https://a.example.com/x')).length, 5);
  assert.deepEqual(hosts, ['a.example.com', 'b.example.com', 'b.example.com']);

  for (const evil of ['http://b.example.com/y', 'https://127.0.0.1/admin', 'https://169.254.169.254/latest/meta-data/', 'https://metadata.internal/x', 'https://x.example.com:9000/y']) {
    let hops = 0;
    const g: FetchLike = async (url) => (hops++, url === 'https://a.example.com/x' ? redirect(evil) : ok(bytes(5)));
    const failure = await code(safeFetchImage(g, 'https://a.example.com/x'));
    assert.equal(failure.retryable, false, evil);
    assert.equal(hops, 1, `never requested ${evil}`);
  }
  const loop: FetchLike = async () => redirect('https://a.example.com/x');
  assert.deepEqual(await code(safeFetchImage(loop, 'https://a.example.com/x')), { code: 'image_too_many_redirects', retryable: false });
  const noLoc: FetchLike = async () => new Response(null, { status: 302 });
  assert.deepEqual(await code(safeFetchImage(noLoc, 'https://a.example.com/x')), { code: 'image_redirect_invalid', retryable: false });
});

test('size cap: declared and undeclared oversize bodies are refused, and an undeclared one is cut off mid-stream', async () => {
  const declared: FetchLike = async () => ok(bytes(10), { 'content-length': String(BULK_LIMITS.maxBytes + 1) });
  assert.deepEqual(await code(safeFetchImage(declared, 'https://s.example.com/a.jpg')), { code: 'image_too_large', retryable: false });

  let pulled = 0;
  const endless: FetchLike = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        pull(ctl) {
          pulled += 1;
          ctl.enqueue(bytes(1024));
        },
      }),
      { status: 200 },
    );
  assert.deepEqual(await code(safeFetchImage(endless, 'https://s.example.com/a.jpg', { maxBytes: 8 * 1024 })), { code: 'image_too_large', retryable: false });
  assert.ok(pulled < 40, 'stopped reading shortly after the cap instead of buffering an unbounded body');

  assert.deepEqual(await code(safeFetchImage(async () => ok(new Uint8Array(0)), 'https://s.example.com/a.jpg')), { code: 'image_empty', retryable: false });
});

test('HTTP and network failures are classified: transient → retry, gone/forbidden → final', async () => {
  const status = (s: number): FetchLike => async () => new Response('x', { status: s });
  assert.deepEqual(await code(safeFetchImage(status(503), 'https://s.example.com/a.jpg')), { code: 'image_http_503', retryable: true });
  assert.deepEqual(await code(safeFetchImage(status(429), 'https://s.example.com/a.jpg')), { code: 'image_http_429', retryable: true });
  assert.deepEqual(await code(safeFetchImage(status(404), 'https://s.example.com/a.jpg')), { code: 'image_gone', retryable: false });
  assert.deepEqual(await code(safeFetchImage(status(403), 'https://s.example.com/a.jpg')), { code: 'image_forbidden', retryable: false });
  const down: FetchLike = async () => {
    throw new TypeError('fetch failed');
  };
  assert.deepEqual(await code(safeFetchImage(down, 'https://s.example.com/a.jpg')), { code: 'image_unreachable', retryable: true });
});

test('a host that never answers times out (retryable) instead of hanging the Worker', async () => {
  const hang: FetchLike = (_url, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  assert.deepEqual(await code(safeFetchImage(hang, 'https://s.example.com/a.jpg', { timeoutMs: 20 })), { code: 'image_timeout', retryable: true });
});

// ── per-row processing ──────────────────────────────────────────────────────────────────────────────────────────
const row = (over: Partial<BulkRow> = {}): BulkRow => ({
  id: 'row-1', user_id: 'user-1', listing_id: 'listing-1', attempts: 1,
  payload: { title: 'iPhone 13', description: 'Good', category: 'phones' },
  photo_urls: ['https://shop.example.com/1.jpg', 'https://shop.example.com/2.jpg'], ...over,
});
const result = (o: Partial<PublicResult> & { urls?: (string | null)[] } = {}): PublicResult => ({
  scanId: 'scan-9', outcome: 'approved', canRetry: false, issues: [],
  images: (o.urls ?? ['https://cdn.test/wm/1.jpg', 'https://cdn.test/wm/2.jpg']).map((url, slot) => ({ slot, verdict: url ? ('pass' as const) : ('reject' as const), issues: [], url, held: false })),
  ...o,
});

function harness(scan: (req: ScanRequest) => Promise<PublicResult>, fetchImpl?: FetchLike) {
  const log = { completes: [] as Parameters<BulkDeps['db']['complete']>[0][], fails: [] as [string, string, boolean][], scans: [] as ScanRequest[], fetched: [] as string[] };
  const deps: BulkDeps = {
    db: {
      claim: async () => [],
      complete: async (a) => void log.completes.push(a),
      fail: async (id, c, r) => void log.fails.push([id, c, r]),
    },
    fetch: fetchImpl ?? (async (url) => (log.fetched.push(url), ok(bytes(50)))),
    scan: async (req) => (log.scans.push(req), scan(req)),
  };
  return { deps, log };
}

test('approved row: every photo is fetched, scanned as source "bulk" for THIS listing, and the derivatives are recorded', async () => {
  const h = harness(async () => result());
  assert.equal(await processBulkRow(row(), h.deps), 'ready');
  assert.equal(h.log.scans.length, 1);
  assert.equal(h.log.scans[0].source, 'bulk');
  assert.equal(h.log.scans[0].listingId, 'listing-1', 'the scan is bound to the id the listing will be published under');
  assert.equal(h.log.scans[0].userId, 'user-1');
  assert.equal(h.log.scans[0].photos.length, 2);
  assert.deepEqual(h.log.completes, [{ rowId: 'row-1', status: 'ready', scanId: 'scan-9', imageUrls: ['https://cdn.test/wm/1.jpg', 'https://cdn.test/wm/2.jpg'] }]);
  assert.equal(h.log.fails.length, 0);
});

test('review outcome → ready_review; rejected photo → needs_changes with NO urls', async () => {
  const review = harness(async () => result({ outcome: 'pending_review' }));
  assert.equal(await processBulkRow(row(), review.deps), 'ready_review');
  assert.equal(review.log.completes[0].status, 'ready_review');

  const rejected = harness(async () => result({ outcome: 'needs_changes', urls: ['https://cdn.test/wm/1.jpg', null] }));
  assert.equal(await processBulkRow(row(), rejected.deps), 'needs_changes');
  assert.deepEqual(rejected.log.completes[0], { rowId: 'row-1', status: 'needs_changes', scanId: 'scan-9', imageUrls: null });
});

test('provider outage (canRetry): nothing is judged, nothing is published — the row is retried later', async () => {
  const h = harness(async () => result({ outcome: 'pending_review', canRetry: true }));
  assert.equal(await processBulkRow(row(), h.deps), 'retried');
  assert.deepEqual(h.log.fails, [['row-1', 'check_unavailable', true]]);
  assert.equal(h.log.completes.length, 0);
});

test('one unreachable photo fails the row BEFORE any scan spend; transient vs final is reported correctly', async () => {
  const f: FetchLike = async (url) => (url.endsWith('2.jpg') ? new Response('x', { status: 503 }) : ok(bytes(50)));
  const h = harness(async () => result(), f);
  assert.equal(await processBulkRow(row(), h.deps), 'retried');
  assert.deepEqual(h.log.fails, [['row-1', 'image_http_503', true]]);
  assert.equal(h.log.scans.length, 0, 'no paid scan for a row we cannot fully fetch');

  const gone = harness(async () => result(), async () => new Response('x', { status: 404 }));
  assert.equal(await processBulkRow(row(), gone.deps), 'failed');
  assert.deepEqual(gone.log.fails, [['row-1', 'image_gone', false]]);
});

test('pipeline errors are mapped: unreadable image is final; busy/internal/rate-limit are retried; bad input is final', async () => {
  const cases: [ScanError['code'], string, boolean][] = [
    ['unsupported_image', 'image_invalid', false],
    ['bad_request', 'row_invalid', false],
    ['in_progress', 'scan_in_progress', true],
    ['internal', 'scan_internal', true],
    ['rate_limited', 'scan_rate_limited', true],
  ];
  for (const [c, expectCode, retry] of cases) {
    const h = harness(async () => {
      throw new ScanError(c, 'x');
    });
    await processBulkRow(row(), h.deps);
    assert.deepEqual(h.log.fails, [['row-1', expectCode, retry]], c);
  }
  const boom = harness(async () => {
    throw new Error('kaboom');
  });
  assert.equal(await processBulkRow(row(), boom.deps), 'retried');
  assert.deepEqual(boom.log.fails, [['row-1', 'internal', true]]);
});

test('an incomplete row (no category/title) is a final failure and spends nothing', async () => {
  const h = harness(async () => result());
  assert.equal(await processBulkRow(row({ payload: { title: 'x' } }), h.deps), 'failed');
  assert.deepEqual(h.log.fails, [['row-1', 'row_incomplete', false]]);
  assert.equal(h.log.scans.length, 0);
});

// ── a whole run ─────────────────────────────────────────────────────────────────────────────────────────────────
test('a run processes claimed rows with bounded concurrency, summarises outcomes, and one failure does not stop the rest', async () => {
  let inflight = 0;
  let peak = 0;
  const rows = Array.from({ length: 6 }, (_, i) => row({ id: `r${i}`, listing_id: `l${i}` }));
  const completes: string[] = [];
  const fails: string[] = [];
  const deps: BulkDeps = {
    db: {
      claim: async (limit) => rows.slice(0, limit),
      complete: async (a) => void completes.push(`${a.rowId}:${a.status}`),
      fail: async (id, c) => {
        if (id === 'r3') throw new Error('database down while reporting');
        fails.push(`${id}:${c}`);
      },
    },
    fetch: async () => ok(bytes(20)),
    scan: async (req) => {
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight--;
      if (req.listingId === 'l1') return result({ outcome: 'needs_changes', urls: [null, null] });
      if (req.listingId === 'l2') return result({ outcome: 'pending_review' });
      if (req.listingId === 'l3') throw new ScanError('internal', 'x');
      if (req.listingId === 'l4') throw new ScanError('unsupported_image', 'x');
      return result();
    },
  };
  const s = await processBulkQueue(deps, 6);
  assert.deepEqual(s, { claimed: 6, ready: 2, readyReview: 1, needsChanges: 1, retried: 0, failed: 2 });
  assert.ok(peak <= BULK_LIMITS.rowConcurrency, `peak concurrency ${peak}`);
  assert.deepEqual(fails, ['r4:image_invalid']);
  assert.equal((await processBulkQueue({ ...deps, db: { ...deps.db, claim: async () => [] } }, 4)).claimed, 0);
});
