import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  BASE_QUERY,
  FeedQuery,
  FeedRpcRow,
  HOME_PAGE_SIZE,
  buildHomeQuery,
  categoryValues,
  fallbackPlan,
  feedKey,
  feedTabFor,
  priceMeta,
  resolvePriceCurrency,
  runFallback,
  splitFeedPage,
  toFeedRpcParams,
} from '../lib/homeFeedPaging';
import { FALLBACK_LIMIT } from '../lib/homeFeed';
import { createPagedFeed, FeedFetchContext } from '../lib/pagedFeed';
import { SessionPage } from '../lib/searchSession';
import { index } from './fixtures';

const root = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');

// ---------------------------------------------------------------- request shaping
test('Home tabs map onto the feed tabs; For You is the newest-first feed', () => {
  assert.equal(feedTabFor('For You'), 'latest');
  assert.equal(feedTabFor('Latest'), 'latest');
  assert.equal(feedTabFor('Nearby'), 'nearby');
  assert.equal(feedTabFor('Trending'), 'trending');
  assert.equal(feedTabFor('Price'), 'price');
  assert.equal(feedTabFor('Price Drops'), 'price_drops');
});

test('RPC params carry only what the tab uses, plus the cursor and page size', () => {
  const latest = toFeedRpcParams({ ...BASE_QUERY, anchorId: 'x', currency: 'USD' }, null);
  assert.equal(latest.p_anchor_id, null, 'anchor is Nearby-only');
  assert.equal(latest.p_currency, null, 'currency is Price-only');
  assert.equal(latest.p_now, null, 'the frozen clock is Trending-only');
  assert.equal(latest.p_limit, HOME_PAGE_SIZE);
  assert.equal(latest.p_cursor_id, null);
  const cursor = { rank: 3, createdAt: '2026-06-01T10:00:00.123456+00:00', id: 'abc' };
  const price = toFeedRpcParams({ ...BASE_QUERY, tab: 'price', currency: 'USD', priceOrder: 'desc', categories: ['phones', 'Phones'], scopeId: 's', city: 'Alpha', subcategory: 'Smartphones' }, cursor, 10);
  assert.deepEqual(price, {
    p_tab: 'price', p_categories: ['phones', 'Phones'], p_subcategory: 'Smartphones', p_scope_id: 's', p_city: 'Alpha', p_anchor_id: null,
    p_currency: 'USD', p_price_order: 'desc', p_limit: 10, p_now: null, p_cursor_rank: 3, p_cursor_created_at: '2026-06-01T10:00:00.123456+00:00', p_cursor_id: 'abc',
  });
  assert.equal(toFeedRpcParams({ ...BASE_QUERY, tab: 'nearby', anchorId: 'a' }, null).p_anchor_id, 'a');
  assert.equal(toFeedRpcParams({ ...BASE_QUERY, tab: 'trending' }, null, 24, Date.parse('2026-01-01T00:00:00Z')).p_now, '2026-01-01T00:00:00.000Z');
  assert.equal(toFeedRpcParams({ ...BASE_QUERY, categories: [] }, null).p_categories, null, 'an empty list means every category');
});

