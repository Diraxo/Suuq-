// 0080 — seller-set discounts, on a REAL Postgres (PGlite) with the real migration chain.
// Proves: only the owner can set/end; 1%..90% bounds; 1-365 days (0081); one at a time; the old price must have been held 3 days;
// the client cannot write the discount columns or change the price while a discount runs; expiry is by clock (live ->
// not live with no job), settle puts the price back; end-early reverts; the badge flag / "Discounted" filter / Discounts
// tab agree; a plain price edit shows no badge; note rules; rollback leaves nothing discounted.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, actors, seedUsers, ok, uuid } from './harness/db.mjs';

const { db, applied } = await boot();
assert.ok(applied.includes('0080_seller_discounts.sql') && applied.includes('0081_discount_duration_forever.sql'));
const { q, fails } = actors(db);
const [seller, other, buyer] = await seedUsers(db, 3);
await db.exec("select set_config('suuqplus.skip_rate_limit','true',false)");

let seq = 900;
async function listing(price, o = {}) {
  const id = uuid(++seq);
  await db.query(
    `insert into public.listings (id,user_id,title,category,city,price,currency,status,images) values ($1,$2,$3,'electronics','Hargeisa',$4,'USD',$5,array['https://x.test/a.jpg'])`,
    [id, o.owner ?? seller, 'Item ' + seq, price, o.status ?? 'available']
  );
  // Published long ago (0082: only a price change AFTER publishing holds); heldDays 0 = the price was just changed.
  if (!o.fresh) await db.query(`update public.listings set created_at = now() - interval '60 days' where id=$1`, [id]);
  if (o.heldDays !== 0 && !o.fresh) await db.query(`update public.listings set price_changed_at = now() - make_interval(days => $2) where id=$1`, [id, o.heldDays ?? 10]);
  return id;
}
const set = (id, price, days = 7, note = null, who = seller) => q(who, `select public.set_listing_discount($1,$2,$3,$4) r`, [id, price, days, note]);
const end = (id, who = seller) => q(who, `select public.end_listing_discount($1) r`, [id]);
const row = async (id) => (await db.query(`select price::float p, discount_original_price::float o, discount_ends_at e, discount_note n, price_changed_at c from public.listings where id=$1`, [id])).rows[0];
const tab = async () => (await q(buyer, `select listing->>'id' id from public.home_feed(p_tab => 'price_drops', p_limit => 60)`)).rows.map((r) => r.id);
const flagged = async () => (await q(buyer, `select listing->>'id' id from public.search_listings(p_price_reduced => true, p_limit => 60)`)).rows.map((r) => r.id);
const badge = async (id) => (await q(buyer, `select price_reduced from public.search_listings(p_limit => 60) where listing->>'id'=$1`, [id])).rows[0]?.price_reduced;

// ---- happy path
const a = await listing(1000);
const r = (await set(a, 900, 7, '  Eid offer ')).rows[0].r;
assert.equal(r.price, 900); assert.equal(r.original_price, 1000); assert.equal(r.note, 'Eid offer');
let x = await row(a);
assert.equal(x.p, 900); assert.equal(x.o, 1000); assert.equal(x.n, 'Eid offer');
assert.ok(Math.abs(new Date(x.e) - Date.now() - 7 * 864e5) < 60_000);
assert.ok((await tab()).includes(a) && (await flagged()).includes(a) && (await badge(a)) === true);
assert.equal((await db.query(`select count(*)::int c from public.price_drops where listing_id=$1`, [a])).rows[0].c, 1, 'the favorites price-drop notification path still records the drop');
ok('owner sets a discount: price lowered, original/ends/note stored, shown by tab + filter + badge flag, price_drop recorded');

assert.ok(new Date(x.c) < new Date(Date.now() - 9 * 864e5), 'price_changed_at kept (10 days ago), not reset to now');
ok("starting a discount does not restart the original price's held clock");

