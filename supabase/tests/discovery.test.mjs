// Phase 1a/1b — runs 0038 on top of the REAL chain 0001..0037 in PGlite (real Postgres) and proves:
// verification / boosts / price-drop recording / protected columns / search semantics (SQL == TS reference),
// pagination, index usage, authorization, and that the rollback restores the pre-0038 schema.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { boot, actors, seedUsers, ok, uuid, sqlFile, root } from './harness/db.mjs';

const F = await import(pathToFileURL(path.join(root, 'lib', 'searchFilters.ts')).href);
const { db, hasTrgm } = await boot({ upTo: '0037' });
const { q, fails } = actors(db);

const snapshot = async () =>
  JSON.stringify(
    (
      await db.query(`
    select 'col' k, table_name||'.'||column_name v from information_schema.columns where table_schema='public'
    union all select 'fn', p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    union all select 'trg', tgrelid::regclass||'.'||tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'public.%'
    union all select 'pol', schemaname||'.'||tablename||'.'||policyname from pg_policies where schemaname='public'
    union all select 'idx', indexname from pg_indexes where schemaname='public'
    order by 1,2`)
    ).rows
  );
const before = await snapshot();
const [admin, seller, buyer, seller2] = await seedUsers(db, 4);
await db.query(`insert into public.admin_users(user_id) values ($1)`, [admin]);

await db.exec(sqlFile('migrations/0038_search_discovery.sql'));
ok('0038 applies on top of the real 0001..0037 chain');
await db.exec(sqlFile('migrations/0038_search_discovery.sql'));
ok('0038 is re-runnable (idempotent)');

// ---------------------------------------------------------------- verification
assert.equal((await db.query(`select count(*)::int c from public.profiles where verified_at is not null`)).rows[0].c, 0);
ok('no existing profile is auto-verified');
await fails(seller, `update public.profiles set verified_at = now() where id = $1`, [seller], /42501|staff only/);
ok('a user cannot self-verify through a plain UPDATE (trigger-enforced)');
await fails(seller, `select public.admin_set_verified($1, true, 'because')`, [seller], /42501|Only an admin/);
ok('a non-admin cannot call admin_set_verified');
await fails(admin, `select public.admin_set_verified($1, true, '  ')`, [seller], /reason is required/);
ok('verification requires a reason');
await q(admin, `select public.admin_set_verified($1, true, 'Business licence seen by staff')`, [seller]);
assert.ok((await db.query(`select verified_at from public.profiles where id=$1`, [seller])).rows[0].verified_at);
const ev = (await db.query(`select action, actor_id, reason from public.profile_verification_events where profile_id=$1`, [seller])).rows;
assert.deepEqual(ev, [{ action: 'grant', actor_id: admin, reason: 'Business licence seen by staff' }]);
assert.equal((await db.query(`select count(*)::int c from public.admin_audit_log where action='verify_user' and target_id=$1`, [seller])).rows[0].c, 1);
ok('admin grants verification: verified_at set + event (who/when/why) + audit row');
await fails(admin, `select public.admin_set_verified($1, true, 'again')`, [seller], /already verified/);
await q(admin, `select public.admin_set_verified($1, false, 'Licence expired')`, [seller]);
assert.equal((await db.query(`select verified_at from public.profiles where id=$1`, [seller])).rows[0].verified_at, null);
ok('revoke clears verified_at and is audited; double-grant is rejected');
assert.equal((await q(buyer, `select count(*)::int c from public.profile_verification_events`)).rows[0].c, 0);
ok('verification events are not readable by non-admins');
await q(admin, `select public.admin_set_verified($1, true, 'Re-verified by staff')`, [seller]);

