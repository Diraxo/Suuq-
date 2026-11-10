// 0085 + 0086 — "Contact for price" safeguards, on a REAL Postgres (PGlite) with the real migration chain plus the two PROPOSED files.
// Proves: a contact-price service (price 0 + priceMode) is accepted only in that exact shape; offers are refused on it by the
// database (RPC, counter, direct insert, amount change) while declining/cancelling stay possible; discounts are refused on it
// (RPC, direct update, service role); a priced listing with a forged priceMode is NOT a contact listing and keeps offers and
// discounts; moving a listing to contact price records no price drop and clears the stale "reduced" flag; price sort keeps it last;
// ordinary listings keep the positive-price rule; the rollback restores 0080's price trigger and removes the guards.
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, uuid, sqlFile } from './harness/db.mjs';

const { db } = await boot({ extraMigrations: ['proposed/0085_service_contact_price.sql', 'proposed/0086_contact_price_safeguards.sql'] });
const { q, fails } = actors(db);
const [seller, buyer, other] = await seedUsers(db, 3);
await db.exec("select set_config('suuqplus.skip_rate_limit','true',false)");

const CONTACT = JSON.stringify({ priceMode: 'Contact for price' });
let seq = 1200;
async function listing({ price, category = 'services', attrs = '{}', owner = seller, aged = true } = {}) {
  const id = uuid(++seq);
  await db.query(
    `insert into public.listings (id,user_id,title,category,city,price,currency,status,images,attributes) values ($1,$2,$3,$4,'Hargeisa',$5,'USD','available',array['https://x.test/a.jpg'],$6::jsonb)`,
    [id, owner, 'Svc ' + seq, category, price, attrs]
  );
  if (aged) await db.query(`update public.listings set created_at = now() - interval '60 days', price_changed_at = now() - interval '60 days' where id=$1`, [id]);
  return id;
}
const drops = async (id) => (await db.query(`select count(*)::int c from public.price_drops where listing_id=$1`, [id])).rows[0].c;
const row = async (id) => (await db.query(`select price::float p, last_price_drop_at d, last_price_drop_from::float f, discount_original_price o from public.listings where id=$1`, [id])).rows[0];
const offer = (id, amt, who = buyer) => q(who, `select (public.create_offer($1,$2,'hi')).id as id`, [id, amt]);

// ---- 1. the shape 0085 accepts, and the helper
const contact = await listing({ price: 0, attrs: CONTACT });
const fn = async (c, p, a) => (await db.query(`select public.is_contact_price_listing($1,$2::numeric,$3::jsonb) v`, [c, p, a])).rows[0].v;
assert.equal(await fn('services', 0, CONTACT), true);
assert.equal(await fn('services', 500, CONTACT), false, 'forged mode on a priced listing is not a contact listing');
assert.equal(await fn('services', 0, '{}'), false);
assert.equal(await fn('phones', 0, CONTACT), false);
assert.equal(await fn('services', 0, JSON.stringify({ priceMode: 'contact for price' })), false, 'exact mode text only');
assert.equal(await fn('services', 0, '[]'), false);
assert.equal(await fn('services', 0, '"Contact for price"'), false);
assert.equal(await fn(null, null, null), false, 'nulls are never contact-price');
ok('is_contact_price_listing: only services + price exactly 0 + the exact mode; forged/malformed/null shapes are not');

await fails(seller, `insert into public.listings (user_id,title,category,city,price,currency,images) values ($1,'x','services','Hargeisa',0,'USD',array['https://x.test/a.jpg'])`, [seller], /listings_price_range|listings_price_zero_needs_mode/);
await fails(seller, `insert into public.listings (user_id,title,category,city,price,currency,images,attributes) values ($1,'x','phones','Hargeisa',0,'USD',array['https://x.test/a.jpg'],$2::jsonb)`, [seller, CONTACT], /listings_price_range|listings_price_zero_needs_mode/);
const hole = await db.query(`select 1 from pg_constraint where conname='listings_price_zero_needs_mode'`);
assert.equal(hole.rows.length, 1);
await fails(seller, `update public.listings set price=0 where id=$1`, [(await listing({ price: 300 }))], /listings_price_range|listings_price_zero_needs_mode/);
ok('the positive-price rule is intact: price 0 without the mode, or outside services, is still refused');

