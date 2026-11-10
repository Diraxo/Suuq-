// The shared image queue's behaviour (lib/imageQueue.ts): bounded concurrency, priority order, de-duplication, the urgent lane,
// cancellation by priority / URL / screen group, bounded retry with backoff, timeouts, pause/resume, state tracking, bounded memory,
// plus the home look-ahead plan and the gallery neighbour plan. The download itself is injected, so all of this runs in node.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { coverLookahead, createImageQueue, neighbourPlan, PREFETCH_PRIORITY, URGENT_UP_TO } from '../lib/imageQueue';

const TIMEOUT = 999999;
type Job = { url: string; resolve: (ok: boolean) => void };
function harness(extra: Partial<Parameters<typeof createImageQueue>[0]> = {}) {
  const jobs: Job[] = [];
  const all: { fn: () => void; ms: number; cleared: boolean }[] = [];
  let clock = 0;
  const q = createImageQueue({
    load: (url) => new Promise<boolean>((resolve) => jobs.push({ url, resolve })),
    concurrency: 2,
    timeoutMs: TIMEOUT,
    now: () => clock,
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; all.push(t); return t; },
    clearTimer: (t) => { (t as { cleared: boolean }).cleared = true; },
    ...extra,
  });
  const tick = () => new Promise((r) => setImmediate(r));
  const timeoutOf = (ms: number) => all.filter((t) => t.ms === ms && !t.cleared);
  return {
    q, jobs, tick,
    /** Backoff timers only (the download timeouts are tracked separately). */
    retryTimers: () => all.filter((t) => t.ms !== TIMEOUT && !t.cleared),
    allTimers: all,
    timeoutOf,
    advance: (ms: number) => { clock += ms; },
  };
}
const urls = (h: ReturnType<typeof harness>) => h.jobs.map((j) => j.url);

test('never runs more than the concurrency limit', async () => {
  const h = harness();
  for (let i = 0; i < 6; i++) h.q.enqueue(`u${i}`, 5);
  assert.equal(h.jobs.length, 2);
  h.jobs[0].resolve(true);
  await h.tick();
  assert.equal(h.jobs.length, 3);
  assert.equal(h.q.stats().running, 2);
});

test('lower priority numbers run first, ties in arrival order', async () => {
  const h = harness({ concurrency: 1 });
  h.q.enqueue('first', 6); // starts immediately
  h.q.enqueue('late', 6);
  h.q.enqueue('urgent', 0);
  h.q.enqueue('mid', 4);
  const order = [h.jobs[0].url];
  for (let i = 0; i < 3; i++) { h.jobs[i].resolve(true); await h.tick(); order.push(h.jobs[i + 1].url); }
  assert.deepEqual(order, ['first', 'urgent', 'mid', 'late']);
});

test('the documented tiers are ordered: photo on screen, hero, neighbours, thumbnails, home, rest of listing, background', () => {
  const p = PREFETCH_PRIORITY;
  assert.ok(p.visible < p.hero && p.hero < p.neighbour && p.neighbour < p.strip && p.strip < p.homeVisible);
  assert.ok(p.homeVisible < p.homeNext && p.homeNext < p.homeAhead && p.homeAhead < p.listingRest && p.listingRest < p.background);
});

test('a visible photo is not stuck behind background work: the urgent lane starts it while every normal slot is busy', async () => {
  const h = harness({ concurrency: 2, urgent: { upTo: URGENT_UP_TO, extra: 1 } });
  for (let i = 0; i < 5; i++) h.q.enqueue(`bg${i}`, PREFETCH_PRIORITY.background);
  assert.equal(h.q.stats().running, 2);
  h.q.enqueue('shown', PREFETCH_PRIORITY.visible);
  assert.equal(h.q.stats().running, 3, 'urgent work uses the reserved slot');
  assert.ok(urls(h).includes('shown'));
  h.q.enqueue('other-bg', PREFETCH_PRIORITY.background);
  assert.equal(h.q.stats().running, 3, 'background work never uses the reserved slot');
  h.q.enqueue('neighbour', PREFETCH_PRIORITY.neighbour);
  assert.equal(h.q.stats().running, 3, 'the reserved slot is taken: urgent work waits for it, ahead of every background item');
  h.jobs.find((j) => j.url === 'shown')!.resolve(true);
  await h.tick();
  assert.ok(urls(h).includes('neighbour'));
});