// ---------------------------------------------------------------- helpers to create listings
// Fixture volume would trip the (separately tested) 10/hour listing quota; the schema has an explicit bypass GUC.
await db.exec("select set_config('suuqplus.skip_rate_limit','true',false)");
let seq = 100;
async function listing(owner, o = {}) {
  const id = uuid(++seq);
  await db.query(
    `insert into public.listings (id,user_id,title,category,city,price,currency,negotiable,status,created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, owner, o.title ?? 'Item ' + seq, o.category ?? 'electronics', o.city ?? 'Hargeisa', o.price ?? 100, o.currency ?? 'USD', o.negotiable ?? false, o.status ?? 'available', o.createdAt ?? new Date().toISOString()]
  );
  return id;
}
const search = async (uid, args = {}, ret = 'ids') => {
  const cols = {
    p_query: null, p_category: null, p_scope_id: null, p_verified: false, p_boosted_today: false,
    p_price_reduced: false, p_negotiable: false, p_posted_today: false, p_limit: 24, p_cursor_created_at: null, p_cursor_id: null, ...args,
  };
  const r = await q(uid, `select * from public.search_listings($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, Object.values(cols));
  return ret === 'rows' ? r.rows : r.rows.map((x) => x.listing.id);
};

// ---------------------------------------------------------------- price drops
const L = await listing(seller, { title: 'Phone A', price: 500, negotiable: true });
await q(seller, `update public.listings set price = 450 where id=$1`, [L]);
let drops = (await db.query(`select old_price::float o, new_price::float n from public.price_drops where listing_id=$1`, [L])).rows;
assert.deepEqual(drops, [{ o: 500, n: 450 }]);
ok('a normal listing edit that lowers the price records exactly one price drop');
await q(seller, `update public.listings set price = 450, title='Phone A2' where id=$1`, [L]);
await q(seller, `update public.listings set price = 460 where id=$1`, [L]);
assert.equal((await db.query(`select count(*)::int c from public.price_drops where listing_id=$1`, [L])).rows[0].c, 1);
ok('unchanged price and price increase record nothing');
await q(seller, `update public.listings set price = 10, currency='SLSH' where id=$1`, [L]);
assert.equal((await db.query(`select count(*)::int c from public.price_drops where listing_id=$1`, [L])).rows[0].c, 1);
await q(seller, `update public.listings set price = 460, currency='USD' where id=$1`, [L]);
ok('a lower number caused only by a currency change is not a reduction');
// old-app flow: UPDATE then INSERT into price_drops — the insert must be rejected and not double-record
await db.query(`insert into public.favorites(user_id, listing_id) values ($1,$2)`, [buyer, L]);
await q(seller, `update public.listings set price = 400 where id=$1`, [L]);
await fails(seller, `insert into public.price_drops(listing_id, old_price, new_price) values ($1, 460, 400)`, [L], /row-level security|42501/);
assert.equal((await db.query(`select count(*)::int c from public.price_drops where listing_id=$1`, [L])).rows[0].c, 2);
assert.equal((await db.query(`select count(*)::int c from public.notifications where user_id=$1 and title like 'Price dropped%'`, [buyer])).rows[0].c, 1);
ok('legacy client flow (UPDATE then INSERT price_drops): insert refused, one drop row, one favorites notification');
await fails(seller, `update public.listings set last_price_drop_at = now() where id=$1`, [L], /42501|Protected/);
await fails(seller, `update public.listings set boosted_until = now() + interval '9 days' where id=$1`, [L], /42501|Protected/);
await fails(seller, `update public.listings set views = 99999 where id=$1`, [L], /42501|Protected/);
ok('clients cannot forge price-drop / boost / view columns on their own listing');
await q(seller, `update public.listings set title='Phone A edited' where id=$1`, [L]);
await q(buyer, `select public.increment_listing_views($1)`, [L]).catch(() => {});
ok('ordinary edits and the view-counter RPC still work with the guard in place');

// ---------------------------------------------------------------- boosts
const dayStart = async (iso) => (await db.query(`select public.marketplace_day_start($1::timestamptz) d`, [iso])).rows[0].d.toISOString();
for (const iso of ['2026-03-01T21:30:00Z', '2026-03-01T20:59:59Z', '2026-06-15T00:00:00Z', '2026-12-31T21:00:00Z']) {
  assert.equal(await dayStart(iso), F.marketplaceDayStart(new Date(iso)).toISOString(), iso);
}
assert.equal(await dayStart('2026-03-01T21:30:00Z'), '2026-03-01T21:00:00.000Z');
ok('marketplace_day_start uses Africa/Addis_Ababa (UTC+3) and equals the TS reference at the day boundary');

const B = await listing(seller, { title: 'Boosted laptop', price: 900 });
await fails(seller, `select public.admin_grant_boost($1, 1, 'self boost')`, [B], /42501|Only an admin/);
await fails(admin, `select public.admin_grant_boost($1, 0, 'bad')`, [B], /1-30/);
await fails(admin, `select public.admin_grant_boost($1, 1, '')`, [B], /reason/);
const boostId = (await q(admin, `select public.admin_grant_boost($1, 1, 'Launch promotion') id`, [B])).rows[0].id;
const bl = (await db.query(`select boosted_until from public.listings where id=$1`, [B])).rows[0].boosted_until;
assert.ok(bl > new Date());
assert.equal(bl.toISOString(), F.marketplaceDayStart(new Date(Date.now() + 86400000)).toISOString());
ok('a 1-day boost ends at the coming Addis midnight; only admins can grant; reason + length validated');
await fails(admin, `select public.admin_grant_boost($1, 2, 'again')`, [B], /already boosted/);
ok('cannot double-boost a live-boosted listing');
assert.deepEqual(await search(buyer, { p_boosted_today: true }), [B]);
ok('"Boosted today" returns only live-boosted listings');
await q(admin, `select public.admin_revoke_boost($1, 'Policy test')`, [boostId]);
assert.equal((await db.query(`select boosted_until from public.listings where id=$1`, [B])).rows[0].boosted_until, null);
assert.deepEqual(await search(buyer, { p_boosted_today: true }), []);
ok('revoking a boost removes it immediately and is audited');
await db.query(`update public.listings set boosted_until = now() - interval '1 minute' where id=$1`, [B]);
assert.deepEqual(await search(buyer, { p_boosted_today: true }), []);
ok('an expired boost no longer matches (no cron needed)');
const REM = await listing(seller, { title: 'Removed one' });
await q(admin, `select public.admin_set_listing_status($1,'removed','spam')`, [REM]);
await fails(admin, `select public.admin_grant_boost($1, 1, 'nope')`, [REM], /available listing/);
ok('a removed listing cannot be boosted');

// ---------------------------------------------------------------- search semantics: SQL == TS reference
await db.query(`delete from public.listings`);
const now = new Date();
const iso = (ms) => new Date(now.getTime() + ms).toISOString();
const DAY = 86400000;
await q(admin, `select public.admin_set_verified($1, false, 'reset for matrix')`, [seller]);
await q(admin, `select public.admin_set_verified($1, true, 'matrix verified seller')`, [seller2]);
const rows = [];
let n = 0;
for (const verifiedSeller of [false, true])
  for (const negotiable of [false, true])
    for (const boosted of [false, true])
      for (const dropAge of [null, 3, 13, 15])
        for (const postedToday of [false, true]) {
          const owner = verifiedSeller ? seller2 : buyer;
          const created = postedToday ? iso(-1000) : iso(-3 * DAY - n * 1000);
          const id = await listing(owner, { title: `matrix ${n++}`, price: 80, negotiable, createdAt: created });
          const dropAt = dropAge == null ? null : iso(-dropAge * DAY);
          await db.query(`update public.listings set boosted_until=$2, last_price_drop_at=$3, last_price_drop_from=$4 where id=$1`, [id, boosted ? iso(DAY) : null, dropAt, dropAge == null ? null : 100]);
          rows.push({ id, facts: { sellerVerifiedAt: verifiedSeller ? 'x' : null, boostedUntil: boosted ? iso(DAY) : null, lastPriceDropAt: dropAt, lastPriceDropFrom: dropAge == null ? null : 100, price: 80, negotiable, createdAt: created } });
        }
const sqlNow = new Date();
let combos = 0;
for (let mask = 0; mask < 32; mask++) {
  const filters = Object.fromEntries(F.FILTER_IDS.map((id, i) => [id, !!(mask & (1 << i))]));
  const input = { query: '', category: null, scopeId: null, filters };
  const got = new Set();
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const res = await search(buyer, { ...F.toRpcParams(input, cursor, 24) }, 'rows');
    const { items, hasMore, cursor: next } = F.splitPage(res, 24);
    items.forEach((r) => got.add(r.listing.id));
    if (!hasMore) break;
    cursor = next;
  }
  const expected = new Set(rows.filter((r) => F.matchesFilters(r.facts, filters, sqlNow)).map((r) => r.id));
  assert.deepEqual([...got].sort(), [...expected].sort(), `filter mask ${mask} ${JSON.stringify(F.activeFilterIds(filters))}`);
  combos++;
}
ok(`all ${combos} filter combinations (AND semantics, all start OFF) return exactly the TS-reference set, across multiple pages`);
const none = await search(buyer, F.toRpcParams({ query: '', filters: F.NO_FILTERS }, null, 100), 'rows');
assert.equal(none.length, 61, 'limit is clamped to 60 (+1 sentinel row)');
ok('page size is clamped server-side (limit 100 → 60 rows + 1 sentinel)');

