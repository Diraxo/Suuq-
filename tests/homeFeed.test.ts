import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { categories } from '../data/categories';
import { categories as webCategories } from '../web/src/lib/categories';
import { buildHomeFeed, categoryMatches, scopeScrollTarget, scopeSelector, trendingScore, nearbyRank, DISCOVERY_TABS } from '../lib/homeFeed';
import { baseInput, index, listing, NOW } from './fixtures';

const DAY = 86_400_000;
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const feed = (over: Partial<typeof baseInput> & { listings: ReturnType<typeof listing>[] }) => buildHomeFeed({ ...baseInput, ...over });

// 1 ── Every category with results ───────────────────────────────────────────
test('every category (mobile and web lists agree) returns exactly its own listings', () => {
  assert.deepEqual(
    categories.map((c) => c.id),
    webCategories.map((c) => c.id)
  );
  const all = categories.map((c) => listing({ category: c.id, city: 'Mekelle' }));
  for (const c of categories) {
    const r = feed({ listings: all, category: { id: c.id, name: c.name } });
    assert.equal(r.items.length, 1, c.id);
    assert.equal(r.items[0].category, c.id);
    assert.equal(r.fallback, null);
  }
});

test('category filter uses the stable id and tolerates legacy rows that stored the display name', () => {
  assert.ok(categoryMatches('phones', { id: 'phones', name: 'Phones' }));
  assert.ok(categoryMatches(' Phones ', { id: 'phones', name: 'Phones' }));
  assert.ok(!categoryMatches('electronics', { id: 'phones', name: 'Phones' }));
  assert.ok(!categoryMatches('', { id: 'phones', name: 'Phones' }));
});

// 2–4 ── Empty categories / empty locations / fallbacks ────────────────────────
test('empty category: strict list is empty and alternatives are separate (other categories)', () => {
  const l = [listing({ category: 'phones' })];
  const r = feed({ listings: l, category: { id: 'property', name: 'Property' } });
  assert.equal(r.items.length, 0);
  assert.equal(r.fallback?.kind, 'other-categories');
  assert.equal(r.fallback?.place, null);
  assert.deepEqual(ids(r.fallback!.items), ids(l));
});

test('empty city: falls back to the same category in the region, never mixed into items', () => {
  const inRegion = listing({ city: 'Adigrat', category: 'phones' });
  const elsewhere = listing({ city: 'Jigjiga', category: 'phones' });
  const r = feed({ listings: [inRegion, elsewhere], scopeId: 'mk', category: { id: 'phones', name: 'Phones' } });
  assert.equal(r.items.length, 0);
  assert.equal(r.fallback?.kind, 'wider-area');
  assert.equal(r.fallback?.place?.id, 'tg');
  assert.deepEqual(ids(r.fallback!.items), [inRegion.id]);
});

test('empty region: widens to the country, then other categories in the place, then the marketplace', () => {
  const inCountry = listing({ city: 'Jigjiga', category: 'phones' });
  let r = feed({ listings: [inCountry], scopeId: 'tg', category: { id: 'phones', name: 'Phones' } });
  assert.equal(r.fallback?.kind, 'wider-area');
  assert.equal(r.fallback?.place?.id, 'et');

  const otherCat = listing({ city: 'Mekelle', category: 'fashion' });
  r = feed({ listings: [otherCat], scopeId: 'tg', category: { id: 'phones', name: 'Phones' } });
  assert.equal(r.fallback?.kind, 'other-categories');
  assert.equal(r.fallback?.place?.id, 'tg');

  const faraway = listing({ city: 'Baidoa' });
  r = feed({ listings: [faraway], scopeId: 'mk' });
  assert.equal(r.items.length, 0);
  assert.equal(r.fallback?.kind, 'marketplace'); // Baidoa is not in Tigray/Ethiopia, so no "nearby areas" claim
});

test('empty place with nothing in its country → "More from Suuqiye" marketplace section', () => {
  const faraway = listing({ city: 'Baidoa' });
  const r = feed({ listings: [faraway], scopeId: 'ke' });
  assert.equal(r.items.length, 0);
  assert.equal(r.fallback?.kind, 'marketplace');
  assert.deepEqual(ids(r.fallback!.items), [faraway.id]);
});

test('no listings at all → empty strict list and no invented fallback', () => {
  const r = feed({ listings: [], scopeId: 'mk', category: { id: 'phones', name: 'Phones' } });
  assert.equal(r.items.length, 0);
  assert.equal(r.fallback, null);
});

