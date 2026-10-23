// Home / category / city feed pagination — runs 0042 on top of the REAL migration chain in PGlite (real Postgres) and
// proves, for every Home tab: the paged server feed returns exactly the listings and order the reference
// implementation (lib/homeFeed.ts buildHomeFeed) produces, pages never repeat or skip a row, visibility / blocked /
// category / place / city rules hold, bad input is rejected, the indexes are used, and the rollback is exact.
//
// Needs the compiled TypeScript (npm test builds it into .test-build) and PGLITE_DIR (see run-all.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { boot, actors, seedUsers, ok, uuid, sqlFile, root } from './harness/db.mjs';

const build = path.join(root, '.test-build');
if (!fs.existsSync(path.join(build, 'lib', 'homeFeed.js'))) {
  console.error('Run `npm test` first: this suite imports the compiled lib/*.ts from .test-build.');
  process.exit(2);
}
const require = createRequire(import.meta.url);
const H = require(path.join(build, 'lib', 'homeFeed.js'));
const P = require(path.join(build, 'lib', 'homeFeedPaging.js'));
const T = require(path.join(build, 'lib', 'locationTree.js'));

// This suite proves 0042 on its own (it re-applies 0042 below), so the chain stops there. 0043 (two-way blocks, targeted
// reads) replaces home_feed()'s block predicate and is tested in listings_reads.test.mjs.
const { db, hasTrgm } = await boot({ upTo: '0042' });
const { q, fails } = actors(db);
const [seller1, seller2, seller3, buyer, blockedPal] = await seedUsers(db, 5);

const snapshot = async () =>
  JSON.stringify(
    (
      await db.query(`
    select 'fn' k, p.oid::regprocedure::text v from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    union all select 'idx', indexname from pg_indexes where schemaname='public'
    union all select 'col', table_name||'.'||column_name from information_schema.columns where table_schema='public'
    union all select 'pol', schemaname||'.'||tablename||'.'||policyname from pg_policies where schemaname='public'
    union all select 'trg', tgrelid::regclass||'.'||tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'public.%'
    order by 1,2`)
    ).rows
  );

// ---------------------------------------------------------------- migration hygiene
assert.ok((await db.query(`select 1 from pg_proc where proname='home_feed'`)).rows.length === 1);
ok('0042 applies on top of the real 0001..0041 chain');
const withMigration = await snapshot();
await db.exec(sqlFile('migrations/0042_home_feed.sql'));
assert.equal(await snapshot(), withMigration);
ok('0042 is re-runnable (idempotent: same functions, indexes, columns, policies, triggers)');
const sec = (await db.query(`select proname, prosecdef from pg_proc where proname in ('home_feed','home_feed_currencies') order by 1`)).rows;
assert.deepEqual(sec, [{ proname: 'home_feed', prosecdef: false }, { proname: 'home_feed_currencies', prosecdef: false }]);
ok('both functions are SECURITY INVOKER (the listings RLS policy keeps applying)');

// ---------------------------------------------------------------- fixture
// Testland → Northreg → (Alpha, Beta) · Southreg → (Delta) ; Otherland → Farreg → (Echo) ; Pendingtown is unapproved
const ids = { c1: uuid(9001), r1: uuid(9002), a: uuid(9003), b: uuid(9004), r2: uuid(9005), d: uuid(9006), c2: uuid(9007), r3: uuid(9008), e: uuid(9009), p: uuid(9010) };
await db.query(
  `insert into public.locations(id,kind,name,normalized_name,parent_id,status) values
  ($1,'country','Testland','testland',null,'approved'),($2,'region','Northreg','northreg',$1,'approved'),
  ($3,'city','Alpha','alpha',$2,'approved'),($4,'city','Beta','beta',$2,'approved'),
  ($5,'region','Southreg','southreg',$1,'approved'),($6,'city','Delta','delta',$5,'approved'),
  ($7,'country','Otherland','otherland',null,'approved'),($8,'region','Farreg','farreg',$7,'approved'),
  ($9,'city','Echo','echo',$8,'approved'),($10,'city','Pendingtown','pendingtown',$2,'pending')`,
  [ids.c1, ids.r1, ids.a, ids.b, ids.r2, ids.d, ids.c2, ids.r3, ids.e, ids.p]
);
const nodes = (await db.query(`select id, kind, name, parent_id, status from public.locations where id = any($1::uuid[])`, [Object.values(ids)])).rows.map((r) => ({
  id: r.id, kind: r.kind, name: r.name, nameSo: null, nameAm: null, parentId: r.parent_id, iso2: null, currencyCodes: null, defaultCurrency: null, aliases: [], isFeatured: false, isAppRegion: false, status: r.status,
}));
const index = T.buildIndex(nodes);