test('a URL is downloaded once: queued, in flight and recently finished repeats are ignored; a queued one can be raised', async () => {
  const h = harness({ concurrency: 1 });
  h.q.enqueue('a', 6);
  h.q.enqueue('a', 6); // in flight
  h.q.enqueue('b', 7);
  h.q.enqueue('b', 7); // queued
  h.q.enqueue('c', 7);
  h.q.enqueue('c', 4); // raised ahead of b
  h.jobs[0].resolve(true); await h.tick();
  assert.equal(h.jobs[1].url, 'c');
  h.jobs[1].resolve(true); await h.tick();
  h.jobs[2].resolve(true); await h.tick();
  h.q.enqueue('a', 0); // finished within ttl
  assert.equal(h.jobs.length, 3);
  assert.deepEqual(urls(h), ['a', 'c', 'b']);
});

test('raising a waiting URL into the urgent range starts it in the reserved slot at once', () => {
  const h = harness({ concurrency: 1, urgent: { upTo: 2, extra: 1 } });
  h.q.enqueue('busy', 7);
  h.q.enqueue('w', 7);
  assert.equal(h.q.stats().running, 1);
  h.q.enqueue('w', 0);
  assert.equal(h.q.stats().running, 2);
});

test('a finished URL may be requested again after the ttl', async () => {
  const h = harness({ ttlMs: 1000 });
  h.q.enqueue('a', 0); h.jobs[0].resolve(true); await h.tick();
  h.advance(1001);
  h.q.enqueue('a', 0);
  assert.equal(h.jobs.length, 2);
});

test('failures retry with exponential backoff, a bounded number of times, then stop', async () => {
  const h = harness({ backoffMs: 100, maxRetries: 2 });
  h.q.enqueue('x', 0);
  h.jobs[0].resolve(false); await h.tick();
  assert.equal(h.retryTimers().length, 1);
  assert.equal(h.retryTimers()[0].ms, 100);
  assert.equal(h.q.stateOf('x'), 'retrying');
  h.q.enqueue('x', 0); // already waiting to retry: no storm
  assert.equal(h.jobs.length, 1);
  h.retryTimers()[0].fn(); assert.equal(h.jobs.length, 2);
  assert.equal(h.q.stateOf('x'), 'retrying', 'a second attempt is still a retry');
  h.jobs[1].resolve(false); await h.tick();
  const second = h.retryTimers().find((t) => t.ms === 200);
  assert.ok(second, 'backoff doubles');
  second!.fn(); h.jobs[2].resolve(false); await h.tick();
  assert.equal(h.retryTimers().filter((t) => t.ms === 400).length, 0, 'no third retry');
  assert.equal(h.q.stats().failed, 1);
  assert.equal(h.q.stateOf('x'), 'failed');
  h.q.enqueue('x', 0); // given up on until ttl
  assert.equal(h.jobs.length, 3);
});

test('a throwing loader counts as a failure and does not wedge the queue', async () => {
  const jobs: string[] = [];
  const q = createImageQueue({ concurrency: 1, maxRetries: 0, load: (u) => { jobs.push(u); if (u === 'bad') throw new Error('boom'); return Promise.resolve(true); } });
  q.enqueue('bad', 0); q.enqueue('good', 0);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(jobs, ['bad', 'good']);
  assert.equal(q.stateOf('bad'), 'failed');
  assert.equal(q.stateOf('good'), 'loaded');
});

test('a download that never answers is abandoned at the timeout and frees its slot; a late answer is ignored', async () => {
  const h = harness({ concurrency: 1, maxRetries: 0, timeoutMs: 5000 });
  h.q.enqueue('hang', 0); h.q.enqueue('next', 1);
  assert.deepEqual(urls(h), ['hang']);
  h.timeoutOf(5000)[0].fn();
  await h.tick();
  assert.equal(h.q.stateOf('hang'), 'failed');
  assert.deepEqual(urls(h), ['hang', 'next'], 'the slot was released');
  h.jobs[0].resolve(true); // the hung download finally answers
  await h.tick();
  assert.equal(h.q.stateOf('hang'), 'failed', 'a late success does not rewrite history or free a second slot');
  assert.equal(h.q.stats().running, 1);
});

