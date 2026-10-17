import test from 'node:test';
import assert from 'node:assert/strict';
import * as refreshModule from '../lib/refreshController';
import { createLatestGuard, createRefreshController } from '../lib/refreshController';

function deferred() {
  let resolve!: (v: boolean) => void;
  const promise = new Promise<boolean>((r) => (resolve = r));
  return { promise, resolve };
}

test('tapping the already-active Home tab triggers a real refresh (the runner runs)', async () => {
  const c = createRefreshController(() => 1234);
  let runs = 0;
  c.setRunner(async () => {
    runs++;
    return true;
  });
  const p = c.onHomeTabPress(true);
  assert.ok(p, 'a promise means a refresh started');
  assert.equal(c.getState().refreshing, true);
  assert.equal(await p, true);
  assert.equal(runs, 1);
  assert.deepEqual(c.getState(), { refreshing: false, lastUpdatedAt: 1234, failed: false });
});

test('pressing Home while on another tab only navigates — it does not refresh', () => {
  const c = createRefreshController();
  let runs = 0;
  c.setRunner(async () => (runs++, true));
  assert.equal(c.onHomeTabPress(false), null);
  assert.equal(runs, 0);
  assert.equal(c.getState().refreshing, false);
});

test('repeated taps share one in-flight request (no overlapping duplicates), then a later tap refreshes again', async () => {
  const c = createRefreshController();
  const d = deferred();
  let runs = 0;
  c.setRunner(() => (runs++, d.promise));
  const first = c.onHomeTabPress(true)!;
  const second = c.onHomeTabPress(true)!;
  const third = c.refresh();
  assert.equal(runs, 1);
  assert.strictEqual(first, second);
  assert.strictEqual(second, third);
  d.resolve(true);
  await first;
  assert.equal(c.getState().refreshing, false);
  c.setRunner(async () => (runs++, true));
  await c.onHomeTabPress(true);
  assert.equal(runs, 2);
});

test('refresh failure is reported (not swallowed), keeps the old timestamp, and Retry succeeds', async () => {
  let t = 100;
  const c = createRefreshController(() => t);
  c.setRunner(async () => true);
  await c.refresh();
  assert.equal(c.getState().lastUpdatedAt, 100);

  t = 200;
  c.setRunner(async () => false);
  assert.equal(await c.refresh(), false);
  assert.deepEqual(c.getState(), { refreshing: false, lastUpdatedAt: 100, failed: true });

  c.setRunner(async () => {
    throw new Error('network down');
  });
  assert.equal(await c.refresh(), false);
  assert.equal(c.getState().failed, true);

  c.setRunner(async () => true); // Retry
  const retry = c.refresh();
  assert.equal(c.getState().failed, false, 'failure banner clears as soon as a retry starts');
  assert.equal(await retry, true);
  assert.deepEqual(c.getState(), { refreshing: false, lastUpdatedAt: 200, failed: false });
});

test('subscribers are notified when refreshing starts and ends; unsubscribe stops notifications', async () => {
  const c = createRefreshController();
  c.setRunner(async () => true);
  const seen: boolean[] = [];
  const off = c.subscribe(() => seen.push(c.getState().refreshing));
  await c.refresh();
  assert.deepEqual(seen, [true, false]);
  off();
  await c.refresh();
  assert.equal(seen.length, 2);
});

test('with no runner installed, refresh is a harmless no-op', async () => {
  const c = createRefreshController();
  assert.equal(await c.refresh(), false);
  assert.equal(c.getState().refreshing, false);
  assert.equal(c.getState().failed, false);
});

test('there is no "Updated …" success notice any more: no label helper, no notice timer', () => {
  assert.equal('updatedLabel' in refreshModule, false);
  assert.equal('UPDATED_NOTICE_MS' in refreshModule, false);
});

test('a timed-out request cannot overwrite the newer successful result, however late it finishes', async () => {
  let data = 'initial';
  const gates: ((v: string) => void)[] = [];
  const c = createRefreshController(() => 1, 15);
  c.setRunner(async (ctx) => {
    const value = await new Promise<string>((r) => gates.push(r));
    if (!ctx.isCurrent()) return false; // exactly what the platform runners do before committing
    data = value;
    return true;
  });
  const first = c.refresh(); // hangs → times out
  assert.equal(await first, false);
  assert.equal(c.getState().failed, true);
  const retry = c.refresh();
  gates[1]('fresh');
  assert.equal(await retry, true);
  assert.equal(data, 'fresh');
  gates[0]('stale-late'); // the abandoned request finally answers
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(data, 'fresh', 'late stale response was discarded');
  assert.deepEqual(c.getState(), { refreshing: false, lastUpdatedAt: 1, failed: false });
});

test('a request that finishes in time stays current (the guard never rejects a healthy response)', async () => {
  let committed = '';
  const c = createRefreshController(() => 1, 1000);
  c.setRunner(async (ctx) => {
    await Promise.resolve();
    if (!ctx.isCurrent()) return false;
    committed = 'ok';
    return true;
  });
  assert.equal(await c.refresh(), true);
  assert.equal(committed, 'ok');
});

test('indicators settle after success, failure and timeout (never a stuck spinner, never a stale error)', async () => {
  let mode: 'ok' | 'fail' | 'hang' = 'ok';
  const c = createRefreshController(() => 7, 15);
  c.setRunner(async () => (mode === 'hang' ? new Promise<boolean>(() => {}) : mode === 'ok'));
  await c.refresh();
  assert.deepEqual(c.getState(), { refreshing: false, lastUpdatedAt: 7, failed: false });
  mode = 'fail';
  await c.refresh();
  assert.deepEqual([c.getState().refreshing, c.getState().failed], [false, true]);
  mode = 'hang';
  const p = c.refresh();
  assert.deepEqual([c.getState().refreshing, c.getState().failed], [true, false], 'starting clears the old error');
  await p;
  assert.deepEqual([c.getState().refreshing, c.getState().failed], [false, true]);
  mode = 'ok';
  await c.refresh();
  assert.deepEqual([c.getState().refreshing, c.getState().failed], [false, false], 'a later success clears the error');
});

test('latest guard: only the newest ticket may commit', () => {
  const g = createLatestGuard();
  const a = g.next();
  const b = g.next();
  assert.equal(g.isLatest(a), false);
  assert.equal(g.isLatest(b), true);
});