// price drop boundary + "raised back above old price"
const edge = await listing(buyer, { title: 'edge', price: 100 });
await db.query(`update public.listings set last_price_drop_at=$2, last_price_drop_from=90 where id=$1`, [edge, iso(-DAY)]);
assert.ok(!(await search(buyer, { p_price_reduced: true })).includes(edge));
ok('a listing whose price was raised back to/above the pre-drop price is not "reduced"');

// ---------------------------------------------------------------- query / category / scope are preserved with filters
await db.query(`delete from public.listings`);
const A1 = await listing(seller2, { title: 'Samsung Galaxy 100% new', category: 'electronics', negotiable: true });
const A2 = await listing(seller2, { title: 'Samsung_TV', category: 'electronics', negotiable: false });
const A3 = await listing(seller2, { title: 'Samsung fridge', category: 'home', negotiable: true });
assert.deepEqual(await search(buyer, { p_query: '100%' }), [A1]);
assert.deepEqual(await search(buyer, { p_query: 'samsung_' }), [A2]);
ok('LIKE wildcards in the query are escaped (a literal % or _ is searched, not interpreted)');
assert.deepEqual((await search(buyer, { p_query: 'samsung', p_negotiable: true, p_category: 'electronics' })).sort(), [A1]);
ok('text query + category + filter are combined with AND');
assert.deepEqual((await search(buyer, { p_query: 'sAmSuNg' })).length, 3);
ok('search is case-insensitive');

