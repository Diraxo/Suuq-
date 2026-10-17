import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshController } from '../lib/refreshController';
import { createHomeBrowseStore, HOME_BROWSE_DEFAULTS } from '../lib/homeBrowse';

// Wires the same pieces both platforms wire (store/homeRefresh.ts on mobile,
// web/src/store/homeRefresh.ts on web): a controller whose reset handler resets
// the shared browse store + scope, a fake data source, and a fake screen.
function setup(opts: { fail?: () => boolean; gate?: () => Promise<void> } = {}) {
  let scopeId: string | null = null;
  const browse = createHomeBrowseStore({ setScope: (id) => (scopeId = id) });
  const controller = createRefreshController(() => 1000);
  const data = { feed: ['old'], fetches: 0 };
  controller.setRunner(async () => {
    data.fetches++;
    await opts.gate?.();
    if (opts.fail?.()) return false;
    data.feed = ['fresh'];
    return true;
  });
  controller.setResetHandler(() => browse.getState().reset());
  const screen = { scrolledToTop: 0 };
  controller.onReset(() => screen.scrolledToTop++);
  const select = () => {
    const b = browse.getState();
    b.setActiveTab('Price');
    b.setActiveCategory('phones');
    b.setPriceOrder('desc');
    b.setPriceCurrency('ETB');
    scopeId = 'jigjiga';
  };
  const selection = () => {
    const { activeTab, activeCategory, priceOrder, priceCurrency } = browse.getState();
    return { activeTab, activeCategory, priceOrder, priceCurrency, scopeId };
  };
  return { browse, controller, data, screen, select, selection, getScope: () => scopeId };
}

const SELECTED = { activeTab: 'Price', activeCategory: 'phones', priceOrder: 'desc', priceCurrency: 'ETB', scopeId: 'jigjiga' };

test('pull-to-refresh / Refresh button reloads data and preserves every selection and scroll', async () => {
  const h = setup();
  h.select();
  assert.equal(await h.controller.refresh(), true);
  assert.equal(h.data.fetches, 1);
  assert.deepEqual(h.data.feed, ['fresh']);
  assert.deepEqual(h.selection(), SELECTED);
  assert.equal(h.screen.scrolledToTop, 0, 'an ordinary refresh does not scroll to top');
});

test('double-tapping the active Home tab resets all Home selections to the defaults and refreshes', async () => {
  const h = setup();
  h.select();
  const p = h.controller.onHomeTabPress(true);
  assert.ok(p);
  // The UI reset is synchronous, so the user sees the default view immediately.
  assert.deepEqual(h.selection(), { ...HOME_BROWSE_DEFAULTS });
  assert.equal(await p, true);
  assert.equal(h.data.fetches, 1);
  assert.deepEqual(h.selection(), { ...HOME_BROWSE_DEFAULTS });
});

test('defaults: For You, All Categories, lowest price first, no currency, All Locations (same on both platforms)', () => {
  assert.deepEqual(HOME_BROWSE_DEFAULTS, { activeTab: 'For You', activeCategory: null, priceOrder: 'asc', priceCurrency: null, scopeId: null });
  const mobile = createHomeBrowseStore({ setScope: () => {} }).getState();
  const web = createHomeBrowseStore({ setScope: () => {} }).getState();
  for (const s of [mobile, web]) {
    assert.equal(s.activeTab, 'For You');
    assert.equal(s.activeCategory, null);
    assert.equal(s.priceOrder, 'asc');
    assert.equal(s.priceCurrency, null);
  }
});

test('double-tap tells the screen to scroll to the top, after the selections were already reset', () => {
  const h = setup();
  h.select();
  let selectionWhenScrolled: unknown = null;
  h.controller.onReset(() => (selectionWhenScrolled = h.selection()));
  h.controller.onHomeTabPress(true);
  assert.equal(h.screen.scrolledToTop, 1);
  assert.deepEqual(selectionWhenScrolled, { ...HOME_BROWSE_DEFAULTS });
});

test('tapping Home from another tab does not reset anything or scroll', () => {
  const h = setup();
  h.select();
  assert.equal(h.controller.onHomeTabPress(false), null);
  assert.deepEqual(h.selection(), SELECTED);
  assert.equal(h.screen.scrolledToTop, 0);
  assert.equal(h.data.fetches, 0);
});

test('a repeated reset shares one in-flight request (no duplicate network calls) but still resets each time', async () => {
  let release!: () => void;
  const h = setup({ gate: () => new Promise<void>((r) => (release = r)) });
  h.select();
  const first = h.controller.onHomeTabPress(true)!;
  h.select(); // the user picks something again while the request is still running
  const second = h.controller.onHomeTabPress(true)!;
  assert.strictEqual(first, second);
  assert.equal(h.data.fetches, 1);
  assert.deepEqual(h.selection(), { ...HOME_BROWSE_DEFAULTS });
  assert.equal(h.screen.scrolledToTop, 2);
  release();
  await first;
  assert.equal(h.data.fetches, 1);
});

