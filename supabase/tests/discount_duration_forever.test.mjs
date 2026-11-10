// 0081 — custom discount duration (1..365 days) and "until I end it", on a REAL Postgres (PGlite) with the real chain.
// Proves: 40/77/365 days accepted and stored to the instant; 0, negative, 366, missing, decimal refused; forever stores no
// expiry (ends_at null + explicit flag) and stays live far past any finite window; settling never touches it; early end
// and the 3-day price hold apply to it; the client cannot forge or edit around it (flag, price, currency); the cooldown
// message carries the exact instant it ends; two simultaneous attempts leave exactly one discount; the 4-argument call
// shape that shipped apps use still works; rollback ends permanent discounts and restores 0080.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, actors, seedUsers, ok, uuid } from './harness/db.mjs';

const { db, applied } = await boot();
assert.ok(applied.includes('0081_discount_duration_forever.sql') && applied.includes('0082_discount_new_listing_no_hold.sql') && applied.includes('0083_discount_edit.sql') && applied.includes('0084_discount_end_no_hold.sql'));
const { q, fails } = actors(db);
const [seller, other, buyer] = await seedUsers(db, 3);
await db.exec("select set_config('suuqplus.skip_rate_limit','true',false)");

let seq = 1900;
async function listing(price, o = {}) {
  const id = uuid(++seq);
  await db.query(
    `insert into public.listings (id,user_id,title,category,city,price,currency,status,images) values ($1,$2,$3,'electronics','Hargeisa',$4,'USD',$5,array['https://x.test/a.jpg'])`,
    [id, o.owner ?? seller, 'Item ' + seq, price, o.status ?? 'available']
  );
  // created_at is backdated further than the hold: only a price change AFTER creation holds (0082). o.fresh = a just-published listing.
  if (!o.fresh) await db.query(`update public.listings set created_at = now() - make_interval(days => $2 + 30), price_changed_at = now() - make_interval(days => $2) where id=$1`, [id, o.heldDays ?? 10]);
  return id;
}
const days = (id, price, d, note = null, who = seller) => q(who, `select public.set_listing_discount($1,$2,$3,$4) r`, [id, price, d, note]);
const forever = (id, price, note = null, who = seller) => q(who, `select public.set_listing_discount($1,$2,null,$3,true) r`, [id, price, note]);
const end = (id, who = seller) => q(who, `select public.end_listing_discount($1) r`, [id]);
const row = async (id) =>
  (await db.query(`select price::float p, discount_original_price::float o, discount_started_at s, discount_ends_at e, discount_permanent f, price_changed_at c from public.listings where id=$1`, [id])).rows[0];
const tab = async () => (await q(buyer, `select listing->>'id' id from public.home_feed(p_tab => 'price_drops', p_limit => 60)`)).rows.map((r) => r.id);
const flagged = async () => (await q(buyer, `select listing->>'id' id from public.search_listings(p_price_reduced => true, p_limit => 60)`)).rows.map((r) => r.id);
const badge = async (id) => (await q(buyer, `select price_reduced from public.search_listings(p_limit => 60) where listing->>'id'=$1`, [id])).rows[0]?.price_reduced;

// ---- custom durations
for (const d of [1, 40, 77, 365]) {
  const id = await listing(1000);
  const r = (await days(id, 900, d)).rows[0].r;
  const x = await row(id);
  assert.equal(r.permanent, false);
  assert.equal(new Date(x.e) - new Date(x.s), d * 864e5, `${d} days is exactly ${d} x 24h`);
  assert.equal(new Date(r.ends_at).getTime(), new Date(x.e).getTime());
  assert.ok((await tab()).includes(id) && (await badge(id)) === true);
}
ok('custom durations 1, 40, 77 and 365 days: stored to the exact instant, live in the tab, filter and badge');

for (const d of [0, -1, -30, 366, 100000, null]) {
  const id = await listing(1000);
  await fails(seller, `select public.set_listing_discount($1,900,$2,null)`, [id, d], /1 to 365 days/);
  assert.equal((await row(id)).o, null);
}
await fails(seller, `select public.set_listing_discount($1,900,7.5,null)`, [await listing(1000)], /does not exist|invalid input/);
ok('0, negative, 366, huge, missing and fractional durations are refused and change nothing');