const BASE = Date.parse('2026-06-01T00:00:00.000Z');
const MIN = 60_000;
let seq = 0;
async function add(owner, o = {}) {
  const id = uuid(1000 + ++seq);
  await db.query(
    `insert into public.listings (id,user_id,title,category,subcategory,city,price,currency,negotiable,status,views,favorites_count,created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,false,$9,$10,$11,$12)`,
    [id, owner, o.title ?? 'Item ' + seq, o.category ?? 'phones', o.sub ?? null, o.city ?? 'Alpha', o.price ?? 100, o.currency ?? 'USD', o.status ?? 'available', o.views ?? 0, o.favs ?? 0, new Date(BASE + (o.minute ?? seq) * MIN).toISOString()]
  );
  return id;
}

// ~70 listings spread over places, categories, currencies, prices and engagement. Created-at minutes are unique
// except for deliberate ties (same instant, different ids) which exercise the (created_at, id) tiebreak.
const cities = ['Alpha', 'Beta', 'Delta', 'Echo', 'Alpha', 'Beta'];
const cats = ['phones', 'cars', 'home'];
const owners = [seller1, seller2, seller3];
for (let i = 0; i < 60; i++) {
  await add(owners[i % 3], {
    city: cities[i % cities.length],
    category: cats[i % 3],
    sub: i % 2 ? 'Smartphones' : 'Accessories',
    price: [50, 75, 75, 120, 300, 1000][i % 6] + (i % 7),
    currency: ['USD', 'USD', 'ETB', 'SLSH', 'USD', 'ETB'][i % 6],
    views: (i * 7) % 40,
    favs: (i * 3) % 5,
    minute: 10 + i * 3,
  });
}
// ties: three listings created at the very same instant
const tieMinute = 500;
const tie1 = await add(seller1, { title: 'tie 1', minute: tieMinute });
const tie2 = await add(seller2, { title: 'tie 2', minute: tieMinute });
const tie3 = await add(seller3, { title: 'tie 3', minute: tieMinute });
// zero / missing price, legacy display-name category, statuses that stay visible, unapproved place, lower-case currency
const zeroPrice = await add(seller1, { title: 'free?', price: 0, minute: 501 });
const legacyCat = await add(seller2, { title: 'legacy category', category: 'Phones', minute: 502 });
const soldOne = await add(seller3, { title: 'sold', status: 'sold', minute: 503 });
const expiredOne = await add(seller1, { title: 'expired', status: 'expired', minute: 504 });
const reservedOne = await add(seller2, { title: 'reserved', status: 'reserved', minute: 505 });
const pendingCity = await add(seller3, { title: 'pending place', city: 'Pendingtown', minute: 506 });
const lowerCur = await add(seller1, { title: 'lower-case currency', currency: 'usd', minute: 507 });
// hidden by moderation
const removedOne = await add(seller1, { title: 'removed', minute: 508 });
const deactivatedOne = await add(seller2, { title: 'deactivated', minute: 509 });
await db.query(`update public.listings set status='removed' where id=$1`, [removedOne]);
await db.query(`update public.listings set status='deactivated' where id=$1`, [deactivatedOne]);
// blocked seller's listing, both directions
const palListing = await add(blockedPal, { title: 'from blocked pal', minute: 510 });
// real price drops (recorded by the 0038 trigger on a genuine decrease)
const dropped1 = await add(seller1, { title: 'dropped 1', price: 400, minute: 511 });
const dropped2 = await add(seller2, { title: 'dropped 2', price: 400, city: 'Delta', minute: 512 });
await db.query(`update public.listings set price = 350 where id=$1`, [dropped1]);
await db.query(`update public.listings set price = 300 where id=$1`, [dropped2]);
await db.query(`update public.listings set last_price_drop_at = $2 where id=$1`, [dropped1, new Date(BASE + 2_000 * MIN).toISOString()]);
await db.query(`update public.listings set last_price_drop_at = $2 where id=$1`, [dropped2, new Date(BASE + 3_000 * MIN).toISOString()]);
const dropLater = await add(seller3, { title: 'dropped 3', price: 90, minute: 513 });
await db.query(`update public.listings set price = 80 where id=$1`, [dropLater]);
await db.query(`update public.listings set last_price_drop_at = $2 where id=$1`, [dropLater, new Date(BASE + 2_500 * MIN).toISOString()]);

