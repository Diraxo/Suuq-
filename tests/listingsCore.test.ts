// The on-demand listings cache (lib/listingsCore.ts) with fake fetchers: deep links, missing/hidden listings, many
// favourites, access restrictions, refreshes, stale responses and failures. No network, no React.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from 'zustand/vanilla';
import { createListingsState, ListingsDeps, ListingsState, resolveIds, capListings, chunk, uniqueIds } from '../lib/listingsCore';
import { onListingsChanged, ListingsChange } from '../lib/feedEvents';
import type { Listing } from '../types';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const L = (n: number, over: Partial<Listing> = {}): Listing =>
  ({ id: uuid(n), title: `Item ${n}`, price: 100 + n, currency: 'USD', status: 'available', createdAt: n, seller: { id: 'seller-' + n }, images: [], ...over }) as unknown as Listing;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

/** A store + a fake "server": `visible` is what the viewer may see (removed / blocked rows are simply not in it). */
function setup(over: Partial<ListingsDeps> = {}, visible: Listing[] = []) {
  const calls: string[][] = [];
  const server = { visible, fail: false };
  const deps: ListingsDeps = {
    isRealId: (id) => /^0{8}-/.test(id),
    fetchByIds: async (ids) => {
      calls.push(ids);
      if (server.fail) throw new Error('network down');
      return server.visible.filter((l) => ids.includes(l.id));
    },
    ...over,
  };
  const store = createStore<ListingsState>()((set, get) => createListingsState(set, get, deps));
  return { store, calls, server, state: () => store.getState() };
}
const resolve = (s: ReturnType<typeof setup>, ids: string[]) =>
  resolveIds(ids, s.state().listings, s.state().lookups, (id) => /^0{8}-/.test(id), () => undefined);

// ---------------------------------------------------------------- batching / no per-item requests
test('250 favourites are fetched in 3 batched requests, never one per listing', async () => {
  const all = Array.from({ length: 250 }, (_, i) => L(i + 1));
  const s = setup({}, all);
  assert.equal(await s.state().ensure(all.map((l) => l.id)), true);
  assert.deepEqual(s.calls.map((c) => c.length), [100, 100, 50]);
  assert.equal(resolve(s, all.map((l) => l.id)).items.length, 250);
});

test('uniqueIds / chunk helpers drop blanks and duplicates and keep order', () => {
  assert.deepEqual(uniqueIds(['a', '', null, 'b', 'a', undefined, 'c']), ['a', 'b', 'c']);
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
});

test('cached ids are not fetched again; force re-checks them', async () => {
  const s = setup({}, [L(1), L(2)]);
  await s.state().ensure([uuid(1)]);
  await s.state().ensure([uuid(1), uuid(2)]);
  assert.deepEqual(s.calls, [[uuid(1)], [uuid(2)]]);
  await s.state().ensure([uuid(1), uuid(2)], { force: true });
  assert.deepEqual(s.calls[2], [uuid(1), uuid(2)]);
});

test('only real (uuid) ids are ever sent to the server', async () => {
  const s = setup({}, [L(1)]);
  assert.equal(await s.state().ensure(['l1', 'demo-2', uuid(1)]), true);
  assert.deepEqual(s.calls, [[uuid(1)]]);
  assert.equal(await s.state().ensure(['l1']), true);
  assert.equal(s.calls.length, 1, 'nothing real to fetch -> no request at all');
  assert.equal(await s.state().ensure([]), true);
});

// ---------------------------------------------------------------- deep links, loading vs missing
test('deep link: an unknown id is LOADING while in flight (never "not found"), then ready', async () => {
  const gate = deferred<Listing[]>();
  const s = setup({ fetchByIds: () => gate.promise });
  const id = uuid(7);
  const p = s.state().ensure([id]);
  assert.equal(s.state().lookups[id].state, 'loading');
  const mid = resolve(s, [id]);
  assert.equal(mid.loading, true);
  assert.deepEqual(mid.missingIds, []);
  assert.equal(mid.items.length, 0);
  gate.resolve([L(7)]);
  await p;
  const done = resolve(s, [id]);
  assert.equal(done.loading, false);
  assert.deepEqual(done.items.map((l) => l.id), [id]);
  assert.equal(s.state().lookups[id].state, 'ready');
});

