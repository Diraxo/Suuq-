import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  FILTER_IDS,
  NO_FILTERS,
  PRICE_REDUCED_DAYS,
  SEARCH_QUERY_MAX,
  FilterFacts,
  activeFilterIds,
  hasActiveFilters,
  marketplaceDayStart,
  matchesFilters,
  mergePage,
  recommendationSearches,
  recoveryActions,
  searchKey,
  splitPage,
  toRpcParams,
  toggleFilter,
} from '../lib/searchFilters';
import { initialSession, sessionReducer, SearchSession } from '../lib/searchSession';

const root = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');
const DAY = 86_400_000;
const NOW = new Date('2026-05-10T09:00:00Z');

// ---------------------------------------------------------------- filter state
test('all filters start OFF and the chips are mutually exclusive', () => {
  assert.equal(hasActiveFilters(NO_FILTERS), false);
  assert.deepEqual(activeFilterIds(NO_FILTERS), []);
  let s = toggleFilter(NO_FILTERS, 'negotiable');
  assert.deepEqual(activeFilterIds(s), ['negotiable']);
  s = toggleFilter(s, 'verified');
  assert.deepEqual(activeFilterIds(s), ['verified'], 'choosing another chip replaces the previous one');
  s = toggleFilter(s, 'verified');
  assert.deepEqual(activeFilterIds(s), [], 'choosing the active chip again clears it');
  assert.equal(NO_FILTERS.negotiable, false, 'toggling must not mutate the shared default');
});

test('"Boosted today" and "Posted today" are distinct filters', () => {
  assert.ok(FILTER_IDS.includes('boostedToday'));
  assert.ok(FILTER_IDS.includes('postedToday'));
  const base: FilterFacts = { sellerVerifiedAt: null, boostedUntil: null, lastPriceDropAt: null, lastPriceDropFrom: null, price: 10, negotiable: false, createdAt: new Date(NOW.getTime() - 60_000).toISOString() };
  assert.equal(matchesFilters(base, { ...NO_FILTERS, postedToday: true }, NOW), true);
  assert.equal(matchesFilters(base, { ...NO_FILTERS, boostedToday: true }, NOW), false, 'a freshly posted listing is not boosted');
  const boosted = { ...base, createdAt: new Date(NOW.getTime() - 30 * DAY).toISOString(), boostedUntil: new Date(NOW.getTime() + DAY).toISOString() };
  assert.equal(matchesFilters(boosted, { ...NO_FILTERS, boostedToday: true }, NOW), true);
  assert.equal(matchesFilters(boosted, { ...NO_FILTERS, postedToday: true }, NOW), false, 'a boosted old listing was not posted today');
});

test('multiple active filters combine with AND', () => {
  const f: FilterFacts = { sellerVerifiedAt: 'x', boostedUntil: null, lastPriceDropAt: null, lastPriceDropFrom: null, price: 10, negotiable: true, createdAt: NOW.toISOString() };
  assert.equal(matchesFilters(f, { ...NO_FILTERS, verified: true, negotiable: true }, NOW), true);
  assert.equal(matchesFilters(f, { ...NO_FILTERS, verified: true, negotiable: true, boostedToday: true }, NOW), false);
  assert.equal(matchesFilters({ ...f, negotiable: false }, { ...NO_FILTERS, verified: true, negotiable: true }, NOW), false);
});

test('price reduced: 14-day window, still-below-old-price, boundary', () => {
  assert.equal(PRICE_REDUCED_DAYS, 14);
  const mk = (ageDays: number, from: number, price: number): FilterFacts => ({
    sellerVerifiedAt: null, boostedUntil: null, lastPriceDropAt: new Date(NOW.getTime() - ageDays * DAY).toISOString(), lastPriceDropFrom: from, price, negotiable: false, createdAt: NOW.toISOString(),
  });
  const on = { ...NO_FILTERS, priceReduced: true };
  assert.equal(matchesFilters(mk(0, 100, 80), on, NOW), true);
  assert.equal(matchesFilters(mk(13.9, 100, 80), on, NOW), true);
  assert.equal(matchesFilters(mk(14.1, 100, 80), on, NOW), false);
  assert.equal(matchesFilters(mk(1, 100, 100), on, NOW), false, 'price back at the old value is not a reduction');
  assert.equal(matchesFilters(mk(1, 100, 120), on, NOW), false, 'price raised above the old value is not a reduction');
  assert.equal(matchesFilters({ ...mk(1, 100, 80), lastPriceDropAt: null }, on, NOW), false);
});