await db.query(`insert into public.blocked_users(blocker_id, blocked_id) values ($1,$2)`, [buyer, blockedPal]);

const NOW = BASE + 10_000 * MIN;
const NOW_ISO = new Date(NOW).toISOString();

// What the reference implementation sees: every row an anonymous visitor can read (RLS), as FeedListing + city.
const visibleRows = async () =>
  (await db.query(`select l.* from public.listings l join public.profiles p on p.id = l.user_id where l.status not in ('removed','deactivated') order by l.id`)).rows.map((r) => ({
    id: r.id,
    price: Number(r.price),
    currency: r.currency,
    category: r.category,
    city: r.city,
    createdAt: new Date(r.created_at).getTime(),
    views: r.views,
    favoritesCount: r.favorites_count,
    _blockedBy: r.user_id,
    _drop: r.last_price_drop_at ? new Date(r.last_price_drop_at).getTime() : null,
  }));

const asParams = (query, cursor, limit, asOf) => Object.values(P.toFeedRpcParams(query, cursor, limit, asOf));
const CALL = `select * from public.home_feed($1,$2::text[],$3,$4::uuid,$5,$6::uuid,$7,$8,$9,$10::timestamptz,$11::float8,$12::timestamptz,$13::uuid)`;
const callPage = (uid, query, cursor, limit, asOf = NOW) => q(uid, CALL, asParams(query, cursor, limit, asOf)).then((r) => r.rows);

/** Pages through the whole feed exactly like the client does (limit+1 rows, cursor from the last shown row). */
async function pageAll(uid, query, limit = 7, asOf = NOW) {
  const out = [];
  const sizes = [];
  let cursor = null;
  for (let guard = 0; guard < 200; guard++) {
    const rows = await callPage(uid, query, cursor, limit, asOf);
    const page = P.splitFeedPage(rows, limit);
    sizes.push(page.items.length);
    out.push(...page.items.map((r) => r.listing.id));
    if (!page.hasMore) return { ids: out, sizes };
    cursor = page.cursor;
  }
  assert.fail('feed did not terminate');
}

const category = { id: 'phones', name: 'Phones' };
const cat = (c) => (c ? P.categoryValues(c) : null);

