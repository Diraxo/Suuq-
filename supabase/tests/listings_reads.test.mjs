// 0043 — targeted listing reads + two-way block enforcement, on a REAL Postgres (PGlite) with the real migration chain.
// Proves: (1) the reverse-block gap exists before 0043 (pinned), (2) after 0043 a block hides listings in BOTH directions
// across every read path, (3) blocked_users stays private and the helper leaks nothing about third parties, (4) the by-id
// / seller / comparable / saved-search reads return exactly what the old startup query would have for the same rows,
// (5) the base-table residual gap is pinned (closed by proposed 0044, tested in block_enforcement.test.mjs), (6) the rollback restores the old behaviour.
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, uuid, sqlFile } from './harness/db.mjs';

const { db } = await boot({ upTo: '0042' });
const { q, fails } = actors(db);
const [admin, alice, bob, carol, dave] = await seedUsers(db, 5); // alice blocks bob; carol/dave are bystanders
await db.query(`insert into public.admin_users(user_id) values ($1)`, [admin]);
await db.exec("select set_config('suuqplus.skip_rate_limit','true',false)");

let seq = 500;
async function listing(owner, o = {}) {
  const id = uuid(++seq);
  await db.query(
    `insert into public.listings (id,user_id,title,category,subcategory,city,price,currency,status,created_at)
     values ($1,$2,$3,$4,$5,'Hargeisa',$6,'USD',$7,$8)`,
    [id, owner, o.title ?? 'Item ' + seq, o.category ?? 'electronics', o.subcategory ?? null, o.price ?? 100, o.status ?? 'available', o.createdAt ?? new Date(Date.now() - (1000 - seq) * 60000).toISOString()]
  );
  return id;
}
const aliceL = await listing(alice, { title: 'Alice laptop', subcategory: 'Laptops' });
const aliceL2 = await listing(alice, { title: 'Alice phone', category: 'phones' });
const bobL = await listing(bob, { title: 'Bob laptop', subcategory: 'Laptops' });
const carolL = await listing(carol, { title: 'Carol laptop', subcategory: 'Laptops' });
const carolSold = await listing(carol, { title: 'Carol sold laptop', status: 'sold' });
const carolRemoved = await listing(carol, { title: 'Carol removed laptop', status: 'available' });
await db.query(`update public.listings set status='removed' where id=$1`, [carolRemoved]); // service-level write (not a client)
const daveReserved = await listing(dave, { title: 'Dave reserved', status: 'reserved' });
await db.query(`insert into public.blocked_users(blocker_id, blocked_id) values ($1,$2)`, [alice, bob]);

const ids = (rows) => rows.map((r) => r.listing?.id ?? r.id).sort();
const feed = async (uid, tab = 'latest') => ids((await q(uid, `select * from public.home_feed(p_tab => $1, p_limit => 60)`, [tab])).rows);
const search = async (uid, query = null) => ids((await q(uid, `select * from public.search_listings(p_query => $1, p_limit => 60)`, [query])).rows);

// ---------------------------------------------------------------- BEFORE 0043: the gap, pinned
assert.ok(!(await feed(alice)).includes(bobL), 'the blocker does not see the blocked user (own blocks work)');
assert.ok((await feed(bob)).includes(aliceL), 'BEFORE 0043 the blocked user still sees the blocker in the home feed');
assert.ok((await search(bob)).includes(aliceL), 'BEFORE 0043 the blocked user still sees the blocker in search');
assert.equal((await q(bob, `select count(*)::int c from public.blocked_users`)).rows[0].c, 0);
ok('before 0043: blocker is hidden from nobody-but-self; the blocked user still sees the blocker (the gap), and cannot read blocked_users');

// ---------------------------------------------------------------- apply 0043
await db.exec(sqlFile('migrations/0043_targeted_listing_reads.sql'));
ok('0043 applies on top of 0001..0042');
await db.exec(sqlFile('migrations/0043_targeted_listing_reads.sql'));
ok('0043 is re-runnable (idempotent)');