test('the RPC argument order is the order the SQL function declares', () => {
  const sql = read('supabase', 'migrations', '0042_home_feed.sql');
  const decl = /create or replace function public\.home_feed\(([\s\S]*?)\)\s*returns table/.exec(sql)![1];
  const declared = [...decl.matchAll(/^\s*(p_\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(Object.keys(toFeedRpcParams(BASE_QUERY, null)), declared);
});

test('the cursor keeps the server timestamp string untouched (no Date round-trip, no lost microseconds)', () => {
  const rows: FeedRpcRow[] = [1, 2, 3].map((n) => ({ listing: { id: `id${n}`, created_at: `2026-06-01T10:00:00.12345${n}+00:00` }, sort_rank: n * 1.5 }));
  const page = splitFeedPage(rows, 2);
  assert.equal(page.hasMore, true);
  assert.deepEqual(page.items.map((r) => r.listing.id), ['id1', 'id2']);
  assert.deepEqual(page.cursor, { rank: 3, createdAt: '2026-06-01T10:00:00.123452+00:00', id: 'id2' });
});

test('a page with exactly `limit` rows is the last page; fewer likewise; empty is empty', () => {
  const rows = (n: number): FeedRpcRow[] => Array.from({ length: n }, (_, i) => ({ listing: { id: `i${i}`, created_at: 't' }, sort_rank: 0 }));
  assert.deepEqual(splitFeedPage(rows(2), 2), { items: rows(2), hasMore: false, cursor: null });
  assert.equal(splitFeedPage(rows(1), 2).hasMore, false);
  assert.deepEqual(splitFeedPage([], 2), { items: [], hasMore: false, cursor: null });
});

// ---------------------------------------------------------------- query from the Home selections
const baseInput = { index, scopeId: null as string | null, category: null as { id: string; name: string } | null, tab: 'For You' as const, priceOrder: 'asc' as const, currency: null as string | null, homePlaceId: null as string | null, priceOptions: null };

test('categories match the stable id and the display name (legacy rows)', () => {
  assert.deepEqual(categoryValues({ id: 'phones', name: 'Phones' }), ['phones', 'Phones']);
  assert.deepEqual(categoryValues({ id: 'jobs', name: 'jobs' }), ['jobs']);
  assert.equal(categoryValues(null), null);
});

test('a saved place that is not in the approved directory is treated as All Locations (same as the strip)', () => {
  assert.equal(buildHomeQuery({ ...baseInput, scopeId: 'gone' }).query!.scopeId, null);
  assert.equal(buildHomeQuery({ ...baseInput, scopeId: 'tg' }).query!.scopeId, 'tg');
});

test('settings that do not matter to a tab never change its identity (no pointless refetch)', () => {
  const a = buildHomeQuery({ ...baseInput, tab: 'Latest', priceOrder: 'asc', currency: 'USD', homePlaceId: 'mk' }).query!;
  const b = buildHomeQuery({ ...baseInput, tab: 'Latest', priceOrder: 'desc', currency: 'ETB', homePlaceId: 'jj' }).query!;
  assert.equal(feedKey(a), feedKey(b));
  assert.equal(feedKey(buildHomeQuery({ ...baseInput, tab: 'For You' }).query!), feedKey(buildHomeQuery({ ...baseInput, tab: 'Latest' }).query!), 'For You and Latest are the same feed');
  assert.notEqual(feedKey(a), feedKey(buildHomeQuery({ ...baseInput, tab: 'Trending' }).query!));
  assert.notEqual(feedKey(a), feedKey(buildHomeQuery({ ...baseInput, tab: 'Latest', category: { id: 'phones', name: 'Phones' } }).query!));
  assert.notEqual(feedKey(a), feedKey(buildHomeQuery({ ...baseInput, tab: 'Latest', scopeId: 'tg' }).query!));
});

test('Nearby needs a place; the anchor is the browsed place unless the home place sits inside it', () => {
  const none = buildHomeQuery({ ...baseInput, tab: 'Nearby' });
  assert.equal(none.query, null);
  assert.equal(none.needsLocation, true);
  assert.equal(buildHomeQuery({ ...baseInput, tab: 'Nearby', homePlaceId: 'mk' }).query!.anchorId, 'mk');
  assert.equal(buildHomeQuery({ ...baseInput, tab: 'Nearby', scopeId: 'sr', homePlaceId: 'mk' }).query!.anchorId, 'sr', 'home place outside the browsed place → the browsed place');
  assert.equal(buildHomeQuery({ ...baseInput, tab: 'Nearby', scopeId: 'et', homePlaceId: 'mk' }).query!.anchorId, 'mk', 'home place inside the browsed place orders results inside it');
  assert.equal(buildHomeQuery({ ...baseInput, tab: 'Nearby', scopeId: 'sr' }).query!.anchorId, 'sr');
});

test('Price waits for the currency choices, then compares one currency (chosen if on offer, else the most common)', () => {
  assert.equal(buildHomeQuery({ ...baseInput, tab: 'Price' }).query, null, 'currencies not loaded yet: nothing to fetch');
  const options = [{ code: 'USD', count: 5 }, { code: 'ETB', count: 3 }];
  const def = buildHomeQuery({ ...baseInput, tab: 'Price', priceOptions: options });
  assert.equal(def.query!.currency, 'USD');
  assert.deepEqual(def.price, { currency: 'USD', options, hiddenOther: 3 });
  const chosen = buildHomeQuery({ ...baseInput, tab: 'Price', priceOptions: options, currency: 'etb', priceOrder: 'desc' });
  assert.equal(chosen.query!.currency, 'ETB');
  assert.equal(chosen.query!.priceOrder, 'desc');
  assert.equal(chosen.price!.hiddenOther, 5);
  assert.equal(resolvePriceCurrency(options, 'KES'), 'USD', 'a currency that is not on offer falls back to the most common');
  assert.equal(resolvePriceCurrency([], null), 'ETB');
  assert.deepEqual(priceMeta([], 'usd'), { currency: 'USD', options: [], hiddenOther: 0 });
});

// ---------------------------------------------------------------- empty-state alternatives
test('fallback order: wider places (nearest first) that keep the category, then other categories, then the marketplace', () => {
  const cat = { id: 'phones', name: 'Phones' };
  const plan = fallbackPlan(index, 'mk', cat);
  assert.deepEqual(plan.map((s) => [s.kind, s.place?.id ?? null, s.query.scopeId, s.query.categories]), [
    ['wider-area', 'tg', 'tg', ['phones', 'Phones']],
    ['wider-area', 'et', 'et', ['phones', 'Phones']],
    ['other-categories', 'mk', 'mk', null],
    ['marketplace', null, null, null],
  ]);
  assert.deepEqual(fallbackPlan(index, null, null).map((s) => s.kind), ['marketplace']);
  assert.deepEqual(fallbackPlan(index, null, cat).map((s) => s.kind), ['other-categories', 'marketplace']);
  assert.ok(plan.every((s) => s.query.tab === 'latest'));
});

test('the first fallback step that has listings wins, capped at the fallback limit; a stale run reports nothing', async () => {
  const steps = fallbackPlan(index, 'mk', { id: 'phones', name: 'Phones' });
  const calls: string[] = [];
  const found = await runFallback(steps, async (query, limit) => {
    calls.push(`${query.scopeId}:${limit}`);
    return query.scopeId === 'et' ? [{ id: 'x' }] : [];
  });
  assert.deepEqual(calls, [`tg:${FALLBACK_LIMIT}`, `et:${FALLBACK_LIMIT}`]);
  assert.equal(found!.kind, 'wider-area');
  assert.equal(found!.place!.id, 'et');
  assert.equal(await runFallback(steps, async () => [], () => true), null, 'nothing anywhere');
  let live = true;
  assert.equal(await runFallback(steps, async () => { live = false; return [{ id: 'x' }]; }, () => live), null, 'the selection changed while looking');
});

// ---------------------------------------------------------------- the paged feed controller
type Row = { id: string };
type Q = { name: string; rows?: number };
const rowsOf = (prefix: string, from: number, to: number): Row[] => Array.from({ length: to - from }, (_, i) => ({ id: `${prefix}${from + i}` }));

function deferred<V>() {
  let resolve!: (v: V) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<V>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((r) => setImmediate(r));

/** A feed whose every request is a promise the test settles by hand, in any order. */
function harness(now: () => number = () => 1000, timeoutMs?: number) {
  type Call = { q: Q; cursorId: string | null; ctx: FeedFetchContext; d: ReturnType<typeof deferred<SessionPage<Row>>> };
  const calls: Call[] = [];
  const feed = createPagedFeed<Row, Q>({
    keyOf: (q) => q.name,
    now,
    timeoutMs,
    fetchPage: (q, cursor, ctx) => {
      const d = deferred<SessionPage<Row>>();
      calls.push({ q, cursorId: cursor?.id ?? null, ctx, d });
      return d.promise;
    },
  });
  const page = (items: Row[], hasMore: boolean): SessionPage<Row> => ({ items, hasMore, cursor: hasMore ? { createdAt: 't', id: items[items.length - 1].id } : null });
  return { feed, calls, page };
}
const ids = (f: { getState: () => { items: Row[] } }) => f.getState().items.map((r) => r.id);

test('first page, load more, end of feed', async () => {
  const { feed, calls, page } = harness();
  feed.setQuery({ name: 'a' });
  assert.equal(feed.getState().status, 'loading');
  calls[0].d.resolve(page(rowsOf('a', 0, 3), true));
  await tick();
  assert.equal(feed.getState().status, 'ready');
  assert.deepEqual(ids(feed), ['a0', 'a1', 'a2']);
  assert.equal(feed.getState().hasMore, true);

  const more = feed.loadMore();
  assert.equal(calls[1].cursorId, 'a2', 'continues after the last shown row');
  assert.equal(feed.getState().loadingMore, true);
  calls[1].d.resolve(page(rowsOf('a', 3, 5), false));
  assert.equal(await more, true);
  assert.deepEqual(ids(feed), ['a0', 'a1', 'a2', 'a3', 'a4']);
  assert.equal(feed.getState().hasMore, false);

  assert.equal(await feed.loadMore(), false, 'nothing past the end');
  assert.equal(calls.length, 2, 'no request was made past the end');
});

test('load more cannot run twice at once, and not before the first page, nor after a failure of the first page', async () => {
  const { feed, calls, page } = harness();
  assert.equal(await feed.loadMore(), false, 'no filters yet');
  feed.setQuery({ name: 'a' });
  assert.equal(await feed.loadMore(), false, 'first page still loading');
  calls[0].d.resolve(page(rowsOf('a', 0, 2), true));
  await tick();
  const first = feed.loadMore();
  const second = feed.loadMore();
  const third = feed.loadMore();
  assert.equal(calls.length, 2, 'rapid onEndReached events produce one request');
  assert.equal(await second, false);
  assert.equal(await third, false);
  calls[1].d.resolve(page(rowsOf('a', 2, 4), false));
  assert.equal(await first, true);
});

test('duplicate listings across pages are shown once (a listing that moved between pages, a retried page)', async () => {
  const { feed, calls, page } = harness();
  feed.setQuery({ name: 'a' });
  calls[0].d.resolve(page([{ id: 'x' }, { id: 'y' }, { id: 'y' }], true));
  await tick();
  assert.deepEqual(ids(feed), ['x', 'y'], 'duplicates inside a page');
  const more = feed.loadMore();
  calls[1].d.resolve(page([{ id: 'y' }, { id: 'z' }, { id: 'x' }], false));
  await more;
  assert.deepEqual(ids(feed), ['x', 'y', 'z'], 'rows already shown are skipped, order of first appearance kept');
});

test('changing the filters clears the old rows at once and the old response can never appear', async () => {
  const { feed, calls, page } = harness();
  feed.setQuery({ name: 'cars' });
  calls[0].d.resolve(page(rowsOf('car', 0, 3), true));
  await tick();
  assert.deepEqual(ids(feed), ['car0', 'car1', 'car2']);

  feed.setQuery({ name: 'phones' });
  assert.deepEqual(ids(feed), [], 'cars are not shown under a phones filter, not even for a moment');
  assert.equal(feed.getState().status, 'loading');
  assert.equal(feed.getState().hasMore, false);

  feed.setQuery({ name: 'homes' }); // changed again before the phones response arrived
  calls[1].d.resolve(page(rowsOf('phone', 0, 2), false)); // slow, superseded response
  await tick();
  assert.deepEqual(ids(feed), [], 'the superseded phones response is dropped');
  assert.equal(feed.getState().status, 'loading');
  calls[2].d.resolve(page(rowsOf('home', 0, 2), false));
  await tick();
  assert.deepEqual(ids(feed), ['home0', 'home1']);
  assert.equal(feed.getState().key, 'homes');
});

test('responses arriving out of order: the newest filters win whatever order the network answers in', async () => {
  const { feed, calls, page } = harness();
  feed.setQuery({ name: 'one' });
  feed.setQuery({ name: 'two' });
  calls[1].d.resolve(page(rowsOf('two', 0, 1), false)); // newest answers first
  await tick();
  calls[0].d.resolve(page(rowsOf('one', 0, 1), false)); // oldest answers last
  await tick();
  assert.deepEqual(ids(feed), ['two0']);
});

test('filters changing while a "load more" is in flight: the late page is not appended to the new feed', async () => {
  const { feed, calls, page } = harness();
  feed.setQuery({ name: 'a' });
  calls[0].d.resolve(page(rowsOf('a', 0, 2), true));
  await tick();
  const more = feed.loadMore();
  feed.setQuery({ name: 'b' });
  calls[1].d.resolve(page(rowsOf('a', 2, 4), false)); // belongs to the old filters
  await more;
  assert.deepEqual(ids(feed), []);
  calls[2].d.resolve(page(rowsOf('b', 0, 1), false));
  await tick();
  assert.deepEqual(ids(feed), ['b0']);
  assert.equal(feed.getState().loadingMore, false);
});

test('setting the same filters again does nothing (no refetch, rows stay)', async () => {
  const { feed, calls, page } = harness();
  feed.setQuery({ name: 'a' });
  calls[0].d.resolve(page(rowsOf('a', 0, 2), true));
  await tick();
  const before = feed.getState();
  feed.setQuery({ name: 'a', rows: 99 }); // a new object with the same identity
  assert.equal(calls.length, 1);
  assert.equal(feed.getState(), before);
  assert.deepEqual(feed.getQuery(), { name: 'a', rows: 99 }, 'the latest equivalent filters are kept for later requests');
});

test('refresh keeps the rows until the new first page lands, then replaces them (a reset to the top)', async () => {
  const { feed, calls, page } = harness();
  feed.setQuery({ name: 'a' });
  calls[0].d.resolve(page(rowsOf('a', 0, 3), true));
  await tick();
  const more = feed.loadMore();
  calls[1].d.resolve(page(rowsOf('a', 3, 6), true));
  await more;
  assert.equal(feed.getState().items.length, 6);

  const refreshing = feed.refresh();
  assert.deepEqual(ids(feed).length, 6, 'rows stay while refreshing');
  assert.equal(feed.getState().status, 'loading');
  assert.equal(calls[2].cursorId, null, 'refresh asks for page 1 again');
  calls[2].d.resolve(page([{ id: 'new' }, ...rowsOf('a', 0, 2)], true));
  assert.equal(await refreshing, true);
  assert.deepEqual(ids(feed), ['new', 'a0', 'a1'], 'replaced by page 1 only — the pagination restarts');
  assert.equal(feed.getState().cursor!.id, 'a1');
});

test('a failed refresh keeps the old rows and reports failure; it never turns into an empty list', async () => {
  const { feed, calls, page } = harness();
  feed.setQuery({ name: 'a' });
  calls[0].d.resolve(page(rowsOf('a', 0, 2), false));
  await tick();
  const refreshing = feed.refresh();
  calls[1].d.reject(new Error('offline'));
  assert.equal(await refreshing, false);
  assert.equal(feed.getState().status, 'error');
  assert.deepEqual(ids(feed), ['a0', 'a1']);
  const retry = feed.refresh();
  calls[2].d.resolve(page(rowsOf('a', 0, 2), false));
  assert.equal(await retry, true);
  assert.equal(feed.getState().status, 'ready');
});

test('refresh while "load more" is running: the late page is dropped and the refreshed feed is intact', async () => {
  const { feed, calls, page } = harness();
  feed.setQuery({ name: 'a' });
  calls[0].d.resolve(page(rowsOf('a', 0, 2), true));
  await tick();
  const more = feed.loadMore();
  const refreshing = feed.refresh();
  calls[1].d.resolve(page(rowsOf('a', 2, 4), true)); // stale
  await more;
  assert.deepEqual(ids(feed), ['a0', 'a1']);
  calls[2].d.resolve(page(rowsOf('a', 0, 2), true));
  await refreshing;
  assert.deepEqual(ids(feed), ['a0', 'a1']);
  assert.equal(feed.getState().loadingMore, false);
  assert.equal(feed.getState().moreFailed, false);
});

test('repeated refresh triggers share one request, plus one follow-up if something changed meanwhile', async () => {
  const { feed, calls, page } = harness();
  feed.setQuery({ name: 'a' });
  calls[0].d.resolve(page(rowsOf('a', 0, 1), false));
  await tick();
  const r1 = feed.refresh();
  const r2 = feed.refresh();
  const r3 = feed.refresh();
  assert.equal(r1, r2);
  assert.equal(calls.length, 2, 'three triggers, one request in flight');
  calls[1].d.resolve(page(rowsOf('a', 0, 1), false));
  await tick();
  assert.equal(calls.length, 3, 'one follow-up for the changes that arrived while it ran');
  calls[2].d.resolve(page([{ id: 'fresh' }], false));
  await Promise.all([r1, r3]);
  assert.deepEqual(ids(feed), ['fresh']);
  assert.equal(calls.length, 3);
});

test('first page failure is an error state with no rows; retry works', async () => {
  const { feed, calls, page } = harness();
  feed.setQuery({ name: 'a' });
  calls[0].d.reject(new Error('500'));
  await tick();
  assert.equal(feed.getState().status, 'error');
  assert.deepEqual(ids(feed), []);
  assert.equal(await feed.loadMore(), false, 'no "load more" from an error state');
  const retry = feed.refresh();
  calls[1].d.resolve(page(rowsOf('a', 0, 1), false));
  assert.equal(await retry, true);
  assert.equal(feed.getState().status, 'ready');
});

test('a failed "load more" keeps what is shown, flags it, and retries from the same place', async () => {
  const { feed, calls, page } = harness();
  feed.setQuery({ name: 'a' });
  calls[0].d.resolve(page(rowsOf('a', 0, 2), true));
  await tick();
  const more = feed.loadMore();
  calls[1].d.reject(new Error('timeout'));
  assert.equal(await more, false);
  assert.equal(feed.getState().moreFailed, true);
  assert.equal(feed.getState().loadingMore, false);
  assert.equal(feed.getState().status, 'ready');
  assert.deepEqual(ids(feed), ['a0', 'a1']);
  const again = feed.loadMore();
  assert.equal(calls[2].cursorId, 'a1');
  assert.equal(feed.getState().moreFailed, false, 'the failure notice clears while retrying');
  calls[2].d.resolve(page(rowsOf('a', 2, 3), false));
  assert.equal(await again, true);
  assert.deepEqual(ids(feed), ['a0', 'a1', 'a2']);
});

test('empty result is a ready, empty feed (not an error)', async () => {
  const { feed, calls, page } = harness();
  feed.setQuery({ name: 'a' });
  calls[0].d.resolve(page([], false));
  await tick();
  assert.equal(feed.getState().status, 'ready');
  assert.deepEqual(ids(feed), []);
  assert.equal(feed.getState().hasMore, false);
});

test('going idle (e.g. Nearby with no place) drops anything in flight and clears the rows', async () => {
  const { feed, calls, page } = harness();
  feed.setQuery({ name: 'a' });
  calls[0].d.resolve(page(rowsOf('a', 0, 2), true));
  await tick();
  const more = feed.loadMore();
  feed.setQuery(null);
  assert.equal(feed.getState().status, 'idle');
  assert.deepEqual(ids(feed), []);
  calls[1].d.resolve(page(rowsOf('a', 2, 4), false));
  await more;
  assert.deepEqual(ids(feed), []);
  assert.equal(await feed.refresh(), false, 'nothing to refresh while idle');
  feed.setQuery({ name: 'a' });
  assert.equal(calls.length, 3, 'coming back fetches again');
});

test('a disposed feed ignores late responses and new requests', async () => {
  const { feed, calls, page } = harness();
  feed.setQuery({ name: 'a' });
  const seen: number[] = [];
  feed.subscribe(() => seen.push(1));
  feed.dispose();
  calls[0].d.resolve(page(rowsOf('a', 0, 2), false));
  await tick();
  assert.deepEqual(ids(feed), []);
  feed.setQuery({ name: 'b' });
  assert.equal(calls.length, 1);
  assert.equal(seen.length, 0);
  assert.equal(await feed.refresh(), false);
});

test('the Trending clock is fixed for all pages of one feed and renewed by a refresh; stale requests can tell', async () => {
  let clock = 1000;
  const { feed, calls, page } = harness(() => clock);
  feed.setQuery({ name: 'a' });
  assert.equal(calls[0].ctx.asOf, 1000);
  calls[0].d.resolve(page(rowsOf('a', 0, 2), true));
  await tick();
  clock = 5000;
  const more = feed.loadMore();
  assert.equal(calls[1].ctx.asOf, 1000, 'later pages reuse the first page\'s instant, so the order cannot reshuffle mid-scroll');
  calls[1].d.resolve(page(rowsOf('a', 2, 3), false));
  await more;
  const refreshing = feed.refresh();
  assert.equal(calls[2].ctx.asOf, 5000);
  assert.equal(calls[2].ctx.isCurrent(), true);
  feed.setQuery({ name: 'b' });
  assert.equal(calls[2].ctx.isCurrent(), false, 'a superseded request can skip its side effects');
  calls[2].d.resolve(page(rowsOf('a', 0, 1), false));
  await refreshing;
});

test('a hung request times out as a failure, Retry starts a new request, and the late answer is ignored', async () => {
  const { feed, calls, page } = harness(() => 1000, 15);
  feed.setQuery({ name: 'a' });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(feed.getState().status, 'error', 'a hung first page becomes an error, not an endless spinner');
  assert.equal(calls[0].ctx.isCurrent(), false);
  const retry = feed.refresh();
  assert.equal(calls.length, 2, 'Retry is not blocked by the hung request');
  calls[0].d.resolve(page(rowsOf('late', 0, 2), false)); // the hung request finally answers
  await tick();
  assert.deepEqual(ids(feed), [], 'the abandoned answer is ignored');
  calls[1].d.resolve(page(rowsOf('a', 0, 1), false));
  assert.equal(await retry, true);
  assert.deepEqual(ids(feed), ['a0']);
});

test('a hung "load more" times out, keeps the rows and can be retried', async () => {
  const { feed, calls, page } = harness(() => 1000, 15);
  feed.setQuery({ name: 'a' });
  calls[0].d.resolve(page(rowsOf('a', 0, 2), true));
  await tick();
  const more = feed.loadMore();
  assert.equal(await more, false);
  assert.equal(feed.getState().moreFailed, true);
  assert.deepEqual(ids(feed), ['a0', 'a1']);
  calls[1].d.resolve(page(rowsOf('late', 0, 1), false));
  await tick();
  assert.deepEqual(ids(feed), ['a0', 'a1']);
});

test('remove() takes a listing out of the shown rows (hidden by moderation) without a request', async () => {
  const { feed, calls, page } = harness();
  feed.setQuery({ name: 'a' });
  calls[0].d.resolve(page(rowsOf('a', 0, 3), false));
  await tick();
  feed.remove('a1');
  feed.remove('nope');
  assert.deepEqual(ids(feed), ['a0', 'a2']);
  assert.equal(calls.length, 1);
});

test('subscribers are told about changes, and not about no-ops', async () => {
  const { feed, calls, page } = harness();
  let n = 0;
  const off = feed.subscribe(() => n++);
  feed.setQuery({ name: 'a' });
  const afterBegin = n;
  assert.ok(afterBegin >= 1);
  feed.setQuery({ name: 'a' });
  assert.equal(n, afterBegin);
  calls[0].d.resolve(page(rowsOf('a', 0, 1), false));
  await tick();
  assert.ok(n > afterBegin);
  off();
  const stable = n;
  feed.remove('a0');
  assert.equal(n, stable);
});

// ---------------------------------------------------------------- the two apps share the same code, and nothing loads everything
test('web copies of the shared feed modules are byte-identical', () => {
  for (const f of ['homeFeed.ts', 'homeFeedPaging.ts', 'pagedFeed.ts', 'searchFilters.ts', 'searchSession.ts', 'refreshController.ts', 'locationTree.ts']) {
    assert.equal(read('web', 'src', 'lib', f), read('lib', f), `web/src/lib/${f} has drifted from lib/${f}`);
  }
});

test('Home, category and city screens no longer read the load-everything listings feed', () => {
  const screens = [
    ['app', '(tabs)', 'home.tsx'],
    ['app', 'category', '[id].tsx'],
    ['app', 'city', '[name].tsx'],
  ];
  for (const s of screens) {
    const src = read(...s);
    assert.doesNotMatch(src, /resolveAllListings|useListingsStore\(\(s\) => s\.listings\)|priceDropAt/, `${s.join('/')} still filters an in-memory copy of every listing`);
    assert.match(src, /loadMore|onEndReached/, `${s.join('/')} must load more pages`);
  }
  for (const f of [['web', 'src', 'app', 'page.tsx'], ['web', 'src', 'app', 'category', '[id]', 'page.tsx']]) {
    const src = read(...f);
    assert.doesNotMatch(src, /useHomeData|listListingsByCategory|fetchHomeFeed|buildHomeFeed/, `${f.join('/')} still uses the load-everything feed`);
    assert.match(src, /loadMore/, `${f.join('/')} must load more pages`);
  }
});

test('the load-everything web helpers are gone, and the mobile store no longer downloads every price drop', () => {
  const web = read('web', 'src', 'services', 'listings.ts');
  assert.doesNotMatch(web, /export async function (fetchHomeFeed|listListingsByCategory|listRecentPriceDropIds)/);
  const mobile = read('store', 'listings.ts');
  assert.doesNotMatch(mobile, /from\('price_drops'\)/);
});

test('every feed request goes through the home_feed RPC with a page size, never an unbounded table select', () => {
  for (const f of [['lib', 'homeFeedApi.ts'], ['web', 'src', 'services', 'homeFeed.ts']]) {
    const src = read(...f);
    assert.match(src, /rpc\('home_feed'/);
    assert.match(src, /toFeedRpcParams/);
    assert.doesNotMatch(src, /from\('listings'\)\s*\.select\('\*'\)/);
  }
});

test('the feed query type stays serialisable and complete (guards the key against forgotten fields)', () => {
  const q: FeedQuery = { ...BASE_QUERY };
  assert.deepEqual(Object.keys(q).sort(), ['anchorId', 'categories', 'city', 'currency', 'priceOrder', 'scopeId', 'subcategory', 'tab']);
  const key = JSON.parse(feedKey(q));
  assert.equal(key.length, Object.keys(q).length, 'feedKey must include every FeedQuery field');
});