// ---------------------------------------------------------------- parity with the reference implementation
const homePlace = ids.a;
let compared = 0;
for (const scopeId of [null, ids.r1, ids.a, ids.c2]) {
  for (const cg of [null, category]) {
    for (const tab of H.DISCOVERY_TABS) {
      for (const priceOrder of tab === 'Price' ? ['asc', 'desc'] : ['asc']) {
        const rows = (await visibleRows()).filter((l) => l._blockedBy !== blockedPal); // the buyer blocked this seller
        const priceDropAt = Object.fromEntries(rows.filter((l) => l._drop).map((l) => [l.id, l._drop]));
        const ref = H.buildHomeFeed({ listings: rows, index, scopeId, category: cg, tab, priceOrder, currency: null, priceDropAt, homePlaceId: homePlace, now: NOW });

        // the client's own request shaping
        const optionsRows = (await q(buyer, `select * from public.home_feed_currencies($1::text[], $2::uuid)`, [cat(cg), scopeId])).rows;
        const priceOptions = optionsRows.map((r) => ({ code: r.code, count: Number(r.n) }));
        const hq = P.buildHomeQuery({ index, scopeId, category: cg, tab, priceOrder, currency: null, homePlaceId: homePlace, priceOptions: tab === 'Price' ? priceOptions : null });
        const label = `${tab}${tab === 'Price' ? ' ' + priceOrder : ''} · scope ${scopeId ? T.norm(index.byId.get(scopeId).name) : 'all'} · ${cg ? 'phones' : 'all categories'}`;

        if (ref.needsLocation) {
          assert.equal(hq.query, null, label);
          assert.equal(hq.needsLocation, true, label);
        } else {
          assert.ok(hq.query, label);
          const got = await pageAll(buyer, hq.query, 7);
          assert.deepEqual(got.ids, ref.items.map((l) => l.id), `${label}: paged server feed differs from the reference order`);
          assert.equal(new Set(got.ids).size, got.ids.length, `${label}: duplicate rows across pages`);
          if (tab === 'Price') {
            assert.deepEqual(hq.price, ref.price, `${label}: price currency/options/hidden count differ`);
          }
          compared++;
        }
      }
    }
  }
}
ok(`all 6 tabs × 4 places × 2 category settings (${compared} feeds, both price orders): the paged server feed returns the same listings in the same order as the reference implementation, with no repeats`);

// ---------------------------------------------------------------- pagination mechanics
const all = await pageAll(buyer, { ...P.BASE_QUERY }, 5);
assert.ok(all.sizes.slice(0, -1).every((n) => n === 5), 'every page but the last is full');
assert.ok(all.sizes[all.sizes.length - 1] >= 1 && all.sizes[all.sizes.length - 1] <= 5);
const total = (await visibleRows()).filter((l) => l._blockedBy !== blockedPal).length;
assert.equal(all.ids.length, total);
ok(`Latest pages in fixed-size chunks and returns all ${total} visible listings exactly once`);

assert.ok([tie1, tie2, tie3].every((id) => all.ids.includes(id)));
const tieOrder = all.ids.filter((id) => [tie1, tie2, tie3].includes(id));
assert.deepEqual(tieOrder, [tie1, tie2, tie3].sort(), 'identical created_at → id ascending (same tiebreak as the client reference)');
for (const size of [1, 2, 3]) {
  const small = await pageAll(buyer, { ...P.BASE_QUERY }, size);
  assert.deepEqual(small.ids, all.ids, `page size ${size} must give the same sequence (ties straddling a page boundary included)`);
}
ok('three listings created at the same instant are never repeated or skipped, even when a page boundary falls between them');

// a listing published while the user is paging must not shift the rows they have not seen yet
{
  const first = P.splitFeedPage(await callPage(buyer, P.BASE_QUERY, null, 5), 5);
  const newest = await add(seller1, { title: 'published mid-scroll', minute: 9_000 });
  const rest = [];
  let cursor = first.cursor;
  while (cursor) {
    const page = P.splitFeedPage(await callPage(buyer, P.BASE_QUERY, cursor, 5), 5);
    rest.push(...page.items.map((r) => r.listing.id));
    cursor = page.cursor;
  }
  const seen = [...first.items.map((r) => r.listing.id), ...rest];
  assert.equal(new Set(seen).size, seen.length);
  assert.ok(!seen.includes(newest), 'a listing newer than the cursor is not injected into later pages');
  assert.deepEqual(seen, all.ids, 'rows after the cursor are exactly the rows that existed when the feed started');
  const fresh = await pageAll(buyer, P.BASE_QUERY, 5);
  assert.equal(fresh.ids[0], newest, 'a refresh (page 1 again) shows it first');
  await db.query(`delete from public.listings where id=$1`, [newest]);
}
ok('inserting a listing mid-scroll neither duplicates nor skips rows; a refresh shows it at the top');