// ---- 2. offers on a contact-price listing
await fails(buyer, `select public.create_offer($1,100,'hi')`, [contact], /contact-for-price/);
assert.equal((await db.query(`select count(*)::int c from public.offers where listing_id=$1`, [contact])).rows[0].c, 0);
assert.equal((await db.query(`select count(*)::int c from public.notifications where body like '%' || (select title from public.listings where id=$1) || '%'`, [contact])).rows[0].c, 0, 'the refused offer left no notification behind (whole RPC rolled back)');
let blocked = false;
try {
  await db.query(`insert into public.offers (listing_id,buyer_id,seller_id,from_user_id,amount) values ($1,$2,$3,$2,100)`, [contact, buyer, seller]);
} catch (e) { blocked = /contact-for-price/.test(e.message); }
assert.ok(blocked, 'a direct insert (even as the database owner) is refused');
ok('offers on a contact-price listing are refused through create_offer and through a direct insert, with nothing left behind');

// ---- 3. offers still work on a priced listing, including one carrying a forged mode
const priced = await listing({ price: 500 });
const forged = await listing({ price: 500, attrs: CONTACT });
const o1 = (await offer(priced, 400)).rows[0];
const o2 = (await offer(forged, 400)).rows[0];
assert.ok(o1.id && o2.id);
ok('a priced listing (also one with a forged priceMode) still takes offers');

// ---- 4. a pending offer when the listing later becomes contact-price: counter refused, decline/cancel allowed
await q(seller, `update public.listings set price=0 where id=$1`, [forged]);
assert.equal((await db.query(`select public.is_contact_price_listing(category, price, attributes) v from public.listings where id=$1`, [forged])).rows[0].v, true);
await fails(seller, `select public.respond_to_offer($1,'counter',450,null)`, [o2.id], /contact-for-price/);
const rej = await q(seller, `select public.respond_to_offer($1,'reject',null,null) r`, [o2.id]);
assert.ok(rej.rows[0].r);
assert.equal((await db.query(`select status from public.offers where id=$1`, [o2.id])).rows[0].status, 'rejected');
await fails(buyer, `select public.create_offer($1,300,null)`, [forged], /contact-for-price/);
await assert.rejects(db.query(`update public.offers set amount=1 where id=$1`, [o1.id]).then(() => db.query(`update public.listings set price=0, attributes=$2::jsonb where id=$1`, [priced, CONTACT])).then(() => db.query(`update public.offers set amount=2 where id=$1`, [o1.id])), /contact-for-price/);
const cancel = await db.query(`update public.offers set status='cancelled' where id=$1 returning status`, [o1.id]);
assert.equal(cancel.rows[0].status, 'cancelled');
ok('after a listing becomes contact-price: counter-offer, new offer and amount change are refused; reject/cancel still work');

// ---- 5. discounts
await fails(seller, `select public.set_listing_discount($1,100,7,null)`, [contact], /./);
await fails(seller, `update public.listings set discount_original_price=100, discount_started_at=now(), discount_ends_at=now()+interval '3 days' where id=$1`, [contact], /./);
let dBlocked = false;
try {
  await db.query(`update public.listings set discount_original_price=100, discount_started_at=now(), discount_ends_at=now()+interval '3 days' where id=$1`, [contact]);
} catch (e) { dBlocked = /Discounts are not available|listings_/.test(e.message); }
assert.ok(dBlocked, 'the database owner / service role cannot write a discount onto a contact-price listing either');
assert.equal((await row(contact)).o, null);
const ordinary = await listing({ price: 1000, category: 'electronics' });
const rr = (await q(seller, `select public.set_listing_discount($1,900,7,null) r`, [ordinary])).rows[0].r;
assert.equal(rr.price, 900);
const forgedDiscount = await listing({ price: 1000, attrs: CONTACT });
assert.equal((await q(seller, `select public.set_listing_discount($1,900,7,null) r`, [forgedDiscount])).rows[0].r.price, 900, 'a priced listing with a forged mode is still discountable');
ok('discounts: refused on contact-price (RPC, owner update, service role); ordinary and forged-mode priced listings unaffected');

