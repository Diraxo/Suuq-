// lib/latestResource.ts: newest request wins, failures, timeouts, key changes (seller listings, comparable samples,
// saved-search counts all use it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createResource } from '../lib/latestResource';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

test('loads, then exposes ready data', async () => {
  const r = createResource(async (k) => `data:${k}`);
  assert.equal(r.getState().status, 'idle');
  const p = r.load('a');
  assert.equal(r.getState().status, 'loading');
  assert.equal(await p, true);
  assert.deepEqual(r.getState(), { status: 'ready', key: 'a', data: 'data:a', error: null });
});

test('a slow older request cannot overwrite a newer key (rapid navigation between sellers)', async () => {
  const gates: Record<string, ReturnType<typeof deferred<string>>> = { a: deferred(), b: deferred() };
  const r = createResource((k) => gates[k].promise);
  const pa = r.load('a');
  const pb = r.load('b');
  gates.b.resolve('B');
  assert.equal(await pb, true);
  gates.a.resolve('A'); // late
  assert.equal(await pa, false, 'the superseded request reports it did not commit');
  assert.deepEqual(r.getState(), { status: 'ready', key: 'b', data: 'B', error: null });
});

test('an older request that FAILS late cannot flip a newer success into an error', async () => {
  const gates: Record<string, ReturnType<typeof deferred<string>>> = { a: deferred(), b: deferred() };
  const r = createResource((k) => gates[k].promise);
  const pa = r.load('a');
  const pb = r.load('b');
  gates.b.resolve('B');
  await pb;
  gates.a.reject(new Error('late failure'));
  await pa;
  assert.equal(r.getState().status, 'ready');
});

test('failure becomes an error state; a retry (reload) recovers', async () => {
  let fail = true;
  const r = createResource(async () => {
    if (fail) throw new Error('network down');
    return 42;
  });
  assert.equal(await r.load('k'), false);
  assert.equal(r.getState().status, 'error');
  assert.equal(r.getState().error, 'network down');
  fail = false;
  assert.equal(await r.reload(), true);
  assert.deepEqual(r.getState().data, 42);
});

test('a failed refresh of the SAME key keeps the previous data; a different key never shows old data', async () => {
  let fail = false;
  const r = createResource(async (k) => {
    if (fail) throw new Error('x');
    return `v:${k}`;
  });
  await r.load('a');
  fail = true;
  await r.reload();
  assert.equal(r.getState().status, 'error');
  assert.equal(r.getState().data, 'v:a');
  await r.load('b');
  assert.equal(r.getState().data, null, "seller A's rows are never shown under seller B");
});

test('loading a different key clears the data immediately; reloading the same key keeps it while refreshing', async () => {
  const gate = deferred<string>();
  let first = true;
  const r = createResource((k) => (first ? ((first = false), Promise.resolve('one')) : gate.promise));
  await r.load('a');
  const p = r.load('a');
  assert.equal(r.getState().data, 'one');
  assert.equal(r.getState().status, 'loading');
  gate.resolve('two');
  await p;
  const q = r.load('b');
  assert.equal(r.getState().data, null);
  await q.catch(() => {});
});

test('timeout turns a hung request into an error', async () => {
  const r = createResource(() => new Promise<string>(() => {}), 15);
  assert.equal(await r.load('a'), false);
  assert.equal(r.getState().status, 'error');
  assert.equal(r.getState().error, 'timeout');
});

test('reset discards anything in flight', async () => {
  const gate = deferred<string>();
  const r = createResource(() => gate.promise);
  const p = r.load('a');
  r.reset();
  gate.resolve('late');
  assert.equal(await p, false);
  assert.equal(r.getState().status, 'idle');
  assert.equal(r.getState().data, null);
  assert.equal(await r.reload(), false, 'nothing to reload after a reset');
});

test('subscribers are notified on every transition', async () => {
  const r = createResource(async () => 1);
  const seen: string[] = [];
  const off = r.subscribe(() => seen.push(r.getState().status));
  await r.load('a');
  off();
  await r.load('a');
  assert.deepEqual(seen, ['loading', 'ready']);
});