// ---- forever
const f = await listing(60000);
const fr = (await forever(f, 54000, 'Special offer')).rows[0].r;
assert.equal(fr.permanent, true); assert.equal(fr.ends_at, null); assert.equal(fr.price, 54000); assert.equal(fr.original_price, 60000);
let x = await row(f);
assert.equal(x.e, null, 'no fabricated expiry'); assert.equal(x.f, true); assert.equal(x.p, 54000); assert.equal(x.o, 60000);
assert.ok((await tab()).includes(f) && (await flagged()).includes(f) && (await badge(f)) === true);
await db.query(`update public.listings set discount_started_at = now() - interval '900 days' where id=$1`, [f]);
assert.ok((await tab()).includes(f) && (await badge(f)) === true, 'still live 900 days later');
assert.equal((await q(seller, `select public.settle_my_expired_discounts() n`)).rows[0].n, 0);
assert.equal((await db.query(`select public.settle_expired_discounts() n`)).rows[0].n, 0, 'the global settle job does not touch it either');
assert.equal((await row(f)).p, 54000);
ok('forever: no expiry stored (flag + null), live in tab/filter/badge long after any finite window, never settled');

const fd = await listing(1000);
const fx = (await q(seller, `select public.set_listing_discount($1,800,5,null,true) r`, [fd])).rows[0].r;
assert.equal(fx.permanent, true); assert.equal(fx.ends_at, null, 'forever wins over a days value');
ok('forever ignores a days value');

// ---- price/currency lock, forged writes
await fails(seller, `update public.listings set price = 70000 where id=$1`, [f], /End the discount before changing the price/);
await fails(seller, `update public.listings set currency = 'ETB' where id=$1`, [f], /End the discount/);
await fails(seller, `update public.listings set price = 50, currency = 'ETB' where id=$1`, [f], /End the discount/);
for (const sql of [`discount_permanent = false`, `discount_ends_at = now() + interval '1 day'`, `discount_original_price = 99999`, `price_changed_at = now() - interval '99 days'`])
  await fails(seller, `update public.listings set ${sql} where id=$1`, [f], /Protected listing column|42501/);
const plain = await listing(1000);
await fails(seller, `update public.listings set discount_permanent = true where id=$1`, [plain], /Protected listing column|42501/);
const forged = uuid(++seq);
await q(seller, `insert into public.listings (id,user_id,title,category,city,price,currency,status,images,discount_original_price,discount_started_at,discount_permanent)
  values ($1,$2,'Forged','electronics','Hargeisa',50,'USD','available',array['https://x.test/a.jpg'],1000,now(),true)`, [forged, seller]);
x = await row(forged);
assert.equal(x.o, null); assert.equal(x.f, false); assert.ok(!(await tab()).includes(forged));
await q(other, `update public.listings set price = 1 where id=$1`, [f]);
assert.equal((await row(f)).p, 54000, 'a stranger cannot touch the price (row-level security)');
await fails(other, `select public.end_listing_discount($1)`, [f], /Listing not found/);
await fails(other, `select public.set_listing_discount($1,500,null,null,true)`, [await listing(1000)], /Listing not found/);
await fails(null, `select public.set_listing_discount($1,500,null,null,true)`, [plain], /permission denied|Sign in/);
await q(seller, `update public.listings set title='Renamed' where id=$1`, [f]);
ok('price and currency frozen while a permanent discount runs; the flag, ends_at, original and held-since cannot be forged by update or insert; strangers and anon refused');