// exactly one extra row is requested (limit+1) and page size is clamped
assert.equal((await callPage(buyer, P.BASE_QUERY, null, 5)).length, 6);
assert.ok((await callPage(buyer, P.BASE_QUERY, null, 5000)).length <= 61);
assert.equal((await callPage(buyer, P.BASE_QUERY, null, 0)).length, 2);
ok('the RPC returns limit+1 rows (to detect another page) and clamps the page size to 1..60');

// last page / end of feed
{
  const lastPage = await pageAll(buyer, { ...P.BASE_QUERY, categories: ['cars'], city: 'Echo' }, 1000);
  assert.equal(lastPage.sizes.length, 1);
  const none = await pageAll(buyer, { ...P.BASE_QUERY, categories: ['cars'], city: 'Nowhere' }, 5);
  assert.deepEqual(none.ids, []);
  assert.deepEqual(none.sizes, [0]);
}
ok('end of feed: a short page reports no more; an empty result is just an empty first page');

// ---------------------------------------------------------------- visibility, blocking, filters
assert.ok(!all.ids.includes(removedOne) && !all.ids.includes(deactivatedOne));
for (const uid of [seller1, seller2, null]) {
  const own = await pageAll(uid, P.BASE_QUERY, 50);
  assert.ok(!own.ids.includes(removedOne) && !own.ids.includes(deactivatedOne), `removed/deactivated must not appear for ${uid ?? 'anon'}`);
}
await db.query(`insert into public.admin_users(user_id) values ($1)`, [seller3]);
const staff = await pageAll(seller3, P.BASE_QUERY, 50);
assert.ok(!staff.ids.includes(removedOne) && !staff.ids.includes(deactivatedOne), 'staff (who can read them through RLS) still does not see them in the public feed');
await db.query(`delete from public.admin_users where user_id=$1`, [seller3]);
ok('removed / deactivated listings never appear — not for anonymous, other users, the owner, or staff');

assert.ok([soldOne, expiredOne, reservedOne].every((id) => all.ids.includes(id)));
ok('sold, expired and reserved listings stay visible (existing Home behaviour is preserved)');

assert.ok(!all.ids.includes(palListing));
// At 0042 only the viewer's own blocks are enforced: the reverse direction ("someone blocked ME") cannot be seen by a
// SECURITY INVOKER function (the blocked_users policy only shows a user the rows they created). The test pins that and
// proves home_feed agrees with search_listings so the two screens never disagree. 0043 closes the gap for both
// (supabase/tests/listings_reads.test.mjs).
await db.query(`insert into public.listings(id,user_id,title,category,city,price,currency,status,created_at) values ($1,$2,'buyer listing','phones','Alpha',10,'USD','available',$3)`, [uuid(5000), buyer, new Date(BASE + 600 * MIN).toISOString()]);
const palFeed = await pageAll(blockedPal, P.BASE_QUERY, 50);
const palSearch = (await q(blockedPal, `select (listing->>'id') id from public.search_listings(null,null,null,false,false,false,false,false,60,null,null)`)).rows.map((r) => r.id);
assert.equal(palFeed.ids.includes(uuid(5000)), palSearch.includes(uuid(5000)), 'home feed and search agree about reverse-direction blocks');
assert.ok((await pageAll(seller1, P.BASE_QUERY, 50)).ids.includes(uuid(5000)));
assert.ok((await pageAll(null, P.BASE_QUERY, 50)).ids.includes(palListing), 'anonymous visitors have no blocks');
await db.query(`delete from public.listings where id=$1`, [uuid(5000)]);
ok("a viewer's own blocks are enforced in the database; guests have no blocks; Home agrees with Search about the reverse direction (fixed by 0043)");

const phones = await pageAll(buyer, { ...P.BASE_QUERY, categories: P.categoryValues(category) }, 50);
const phoneRows = (await visibleRows()).filter((l) => ['phones', 'Phones'].includes(l.category) && l._blockedBy !== blockedPal);
assert.deepEqual([...phones.ids].sort(), phoneRows.map((l) => l.id).sort());
assert.ok(phones.ids.includes(legacyCat));
const strict = await pageAll(buyer, { ...P.BASE_QUERY, categories: ['phones'] }, 50);
assert.ok(!strict.ids.includes(legacyCat), 'the category screen matches the stable id only (as before)');
ok('category filter: Home tolerates legacy display-name rows, the category screen matches the id only');