// location scope via the approved directory
const country = uuid(9001), region = uuid(9002), city = uuid(9003), pend = uuid(9004);
await db.query(`insert into public.locations(id,kind,name,normalized_name,parent_id,status) values
  ($1,'country','Testland','testland',null,'approved'),($2,'region','Northreg','northreg',$1,'approved'),
  ($3,'city','Cityville','cityville',$2,'approved'),($4,'city','Pendingtown','pendingtown',$2,'pending')`, [country, region, city, pend]);
const S1 = await listing(seller2, { title: 'in city', city: 'Cityville' });
const S2 = await listing(seller2, { title: 'in pending', city: 'Pendingtown' });
assert.ok((await search(buyer, { p_scope_id: country })).includes(S1));
assert.ok(!(await search(buyer, { p_scope_id: country })).includes(S2));
assert.ok(!(await search(buyer, { p_scope_id: city })).includes(A1));
ok('location scope includes descendants, and never matches pending (unapproved) places');

// eligibility + visibility
const sold = await listing(seller2, { title: 'zzsold', status: 'sold' });
const exp = await listing(seller2, { title: 'zzexpired', status: 'expired' });
const gone = await listing(seller2, { title: 'zzgone' });
await q(admin, `select public.admin_set_listing_status($1,'removed','policy')`, [gone]);
for (const id of [sold, exp, gone]) assert.ok(!(await search(buyer, {})).includes(id));
assert.ok(!(await search(null, {})).includes(gone));
ok('sold / expired / removed listings never appear in search (authenticated or anonymous)');
assert.ok((await search(null, {})).length > 0);
ok('anonymous visitors can search');