test('strict items never contain listings from outside the selected place', () => {
  const a = listing({ city: 'Mekelle' });
  const b = listing({ city: 'Jigjiga' });
  const c = listing({ city: 'Baidoa' });
  assert.deepEqual(ids(feed({ listings: [a, b, c], scopeId: 'tg' }).items), [a.id]);
  assert.deepEqual(ids(feed({ listings: [a, b, c], scopeId: 'et' }).items).sort(), [a.id, b.id].sort());
  assert.deepEqual(ids(feed({ listings: [a, b, c], scopeId: null }).items).sort(), [a.id, b.id, c.id].sort());
});

test('changing the category recomputes from scratch (no previous category leaks through)', () => {
  const p = listing({ category: 'phones' });
  const v = listing({ category: 'vehicles' });
  const first = feed({ listings: [p, v], category: { id: 'phones', name: 'Phones' } });
  const second = feed({ listings: [p, v], category: { id: 'vehicles', name: 'Vehicles' } });
  assert.deepEqual(ids(first.items), [p.id]);
  assert.deepEqual(ids(second.items), [v.id]);
});

// 5 ── Latest ────────────────────────────────────────────────────────────────
test('Latest sorts by creation time, newest first, with a stable id tiebreak', () => {
  const old = listing({ createdAt: 1000 });
  const fresh = listing({ createdAt: 9000 });
  const tieB = listing({ createdAt: 5000, id: 'b' });
  const tieA = listing({ createdAt: 5000, id: 'a' });
  const r = feed({ listings: [old, tieB, fresh, tieA], tab: 'Latest' });
  assert.deepEqual(ids(r.items), [fresh.id, 'a', 'b', old.id]);
  // same input, different input order → same output (stable for pagination)
  assert.deepEqual(ids(feed({ listings: [tieA, fresh, old, tieB], tab: 'Latest' }).items), ids(r.items));
});

// 6 ── Trending ──────────────────────────────────────────────────────────────
test('Trending ranks real engagement (saves count more than views) decayed by listing age', () => {
  const quiet = listing({ views: 1, favoritesCount: 0, createdAt: NOW - DAY });
  const saved = listing({ views: 10, favoritesCount: 10, createdAt: NOW - DAY }); // 60
  const viewed = listing({ views: 40, favoritesCount: 0, createdAt: NOW - DAY }); // 40
  const r = feed({ listings: [quiet, viewed, saved], tab: 'Trending' });
  assert.deepEqual(ids(r.items), [saved.id, viewed.id, quiet.id]);
});

test('Trending: an old listing with the same engagement ranks below a fresh one; ties are deterministic', () => {
  const old = listing({ views: 50, createdAt: NOW - 60 * DAY });
  const fresh = listing({ views: 50, createdAt: NOW - DAY });
  assert.ok(trendingScore(fresh, NOW) > trendingScore(old, NOW));
  const zeroA = listing({ id: 'za', createdAt: 100 });
  const zeroB = listing({ id: 'zb', createdAt: 100 });
  const r = feed({ listings: [zeroB, old, fresh, zeroA], tab: 'Trending' });
  assert.deepEqual(ids(r.items).slice(0, 2), [fresh.id, old.id]);
  assert.deepEqual(ids(r.items).slice(2), ['za', 'zb']);
});

test('Trending score ignores negative/garbage counters and never invents engagement', () => {
  assert.equal(trendingScore(listing({ views: -5, favoritesCount: -2 }), NOW), 0);
});

// 7 ── Price ─────────────────────────────────────────────────────────────────
test('Price sorts numerically (not as strings), both directions', () => {
  const l = [listing({ price: 9 }), listing({ price: 100 }), listing({ price: 25 })];
  assert.deepEqual(feed({ listings: l, tab: 'Price', priceOrder: 'asc' }).items.map((x) => x.price), [9, 25, 100]);
  assert.deepEqual(feed({ listings: l, tab: 'Price', priceOrder: 'desc' }).items.map((x) => x.price), [100, 25, 9]);
});

test('Price: missing/invalid prices go last in both directions', () => {
  const l = [listing({ price: 0 }), listing({ price: 50 }), listing({ price: NaN }), listing({ price: 5 })];
  for (const priceOrder of ['asc', 'desc'] as const) {
    const r = feed({ listings: l, tab: 'Price', priceOrder });
    assert.deepEqual(r.items.slice(0, 2).map((x) => x.price), priceOrder === 'asc' ? [5, 50] : [50, 5]);
    assert.ok(r.items.slice(2).every((x) => !(x.price > 0)));
  }
});