// ---------------------------------------------------------------- both directions, every read path
for (const tab of ['latest', 'trending', 'nearby', 'price', 'price_drops']) {
  const a = await feed(alice, tab);
  const b = await feed(bob, tab);
  const c = await feed(carol, tab);
  assert.ok(!a.includes(bobL), `${tab}: blocker no longer sees the blocked user`);
  assert.ok(!b.includes(aliceL) && !b.includes(aliceL2), `${tab}: blocked user no longer sees the blocker`);
  if (tab === 'latest') assert.ok(c.includes(aliceL) && c.includes(bobL), 'a bystander sees both');
}
ok('home_feed hides a block in both directions on every tab (static SQL and the dynamic ranked path); bystanders unaffected');

assert.ok(!(await search(alice)).includes(bobL) && !(await search(bob)).includes(aliceL));
assert.ok((await search(carol)).includes(aliceL) && (await search(carol)).includes(bobL));
ok('search_listings hides a block in both directions');

const cur = async (uid) => (await q(uid, `select code, n::int n from public.home_feed_currencies()`)).rows;
const totalFor = async (uid) => (await cur(uid)).reduce((s, r) => s + r.n, 0);
assert.equal((await totalFor(bob)) + 2, await totalFor(carol), 'bob does not count alice\'s 2 listings');
assert.equal((await totalFor(alice)) + 1, await totalFor(carol), 'alice does not count bob\'s listing');
ok('home_feed_currencies counts exclude a block in both directions');

const byIds = async (uid, list) => ids((await q(uid, `select * from public.listings_by_ids($1::uuid[])`, [list])).rows);
const all = [aliceL, aliceL2, bobL, carolL, carolSold, carolRemoved, daveReserved, uuid(999999)];
assert.deepEqual(await byIds(carol, all), [aliceL, aliceL2, bobL, carolL, carolSold, daveReserved].sort(), 'bystander: everything visible incl. sold/reserved; removed + unknown absent');
assert.deepEqual(await byIds(bob, all), [bobL, carolL, carolSold, daveReserved].sort(), 'blocked user: no alice listings (even by direct id)');
assert.deepEqual(await byIds(alice, all), [aliceL, aliceL2, carolL, carolSold, daveReserved].sort(), 'blocker: no bob listing; own listings present');
assert.deepEqual(await byIds(null, all), [aliceL, aliceL2, bobL, carolL, carolSold, daveReserved].sort(), 'guest: no blocks, visible rows only');
assert.deepEqual(await byIds(admin, [carolRemoved]), [], 'removed/deactivated stay hidden here even for staff (same rule as the old startup query)');
assert.deepEqual(await byIds(carol, [carolRemoved]), [], 'and for the owner');
ok('listings_by_ids: batch result == visible rows; sold/reserved kept; removed/unknown/blocked absent; guest ok');

// A blocked listing and a missing listing are indistinguishable in a single response.
assert.deepEqual((await q(bob, `select * from public.listings_by_ids($1::uuid[])`, [[aliceL]])).rows, (await q(bob, `select * from public.listings_by_ids($1::uuid[])`, [[uuid(888888)]])).rows);
ok('a listing hidden by a block returns exactly what a non-existent id returns (no "blocked" signal)');

assert.deepEqual(await byIds(carol, []), []);
assert.deepEqual((await q(carol, `select * from public.listings_by_ids(null)`)).rows, []);
await fails(carol, `select * from public.listings_by_ids($1::uuid[])`, [Array.from({ length: 201 }, (_, i) => uuid(i + 1))], /Too many ids/);
assert.equal((await q(carol, `select * from public.listings_by_ids($1::uuid[])`, [Array.from({ length: 200 }, (_, i) => uuid(i + 1))])).rows.length, 0);
ok('listings_by_ids: empty/null ok, 200 ids ok, 201 rejected with a clear error (never silently truncated)');