test('cancelBelow drops queued look-ahead but keeps visible work and in-flight downloads', () => {
  const h = harness({ concurrency: 1 });
  h.q.enqueue('running', 0);
  h.q.enqueue('vis', 0);
  h.q.enqueue('next', 1);
  h.q.enqueue('far', 2);
  assert.equal(h.q.cancelBelow(0), 2);
  assert.equal(h.q.stats().queued, 1);
  assert.equal(h.q.cancel('vis'), true);
  assert.equal(h.q.stats().queued, 0);
  assert.equal(h.q.stats().running, 1);
});

test('cancelGroup withdraws a screen\'s queued work; a photo another screen also wants survives; in-flight work finishes', async () => {
  const h = harness({ concurrency: 1 });
  h.q.enqueue('inflight', 5, 'home');
  h.q.enqueue('only-home', 5, 'home');
  h.q.enqueue('shared', 5, 'home');
  h.q.enqueue('shared', 5, 'detail');
  assert.equal(h.q.cancelGroup('home'), 1);
  assert.equal(h.q.stateOf('only-home'), 'idle');
  assert.equal(h.q.stateOf('shared'), 'queued');
  assert.equal(h.q.stateOf('inflight'), 'loading');
  assert.equal(h.q.cancelGroup('detail'), 1);
  assert.equal(h.q.stateOf('shared'), 'idle');
  h.jobs[0].resolve(true); await h.tick();
  assert.equal(h.q.stateOf('inflight'), 'loaded');
});

test('cancelGroup also withdraws work waiting for a retry', async () => {
  const h = harness({ backoffMs: 100, maxRetries: 1 });
  h.q.enqueue('r', 5, 'gallery');
  h.jobs[0].resolve(false); await h.tick();
  assert.equal(h.q.stateOf('r'), 'retrying');
  assert.equal(h.q.cancelGroup('gallery'), 1);
  assert.equal(h.q.stateOf('r'), 'idle');
  assert.equal(h.retryTimers().length, 0, 'its backoff timer was cleared');
});

test('pause stops new downloads; resume continues', async () => {
  const h = harness({ concurrency: 1 });
  h.q.enqueue('a', 0); h.q.enqueue('b', 0);
  h.q.pause();
  h.jobs[0].resolve(true); await h.tick();
  assert.equal(h.jobs.length, 1);
  h.q.enqueue('c', 0);
  assert.equal(h.jobs.length, 1, 'nothing starts while paused, even new work');
  h.q.resume();
  assert.equal(h.jobs.length, 2);
});

test('pausing keeps work that was waiting to retry and re-arms it on resume (nothing is lost across an outage)', async () => {
  const h = harness({ backoffMs: 100, maxRetries: 2 });
  h.q.enqueue('x', 0);
  h.jobs[0].resolve(false); await h.tick();
  assert.equal(h.retryTimers().length, 1);
  h.q.pause();
  assert.equal(h.retryTimers().length, 0, 'the old timer was cleared');
  assert.equal(h.q.stateOf('x'), 'retrying', 'still remembered');
  h.q.resume();
  const t = h.retryTimers();
  assert.equal(t.length, 1, 're-armed');
  t[0].fn();
  assert.equal(h.jobs.length, 2, 'and it downloads again');
});

test('forgetFailures makes given-up URLs eligible again (network recovery)', async () => {
  const h = harness({ maxRetries: 0 });
  h.q.enqueue('x', 0); h.jobs[0].resolve(false); await h.tick();
  h.q.enqueue('x', 0);
  assert.equal(h.jobs.length, 1, 'still failed within ttl');
  assert.equal(h.q.forgetFailures(), 1);
  h.q.enqueue('x', 0);
  assert.equal(h.jobs.length, 2);
  h.jobs[1].resolve(true); await h.tick();
  assert.equal(h.q.forgetFailures(), 0, 'successes are kept');
});

test('setConcurrency changes the limit at once (slow network) and never goes below one', async () => {
  const h = harness({ concurrency: 3 });
  for (let i = 0; i < 6; i++) h.q.enqueue(`u${i}`, 5);
  assert.equal(h.q.stats().running, 3);
  h.q.setConcurrency(1);
  h.jobs[0].resolve(true); h.jobs[1].resolve(true); await h.tick();
  assert.equal(h.q.stats().running, 1, 'drained to the new limit before starting more');
  h.q.setConcurrency(0);
  h.jobs[2].resolve(true); await h.tick();
  assert.equal(h.q.stats().running, 1);
});