// ---- one at a time, owner only
await fails(seller, `select public.set_listing_discount($1,800,7,null)`, [a], /already running/);
await fails(other, `select public.set_listing_discount($1,500,7,null)`, [await listing(1000)], /Listing not found/);
await fails(other, `select public.end_listing_discount($1)`, [a], /Listing not found/);
await fails(null, `select public.set_listing_discount($1,500,7,null)`, [a], /permission denied|Sign in/);
ok('one active discount per listing; only the owner can set or end; anon refused');

// ---- bounds
const b = await listing(1000);
for (const [p, d, re] of [
  [1000, 7, /lower/], [1200, 7, /lower/], [995, 7, /at least 1%/], [99, 7, /at most 90%/],
  [0, 7, /whole number/], [500.5, 7, /whole number/], [500, 0, /1 to 365/], [500, 366, /1 to 365/], [500, null, /1 to 365/],
]) await fails(seller, `select public.set_listing_discount($1,$2,$3,null)`, [b, p, d], re);
assert.equal((await row(b)).o, null);
await set(b, 990, 1); await end(b);
await db.query(`update public.listings set price_changed_at = now() - interval '10 days' where id=$1`, [b]);
await set(b, 100, 30);
ok('bounds: <1% and >90% refused, 1% and 90% accepted; 1..365 days; whole numbers only');

// ---- held-for-3-days rule
const fresh = await listing(1000, { heldDays: 0 });
await fails(seller, `select public.set_listing_discount($1,800,7,null)`, [fresh], /changed recently/);
await db.query(`update public.listings set price_changed_at = now() - interval '2 days 23 hours' where id=$1`, [fresh]);
await fails(seller, `select public.set_listing_discount($1,800,7,null)`, [fresh], /changed recently/);
await db.query(`update public.listings set price_changed_at = now() - interval '3 days 1 minute' where id=$1`, [fresh]);
await set(fresh, 800, 3);
const trick = await listing(500);
await q(seller, `update public.listings set price=1000 where id=$1`, [trick]);
await fails(seller, `select public.set_listing_discount($1,500,7,null)`, [trick], /changed recently/);
ok('price must have been held 3 days (2d23h refused, 3d accepted); raising a price then discounting it is refused');

// ---- status
for (const st of ['sold', 'reserved']) await fails(seller, `select public.set_listing_discount($1,800,7,null)`, [await listing(1000, { status: st })], /available/);
ok('sold / reserved listings cannot be discounted');

// ---- client cannot forge or edit around it
const c = await listing(1000);
await set(c, 800, 7);
for (const sql of [`discount_ends_at = now() + interval '400 days'`, `discount_original_price = 5000`, `discount_note = 'x'`, `price_changed_at = now() - interval '99 days'`, `discount_started_at = now()`])
  await fails(seller, `update public.listings set ${sql} where id=$1`, [c], /Protected listing column|42501/);
await fails(seller, `update public.listings set price = 1500 where id=$1`, [c], /End the discount before changing the price/);
await fails(seller, `update public.listings set price = 700, currency='ETB' where id=$1`, [c], /End the discount/);
await q(seller, `update public.listings set title='New title' where id=$1`, [c]);
const forged = uuid(++seq);
await q(seller, `insert into public.listings (id,user_id,title,category,city,price,currency,status,images,discount_original_price,discount_started_at,discount_ends_at,discount_note,price_changed_at)
  values ($1,$2,'Forged','electronics','Hargeisa',50,'USD','available',array['https://x.test/a.jpg'],1000,now(),now()+interval '9 days','fake', now() - interval '99 days')`, [forged, seller]);
const f = await row(forged);
assert.equal(f.o, null); assert.equal(f.n, null); assert.ok(new Date(f.c) > new Date(Date.now() - 60_000));
assert.ok(!(await tab()).includes(forged));
ok('client cannot write discount columns or price_changed_at (update or insert); price frozen while running; other edits fine');

// ---- end early reverts
const e1 = await end(c);
assert.equal(e1.rows[0].r.price, 1000); assert.equal((await row(c)).p, 1000); assert.equal((await row(c)).o, null);
assert.ok(!(await tab()).includes(c) && (await badge(c)) === false);
assert.equal((await end(c)).rows[0].r.ended, false, 'ending again is a harmless no-op');
assert.equal((await q(seller, `select public.set_listing_discount($1,800,7,null) r`, [c])).rows[0].r.price, 800, 'a new discount right after ending (0084)');
await end(c);
ok('end early: price back to original, no badge anywhere, idempotent; a new discount can start at once');