test('marketplace day boundaries use Africa/Addis_Ababa (UTC+3)', () => {
  assert.equal(marketplaceDayStart(new Date('2026-03-01T20:59:59Z')).toISOString(), '2026-02-28T21:00:00.000Z');
  assert.equal(marketplaceDayStart(new Date('2026-03-01T21:00:00Z')).toISOString(), '2026-03-01T21:00:00.000Z');
  assert.equal(marketplaceDayStart(new Date('2026-03-01T23:59:00Z')).toISOString(), '2026-03-01T21:00:00.000Z');
});

// ---------------------------------------------------------------- request shaping
test('toRpcParams preserves query, category, location and every filter; trims and caps the query', () => {
  const p = toRpcParams({ query: '  iphone  ', category: 'electronics', scopeId: 'loc-1', filters: { ...NO_FILTERS, verified: true, priceReduced: true } });
  assert.equal(p.p_query, 'iphone');
  assert.equal(p.p_category, 'electronics');
  assert.equal(p.p_scope_id, 'loc-1');
  assert.deepEqual([p.p_verified, p.p_boosted_today, p.p_price_reduced, p.p_negotiable, p.p_posted_today], [true, false, true, false, false]);
  assert.equal(toRpcParams({ query: 'x'.repeat(500), filters: NO_FILTERS }).p_query?.length, SEARCH_QUERY_MAX);
  assert.equal(toRpcParams({ query: '   ', filters: NO_FILTERS }).p_query, null);
  const c = toRpcParams({ query: '', filters: NO_FILTERS }, { createdAt: 't', id: 'i' });
  assert.deepEqual([c.p_cursor_created_at, c.p_cursor_id], ['t', 'i']);
});

test('searchKey changes with any search dimension and ignores the page and whitespace', () => {
  const a = { query: 'tv', category: null, scopeId: null, filters: NO_FILTERS };
  assert.equal(searchKey(a), searchKey({ ...a, query: ' tv ' }));
  for (const b of [{ ...a, query: 'tvs' }, { ...a, category: 'x' }, { ...a, scopeId: 's' }, { ...a, filters: toggleFilter(NO_FILTERS, 'verified') }]) assert.notEqual(searchKey(a), searchKey(b));
});

const row = (id: string, at = '2026-01-01T00:00:00Z') => ({ listing: { id, created_at: at } });
test('splitPage uses the extra row only as a "has more" signal and returns the cursor of the last visible row', () => {
  const rows = [row('a', '3'), row('b', '2'), row('c', '1')];
  const p = splitPage(rows, 2);
  assert.deepEqual(p.items.map((r) => r.listing.id), ['a', 'b']);
  assert.equal(p.hasMore, true);
  assert.deepEqual(p.cursor, { createdAt: '2', id: 'b' });
  const last = splitPage(rows, 3);
  assert.equal(last.hasMore, false);
  assert.equal(last.cursor, null);
  assert.deepEqual(splitPage([], 24), { items: [], hasMore: false, cursor: null });
  assert.deepEqual(mergePage([row('a')], [row('a'), row('b')]).map((r) => r.listing.id), ['a', 'b']);
});

test('empty-state recovery offers only actions that apply, and recommendations drop the failing constraints', () => {
  assert.deepEqual(recoveryActions({ query: '', filters: NO_FILTERS }), []);
  assert.deepEqual(recoveryActions({ query: '', filters: toggleFilter(NO_FILTERS, 'verified') }), ['clearFilters'], 'no search text → nothing to save');
  assert.deepEqual(recoveryActions({ query: 'x', filters: NO_FILTERS }), ['clearSearch', 'saveSearch']);
  assert.deepEqual(recoveryActions({ query: 'x', category: 'c', scopeId: 's', filters: toggleFilter(NO_FILTERS, 'verified') }), ['clearFilters', 'clearSearch', 'clearCategory', 'clearLocation', 'saveSearch']);
  const recs = recommendationSearches({ query: 'zzz', category: 'cars', scopeId: 's1', filters: toggleFilter(NO_FILTERS, 'verified') });
  assert.deepEqual(recs.map((r) => [r.category, r.scopeId]), [['cars', 's1'], [null, 's1'], [null, null]]);
  for (const r of recs) {
    assert.equal(r.query, '');
    assert.equal(hasActiveFilters(r.filters), false);
  }
});