test('states: idle -> queued -> loading -> loaded', async () => {
  const h = harness({ concurrency: 1 });
  assert.equal(h.q.stateOf('a'), 'idle');
  h.q.enqueue('a', 0); h.q.enqueue('b', 0);
  assert.equal(h.q.stateOf('a'), 'loading');
  assert.equal(h.q.stateOf('b'), 'queued');
  h.jobs[0].resolve(true); await h.tick();
  assert.equal(h.q.stateOf('a'), 'loaded');
  h.advance(11 * 60 * 1000);
  assert.equal(h.q.stateOf('a'), 'idle', 'a result older than the ttl is no longer trusted');
});

test('memory is bounded: finished URLs and waiting URLs', async () => {
  const h = harness({ memoryLimit: 3, concurrency: 1 });
  for (let i = 0; i < 6; i++) { h.q.enqueue(`u${i}`, 0); h.jobs[i].resolve(true); await h.tick(); }
  assert.equal(h.q.stats().done, 3);

  const w = harness({ concurrency: 1, maxQueued: 3 });
  w.q.enqueue('running', 0);
  for (let i = 0; i < 10; i++) w.q.enqueue(`w${i}`, 8);
  w.q.enqueue('important', 1);
  assert.equal(w.q.stats().queued, 3);
  assert.equal(w.q.stateOf('important'), 'queued', 'the most important waiting URL is never the one dropped');
  assert.equal(w.q.stats().dropped, 8);
});

test('scenario: fast gallery swipes. Each swipe replaces the previous plan; only the current neighbourhood survives', async () => {
  const h = harness({ concurrency: 1, urgent: { upTo: URGENT_UP_TO, extra: 1 } });
  const photos = Array.from({ length: 8 }, (_, i) => `p${i}`);
  const plan = (active: number) => {
    h.q.cancelGroup('gallery');
    for (const { index, priority } of neighbourPlan(photos.length, active)) h.q.enqueue(photos[index], priority, 'gallery');
  };
  plan(0);
  plan(3); // swiped quickly
  plan(7);
  // p0 and its neighbour p1 were already started by the first plan and cannot be cancelled; everything still waiting was re-planned.
  assert.equal(h.q.stateOf('p0'), 'loading');
  assert.equal(h.q.stateOf('p1'), 'loading');
  assert.equal(h.q.stateOf('p7'), 'queued');
  h.jobs[0].resolve(true); await h.tick();
  assert.equal(h.jobs[2].url, 'p7', 'the photo now on screen goes next, ahead of everything the earlier plans queued');
  h.jobs[1].resolve(true); await h.tick();
  assert.equal(h.jobs[3].url, 'p6', 'then its neighbour');
  h.q.cancelGroup('gallery');
  assert.equal(h.q.stats().queued, 0, 'closing the viewer withdraws everything still waiting');
});

test('scenario: a hero photo never waits behind a full queue of home look-ahead', async () => {
  const h = harness({ concurrency: 2, urgent: { upTo: URGENT_UP_TO, extra: 1 } });
  coverLookahead(Array.from({ length: 30 }, (_, i) => `c${i}`), [0, 1], 2).forEach((c) => h.q.enqueue(c.url, c.priority, 'home'));
  h.q.enqueue('hero-of-opened-listing', PREFETCH_PRIORITY.hero, 'detail');
  assert.ok(urls(h).includes('hero-of-opened-listing'), 'started immediately in the reserved slot');
});

test('coverLookahead: visible first, then the following rows by tier, de-duplicated, clamped to the list', () => {
  const covers = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
  const plan = coverLookahead(covers, [3, 2], 2, 8);
  assert.deepEqual(plan.slice(0, 2), [{ url: 'c', priority: PREFETCH_PRIORITY.homeVisible }, { url: 'd', priority: PREFETCH_PRIORITY.homeVisible }]);
  assert.deepEqual(plan.slice(2, 6).map((p) => p.priority), [PREFETCH_PRIORITY.homeNext, PREFETCH_PRIORITY.homeNext, PREFETCH_PRIORITY.homeNext, PREFETCH_PRIORITY.homeNext]);
  assert.equal(plan[6].priority, PREFETCH_PRIORITY.homeAhead);
  assert.equal(plan.length, 2 + 8);
  assert.deepEqual(coverLookahead(covers, [10], 2, 8).map((p) => p.url), ['k', 'l']);
  assert.deepEqual(coverLookahead(covers, [], 2), []);
  assert.deepEqual(coverLookahead([], [0], 2), []);
  assert.deepEqual(coverLookahead(['x', undefined, 'x', 'y'], [0], 1).map((p) => p.url), ['x', 'y']);
});