const sellerRows = async (uid, seller, limit = 100) => ids((await q(uid, `select * from public.seller_listings($1,$2)`, [seller, limit])).rows);
assert.deepEqual(await sellerRows(carol, alice), [aliceL, aliceL2].sort());
assert.deepEqual(await sellerRows(bob, alice), [], 'blocked user opens the blocker\'s profile -> no listings');
assert.deepEqual(await sellerRows(alice, bob), [], 'blocker opens the blocked user\'s profile -> no listings');
assert.deepEqual(await sellerRows(carol, carol), [carolL, carolSold].sort(), 'removed excluded, sold kept');
assert.equal((await q(carol, `select * from public.seller_listings($1,1)`, [carol])).rows.length, 2, 'asks limit+1 so the client can tell there is more');
assert.deepEqual((await q(carol, `select * from public.seller_listings(null,10)`)).rows, []);
ok('seller_listings: both block directions, removed excluded, limit+1 semantics, null seller');

const comp = async (uid, cat, sub, excl, lim = 60) => ids((await q(uid, `select * from public.comparable_listings($1,$2,$3,$4)`, [cat, sub, excl, lim])).rows);
assert.deepEqual(await comp(carol, 'electronics', 'Laptops', carolL), [aliceL, bobL].sort(), 'available only, excludes self, no sold/removed');
assert.deepEqual(await comp(bob, 'electronics', 'Laptops', null), [bobL, carolL].sort(), 'blocked user: alice excluded, own listing kept');
assert.deepEqual(await comp(alice, 'electronics', 'Laptops', null), [aliceL, carolL].sort());
const order = (await q(carol, `select * from public.comparable_listings('electronics', 'Laptops', null, 60)`)).rows.map((r) => r.listing.id);
assert.equal(order.length, 3);
assert.deepEqual(await comp(carol, '', null, null), []);
assert.deepEqual(await comp(carol, null, null, null), []);
ok('comparable_listings: category+available only, excludes the given id and blocked users (both directions)');
// same-subcategory first, then newest, then cap
const other = await listing(carol, { title: 'Newest other-sub', subcategory: 'Desktops', createdAt: new Date().toISOString() });
const capped = (await q(carol, `select * from public.comparable_listings('electronics', 'Laptops', null, 3)`)).rows.map((r) => r.listing.id);
assert.ok(!capped.includes(other), 'a newer row from another subcategory does not displace same-subcategory rows when capped');
assert.equal((await q(carol, `select * from public.comparable_listings('electronics', 'Laptops', null, 1000)`)).rows.length <= 100, true);
ok('comparable_listings: same-subcategory rows win a capped sample; cap clamped to 100');

const counts = async (uid, qs) => Object.fromEntries((await q(uid, `select query, n from public.saved_search_counts($1::text[])`, [qs])).rows.map((r) => [r.query, r.n]));
await listing(carol, { title: '100% cotton' });
assert.deepEqual(await counts(carol, ['laptop', 'PHONE', 'zzz', '', '  ']), { laptop: 4, PHONE: 1, zzz: 0, '': 0, '  ': 0 });
assert.equal((await counts(bob, ['laptop'])).laptop, 3, 'bob: no Alice, no removed');
assert.deepEqual(await counts(carol, ['%', '_']), { '%': 1, _: 0 }, 'LIKE wildcards in the query are literal');
assert.equal(Object.keys(await counts(carol, Array.from({ length: 30 }, (_, i) => 'q' + i))).length, 20, 'only 20 searches answered per call');
ok('saved_search_counts: case-insensitive, wildcard-safe, blocks excluded, blank = 0, max 20 per call');