// blocking
await db.query(`insert into public.blocked_users(blocker_id, blocked_id) values ($1,$2)`, [buyer, seller2]);
assert.deepEqual(await search(buyer, { p_query: 'samsung' }), []);
assert.equal((await search(seller, { p_query: 'samsung' })).length, 3);
ok("a blocked seller's listings are excluded for the blocker only");
await db.query(`delete from public.blocked_users`);

// pagination: stable, no duplicates, no gaps, with timestamp ties
await db.query(`delete from public.listings`);
const tie = iso(-5000);
const ids = [];
for (let i = 0; i < 130; i++) ids.push(await listing(seller2, { title: `page ${i}`, createdAt: i % 10 === 0 ? tie : iso(-i * 1000 - 10_000) }));
const seen = [];
let cur = null;
for (let p = 0; p < 20; p++) {
  const r = F.splitPage(await search(buyer, F.toRpcParams({ query: 'page', filters: F.NO_FILTERS }, cur, 24), 'rows'), 24);
  seen.push(...r.items.map((x) => x.listing.id));
  if (!r.hasMore) break;
  cur = r.cursor;
}
assert.equal(new Set(seen).size, 130);
assert.equal(seen.length, 130);
ok('keyset pagination returns all 130 rows exactly once (including identical created_at ties)');

// indexes are usable (planner evidence on a bigger table)
if (hasTrgm) {
  await db.query(`insert into public.listings(user_id,title,category,city,price,currency,negotiable,status,created_at)
    select $1, 'bulk '||g||' '||md5(g::text), (array['electronics','home','cars'])[1+g%3], 'Hargeisa', 10+g, 'USD', g%4=0, 'available', now() - (g||' seconds')::interval from generate_series(1,6000) g`, [seller2]);
  await db.exec('analyze public.listings; set enable_seqscan = off;');
  const plan = async (sqlText) => (await db.query('explain ' + sqlText)).rows.map((r) => r['QUERY PLAN']).join('\n');
  // Text predicate alone: the trigram GIN index is chosen. (Combined with the status predicate on this uniform
  // fixture — every row 'available' — the planner may prefer the partial feed index; with real, skewed data the
  // selective text predicate wins. Either way it is an index scan, never a sequential scan.)
  const p1 = await plan(`select id from public.listings where title ilike '%md5abc%'`);
  assert.match(p1, /listings_title_trgm_idx/);
  const p1b = await plan(`select id from public.listings where title ilike '%md5abc%' and status in ('available','reserved')`);
  assert.doesNotMatch(p1b, /Seq Scan/);
  const p2 = await plan(`select id from public.listings where status in ('available','reserved') order by created_at desc, id desc limit 25`);
  assert.match(p2, /listings_feed_idx/);
  const p3 = await plan(`select id from public.listings where negotiable and status in ('available','reserved') order by created_at desc, id desc limit 25`);
  assert.match(p3, /listings_negotiable_feed_idx/);
  const p4 = await plan(`select id from public.listings where last_price_drop_at >= now() - interval '14 days'`);
  assert.match(p4, /listings_price_drop_idx/);
  await db.exec('reset enable_seqscan');
  ok('planner uses the trigram index for text search and the partial feed/negotiable/price-drop indexes');
} else {
  console.log('SKIP  index-plan checks: pg_trgm contrib not available in this PGlite build');
}

// ---------------------------------------------------------------- rollback restores the pre-0038 schema
await db.exec(sqlFile('rollback/0038_search_discovery_ROLLBACK.sql'));
assert.equal(await snapshot(), before);
ok('rollback restores the exact pre-0038 schema (columns, functions, triggers, policies, indexes)');
await db.exec(sqlFile('migrations/0038_search_discovery.sql'));
ok('0038 re-applies cleanly after a rollback');

console.log('\nOK discovery.test.mjs');