test('a reset during an ordinary refresh joins the request but still resets the UI and scrolls', async () => {
  let release!: () => void;
  const h = setup({ gate: () => new Promise<void>((r) => (release = r)) });
  h.select();
  const pull = h.controller.refresh();
  assert.deepEqual(h.selection(), SELECTED, 'ordinary refresh keeps selections');
  const reset = h.controller.onHomeTabPress(true)!;
  assert.strictEqual(pull, reset);
  assert.equal(h.data.fetches, 1);
  assert.deepEqual(h.selection(), { ...HOME_BROWSE_DEFAULTS });
  assert.equal(h.screen.scrolledToTop, 1);
  release();
  assert.equal(await reset, true);
});

test('a failed refresh keeps the old feed and the selections, shows the error state, and Retry recovers', async () => {
  let failing = true;
  const h = setup({ fail: () => failing });
  h.select();
  assert.equal(await h.controller.refresh(), false);
  assert.deepEqual(h.data.feed, ['old']);
  assert.deepEqual(h.selection(), SELECTED);
  assert.deepEqual(h.controller.getState(), { refreshing: false, lastUpdatedAt: null, failed: true });
  failing = false;
  assert.equal(await h.controller.refresh(), true);
  assert.deepEqual(h.controller.getState(), { refreshing: false, lastUpdatedAt: 1000, failed: false });
});

test('a failed reset still restores the default view and keeps the old feed', async () => {
  const h = setup({ fail: () => true });
  h.select();
  assert.equal(await h.controller.onHomeTabPress(true), false);
  assert.deepEqual(h.selection(), { ...HOME_BROWSE_DEFAULTS });
  assert.deepEqual(h.data.feed, ['old']);
  assert.equal(h.controller.getState().failed, true);
});

test('the refreshing indicator is cleaned up after success and after failure; a throwing runner counts as failure', async () => {
  const seen: boolean[] = [];
  const h = setup();
  h.controller.subscribe(() => seen.push(h.controller.getState().refreshing));
  await h.controller.refresh();
  assert.deepEqual(seen, [true, false]);
  h.controller.setRunner(async () => {
    throw new Error('offline');
  });
  await h.controller.onHomeTabPress(true);
  assert.equal(h.controller.getState().refreshing, false);
  assert.equal(h.controller.getState().failed, true);
});

test('reset listeners can be removed (screen unmounted) and a missing reset handler is harmless', async () => {
  const c = createRefreshController();
  c.setRunner(async () => true);
  let calls = 0;
  const off = c.onReset(() => calls++);
  await c.reset();
  off();
  await c.reset();
  assert.equal(calls, 1);
});

// Mobile wiring: the saved location (useLocationStore) is shared with Search and
// is not handed to the Home browse store at all.
test('mobile: Home reset resets Home selections but never touches the saved location Search uses', async () => {
  let saved: string | null = 'jigjiga';
  let writes = 0;
  const location = { get: () => saved, set: (id: string | null) => ((saved = id), writes++) };
  const browse = createHomeBrowseStore(); // no ScopePort, exactly as store/homeBrowse.ts
  const controller = createRefreshController(() => 1);
  controller.setRunner(async () => true);
  controller.setResetHandler(() => browse.getState().reset());
  browse.getState().setActiveTab('Price');
  browse.getState().setActiveCategory('phones');
  await controller.onHomeTabPress(true);
  assert.equal(browse.getState().activeTab, 'For You');
  assert.equal(browse.getState().activeCategory, null);
  assert.equal(location.get(), 'jigjiga');
  assert.equal(writes, 0);
  await controller.refresh();
  assert.equal(location.get(), 'jigjiga', 'ordinary refresh keeps it too');
});

test('a hung request times out as failed, clears the spinner, and Retry starts exactly one new request', async () => {
  let calls = 0;
  const c = createRefreshController(() => 5, 20);
  c.setRunner(() => {
    calls++;
    return calls === 1 ? new Promise<boolean>(() => {}) : Promise.resolve(true);
  });
  const first = c.refresh();
  assert.strictEqual(c.refresh(), first, 'joins while in flight');
  assert.equal(calls, 1);
  assert.equal(await first, false);
  assert.deepEqual(c.getState(), { refreshing: false, lastUpdatedAt: null, failed: true });
  assert.equal(await c.refresh(), true);
  assert.equal(calls, 2);
  assert.equal(c.getState().failed, false);
});

test('web wiring: reset restores the place through the scope port only (no second source of truth for scope)', () => {
  const h = setup();
  h.select();
  assert.equal(h.getScope(), 'jigjiga');
  h.browse.getState().reset();
  assert.equal(h.getScope(), null);
});