// ---------------------------------------------------------------- blocked_users stays private; the helper leaks nothing
assert.equal((await q(bob, `select count(*)::int c from public.blocked_users`)).rows[0].c, 0, 'blocked user cannot read the block row');
assert.equal((await q(alice, `select count(*)::int c from public.blocked_users`)).rows[0].c, 1, 'blocker sees own block');
assert.equal((await q(carol, `select count(*)::int c from public.blocked_users`)).rows[0].c, 0);
await fails(bob, `insert into public.blocked_users(blocker_id, blocked_id) values ($1,$2)`, [alice, carol], /row-level security|42501/);
await q(bob, `delete from public.blocked_users where blocker_id = $1`, [alice]);
assert.equal((await db.query(`select count(*)::int c from public.blocked_users`)).rows[0].c, 1, 'a blocked user cannot lift the block');
const helper = async (uid) => (await q(uid, `select private.blocked_either_way() as v`)).rows[0].v;
assert.deepEqual(await helper(alice), [bob]);
assert.deepEqual(await helper(bob), [alice]);
assert.deepEqual(await helper(carol), [], 'a bystander learns nothing about alice/bob');
assert.deepEqual(await helper(null), [], 'guests have no blocks');
assert.equal((await db.query(`select count(*)::int c from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='blocked_either_way'`)).rows[0].c, 0, 'the helper is not in the API-exposed public schema');
ok('blocked_users stays private (own rows only, no lifting a block); the helper returns only the caller\'s own counterparties and is not in the public (API) schema');

// ---------------------------------------------------------------- unblock restores; new blocks apply immediately
await q(alice, `delete from public.blocked_users where blocked_id = $1`, [bob]);
assert.ok((await feed(bob)).includes(aliceL) && (await byIds(bob, [aliceL])).includes(aliceL));
await q(bob, `insert into public.blocked_users(blocker_id, blocked_id) values ($1,$2)`, [bob, carol]);
assert.ok(!(await feed(carol)).includes(bobL), 'bob blocks carol: carol (the blocked one) stops seeing bob');
assert.ok(!(await feed(bob)).includes(carolL));
await q(bob, `delete from public.blocked_users where blocked_id = $1`, [carol]);
await q(alice, `insert into public.blocked_users(blocker_id, blocked_id) values ($1,$2)`, [alice, bob]);
ok('unblock restores visibility; a block created later applies on the next read, either direction');

// ---------------------------------------------------------------- plan sanity (small data: shape, not volume)
const plan = (await db.query(`explain select to_jsonb(l.*) from public.listings l where l.id = any($1::uuid[]) and l.status not in ('removed','deactivated')`, [[aliceL, bobL]])).rows.map((r) => r['QUERY PLAN']).join('\n');
assert.match(plan, /listings_pkey|Index|Bitmap|Seq Scan/); // existence check only; real EXPLAIN on production volume is BLOCKED (see docs)
ok('by-id lookup plans (volume EXPLAIN is a staging step)');

// ---------------------------------------------------------------- base table: documented residual gap (closed by proposed 0044, see block_enforcement.test.mjs)
const direct = async (uid, id) => (await q(uid, `select id from public.listings where id = $1`, [id])).rows.length;
assert.equal(await direct(bob, aliceL), 1, 'with 0043 alone a direct table read by the blocked user still works (closed by proposed 0044)');
ok('residual gap pinned: base-table policy is unchanged by 0043');

// ---------------------------------------------------------------- rollback
await db.exec(sqlFile('rollback/0043_targeted_listing_reads_ROLLBACK.sql'));
await db.exec(sqlFile('rollback/0043_targeted_listing_reads_ROLLBACK.sql'));
assert.ok((await feed(bob)).includes(aliceL), 'after rollback the old (own-blocks-only) behaviour is back');
for (const fn of ['listings_by_ids', 'seller_listings', 'comparable_listings', 'saved_search_counts'])
  assert.equal((await db.query(`select count(*)::int c from pg_proc where proname = $1`, [fn])).rows[0].c, 0, `${fn} dropped`);
assert.equal((await db.query(`select count(*)::int c from pg_proc where proname = 'blocked_either_way'`)).rows[0].c, 0);
ok('rollback is re-runnable, drops the new functions and restores the 0038/0042 read paths');

// re-apply to leave nothing half-done and prove up-after-down works
await db.exec(sqlFile('migrations/0043_targeted_listing_reads.sql'));
assert.ok(!(await feed(bob)).includes(aliceL));
ok('0043 re-applies cleanly after a rollback');
process.exit(0);