// ---- 6. price drops
const toContact = await listing({ price: 800 });
await q(seller, `update public.listings set price=600 where id=$1`, [toContact]);
assert.equal(await drops(toContact), 1);
assert.ok((await row(toContact)).d, 'a real drop is flagged');
const before = (await db.query(`select count(*)::int c from public.notifications`)).rows[0].c;
await q(seller, `update public.listings set price=0, attributes=$2::jsonb where id=$1`, [toContact, CONTACT]);
let x = await row(toContact);
assert.equal(await drops(toContact), 1, 'moving to contact price records no new drop');
assert.equal(x.d, null); assert.equal(x.f, null);
assert.equal((await db.query(`select count(*)::int c from public.notifications`)).rows[0].c, before, 'nobody is told "X -> 0"');
const flagged = (await q(buyer, `select listing->>'id' id from public.search_listings(p_price_reduced => true, p_limit => 60)`)).rows.map((r) => r.id);
const tab = (await q(buyer, `select listing->>'id' id from public.home_feed(p_tab => 'price_drops', p_limit => 60)`)).rows.map((r) => r.id);
assert.ok(!flagged.includes(toContact) && !tab.includes(toContact), 'not in the Price reduced filter or the price-drops tab');
// an ordinary drop still records exactly as before
const normal = await listing({ price: 1000, category: 'electronics' });
await q(seller, `update public.listings set price=900 where id=$1`, [normal]);
assert.equal(await drops(normal), 1);
// and back from contact to a real price is just a price change, not a drop
await q(seller, `update public.listings set price=700, attributes='{}'::jsonb where id=$1`, [toContact]);
assert.equal(await drops(toContact), 1);
ok('price drops: a move to price 0 records nothing and clears the stale flag; normal drops and contact→priced behave as before');

// ---- 7. price sort keeps contact-price last
const cheap = await listing({ price: 50, category: 'electronics' });
const c2 = await listing({ price: 0, attrs: CONTACT });
const asc = (await q(buyer, `select listing->>'id' id from public.home_feed(p_tab => 'price', p_price_order => 'asc', p_currency => 'USD', p_limit => 100)`)).rows.map((r) => r.id);
const desc = (await q(buyer, `select listing->>'id' id from public.home_feed(p_tab => 'price', p_price_order => 'desc', p_currency => 'USD', p_limit => 100)`)).rows.map((r) => r.id);
assert.ok(asc.indexOf(cheap) < asc.indexOf(c2) && desc.indexOf(cheap) < desc.indexOf(c2), 'contact-price sorts after every priced listing, both directions');
ok('price sort (both directions) keeps a contact-price listing after every priced one');

// ---- 8. rollback
const live = (await db.query(`select pg_get_functiondef('public.trg_listings_record_price_drop()'::regprocedure) d`)).rows[0].d;
await db.exec(sqlFile('proposed/0086_contact_price_safeguards_ROLLBACK.sql'));
const restored = (await db.query(`select pg_get_functiondef('public.trg_listings_record_price_drop()'::regprocedure) d`)).rows[0].d;
assert.ok(live.includes('new.price > 0 and new.price < old.price') && !restored.includes('new.price > 0'), 'rollback removes the extra condition');
const fresh = (await boot({ upTo: '0084' })).db;
const original = (await fresh.query(`select pg_get_functiondef('public.trg_listings_record_price_drop()'::regprocedure) d`)).rows[0].d;
assert.equal(restored, original, 'the restored price trigger is byte-identical to the one the migration chain leaves');
assert.equal((await db.query(`select count(*)::int c from pg_trigger where tgname in ('offers_contact_price_guard','listings_y_contact_price_guard')`)).rows[0].c, 0);
assert.equal((await db.query(`select to_regprocedure('public.is_contact_price_listing(text,numeric,jsonb)') p`)).rows[0].p, null);
const c3 = await listing({ price: 0, attrs: CONTACT });
assert.ok((await offer(c3, 10)).rows[0].id, 'with the guards rolled back an offer is accepted again (so the rollback is real)');
ok('rollback: triggers + helper gone, 0080 price trigger restored byte-for-byte, offers possible again');

console.log('\nAll contact-price safeguard checks passed');