const sub = await pageAll(buyer, { ...P.BASE_QUERY, categories: ['phones'], subcategory: 'Smartphones' }, 50);
assert.ok(sub.ids.length > 0);
const subRows = (await db.query(`select id from public.listings where category='phones' and subcategory='Smartphones' and status not in ('removed','deactivated') and user_id <> $1`, [blockedPal])).rows.map((r) => r.id);
assert.deepEqual([...sub.ids].sort(), subRows.sort());
const cityOnly = await pageAll(buyer, { ...P.BASE_QUERY, city: 'Beta' }, 50);
assert.ok(cityOnly.ids.length > 0);
const betaRows = (await db.query(`select id from public.listings where city='Beta' and status not in ('removed','deactivated')`)).rows.map((r) => r.id);
assert.deepEqual([...cityOnly.ids].sort(), betaRows.sort());
ok('subcategory and exact-city filters return exactly the matching rows');

const scoped = await pageAll(buyer, { ...P.BASE_QUERY, scopeId: ids.r1 }, 50);
const scopedRows = (await db.query(`select id from public.listings where city in ('Alpha','Beta') and status not in ('removed','deactivated') and user_id <> $1`, [blockedPal])).rows.map((r) => r.id);
assert.deepEqual([...scoped.ids].sort(), scopedRows.sort());
assert.ok(!scoped.ids.includes(pendingCity), 'a listing in an unapproved place is not inside any approved scope');
assert.ok(all.ids.includes(pendingCity), 'but it is still in the unscoped feed');
ok('place filter includes descendants and excludes unapproved places');

// Price: zero price last, lower-case currency counts as its upper-case code, opposite orders are mirror images
{
  const usd = { ...P.BASE_QUERY, tab: 'price', currency: 'USD', priceOrder: 'asc' };
  const asc = await pageAll(buyer, usd, 9);
  const desc = await pageAll(buyer, { ...usd, priceOrder: 'desc' }, 9);
  const usdRows = (await visibleRows()).filter((l) => l._blockedBy !== blockedPal && l.currency.toUpperCase() === 'USD');
  assert.equal(asc.ids.length, usdRows.length);
  assert.ok(asc.ids.includes(lowerCur));
  assert.equal(asc.ids[asc.ids.length - 1], zeroPrice, 'a listing without a usable price goes last');
  assert.equal(desc.ids[desc.ids.length - 1], zeroPrice);
  const priceOf = Object.fromEntries(usdRows.map((l) => [l.id, l.price]));
  const ascPrices = asc.ids.slice(0, -1).map((id) => priceOf[id]);
  assert.deepEqual(ascPrices, [...ascPrices].sort((x, y) => x - y));
  const descPrices = desc.ids.slice(0, -1).map((id) => priceOf[id]);
  assert.deepEqual(descPrices, [...descPrices].sort((x, y) => y - x));
  const opts = (await q(buyer, `select * from public.home_feed_currencies(null, null)`)).rows;
  assert.equal(opts[0].code, 'USD');
  assert.deepEqual(opts.map((r) => r.code).sort(), ['ETB', 'SLSH', 'USD']);
  assert.equal(opts.reduce((n, r) => n + Number(r.n), 0), total);
}
ok('Price: one currency at a time, unusable prices last in both orders, currency codes folded to upper case, option counts add up');

// Nearby: without a chosen place it stops at the home country; with one it keeps everything inside it
{
  const nearby = { ...P.BASE_QUERY, tab: 'nearby', anchorId: ids.a };
  const near = await pageAll(buyer, nearby, 8);
  const cityOf = Object.fromEntries((await db.query(`select id, city from public.listings`)).rows.map((r) => [r.id, r.city]));
  const rankOf = (c) => (c === 'Alpha' ? 0 : c === 'Beta' ? 1 : c === 'Delta' ? 2 : c === 'Echo' ? 3 : 3);
  assert.ok(near.ids.every((id) => cityOf[id] !== 'Echo'), 'another country is not "near me"');
  const ranks = near.ids.map((id) => (cityOf[id] === 'Pendingtown' ? 3 : rankOf(cityOf[id])));
  assert.deepEqual(ranks, [...ranks].sort((x, y) => x - y), 'same place, then same region, then same country');
  const scopedNear = await pageAll(buyer, { ...nearby, scopeId: ids.c2 }, 8);
  assert.ok(scopedNear.ids.length > 0 && scopedNear.ids.every((id) => cityOf[id] === 'Echo'));
}
ok('Nearby: ordered by same place → region → country, stops at the home country unless a place is chosen');