// ---------------------------------------------------------------- session state machine
type Item = { id: string; t?: string };
const page = (ids: string[], hasMore = false) => ({ items: ids.map((id) => ({ id })), hasMore, cursor: hasMore ? { createdAt: 'c', id: ids[ids.length - 1] } : null });
const run = (actions: Parameters<typeof sessionReducer<Item>>[1][], s: SearchSession<Item> = initialSession<Item>()) => actions.reduce((acc, a) => sessionReducer<Item>(acc, a), s);

test('a stale (older-ticket) response never overwrites a newer search', () => {
  const s = run([
    { type: 'begin', key: 'a', ticket: 1 },
    { type: 'begin', key: 'b', ticket: 2 },
    { type: 'success', ticket: 2, page: page(['b1', 'b2']) },
    { type: 'success', ticket: 1, page: page(['a1']) }, // slow response for the superseded search arrives last
  ]);
  assert.deepEqual(s.items.map((i) => i.id), ['b1', 'b2']);
  assert.equal(s.key, 'b');
  const f = run([{ type: 'begin', key: 'a', ticket: 1 }, { type: 'begin', key: 'b', ticket: 2 }, { type: 'failure', ticket: 1 }]);
  assert.equal(f.status, 'loading', 'a stale failure must not flip the screen to error');
});

test('changing a search keeps the old results visible while loading; failure is an error, never "empty"', () => {
  let s = run([{ type: 'begin', key: 'a', ticket: 1 }, { type: 'success', ticket: 1, page: page(['a1']) }]);
  s = run([{ type: 'begin', key: 'b', ticket: 2 }], s);
  assert.equal(s.status, 'loading');
  assert.deepEqual(s.items.map((i) => i.id), ['a1']);
  s = run([{ type: 'failure', ticket: 2 }], s);
  assert.equal(s.status, 'error');
});

test('load more appends without duplicates, ignores double triggers and keeps results when a page fails', () => {
  let s = run([{ type: 'begin', key: 'a', ticket: 1 }, { type: 'success', ticket: 1, page: page(['1', '2'], true) }]);
  s = run([{ type: 'beginMore', ticket: 1 }], s);
  assert.equal(s.loadingMore, true);
  const again = sessionReducer(s, { type: 'beginMore', ticket: 1 });
  assert.equal(again, s, 'a second load-more while one is in flight is a no-op');
  s = run([{ type: 'moreFailure', ticket: 1 }], s);
  assert.deepEqual(s.items.map((i) => i.id), ['1', '2']);
  assert.equal(s.moreFailed, true);
  s = run([{ type: 'beginMore', ticket: 1 }, { type: 'moreSuccess', ticket: 1, page: page(['2', '3'], false) }], s);
  assert.deepEqual(s.items.map((i) => i.id), ['1', '2', '3']);
  assert.equal(s.hasMore, false);
  // a page that lands after the user changed the search is dropped
  const stale = run([{ type: 'begin', key: 'z', ticket: 2 }, { type: 'moreSuccess', ticket: 1, page: page(['9']) }], s);
  assert.ok(!stale.items.some((i) => i.id === '9'));
  // cannot load more while a new search is loading
  assert.equal(sessionReducer(run([{ type: 'begin', key: 'q', ticket: 3 }], s), { type: 'beginMore', ticket: 3 }).loadingMore, false);
});

test('realtime remove/patch update the visible results and ignore unknown ids', () => {
  const s = run([{ type: 'begin', key: 'a', ticket: 1 }, { type: 'success', ticket: 1, page: page(['1', '2']) }]);
  assert.deepEqual(sessionReducer(s, { type: 'remove', id: '1' }).items.map((i) => i.id), ['2']);
  assert.equal(sessionReducer(s, { type: 'remove', id: 'nope' }), s);
  assert.equal(sessionReducer(s, { type: 'patch', id: '2', patch: { t: 'x' } }).items[1].t, 'x');
});

// ---------------------------------------------------------------- parity + contracts
test('mobile and web copies of the shared search logic are byte-identical', () => {
  for (const f of ['searchFilters.ts', 'searchSession.ts', 'refreshController.ts']) {
    assert.equal(read('lib', f), read('web', 'src', 'lib', f), `${f} differs between lib/ and web/src/lib/ — keep them in sync`);
  }
});