test('coverLookahead: scrolling up re-plans from the new visible rows (direction does not matter) and ignores out-of-range indexes', () => {
  const covers = Array.from({ length: 40 }, (_, i) => `c${i}`);
  const down = coverLookahead(covers, [10, 11], 2);
  const up = coverLookahead(covers, [4, 5], 2);
  assert.deepEqual(down.slice(0, 2).map((p) => p.url), ['c10', 'c11']);
  assert.deepEqual(up.slice(0, 2).map((p) => p.url), ['c4', 'c5']);
  assert.deepEqual(coverLookahead(covers, [-3, 99], 2), []);
  assert.equal(coverLookahead(covers, [0], 0).length, 1 + 8, 'a bad column count is treated as one');
});

test('neighbourPlan: open photo first, then next and previous, then outward; edges and tiny listings', () => {
  const idx = (n: number, a: number) => neighbourPlan(n, a).map((p) => p.index);
  assert.deepEqual(idx(8, 3), [3, 4, 2, 5, 1, 6, 0, 7]);
  assert.deepEqual(idx(8, 0), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(idx(8, 7), [7, 6, 5, 4, 3, 2, 1, 0]);
  assert.deepEqual(idx(1, 0), [0]);
  assert.deepEqual(idx(2, 1), [1, 0]);
  assert.deepEqual(idx(5, 99), [4, 3, 2, 1, 0], 'an out-of-range index is clamped');
  assert.deepEqual(idx(0, 0), []);
  const p = neighbourPlan(8, 3);
  assert.equal(p[0].priority, PREFETCH_PRIORITY.visible);
  assert.deepEqual(p.slice(1, 3).map((x) => x.priority), [PREFETCH_PRIORITY.neighbour, PREFETCH_PRIORITY.neighbour]);
  assert.ok(p.slice(3).every((x) => x.priority === PREFETCH_PRIORITY.listingRest));
  assert.equal(neighbourPlan(30, 12).length, 30, 'many-photo listings are planned in full but bounded by the queue');
});

// Wiring (source-level, like tests/galleryRender.test.ts): the screens must actually use the queue and request matching URLs.
// These only prove the call sites exist and agree on the URL; the behaviour above is what the queue does with them.
const src = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8').replace(/\r\n/g, '\n');

test('home list reports viewable items to the cover prefetcher through a stable callback', () => {
  const h = src('app/(tabs)/home.tsx');
  assert.match(h, /onViewableItemsChanged=\{onViewableItemsChanged\}/);
  assert.match(h, /useRef\(\(\{ viewableItems \}/);
  assert.match(h, /prefetchHomeCovers\(/);
});

test('every surface asks the shared queue for the exact URL it displays', () => {
  const p = src('lib/imagePrefetch.ts');
  assert.match(p, /imageUrl\(url, \{ size: 'thumb' \}\)/);
  assert.match(src('components/ListingCard.tsx'), /imageUrl\(listing\.images\[0\], \{ size: 'thumb' \}\)/);
  assert.match(p, /\{ size: 'strip' \}/);
  assert.match(src('app/listing/[id].tsx'), /imageUrl\(uri, \{ size: 'strip' \}\)/);
  assert.match(p, /\{ size: 'card' \}/);
  assert.match(src('app/listing/[id].tsx'), /imageUrl\(uri, \{ size: 'card' \}\)/);
  assert.match(p, /\{ size: 'full' \}/);
  assert.match(src('components/ZoomableImage.tsx'), /imageUrl\(uri, \{ size: 'full' \}\)/);
});

test('the gallery no longer has its own batching: it goes through the shared queue', () => {
  const p = src('lib/imagePrefetch.ts');
  assert.doesNotMatch(p, /BATCH|RE_REQUEST_AFTER_MS|generation/);
  assert.doesNotMatch(p, /Image\.prefetch\(\s*(fresh|list)/);
  assert.match(p, /queue\.enqueue\(imageUrl\(urls\[index\], \{ size: 'full' \}\)/);
});

test('lifecycle: the queue follows app state and network, started once from the root layout', () => {
  assert.match(src('app/_layout.tsx'), /startImageLifecycle\(\)/);
  const l = src('lib/imageLifecycle.ts');
  assert.match(l, /AppState\.addEventListener/);
  assert.match(l, /NetInfo\.addEventListener/);
  assert.match(l, /forgetImageFailures\(\)/);
});