test('Price never compares currencies: only the chosen currency is ranked, others are counted not mixed', () => {
  const etb = [listing({ price: 5000, currency: 'ETB' }), listing({ price: 8000, currency: 'ETB' }), listing({ price: 100, currency: 'ETB' })];
  const usd = [listing({ price: 20, currency: 'USD' })];
  const sos = [listing({ price: 1, currency: 'SOS' })];
  const r = feed({ listings: [...etb, ...usd, ...sos], tab: 'Price' });
  assert.equal(r.price?.currency, 'ETB'); // most common
  assert.ok(r.items.every((x) => x.currency === 'ETB'));
  assert.equal(r.price?.hiddenOther, 2);
  assert.deepEqual(r.price?.options.map((o) => o.code), ['ETB', 'SOS', 'USD']);
  const usdView = feed({ listings: [...etb, ...usd, ...sos], tab: 'Price', currency: 'usd' });
  assert.deepEqual(usdView.items.map((x) => x.currency), ['USD']);
  // an unknown currency choice falls back to a currency that exists
  assert.equal(feed({ listings: [...etb, ...usd], tab: 'Price', currency: 'EUR' }).price?.currency, 'ETB');
});

test('Price drops tab only shows listings with a recorded drop, most recent drop first', () => {
  const a = listing();
  const b = listing();
  const c = listing();
  const r = feed({ listings: [a, b, c], tab: 'Price Drops', priceDropAt: { [a.id]: 10, [c.id]: 99 } });
  assert.deepEqual(ids(r.items), [c.id, a.id]);
});

// 8 ── Nearby ────────────────────────────────────────────────────────────────
test('nearbyRank: same city, same region, same country, elsewhere', () => {
  assert.equal(nearbyRank(index, 'Mekelle', 'mk'), 0);
  assert.equal(nearbyRank(index, 'Adigrat', 'mk'), 1);
  assert.equal(nearbyRank(index, 'Jigjiga', 'mk'), 2);
  assert.equal(nearbyRank(index, 'Baidoa', 'mk'), 3);
  assert.equal(nearbyRank(index, 'Nowhereville', 'mk'), 3);
});

test('Nearby orders by place proximity to the user’s home place and stays inside their country', () => {
  const far = listing({ city: 'Baidoa', createdAt: 9000 });
  const country = listing({ city: 'Jigjiga', createdAt: 8000 });
  const region = listing({ city: 'Adigrat', createdAt: 1000 });
  const here = listing({ city: 'Mekelle', createdAt: 500 });
  const r = feed({ listings: [far, country, region, here], tab: 'Nearby', homePlaceId: 'mk' });
  assert.deepEqual(ids(r.items), [here.id, region.id, country.id]);
  assert.equal(r.nearbyAnchor?.id, 'mk');
  assert.equal(r.needsLocation, false);
});

test('Nearby without any known place does not pretend: asks for a location and returns nothing (no GPS needed/used)', () => {
  const r = feed({ listings: [listing(), listing()], tab: 'Nearby', homePlaceId: null, scopeId: null });
  assert.equal(r.needsLocation, true);
  assert.equal(r.items.length, 0);
  assert.equal(r.fallback, null);
});

test('Nearby with a chosen scope uses that scope; the home place only orders results inside it', () => {
  const a = listing({ city: 'Adigrat', createdAt: 100 });
  const m = listing({ city: 'Mekelle', createdAt: 50 });
  const r = feed({ listings: [a, m], tab: 'Nearby', scopeId: 'tg', homePlaceId: 'mk' });
  assert.deepEqual(ids(r.items), [m.id, a.id]);
  const r2 = feed({ listings: [a, m], tab: 'Nearby', scopeId: 'tg', homePlaceId: 'bd' }); // home outside scope → scope is the anchor
  assert.equal(r2.nearbyAnchor?.id, 'tg');
  assert.equal(r2.items.length, 2);
});

test('Nearby differs from For You (it is not the same feed)', () => {
  const l = [listing({ city: 'Jigjiga', createdAt: 9 }), listing({ city: 'Mekelle', createdAt: 1 })];
  const nearby = ids(feed({ listings: l, tab: 'Nearby', homePlaceId: 'mk' }).items);
  const forYou = ids(feed({ listings: l, tab: 'For You' }).items);
  assert.notDeepEqual(nearby, forYou);
});

