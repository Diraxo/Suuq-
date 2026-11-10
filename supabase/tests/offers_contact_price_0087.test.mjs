// 0087 — pending offers on a listing that becomes "Contact for price", on a REAL Postgres (PGlite): real migration chain + the PROPOSED 0085, 0086.
// Part A boots WITHOUT 0087 and proves the gap that 0086 leaves: a pending offer can still be ACCEPTED after its listing turned contact-price
// (0086's trigger only fires on insert / amount / listing_id, never on a status-only update).
// Part B applies the PROPOSED 0087 and proves every path: create, counter (RPC), direct insert, amount change, accept (RPC and direct UPDATE,
// seller and buyer side), while reject / cancel / expire keep working, nothing is left half-written, ordinary listings are untouched,
// a listing that goes back to a real price takes offers again, and the rollback restores 0086's behaviour.
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, uuid, sqlFile } from './harness/db.mjs';

const { db } = await boot({ extraMigrations: ['proposed/0085_service_contact_price.sql', 'proposed/0086_contact_price_safeguards.sql'] });
const { q, fails } = actors(db);
const [seller, buyer, buyer2] = await seedUsers(db, 3);
await db.exec("select set_config('suuqplus.skip_rate_limit','true',false)");

const CONTACT = JSON.stringify({ priceMode: 'Contact for price' });
let seq = 1700;
async function listing({ price = 500, category = 'services', attrs = '{}' } = {}) {
  const id = uuid(++seq);
  await db.query(
    `insert into public.listings (id,user_id,title,category,city,price,currency,status,images,attributes) values ($1,$2,$3,$4,'Hargeisa',$5,'USD','available',array['https://x.test/a.jpg'],$6::jsonb)`,
    [id, seller, 'Svc ' + seq, category, price, attrs]
  );
  return id;
}
const toContact = (id) => q(seller, `update public.listings set price=0, attributes=$2::jsonb where id=$1`, [id, CONTACT]);
const toPriced = (id, p = 500) => q(seller, `update public.listings set price=$2, attributes='{}'::jsonb where id=$1`, [id, p]);
const status = async (id) => (await db.query(`select status from public.offers where id=$1`, [id])).rows[0].status;
const make = async (l, amt = 400, who = buyer) => (await q(who, `select (public.create_offer($1,$2,'hi')).id as id`, [l, amt])).rows[0].id;
const notes = async () => (await db.query(`select count(*)::int c from public.notifications`)).rows[0].c;

// ---- Part A: the gap, before 0087
const gapListing = await listing();
const gapOffer = await make(gapListing);
await toContact(gapListing);
const gap = await q(seller, `select (public.respond_to_offer($1,'accept',null,null)).status s`, [gapOffer]);
assert.equal(gap.rows[0].s, 'accepted', 'without 0087 a pending offer IS accepted after the listing became contact-price');
ok('A. GAP CONFIRMED (0085+0086 only): the seller can still accept a pending offer on a listing that is now contact-price');

// ---- Part B: apply the proposal
await db.exec(sqlFile('proposed/0087_contact_price_pending_offers.sql'));

// 1. accept refused, through the RPC (seller accepts buyer's offer) and the buyer accepting a seller counter
const l1 = await listing();
const o1 = await make(l1, 400);
const l1b = await listing();
const o1b = await make(l1b, 400);
const counterId = (await q(seller, `select (public.respond_to_offer($1,'counter',450,null)).id id`, [o1b])).rows[0].id; // seller counters while still priced
await toContact(l1); await toContact(l1b);
const nBefore = await notes();
await fails(seller, `select public.respond_to_offer($1,'accept',null,null)`, [o1], /contact-for-price/);
await fails(buyer, `select public.respond_to_offer($1,'accept',null,null)`, [counterId], /contact-for-price/);
assert.equal(await status(o1), 'pending'); assert.equal(await status(counterId), 'pending');
assert.equal(await notes(), nBefore, 'a refused accept leaves no "accepted" notification behind');
ok('B1. accept is refused for both sides through respond_to_offer; the offer stays pending and nobody is notified');

// 2. accept refused through a direct UPDATE, even as the database owner / service role
let direct = false;
try { await db.query(`update public.offers set status='accepted' where id=$1`, [o1]); } catch (e) { direct = /contact-for-price/.test(e.message); }
assert.ok(direct, 'direct status update to accepted is refused');
assert.equal(await status(o1), 'pending');
ok('B2. a direct UPDATE to accepted is refused as well (not only the RPC)');

