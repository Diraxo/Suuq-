import test from 'node:test';
import assert from 'node:assert/strict';
import { createScanRunner, scanKey, photosToFix, issueRows, publishableUrls, keyFromUrl, type ScanInput, type ScanResult } from '../lib/imageScanState';
import { isWatermarkedDerivative, containRect } from '../lib/imageSafety';

const input = (over: Partial<ScanInput> = {}): ScanInput => ({ listingId: 'l1', categoryId: 'phones', title: 'iPhone 13', description: 'nice', photoUris: ['a.jpg', 'b.jpg'], ...over });
const ok: ScanResult = { scanId: 's', outcome: 'approved', canRetry: false, issues: [], images: [{ slot: 0, verdict: 'pass', issues: [], url: 'https://cdn.test/wm/listings/u/l/x.jpg', held: false }, { slot: 1, verdict: 'pass', issues: [], url: 'https://cdn.test/wm/listings/u/l/y.jpg', held: false }] };

test('unchanged photos/context are scanned once; navigating back and forth reuses the answer', async () => {
  let calls = 0;
  const runner = createScanRunner(async () => { calls++; return ok; });
  await runner.scan(input());
  await runner.scan(input());
  await runner.scan(input({ photoUris: ['b.jpg', 'a.jpg'], title: '  IPHONE 13 ' })); // reordered + trivially edited title
  assert.equal(calls, 1);
});

test('changing a photo, category, title or description rescans', async () => {
  let calls = 0;
  const runner = createScanRunner(async () => { calls++; return ok; });
  await runner.scan(input());
  await runner.scan(input({ photoUris: ['a.jpg', 'c.jpg'] }));
  await runner.scan(input({ categoryId: 'electronics' }));
  await runner.scan(input({ title: 'Samsung S23' }));
  await runner.scan(input({ description: 'cracked screen' }));
  assert.equal(calls, 5);
  assert.notEqual(scanKey(input()), scanKey(input({ listingId: 'l2' })));
});

test('identical concurrent requests share one in-flight scan (double taps cost one scan)', async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const runner = createScanRunner(async () => { calls++; await gate; return ok; });
  const a = runner.scan(input());
  const b = runner.scan(input());
  release();
  assert.equal(await a, await b);
  assert.equal(calls, 1);
});

test('a retry-able failure is never cached; rejected results are (the seller must change something)', async () => {
  let calls = 0;
  const failed: ScanResult = { ...ok, outcome: 'pending_review', canRetry: true, issues: [{ code: 'check_failed', indexes: [0], messageKey: '', severity: 'review' }] };
  const rejected: ScanResult = { ...ok, outcome: 'needs_changes' };
  const runner = createScanRunner(async () => (++calls === 1 ? failed : rejected));
  assert.equal((await runner.scan(input())).canRetry, true);
  assert.equal((await runner.scan(input())).outcome, 'needs_changes'); // retried because the failure was not cached
  await runner.scan(input());
  assert.equal(calls, 2);
});

test('a failing request clears its in-flight slot so a later tap can retry', async () => {
  let calls = 0;
  const runner = createScanRunner(async () => { if (++calls === 1) throw new Error('network'); return ok; });
  await assert.rejects(() => runner.scan(input()), /network/);
  assert.equal((await runner.scan(input())).outcome, 'approved');
});

test('only the flagged photos need fixing; valid ones stay; issues are grouped once with 1-based photo numbers', () => {
  const r: ScanResult = {
    scanId: 's', outcome: 'needs_changes', canRetry: false,
    issues: [
      { code: 'category_mismatch', indexes: [1, 2], messageKey: 'imageScan.issue.category_mismatch', severity: 'fix' },
      { code: 'duplicate_listing', indexes: [3], messageKey: 'imageScan.issue.duplicate_listing', severity: 'review' },
    ],
    images: [
      { slot: 0, verdict: 'pass', issues: [], url: 'u0', held: false },
      { slot: 1, verdict: 'reject', issues: ['category_mismatch'], url: null, held: false },
      { slot: 2, verdict: 'reject', issues: ['category_mismatch'], url: null, held: false },
      { slot: 3, verdict: 'review', issues: ['duplicate_listing'], url: 'u3', held: false },
    ],
  };
  assert.deepEqual(photosToFix(r), [1, 2]);
  const rows = issueRows(r);
  assert.deepEqual(rows.map((x) => [x.code, x.photos]), [['category_mismatch', [2, 3]], ['duplicate_listing', [4]]]);
  assert.equal(rows[0].titleKey, 'imageScan.issue.category_mismatch.title');
  assert.equal(publishableUrls(r), null);
});

test('publishable urls: approved and review outcomes proceed with every photo url, in order', () => {
  assert.deepEqual(publishableUrls(ok), ['https://cdn.test/wm/listings/u/l/x.jpg', 'https://cdn.test/wm/listings/u/l/y.jpg']);
  const review: ScanResult = { ...ok, outcome: 'pending_review', images: [{ ...ok.images[0], verdict: 'review', held: true }, ok.images[1]] };
  assert.equal(publishableUrls(review)?.length, 2);
  assert.equal(publishableUrls({ ...ok, images: [{ ...ok.images[0], url: null }, ok.images[1]] }), null);
  assert.equal(keyFromUrl('https://cdn.test/wm/listings/u/l/x.jpg'), 'wm/listings/u/l/x.jpg');
});

test('viewer helpers: derivative detection (no double mark) and contain-fit rectangle', () => {
  assert.equal(isWatermarkedDerivative('https://cdn.test/wm/listings/u/l/x.jpg'), true);
  assert.equal(isWatermarkedDerivative('https://cdn.test/listings/u/l/x.jpg'), false);
  assert.equal(isWatermarkedDerivative('https://res.cloudinary.com/x/upload/wmx.jpg'), false);
  assert.equal(isWatermarkedDerivative('not a url'), false);
  const r = containRect(1000, 500, 400, 800); // wide photo in a tall screen: letterboxed top/bottom
  assert.deepEqual([r.x, r.w, r.h], [0, 400, 200]);
  assert.equal(r.y, 300);
  assert.deepEqual(containRect(0, 0, 400, 800), { x: 0, y: 0, w: 400, h: 800 });
});
