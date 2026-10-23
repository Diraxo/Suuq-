// 0068 — one account identity: per-listing seller presentation + business phone opt-in. Real Postgres (PGlite), the REAL
// migration chain and rollback SQL.
// Proves: listings default to personal; 'business' needs a business name (any writer); switching modes never rewrites a
// listing or touches personal name/photo/phone/verification; editing business fields never touches the personal identity;
// the phone opt-in defaults to private and only the owner can change it; the backfill rule keeps today's appearance;
// clearing the business name does not destroy business-presented listings; rollback is clean and re-runnable.
// Not proven here: PostgREST, the apps (tests/accountIdentity.test.ts covers the display rules).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, actors, seedUsers, ok, uuid } from './harness/db.mjs';

const { db, applied } = await boot();
assert.ok(applied.includes('0068_listing_seller_presentation.sql'));
const { q, fails } = actors(db);
const [alice, bob] = await seedUsers(db, 2);
await db.exec("select set_config('suuqplus.skip_rate_limit','true',false)");

const addListing = (id, owner, extra = '') =>
  db.query(`insert into public.listings (id,user_id,title,category,city,price,currency,status,images${extra ? ',seller_presentation' : ''}) values ($1,$2,'Laptop','electronics','Hargeisa',100,'USD','available',array['https://x.test/a.jpg']${extra ? ',$3' : ''})`, extra ? [id, owner, extra] : [id, owner]);
const presentation = async (id) => (await db.query(`select seller_presentation s from public.listings where id=$1`, [id])).rows[0].s;
const person = async (uid) => (await db.query(`select full_name, avatar_url, (select pp.phone from private.profile_phones pp where pp.user_id = profiles.id) as phone, (verified_at is not null) v, business_phone_public bp from public.profiles where id=$1`, [uid])).rows[0];

await db.query(`update public.profiles set full_name='Ahmed Ali', avatar_url='https://x.test/ahmed.jpg', phone='+252611111111', verified_at=now() where id=$1`, [alice]);
const before = { ...(await person(alice)) };
assert.equal(before.bp, false);
const l1 = uuid(701), l2 = uuid(702), l3 = uuid(703);
await addListing(l1, alice);
assert.equal(await presentation(l1), 'personal');
ok('a listing defaults to personal presentation and the phone opt-in defaults to private');

await assert.rejects(() => addListing(l2, alice, 'business'), /business_profile_incomplete|business name/);
await db.query(`update public.profiles set business_name='Ahmed Motors', business_logo_url='https://x.test/logo.jpg' where id=$1`, [alice]);
await addListing(l2, alice, 'business');
assert.equal(await presentation(l2), 'business');
await assert.rejects(() => addListing(uuid(704), bob, 'business'), /business_profile_incomplete|business name/);
await assert.rejects(() => db.query(`update public.listings set seller_presentation='team' where id=$1`, [l1]), /listings_seller_presentation_check|violates check/);
ok("'business' presentation needs a business name for any writer; unknown values are refused");

await q(alice, `select public.set_active_mode('business')`);
await q(alice, `select public.set_active_mode('personal')`);
await q(alice, `select public.set_active_mode('business')`);
assert.equal(await presentation(l1), 'personal');
assert.equal(await presentation(l2), 'business');
assert.deepEqual({ ...(await person(alice)) }, before);
ok('switching modes keeps the same listings, presentations and personal name/photo/phone/verification');

// Business fields are written on the trusted path here: with 0054 applied a direct client write of profiles.business_* is routed through
// the storefront draft and cleared from profiles until publication (migration review, decision E), which is not what this suite tests.
await db.query(`update public.profiles set business_name='Ahmed Motors Ltd', business_logo_url='https://x.test/logo2.jpg', business_description='Cars' where id=$1`, [alice]);
assert.deepEqual({ ...(await person(alice)) }, before);
ok('editing business fields never changes the personal identity');

await db.query(`update public.profiles set avatar_url='https://x.test/ahmed2.jpg' where id=$1`, [alice]);
await q(alice, `update public.profiles set full_name='Ahmed A. Ali' where id=$1`, [alice]);
const biz = (await db.query(`select business_name, business_logo_url from public.profiles where id=$1`, [alice])).rows[0];
assert.deepEqual({ ...biz }, { business_name: 'Ahmed Motors Ltd', business_logo_url: 'https://x.test/logo2.jpg' });
ok('editing the personal name/photo never changes the business identity');

const mine = await q(alice, `update public.profiles set business_phone_public=true where id=$1 returning id`, [alice]);
assert.equal(mine.rows.length, 1);
const theirs = await q(bob, `update public.profiles set business_phone_public=false where id=$1 returning id`, [alice]);
assert.equal(theirs.rows.length, 0);
assert.equal((await person(alice)).bp, true);
assert.equal((await person(alice)).phone, '+252611111111');
ok('only the owner can change the phone opt-in, and it does not change the phone or its verification');

await db.query(`update public.profiles set business_name=null where id=$1`, [alice]);
assert.equal(await presentation(l2), 'business');
assert.equal((await db.query(`select count(*)::int n from public.listings where user_id=$1`, [alice])).rows[0].n, 2);
await fails(alice, `update public.listings set seller_presentation='business' where id=$1`, [l1], /business_profile_incomplete|business name/);
ok('clearing the business name destroys nothing (the stored choice stays; clients fall back to personal) and blocks new business listings');

// backfill rule replayed on the migration's own predicate
await db.query(`update public.profiles set business_name='Ahmed Motors', active_mode='business' where id=$1`, [alice]);
await db.query(`update public.listings set seller_presentation='personal' where user_id=$1`, [alice]);
await db.query(`update public.listings l set seller_presentation='business' from public.profiles p where p.id=l.user_id and p.active_mode='business' and nullif(btrim(p.business_name),'') is not null`);
assert.equal(await presentation(l1), 'business');
await addListing(l3, bob);
assert.equal(await presentation(l3), 'personal');
ok('backfill rule: only listings of owners currently showing business become business-presented');

const rollback = readFileSync(new URL('../rollback/0068_listing_seller_presentation_ROLLBACK.sql', import.meta.url), 'utf8');
await db.exec(rollback);
await db.exec(rollback);
assert.equal((await db.query(`select count(*)::int n from information_schema.columns where column_name in ('seller_presentation','business_phone_public')`)).rows[0].n, 0);
assert.equal((await db.query(`select count(*)::int n from public.listings`)).rows[0].n, 3);
ok('rollback removes the columns and trigger, keeps every listing, and is re-runnable');
console.log('listing_seller_presentation: all passed');