test('before any request is made a real id resolves as loading, not missing (first render of a deep link)', () => {
  const s = setup();
  const r = resolve(s, [uuid(9)]);
  assert.equal(r.loading, true);
  assert.deepEqual(r.missingIds, []);
});

test('missing / removed / deactivated / never-existed listings end as missing, not as an error', async () => {
  const s = setup({}, [L(1)]); // 2 = removed (server filters it), 3 = never existed
  assert.equal(await s.state().ensure([uuid(1), uuid(2), uuid(3)]), true);
  const r = resolve(s, [uuid(1), uuid(2), uuid(3)]);
  assert.deepEqual(r.items.map((l) => l.id), [uuid(1)]);
  assert.deepEqual(r.missingIds, [uuid(2), uuid(3)]);
  assert.equal(r.failed, false);
});

test('sold and expired listings are returned and stay visible with their status', async () => {
  const s = setup({}, [L(1, { status: 'sold' }), L(2, { status: 'expired' }), L(3, { status: 'reserved' })]);
  await s.state().ensure([uuid(1), uuid(2), uuid(3)]);
  assert.deepEqual(resolve(s, [uuid(1), uuid(2), uuid(3)]).items.map((l) => l.status), ['sold', 'expired', 'reserved']);
});

test('a listing that disappears server-side on re-check is dropped and reported missing', async () => {
  const s = setup({}, [L(1)]);
  await s.state().ensure([uuid(1)]);
  s.server.visible = []; // staff removed it (or the seller blocked this viewer) in the meantime
  await s.state().ensure([uuid(1)], { force: true });
  assert.equal(s.state().listings.length, 0);
  assert.equal(s.state().lookups[uuid(1)].state, 'missing');
  s.server.visible = [L(1)]; // restored
  await s.state().ensure([uuid(1)], { force: true });
  assert.equal(s.state().lookups[uuid(1)].state, 'ready');
});

// ---------------------------------------------------------------- multiple favourites / comparisons
test('mixed favourites: result keeps the requested order, hidden ones are reported, the rest still load', async () => {
  const s = setup({}, [L(1), L(3), L(5)]);
  await s.state().ensure([uuid(5), uuid(2), uuid(1), uuid(4), uuid(3)]);
  const r = resolve(s, [uuid(5), uuid(2), uuid(1), uuid(4), uuid(3)]);
  assert.deepEqual(r.items.map((l) => l.id), [uuid(5), uuid(1), uuid(3)]);
  assert.deepEqual(r.missingIds, [uuid(2), uuid(4)]);
});

test('duplicate ids in one request are fetched once', async () => {
  const s = setup({}, [L(1)]);
  await s.state().ensure([uuid(1), uuid(1), uuid(1)]);
  assert.deepEqual(s.calls, [[uuid(1)]]);
});

test('overlapping requests for the same ids share ONE fetch', async () => {
  const gate = deferred<Listing[]>();
  let n = 0;
  const s = setup({ fetchByIds: () => (n++, gate.promise) });
  const a = s.state().ensure([uuid(1), uuid(2)]);
  const b = s.state().ensure([uuid(2), uuid(3)]);
  const c = s.state().ensure([uuid(1)]);
  gate.resolve([L(1), L(2), L(3)]);
  await Promise.all([a, b, c]);
  assert.equal(n, 2, 'one request for {1,2} and one for the not-yet-requested {3}');
  assert.equal(s.state().listings.length, 3);
});

// ---------------------------------------------------------------- stale responses
test('a slow OLD response can never overwrite a newer one for the same listing', async () => {
  const slow = deferred<Listing[]>();
  const fast = deferred<Listing[]>();
  const queue = [slow, fast];
  const s = setup({ fetchByIds: () => queue.shift()!.promise });
  const first = s.state().ensure([uuid(1)], { force: true });
  const second = s.state().ensure([uuid(1)], { force: true });
  fast.resolve([L(1, { price: 999 })]);
  await second;
  assert.equal(s.state().listings[0].price, 999);
  slow.resolve([L(1, { price: 1 })]); // arrives last, but it is the older request
  await first;
  assert.equal(s.state().listings[0].price, 999, 'the newer data stays');
});