// ---- expiry by clock, then settle
const d = await listing(1000); await set(d, 800, 3);
await db.query(`update public.listings set discount_ends_at = now() - interval '1 minute', discount_started_at = now() - interval '3 days' where id=$1`, [d]);
assert.ok(!(await tab()).includes(d) && !(await flagged()).includes(d) && (await badge(d)) === false);
assert.equal((await row(d)).p, 800, 'not yet settled: row still stores the low price (clients show the original)');
assert.equal((await q(other, `select public.settle_my_expired_discounts() n`)).rows[0].n, 0, 'someone else settles nothing of mine');
assert.equal((await q(seller, `select public.settle_my_expired_discounts() n`)).rows[0].n, 1);
x = await row(d); assert.equal(x.p, 1000); assert.equal(x.o, null);
await fails(seller, `select public.settle_expired_discounts()`, [], /permission denied/);
ok('expiry is by clock (not live the instant it ends, no job); settle restores the price; owner-scoped; global settle is not callable by users');

const g = await listing(1000); await set(g, 800, 3);
await db.query(`update public.listings set discount_ends_at = now() - interval '1 minute', discount_started_at = now() - interval '3 days' where id=$1`, [g]);
await q(seller, `update public.listings set price = 900 where id=$1`, [g]);
x = await row(g); assert.equal(x.p, 900); assert.equal(x.o, null);
ok("editing the price after a discount expired (unsettled) keeps the seller's price and clears the stale discount");

// ---- plain price edit: no badge
const h = await listing(1000);
await q(seller, `update public.listings set price = 800 where id=$1`, [h]);
assert.ok(!(await tab()).includes(h) && !(await flagged()).includes(h) && (await badge(h)) === false);
ok('a normal price edit shows no badge and is not in the Discounts tab');

// ---- note rules
const n = await listing(1000);
await fails(seller, `select public.set_listing_discount($1,800,7,$2)`, [n, 'x'.repeat(61)], /at most 60/);
await fails(seller, `select public.set_listing_discount($1,800,7,$2)`, [n, 'bad\u0007note'], /special characters/);
assert.equal((await set(n, 800, 7, '   ')).rows[0].r.note, null);
ok('note: 60 chars max, control characters refused, blank = none');

// ---- suspended account
const sus = await listing(1000);
await db.query(`update public.profiles set account_status='suspended', suspended_until = now() + interval '5 days' where id=$1`, [seller]);
await fails(seller, `select public.set_listing_discount($1,800,7,null)`, [sus], /cannot set discounts/);
await db.query(`update public.profiles set account_status='active', suspended_until=null where id=$1`, [seller]);
ok('a suspended account cannot set discounts');

// ---- rollback
const live = await listing(1000); await set(live, 700, 7);
await db.exec(readFileSync(new URL('../rollback/0081_discount_duration_forever_ROLLBACK.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../rollback/0080_seller_discounts_ROLLBACK.sql', import.meta.url), 'utf8'));
assert.equal((await db.query(`select price::float p from public.listings where id=$1`, [live])).rows[0].p, 1000);
assert.equal((await db.query(`select count(*)::int c from information_schema.columns where table_name='listings' and column_name like 'discount_%'`)).rows[0].c, 0);
assert.equal((await db.query(`select to_regprocedure('public.set_listing_discount(uuid,numeric,int,text,boolean)') r`)).rows[0].r, null);
await q(seller, `update public.listings set price = 123 where id=$1`, [live]);
assert.ok((await q(buyer, `select 1 from public.search_listings(p_limit => 5)`)).rows.length > 0);
await q(buyer, `select * from public.home_feed(p_tab => 'price_drops')`);
ok('rollback: live discounts settled to the original price, columns and functions gone, reads work again');
console.log('\nALL CHECKS PASSED');