// Trending: the order is fixed by the frozen "now", so pages of one session stay consistent
{
  const trending = { ...P.BASE_QUERY, tab: 'trending' };
  const one = await pageAll(buyer, trending, 6, NOW);
  const two = await pageAll(buyer, trending, 11, NOW);
  assert.deepEqual(one.ids, two.ids);
  const later = await pageAll(buyer, trending, 6, NOW + 90 * 86_400_000);
  assert.equal(new Set(later.ids).size, later.ids.length);
  const clampedAhead = await callPage(buyer, trending, null, 3, NOW + 365 * 86_400_000 * 50);
  assert.equal(clampedAhead.length, 4, 'a client clock far in the future cannot break the feed (clamped to the server clock)');
}
ok('Trending: identical sequence for any page size at a fixed instant; an absurd client clock is clamped');

// Price drops: only listings with a recorded drop, most recent drop first
{
  const pd = await pageAll(buyer, { ...P.BASE_QUERY, tab: 'price_drops' }, 2);
  assert.deepEqual(pd.ids, [dropped2, dropLater, dropped1]);
}
ok('Price Drops: only listings with a recorded drop, most recent drop first');

// ---------------------------------------------------------------- input validation and injection
await fails(buyer, `select * from public.home_feed('bogus')`, [], /Unknown feed tab/);
await fails(buyer, `select * from public.home_feed('price', null, null, null, null, null, 'USD', 'sideways')`, [], /Unknown price order/);
const evil = await callPage(buyer, { ...P.BASE_QUERY, city: `x'; drop table public.listings; --`, categories: [`') or 1=1 --`], subcategory: `'||'` }, null, 5);
assert.deepEqual(evil, []);
assert.equal((await db.query(`select count(*)::int c from public.listings`)).rows[0].c > 0, true);
ok('unknown tab / price order are rejected; hostile city, category and subcategory text is only ever bound data');