// ---- cooldown: boundaries, message, forever does not bypass it
const hold = await listing(1000, { heldDays: 0 });
await db.query(`update public.listings set price_changed_at = now() - interval '2 days 23 hours' where id=$1`, [hold]);
const heldAt = (await row(hold)).c;
let msg = '';
try { await forever(hold, 800); } catch (e) { msg = e.message; }
assert.match(msg, /^(P0001 )?The price was changed recently\. You can set a discount from \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
const instant = /from (\S+)$/.exec(msg)[1];
assert.equal(new Date(instant).getTime(), Math.floor(new Date(heldAt).getTime() / 1000) * 1000 + 3 * 864e5, 'message names the exact instant the hold ends (UTC)');
assert.match(msg, /from \d{4}-\d{2}-\d{2}/, 'still begins with a date, so shipped apps keep working');
await fails(seller, `select public.set_listing_discount($1,800,7,null)`, [hold], /changed recently/);
await db.query(`update public.listings set price_changed_at = now() - interval '3 days 1 second' where id=$1`, [hold]);
await forever(hold, 800);
ok('cooldown unchanged: 2d23h refused (forever too), 3d accepted; the message carries the exact UTC instant');

// a genuine price change restarts the hold; ending a discount does NOT (0084)
const g = await listing(500);
await q(seller, `update public.listings set price = 1000 where id=$1`, [g]);
await fails(seller, `select public.set_listing_discount($1,500,null,null,true)`, [g], /changed recently/);
const e1 = await end(f);
assert.equal(e1.rows[0].r.price, 60000); assert.equal(e1.rows[0].r.ended, true);
x = await row(f);
assert.equal(x.p, 60000); assert.equal(x.o, null); assert.equal(x.f, false); assert.equal(x.e, null);
assert.ok(!(await tab()).includes(f) && (await badge(f)) === false);
assert.equal((await forever(f, 50000)).rows[0].r.permanent, true, 'a new discount right after ending (0084)');
await end(f);
ok('a raised price must be held 3 days before a forever discount; ending a forever discount restores the price, removes every badge and allows a new one at once');

// ---- availability: a sale ends the discount for good (reopening does not bring it back), bounds still apply
const av = await listing(1000);
await forever(av, 700);
await q(seller, `update public.listings set status='sold' where id=$1`, [av]);
assert.ok(!(await tab()).includes(av) && !(await flagged()).includes(av));
await q(seller, `update public.listings set status='available' where id=$1`, [av]);
assert.ok(!(await tab()).includes(av) && !(await flagged()).includes(av));
await fails(seller, `select public.set_listing_discount($1,500,null,null,true)`, [await listing(1000, { status: 'reserved' })], /available/);
const bnd = await listing(1000);
await fails(seller, `select public.set_listing_discount($1,99,null,null,true)`, [bnd], /at most 90%/);
await fails(seller, `select public.set_listing_discount($1,999,null,null,true)`, [bnd], /at least 1%/);
await fails(seller, `select public.set_listing_discount($1,1000,null,null,true)`, [bnd], /lower/);
ok('a permanent discount is shown only while the listing is available; the 1%..90% bounds apply to it');

// ---- simultaneous attempts leave exactly one discount
const sim = await listing(1000);
const res = await Promise.allSettled([forever(sim, 800), days(sim, 700, 7), forever(sim, 600)]);
assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1, 'exactly one attempt wins');
assert.ok(res.filter((r) => r.status === 'rejected').every((r) => /already running/.test(r.reason.message)));
assert.equal((await db.query(`select count(*)::int c from public.price_drops where listing_id=$1`, [sim])).rows[0].c, 1);
ok('simultaneous attempts: one wins, the rest are told a discount is already running (PGlite serialises; the SELECT ... FOR UPDATE is the cross-connection guard)');

// ---- finite long discounts still expire by the clock and settle
const long = await listing(1000); await days(long, 800, 77);
await db.query(`update public.listings set discount_ends_at = now() - interval '1 second', discount_started_at = now() - interval '77 days' where id=$1`, [long]);
assert.ok(!(await tab()).includes(long) && (await badge(long)) === false);
assert.equal((await q(seller, `select public.settle_my_expired_discounts() n`)).rows[0].n, 1);
assert.equal((await row(long)).p, 1000);
ok('a 77-day discount stops the instant it ends and settles back to the original price');