// 9–10 ── Horizontal selector ───────────────────────────────────────────────────
test('selector at the root lists active countries (those with places) after "All Locations"', () => {
  const sel = scopeSelector(index, null, 'en');
  assert.equal(sel.parent, null);
  assert.equal(sel.options[0].isAll, true);
  assert.equal(sel.options[0].id, null);
  assert.deepEqual(sel.options.slice(1).map((o) => o.node!.name), ['Ethiopia', 'Somalia']); // Kenya has no places yet
  assert.equal(sel.activeIndex, 0);
});

test('choosing a country/region starts the strip at its own "All …" option (start of scope), never at a city', () => {
  for (const [scope, parent, firstCities] of [
    ['tg', 'Tigray', ['Adigrat', 'Mekelle']],
    ['sw', 'South West State', ['Baidoa', 'Barawe']],
    ['et', 'Ethiopia', ['Somali Region', 'Tigray']],
  ] as const) {
    const sel = scopeSelector(index, scope, 'en');
    assert.equal(sel.parent?.name, parent);
    assert.equal(sel.options[0].isAll, true);
    assert.equal(sel.options[0].id, scope);
    assert.deepEqual(sel.options.slice(1).map((o) => o.node!.name), firstCities);
    assert.equal(sel.activeIndex, 0);
    assert.deepEqual(scopeScrollTarget(sel), { index: 0 });
  }
});

test('choosing a city keeps its siblings, highlights it, and scrolls to it (not to the start)', () => {
  const sel = scopeSelector(index, 'br', 'en');
  assert.equal(sel.parent?.id, 'sw');
  assert.equal(sel.options[sel.activeIndex].id, 'br');
  assert.deepEqual(scopeScrollTarget(sel), { index: sel.activeIndex });
  assert.ok(sel.activeIndex > 0);
});

test('changing parent changes the strip’s level key (so the strip remounts at offset 0); same-level picks do not', () => {
  const level = (id: string | null) => scopeSelector(index, id, 'en').parent?.id ?? 'root';
  assert.notEqual(level('tg'), level('sw'));
  assert.equal(level('mk'), level('tg')); // city under Tigray keeps the Tigray level (no jump)
  assert.equal(level('tg'), level('ad'));
});

test('selector handles a short list safely (a place with a single child) and an unknown scope id', () => {
  const sel = scopeSelector(index, 'sr', 'en');
  assert.equal(sel.options.length, 2);
  assert.deepEqual(scopeScrollTarget(sel), { index: 0 });
  const unknown = scopeSelector(index, 'does-not-exist', 'en');
  assert.equal(unknown.parent, null);
  assert.equal(unknown.activeIndex, 0);
});

// 15 ── Mobile/web equivalence ────────────────────────────────────────────────
test('mobile and web run byte-identical Home logic', () => {
  const root = path.join(__dirname, '..', '..');
  for (const f of ['homeFeed.ts', 'refreshController.ts', 'locationTree.ts', 'homeBrowse.ts']) {
    const mobile = fs.readFileSync(path.join(root, 'lib', f), 'utf8');
    const web = fs.readFileSync(path.join(root, 'web', 'src', 'lib', f), 'utf8');
    assert.equal(web, mobile, `${f} differs between lib/ and web/src/lib/ — keep them in sync`);
  }
});

test('both platforms expose the same discovery controls', () => {
  assert.deepEqual([...DISCOVERY_TABS], ['For You', 'Nearby', 'Latest', 'Trending', 'Price', 'Price Drops']);
});

// 11 (wiring) ── tab press is connected to the refresh controller ───────────────
test('Home tab press is wired to the shared refresh on both platforms', () => {
  const root = path.join(__dirname, '..', '..');
  const layout = fs.readFileSync(path.join(root, 'app', '(tabs)', '_layout.tsx'), 'utf8');
  assert.match(layout, /homeRefresh\.onHomeTabPress\(navigation\.isFocused\(\)\)/);
  assert.doesNotMatch(layout, /resetHomeBrowsing/);
  const web = fs.readFileSync(path.join(root, 'web', 'src', 'components', 'MobileTabBar.tsx'), 'utf8');
  assert.match(web, /homeRefresh\.onHomeTabPress\(true\)/);
});