// ---------------------------------------------------------------- indexes (planner evidence on a larger table)
if (hasTrgm) {
  // Seeding as the database owner, not as the last simulated user (the per-user listing rate limit would apply).
  await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
  await db.query(`insert into public.listings(user_id,title,category,city,price,currency,negotiable,status,created_at)
    select $1, 'bulk '||g, (array['phones','cars','home','jobs'])[1+g%4], (array['Alpha','Beta','Delta','Echo'])[1+g%4], 10+g, 'USD', g%4=0,
           (array['available','available','available','sold','expired','removed'])[1+g%6], now() - (g||' seconds')::interval
      from generate_series(1,8000) g`, [seller2]);
  await db.query(`update public.listings set location_id = (select id from public.locations where name = listings.city and status='approved' limit 1) where location_id is null`);
  // A rare category and a rare city: 30 rows among ~8000.
  const rareCity = uuid(9011);
  await db.query(`insert into public.locations(id,kind,name,normalized_name,parent_id,status) values ($1,'city','Rareville','rareville',$2,'approved')`, [rareCity, ids.r1]);
  await db.query(`update public.listings set category='rare', city='Rareville', location_id=$1 where id in (select id from public.listings where title like 'bulk %' order by id limit 30)`, [rareCity]);
  await db.exec('analyze public.listings; set plan_cache_mode = force_custom_plan;'); // no planner overrides: the plans below are what Postgres really picks
  const plan = async (sqlText) => (await db.query('explain ' + sqlText)).rows.map((r) => r['QUERY PLAN']).join('\n');
  const vis = `status not in ('removed', 'deactivated')`;
  const tail = `order by created_at desc, id asc limit 25`;
  // the shapes home_feed() generates: a single category / single city is a plain equality
  const shapes = {
    latest: `select id from public.listings where ${vis} ${tail}`,
    rareCategory: `select id from public.listings where ${vis} and category = ('{rare}'::text[])[1] ${tail}`,
    rareCity: `select id from public.listings where ${vis} and location_id = ('{${rareCity}}'::uuid[])[1] ${tail}`,
  };
  const withNew = Object.fromEntries(await Promise.all(Object.entries(shapes).map(async ([k, v]) => [k, await plan(v)])));
  assert.match(withNew.latest, /listings_home_feed_idx/);
  assert.doesNotMatch(withNew.latest, /Sort|Seq Scan/, 'newest-first is read straight off the index — no sort of the whole table');
  assert.match(withNew.rareCategory, /listings_home_category_idx/);
  assert.doesNotMatch(withNew.rareCategory, /Seq Scan/);
  // a place feed needs no new index: the 0032 index on location_id already serves it
  assert.doesNotMatch(withNew.rareCity, /Seq Scan/);
  assert.match(withNew.rareCity, /listings_location_id_idx|listings_location_feed_idx/);
  assert.equal((await db.query(`select 1 from pg_indexes where indexname = 'listings_home_location_idx'`)).rows.length, 0, 'no redundant place index was added');
  // Evidence the two new indexes are NOT redundant: take them away and the existing indexes (0038's are partial on
  // status in available/reserved, so they cannot answer "everything except removed/deactivated") cannot serve these queries.
  await db.exec(`drop index listings_home_feed_idx; drop index listings_home_category_idx; analyze public.listings;`);
  const without = Object.fromEntries(await Promise.all(Object.entries(shapes).map(async ([k, v]) => [k, await plan(v)])));
  assert.match(without.latest, /Sort/, 'without the feed index every Latest page sorts the table');
  assert.doesNotMatch(without.latest, /listings_feed_idx/);
  assert.match(without.rareCategory, /Seq Scan/, 'without the category index a rare category scans the whole table');
  await db.exec(sqlFile('migrations/0042_home_feed.sql'));
  await db.exec('analyze public.listings');
  ok('planner reads Latest off listings_home_feed_idx (no sort) and a rare category off listings_home_category_idx; a place feed is already served by the 0032 index; without the two new indexes both queries sort / sequentially scan, so neither is redundant');

  // the whole feed still pages correctly on a table this size
  const big = await pageAll(buyer, P.BASE_QUERY, 60);
  assert.equal(new Set(big.ids).size, big.ids.length);
  const bigCount = (await db.query(`select count(*)::int c from public.listings l where status not in ('removed','deactivated') and user_id <> $1`, [blockedPal])).rows[0].c;
  assert.equal(big.ids.length, bigCount);
  ok(`${bigCount} listings page through in order with no repeats and no gaps`);
} else {
  console.log('SKIP  index-plan checks: pg_trgm contrib not available in this PGlite build');
}

// ---------------------------------------------------------------- rollback restores the pre-0042 schema
await db.exec(sqlFile('rollback/0042_home_feed_ROLLBACK.sql'));
const rolled = JSON.parse(await snapshot());
const gone = JSON.parse(withMigration).filter((r) => !rolled.some((x) => x.k === r.k && x.v === r.v));
assert.deepEqual(gone.map((r) => r.v).sort(), [
  'home_feed(text,text[],text,uuid,text,uuid,text,text,integer,timestamp with time zone,double precision,timestamp with time zone,uuid)',
  'home_feed_currencies(text[],uuid)',
  'listings_home_category_idx',
  'listings_home_feed_idx',
]);
assert.equal(rolled.length, JSON.parse(withMigration).length - 4, 'the rollback removes exactly the 2 functions and 2 indexes 0042 added');
await db.exec(sqlFile('migrations/0042_home_feed.sql'));
assert.equal(await snapshot(), withMigration);
ok('rollback removes exactly 0042\'s 2 functions and 2 indexes, and 0042 re-applies cleanly');

console.log('\nOK homefeed.test.mjs');