// 3. counter, new offer, direct insert, amount change stay refused (0086 behaviour kept)
await fails(seller, `select public.respond_to_offer($1,'counter',450,null)`, [o1], /contact-for-price/);
await fails(buyer2, `select public.create_offer($1,100,null)`, [l1], /contact-for-price/);
let ins = false;
try { await db.query(`insert into public.offers (listing_id,buyer_id,seller_id,from_user_id,amount) values ($1,$2,$3,$2,100)`, [l1, buyer2, seller]); } catch (e) { ins = /contact-for-price/.test(e.message); }
assert.ok(ins);
let amt = false;
try { await db.query(`update public.offers set amount=1 where id=$1`, [o1]); } catch (e) { amt = /contact-for-price/.test(e.message); }
assert.ok(amt);
assert.equal(await status(o1), 'pending');
ok('B3. counter-offer, new offer, direct insert and amount change remain refused');

// 4. reject / cancel / expire keep working and notify
const rej = await q(seller, `select (public.respond_to_offer($1,'reject',null,null)).status s`, [o1]);
assert.equal(rej.rows[0].s, 'rejected');
const canc = await q(seller, `select (public.cancel_offer($1)).status s`, [counterId]); // seller proposed the counter, so the seller cancels it
assert.equal(canc.rows[0].s, 'cancelled');
const l4 = await listing();
const o4 = await make(l4, 300);
await db.query(`update public.offers set expires_at = now() - interval '1 hour' where id=$1`, [o4]);
await toContact(l4);
await q(buyer, `select public.expire_stale_offers()`);
assert.equal(await status(o4), 'expired');
ok('B4. reject, cancel and expire still work on a contact-price listing');

// 5. the buyer can withdraw their own pending offer
const l5 = await listing();
const o5 = await make(l5, 300);
await toContact(l5);
assert.equal((await q(buyer, `select (public.cancel_offer($1)).status s`, [o5])).rows[0].s, 'cancelled');
ok('B5. a buyer can still cancel their own pending offer');

// 6. nothing else changes: ordinary and forged-mode priced listings, other transitions of an already-accepted offer
const priced = await listing({ category: 'electronics' });
const op = await make(priced, 400);
assert.equal((await q(seller, `select (public.respond_to_offer($1,'accept',null,null)).status s`, [op])).rows[0].s, 'accepted');
const forged = await listing({ price: 500, attrs: CONTACT });
const of = await make(forged, 400);
assert.equal((await q(seller, `select (public.respond_to_offer($1,'accept',null,null)).status s`, [of])).rows[0].s, 'accepted', 'a priced listing with a forged mode is not contact-price');
// an offer accepted BEFORE the listing became contact-price is history: later status moves (sold) are not blocked
const l6 = await listing();
const o6 = await make(l6, 400);
await q(seller, `select public.respond_to_offer($1,'accept',null,null)`, [o6]);
await toContact(l6);
await db.query(`update public.offers set status='sold' where id=$1`, [o6]);
assert.equal(await status(o6), 'sold');
ok('B6. ordinary and forged-mode priced listings accept as before; moving an already-accepted offer on (sold) is not blocked');

// 7. back to a real price: offers work again
const l7 = await listing();
await toContact(l7);
await fails(buyer, `select public.create_offer($1,100,null)`, [l7], /contact-for-price/);
await toPriced(l7, 500);
assert.ok(await make(l7, 450));
ok('B7. when the seller switches back to a real price, offers and accepting work again');

// 8. rollback restores 0086
await db.exec(sqlFile('proposed/0087_contact_price_pending_offers_ROLLBACK.sql'));
assert.equal((await db.query(`select count(*)::int c from pg_trigger where tgname='offers_contact_price_guard_accept'`)).rows[0].c, 0);
const l8 = await listing();
const o8 = await make(l8, 400);
await toContact(l8);
assert.equal((await q(seller, `select (public.respond_to_offer($1,'accept',null,null)).status s`, [o8])).rows[0].s, 'accepted', 'after rollback the 0086 behaviour (gap) is back');
await fails(buyer2, `select public.create_offer($1,100,null)`, [l8], /contact-for-price/);
ok('B8. rollback removes the accept guard and keeps 0086 intact (new offers still refused)');

console.log('\nAll pending-offer / contact-price checks passed');