test('a late "not visible" answer cannot remove a listing a newer response already delivered', async () => {
  const oldGate = deferred<Listing[]>();
  const newGate = deferred<Listing[]>();
  const queue = [oldGate, newGate];
  const s = setup({ fetchByIds: () => queue.shift()!.promise });
  const a = s.state().ensure([uuid(1)], { force: true });
  const b = s.state().ensure([uuid(1)], { force: true });
  newGate.resolve([L(1)]);
  await b;
  oldGate.resolve([]);
  await a;
  assert.equal(s.state().lookups[uuid(1)].state, 'ready');
  assert.equal(s.state().listings.length, 1);
});

test('a local removal while a fetch is in flight is not undone by that fetch', async () => {
  const gate = deferred<Listing[]>();
  const s = setup({ fetchByIds: () => gate.promise });
  const p = s.state().ensure([uuid(1)], { force: true });
  s.state().removeLocal(uuid(1)); // realtime: staff removed it
  gate.resolve([L(1)]); // the response was computed before the removal
  await p;
  assert.equal(s.state().listings.length, 0);
  assert.equal(s.state().lookups[uuid(1)].state, 'missing');
});

test('a local edit (sold / price) while a fetch is in flight is not overwritten by the older response', async () => {
  const gate = deferred<Listing[]>();
  const s = setup({ fetchByIds: () => gate.promise });
  s.state().upsertLocal(L(1, { status: 'available' }));
  const p = s.state().ensure([uuid(1)], { force: true });
  s.state().patchLocal(uuid(1), { status: 'sold' });
  gate.resolve([L(1, { status: 'available' })]);
  await p;
  assert.equal(s.state().listings[0].status, 'sold');
});

test('reset (sign-out, account switch, block list change) discards in-flight responses and bumps the epoch', async () => {
  const gate = deferred<Listing[]>();
  const s = setup({ fetchByIds: () => gate.promise });
  const p = s.state().ensure([uuid(1)]);
  const before = s.state().epoch;
  s.state().reset();
  assert.equal(s.state().epoch, before + 1);
  gate.resolve([L(1)]);
  await p;
  assert.equal(s.state().listings.length, 0, "the previous viewer's data does not come back");
  assert.equal(s.state().lookups[uuid(1)], undefined);
});

// ---------------------------------------------------------------- errors
test('first load failure: error state (not "missing"), ensure resolves false, retry succeeds', async () => {
  const s = setup({}, [L(1)]);
  s.server.fail = true;
  assert.equal(await s.state().ensure([uuid(1)]), false);
  assert.equal(s.state().lookups[uuid(1)].state, 'error');
  const r = resolve(s, [uuid(1)]);
  assert.equal(r.failed, true);
  assert.deepEqual(r.missingIds, []);
  s.server.fail = false;
  assert.equal(await s.state().ensure([uuid(1)]), true);
  assert.equal(s.state().lookups[uuid(1)].state, 'ready');
});

test('a failed REFRESH keeps showing the cached listing (no error screen over good data)', async () => {
  const s = setup({}, [L(1)]);
  await s.state().ensure([uuid(1)]);
  s.server.fail = true;
  assert.equal(await s.state().ensure([uuid(1)], { force: true }), true, 'nothing the user is looking at failed');
  assert.equal(s.state().lookups[uuid(1)].state, 'ready');
  assert.equal(resolve(s, [uuid(1)]).items.length, 1);
});

test('one failing batch does not lose the batches that worked', async () => {
  const all = Array.from({ length: 150 }, (_, i) => L(i + 1));
  let n = 0;
  const s = setup({ fetchByIds: async (ids) => (++n === 2 ? Promise.reject(new Error('boom')) : all.filter((l) => ids.includes(l.id))) }, all);
  assert.equal(await s.state().ensure(all.map((l) => l.id)), false);
  const r = resolve(s, all.map((l) => l.id));
  assert.equal(r.items.length, 100);
  assert.equal(r.failed, true);
});