// ---- 0084: ending or expiring a discount does not start a hold; a real price edit still does
{
  const id = await listing(1000, { heldDays: 10 });
  await days(id, 800, 7);
  const held0 = (await row(id)).c;
  await end(id);
  let x = await row(id);
  assert.equal(x.p, 1000); assert.equal(new Date(x.c).getTime(), new Date(held0).getTime(), 'ending keeps the hold clock where it was');
  assert.equal((await days(id, 700, 30)).rows[0].r.price, 700, 'a new discount right after ending');
  await end(id);
  assert.equal((await forever(id, 600)).rows[0].r.permanent, true, 'and Forever right after ending again');
  await end(id);
  // a just-published listing: discount, end, discount again at once
  const fr = await listing(1000, { fresh: true });
  await days(fr, 900, 7); await end(fr);
  assert.equal((await days(fr, 850, 7)).rows[0].r.price, 850);
  // an expired discount settled by the database keeps the clock too
  const ex = await listing(1000, { heldDays: 10 });
  await days(ex, 800, 7);
  const heldE = (await row(ex)).c;
  await db.query(`update public.listings set discount_started_at = now() - interval '9 days', discount_ends_at = now() - interval '2 days' where id=$1`, [ex]);
  await db.query(`select public.settle_expired_discounts($1)`, [seller]);
  x = await row(ex);
  assert.equal(x.p, 1000); assert.equal(x.o, null); assert.equal(new Date(x.c).getTime(), new Date(heldE).getTime(), 'settling an expired discount keeps the clock');
  assert.equal((await days(ex, 900, 7)).rows[0].r.price, 900);
  // but the seller's own price edit still holds 3 days
  const ed = await listing(1000, { heldDays: 10 });
  await q(seller, `update public.listings set price=1200 where id=$1`, [ed]);
  await fails(seller, `select public.set_listing_discount($1,900,7,null)`, [ed], /changed recently/);
}
ok('0084: ending or expiring a discount keeps the price-hold clock, so another discount can start at once; a real price edit still holds 3 days');

// ---- 0083: editing a running discount (p_replace)
const edit = (id, price, d, note = null, who = seller, fv = false) =>
  q(who, `select public.set_listing_discount($1,$2,$3,$4,$5,true) r`, [id, price, d, note, fv]);
{
  const id = await listing(1000);
  await days(id, 800, 7, 'Eid offer');
  const held0 = (await row(id)).c;
  const r = (await edit(id, 900, 30, 'Weekend')).rows[0].r;
  let x = await row(id);
  assert.equal(r.original_price, 1000); assert.equal(x.p, 900); assert.equal(x.o, 1000, 'the original price stays the original');
  assert.equal(new Date(x.e) - new Date(x.s), 30 * 864e5, 'the new length counts from now');
  assert.equal((await db.query(`select discount_note n from public.listings where id=$1`, [id])).rows[0].n, 'Weekend');
  assert.equal(new Date(x.c).getTime(), new Date(held0).getTime(), 'editing does not restart the 3-day price hold');
  assert.ok((await tab()).includes(id) && (await badge(id)) === true);
  // to Forever and back, percent measured against the original (not the discounted price)
  assert.equal((await edit(id, 700, null, null, seller, true)).rows[0].r.permanent, true);
  x = await row(id); assert.equal(x.f, true); assert.equal(x.e, null); assert.equal(x.o, 1000); assert.equal(x.p, 700);
  assert.equal((await edit(id, 950, 14)).rows[0].r.price, 950); assert.equal((await row(id)).f, false);
  await fails(seller, `select public.set_listing_discount($1,1000,7,null,false,true)`, [id], /lower than the current price/);
  await fails(seller, `select public.set_listing_discount($1,99,7,null,false,true)`, [id], /at most 90%/);
  await fails(seller, `select public.set_listing_discount($1,995,7,null,false,true)`, [id], /at least 1%/);
  await fails(seller, `select public.set_listing_discount($1,800,400,null,false,true)`, [id], /1 to 365 days/);
  assert.equal((await row(id)).p, 950, 'refused edits change nothing');
  await end(id);
  assert.equal((await row(id)).p, 1000, 'ending after edits restores the original price');
  await fails(seller, `select public.set_listing_discount($1,800,7,null,false,true)`, [id], /No discount is running/);
}
{
  const id = await listing(1000); await days(id, 800, 7);
  await fails(other, `select public.set_listing_discount($1,700,7,null,false,true)`, [id], /Listing not found/);
  await q(seller, `update public.listings set status='reserved' where id=$1`, [id]);
  await fails(seller, `select public.set_listing_discount($1,700,7,null,false,true)`, [id], /available/);
  assert.equal((await row(id)).p, 800);
}
ok('0083: a running discount can be edited (percent, length, Forever, note) against the original price; no hold, rules unchanged, strangers and non-available refused');