test('TS constants match the SQL source of truth (0038)', () => {
  const sql = read('supabase', 'migrations', '0038_search_discovery.sql');
  assert.match(sql, new RegExp(`select interval '${PRICE_REDUCED_DAYS} days'`));
  assert.match(sql, /Africa\/Addis_Ababa/);
  assert.match(sql, /status in \('available', 'reserved'\)/);
  for (const arg of ['p_verified', 'p_boosted_today', 'p_price_reduced', 'p_negotiable', 'p_posted_today', 'p_query', 'p_category', 'p_scope_id']) assert.ok(sql.includes(arg), arg);
  assert.deepEqual(Object.keys(toRpcParams({ query: '', filters: NO_FILTERS })).sort(), [
    'p_boosted_today', 'p_category', 'p_cursor_created_at', 'p_cursor_id', 'p_limit', 'p_negotiable', 'p_posted_today', 'p_price_reduced', 'p_query', 'p_scope_id', 'p_verified',
  ]);
});

test('both search screens are server-side: they page through the RPC and never load/filter the whole catalogue', () => {
  const mobile = read('app', '(tabs)', 'search.tsx');
  const web = read('web', 'src', 'app', 'search', 'page.tsx');
  for (const src of [mobile, web]) {
    assert.match(src, /fetchSearchPage/);
    assert.match(src, /sessionReducer/);
    assert.match(src, /SEARCH_DEBOUNCE_MS/);
    assert.match(src, /recommendationSearches/);
    assert.match(src, /recoveryActions/);
    // (the mobile screen may call useListingsStore.getState().mergeFetched(...) so results can be opened — it must never subscribe to or reload the whole catalogue)
    assert.doesNotMatch(src, /listListings\(|useListingsStore\(|resolveAllListings|\.load\(\)/);
    assert.doesNotMatch(src, /Verified only['"],\s*['"]Price reduced/, 'the old no-op string-array filters are gone');
  }
  assert.doesNotMatch(read('web', 'src', 'services', 'search.ts'), /listListings|select\('id'\)/);
});

test('no client writes price_drops; the database records every price decrease', () => {
  const walk = (dir: string, out: string[] = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.next', '.test-build', '.git'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const offenders = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'store')), ...walk(path.join(root, 'lib')), ...walk(path.join(root, 'web', 'src'))].filter((f) =>
    /from\(['"]price_drops['"]\)\s*\.insert/.test(fs.readFileSync(f, 'utf8'))
  );
  assert.deepEqual(offenders, []);
});

test('filter labels exist in all three locales and the verified flag comes from profiles.verified_at', () => {
  for (const l of ['en', 'so', 'am']) {
    const d = JSON.parse(read('locales', l, 'translation.json'));
    for (const k of ['verifiedOnly', 'boostedToday', 'priceReduced', 'negotiable', 'postedToday']) assert.ok(d.search.filters[k], `${l}: search.filters.${k}`);
    for (const k of ['errorTitle', 'errorMessage', 'retry', 'emptyFilteredTitle', 'emptyFilteredMessage', 'clearFilters', 'clearCategory', 'clearLocation', 'recommended', 'loadingMore']) assert.ok(d.search[k], `${l}: search.${k}`);
    assert.ok(d.components.listingCard.priceReduced && d.components.listingCard.boosted, `${l}: listing card badges`);
  }
  assert.match(read('lib', 'sellerStats.ts'), /verified: !!profile\.verified_at/);
  assert.match(read('web', 'src', 'services', 'profile.ts'), /verified: !!profile\.verified_at/);
});

test('mobile search results are merged into the global store so every result can be opened', () => {
  const screen = read('app', '(tabs)', 'search.tsx');
  assert.ok((screen.match(/mergeFetched/g) ?? []).length >= 3, 'first page, next pages and recommendations are all merged');
  assert.match(read('lib', 'listingsCore.ts'), /mergeFetched: \(incoming\)/);
});

test('both edit screens save price and every other field in ONE update (the database records the drop)', () => {
  const mobile = read('app', 'listing', 'edit', '[id].tsx');
  const web = read('web', 'src', 'app', 'listing', 'edit', '[id]', 'page.tsx');
  assert.match(mobile, /updateListing\(original\.id, \{ \.\.\.patch, price: priceNum \}\)/);
  assert.match(web, /updateListing\(original\.id, \{ \.\.\.patch, price: priceNum \}\)/);
  assert.doesNotMatch(mobile, /dropPrice\(/);
  assert.doesNotMatch(web, /dropListingPrice/);
});