test('a request that never answers times out into an error instead of loading forever', async () => {
  const s = setup({ fetchByIds: () => new Promise<Listing[]>(() => {}), timeoutMs: 20 });
  assert.equal(await s.state().ensure([uuid(1)]), false);
  assert.equal(s.state().lookups[uuid(1)].state, 'error');
  assert.match(s.state().lookups[uuid(1)].error ?? '', /timeout/);
});

// ---------------------------------------------------------------- access restrictions
test('blocked / inaccessible listings are indistinguishable from non-existent ones', async () => {
  // The server (listings_by_ids) returns nothing for a listing hidden by a block in EITHER direction.
  const s = setup({}, [L(1)]); // 2 is hidden by a block, 3 never existed
  await s.state().ensure([uuid(2), uuid(3)]);
  assert.deepEqual(s.state().lookups[uuid(2)], s.state().lookups[uuid(3)]);
  assert.equal(s.state().lookups[uuid(2)].state, 'missing');
});

test('the client never asks the server for more than 100 ids at once', async () => {
  const all = Array.from({ length: 101 }, (_, i) => L(i + 1));
  const s = setup({}, all);
  await s.state().ensure(all.map((l) => l.id));
  assert.ok(s.calls.every((c) => c.length <= 100));
});

// ---------------------------------------------------------------- local changes + feed notifications
test('upsert / patch / remove update the cache and tell the paged feeds', () => {
  const events: ListingsChange[] = [];
  const off = onListingsChanged((c) => events.push(c));
  const s = setup();
  s.state().upsertLocal(L(1));
  s.state().patchLocal(uuid(1), { price: 5 });
  s.state().removeLocal(uuid(1));
  off();
  assert.deepEqual(events, [{ type: 'changed' }, { type: 'changed' }, { type: 'removed', id: uuid(1) }]);
  assert.equal(s.state().listings.length, 0);
});

test('mergeFetched adds and refreshes feed results so a tapped card opens without a request', () => {
  const s = setup();
  s.state().mergeFetched([L(1), L(2)]);
  s.state().mergeFetched([L(2, { price: 7 }), L(3)]);
  assert.deepEqual(s.state().listings.map((l) => l.id).sort(), [uuid(1), uuid(2), uuid(3)]);
  assert.equal(s.state().listings.find((l) => l.id === uuid(2))!.price, 7);
  assert.equal(s.state().lookups[uuid(3)].state, 'ready');
  assert.equal(s.calls.length, 0);
});

// ---------------------------------------------------------------- bounded cache
test('the cache is capped (newest first) and an evicted id is "unknown", not "missing"', () => {
  const s = setup({ max: 3 });
  s.state().mergeFetched([1, 2, 3, 4, 5].map((n) => L(n)));
  assert.equal(s.state().listings.length, 3);
  assert.deepEqual(s.state().listings.map((l) => l.id), [uuid(1), uuid(2), uuid(3)]);
  assert.equal(s.state().lookups[uuid(5)], undefined);
  assert.equal(resolve(s, [uuid(5)]).loading, true, 'it will simply be fetched again');
});

test('ids pinned by an open screen are never evicted', () => {
  const s = setup({ max: 2 });
  const unpin = s.state().pin([uuid(9)]);
  s.state().mergeFetched([L(9)]);
  s.state().mergeFetched([L(1), L(2), L(3)]);
  assert.ok(s.state().listings.some((l) => l.id === uuid(9)));
  unpin();
  unpin(); // idempotent
  s.state().mergeFetched([L(4), L(5), L(6)]);
  assert.ok(!s.state().listings.some((l) => l.id === uuid(9)));
});

test('capListings keeps pinned entries beyond the cap', () => {
  const { kept, dropped } = capListings([L(1), L(2), L(3), L(4)], 2, new Set([uuid(4)]));
  assert.deepEqual(kept.map((l) => l.id), [uuid(1), uuid(2), uuid(4)]);
  assert.deepEqual(dropped, [uuid(3)]);
});

test('startup never needs the catalogue: a fresh store is empty and makes no request until a screen asks', () => {
  const s = setup({}, [L(1)]);
  assert.equal(s.state().listings.length, 0);
  assert.equal(s.calls.length, 0);
  assert.equal(Object.keys(s.state()).includes('load'), false, 'there is no load-everything action any more');
});