// ---- 0082: a just-published listing can be discounted at once; a real price change after publishing still holds 3 days
{
  const id = await listing(1000, { fresh: true });
  const x0 = await row(id);
  assert.equal(new Date(x0.c).getTime(), new Date((await db.query(`select created_at c from public.listings where id=$1`, [id])).rows[0].c).getTime(), 'a new listing stamps price_changed_at = created_at');
  assert.equal((await days(id, 900, 7)).rows[0].r.price, 900, 'discount accepted on a listing published seconds ago');
  const fe = await listing(1000, { fresh: true });
  assert.equal((await forever(fe, 800)).rows[0].r.permanent, true, 'Forever too');
  // a client-created listing (insert as the seller) behaves the same
  const cid = uuid(++seq);
  await q(seller, `insert into public.listings (id,user_id,title,category,city,price,currency,status,images) values ($1,$2,'Client item','electronics','Hargeisa',500,'USD','available',array['https://x.test/a.jpg'])`, [cid, seller]);
  assert.equal((await days(cid, 450, 3)).rows[0].r.price, 450);
  // a real price edit after publishing restarts the hold
  const ed = await listing(1000, { fresh: true });
  await q(seller, `update public.listings set price=1200 where id=$1`, [ed]);
  await fails(seller, `select public.set_listing_discount($1,900,7,null)`, [ed], /changed recently/);
}
ok('0082: a new listing (seeded or client-created) can be discounted at once, Forever too; a price edit after publishing still holds 3 days');

// ---- a sale ends the discount for good (option A: price stays what it sold for)
const soldVia = {
  'client update (app/web)': (id) => q(seller, `update public.listings set status='sold' where id=$1`, [id]),
  'mark_listing_sold()': (id) => q(seller, `select public.mark_listing_sold($1)`, [id]),
  'direct database update': (id) => db.query(`update public.listings set status='sold' where id=$1`, [id]),
};
for (const [how, mark] of Object.entries(soldVia)) {
  for (const kind of ['finite', 'forever']) {
    const id = await listing(1000);
    if (kind === 'forever') await forever(id, 800, 'Offer'); else await days(id, 800, 30, 'Offer');
    await mark(id);
    const s = await row(id);
    assert.equal(s.p, 800, `${how}/${kind}: sold price kept`);
    assert.equal(s.o, null); assert.equal(s.s, null); assert.equal(s.e, null); assert.equal(s.f, false);
    assert.equal((await db.query(`select discount_note n from public.listings where id=$1`, [id])).rows[0].n, null);
    assert.ok(Date.now() - new Date(s.c) < 60000, 'hold restarts at the sale');
    // reopen: ordinary listing at the retained price, no discount comes back
    await q(seller, `update public.listings set status='available' where id=$1`, [id]).catch(() => db.query(`update public.listings set status='available' where id=$1`, [id]));
    const r = await row(id);
    assert.equal(r.p, 800); assert.equal(r.o, null); assert.equal(r.f, false);
    assert.ok(!(await tab()).includes(id) && (await badge(id)) !== true, 'no badge or price-drop tab after reopening');
    // a new discount waits out the 3-day hold
    await fails(seller, `select public.set_listing_discount($1,700,7,null)`, [id], /changed recently|recently/i);
  }
}
ok('marking a listing sold (client update, mark_listing_sold, direct update) clears finite and Forever discounts, keeps the sold price; reopening restores no discount and a new one waits out the cooldown');

{ // reserved keeps the discount record and its clock; hidden from buyers; sold afterwards clears it
  const id = await listing(1000); await days(id, 800, 30);
  await q(seller, `update public.listings set status='reserved' where id=$1`, [id]);
  const rs = await row(id);
  assert.equal(rs.o, 1000); assert.equal(rs.p, 800);
  assert.ok(!(await tab()).includes(id), 'reserved: discount hidden from buyers');
  await q(seller, `update public.listings set status='sold' where id=$1`, [id]);
  assert.equal((await row(id)).o, null);
  // other status moves and unrelated edits leave a discount alone
  const k = await listing(1000); await forever(k, 900);
  await q(seller, `update public.listings set title='New title' where id=$1`, [k]);
  assert.equal((await row(k)).o, 1000);
}
ok('reserved only hides the discount; unrelated edits leave it; sold afterwards clears it');

{ // a client still cannot edit discount columns, and non-owners cannot sell someone else's listing
  const id = await listing(1000); await days(id, 800, 30);
  await fails(seller, `update public.listings set discount_original_price=null where id=$1`, [id], /Protected listing column/);
  await q(other, `update public.listings set status='sold' where id=$1`, [id]);
  const st = (await db.query(`select status, discount_original_price::float o from public.listings where id=$1`, [id])).rows[0];
  assert.equal(st.status, 'available'); assert.equal(st.o, 1000);
}
ok('protections intact: clients cannot edit discount columns; another user cannot sell the listing');

{ // listings already sold with a discount attached are cleaned by the migration's backfill statement
  const id = await listing(1000); await days(id, 800, 30);
  await db.exec(`alter table public.listings disable trigger listings_b_sold_ends_discount`);
  await db.query(`update public.listings set status='sold' where id=$1`, [id]);
  await db.exec(`alter table public.listings enable trigger listings_b_sold_ends_discount`);
  assert.equal((await row(id)).o, 1000);
  const m = readFileSync(new URL('../migrations/0081_discount_duration_forever.sql', import.meta.url), 'utf8');
  await db.exec(m.slice(m.lastIndexOf('update public.listings\n   set discount_original_price = null')));
  const c = await row(id); assert.equal(c.o, null); assert.equal(c.p, 800);
}
ok('pre-existing sold listings with a discount are cleaned by the migration, price kept');

// ---- rollback
const keepP = await listing(1000); await forever(keepP, 700);
const keepF = await listing(1000); await days(keepF, 800, 77);
await db.exec(readFileSync(new URL('../rollback/0084_discount_end_no_hold_ROLLBACK.sql', import.meta.url), 'utf8'));
// Roll back in reverse order: 0083 first (back to the 0082 function), then 0081.
await db.exec(readFileSync(new URL('../rollback/0083_discount_edit_ROLLBACK.sql', import.meta.url), 'utf8'));
assert.equal((await db.query(`select to_regprocedure('public.set_listing_discount(uuid,numeric,int,text,boolean,boolean)') r`)).rows[0].r, null, '0083 rollback removes the edit form');
await db.exec(readFileSync(new URL('../rollback/0081_discount_duration_forever_ROLLBACK.sql', import.meta.url), 'utf8'));
assert.equal((await db.query(`select price::float p, discount_original_price o from public.listings where id=$1`, [keepP])).rows[0].p, 1000, 'permanent discount ended by rollback');
assert.equal((await db.query(`select discount_original_price::float o from public.listings where id=$1`, [keepF])).rows[0].o, 1000, 'valid finite 0080 data is kept');
assert.equal((await db.query(`select count(*)::int c from information_schema.columns where table_name='listings' and column_name='discount_permanent'`)).rows[0].c, 0);
assert.equal((await db.query(`select to_regprocedure('public.set_listing_discount(uuid,numeric,int,text)') r`)).rows[0].r !== null, true);
assert.equal((await db.query(`select to_regprocedure('public.listing_discount_live(numeric,numeric,timestamptz,text)') r`)).rows[0].r !== null, true);
await q(buyer, `select * from public.home_feed(p_tab => 'price_drops')`);
assert.ok((await q(buyer, `select 1 from public.search_listings(p_limit => 5)`)).rows.length > 0);
await fails(seller, `select public.set_listing_discount($1,500,31,null)`, [await listing(1000)], /1 to 30 days/);
assert.equal((await db.query(`select count(*)::int c from pg_trigger where tgname='listings_b_sold_ends_discount'`)).rows[0].c, 0, 'sold trigger removed');
ok('rollback: permanent discounts ended at the original price, 0080 functions and reads restored');
console.log('\nALL CHECKS PASSED');
