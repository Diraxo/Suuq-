// 0066 + 0067 — direct business chat and business category. Real Postgres (PGlite), the REAL migration chain and rollback SQL.
// Proves: a business with NO listings can be messaged; the same pair reuses one direct conversation; personal accounts, yourself,
// anon and blocked pairs are refused; messages and notifications work without a listing; listing chats are untouched;
// category shape check; both rollbacks are clean and re-runnable.
// Not proven here: PostgREST, Realtime delivery, the apps.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, actors, seedUsers, ok, uuid } from './harness/db.mjs';

const { db, applied } = await boot();
assert.ok(applied.includes('0066_business_direct_chat.sql') && applied.includes('0067_business_category.sql'));
const { q, fails } = actors(db);
const [shop, bob, carol, plain] = await seedUsers(db, 4);
await db.exec("select set_config('suuqplus.skip_rate_limit','true',false)");
await db.query(`update public.profiles set business_name='Shop', active_mode='business' where id=$1`, [shop]);

const start = (uid, target) => q(uid, `select * from public.start_business_conversation($1)`, [target]);

const c1 = (await start(bob, shop)).rows[0];
assert.equal(c1.listing_id, null);
assert.equal(c1.buyer_id, bob);
assert.equal(c1.seller_id, shop);
ok('a business with no listings can be messaged (direct conversation, no listing)');

const again = (await start(bob, shop)).rows[0];
assert.equal(again.id, c1.id);
assert.equal((await db.query(`select count(*)::int n from public.conversations where listing_id is null`)).rows[0].n, 1);
ok('the same buyer reuses one direct conversation');

const members = (await db.query(`select user_id from public.conversation_participants where conversation_id=$1`, [c1.id])).rows.map((r) => r.user_id).sort();
assert.deepEqual(members, [bob, shop].sort());
ok('both people are participants');

await q(bob, `insert into public.messages(conversation_id, sender_id, text) values ($1,$2,'hi, are you open?')`, [c1.id, bob]);
await q(shop, `insert into public.messages(conversation_id, sender_id, text) values ($1,$2,'yes!')`, [c1.id, shop]);
const note = (await db.query(`select title, body from public.notifications where user_id=$1 and type='message'`, [shop])).rows[0];
assert.equal(note.body, 'hi, are you open?');
ok('messages and notifications work with no listing (body falls back to the message text)');

await fails(shop, `select * from public.start_business_conversation($1)`, [shop], /yourself/);
await fails(bob, `select * from public.start_business_conversation($1)`, [plain], /Business not found|P0002/);
await fails(null, `select * from public.start_business_conversation($1)`, [shop], /permission denied|42501|28000/);
ok('yourself, a personal-only account and anon are refused');

await q(shop, `select public.set_active_mode('personal')`);
await fails(carol, `select * from public.start_business_conversation($1)`, [shop], /Business not found|P0002/);
await q(shop, `select public.set_active_mode('business')`);
ok('a business showing its personal identity cannot be messaged as a business');

await db.query(`insert into public.blocked_users(blocker_id, blocked_id) values ($1,$2)`, [shop, carol]);
await fails(carol, `select * from public.start_business_conversation($1)`, [shop], /Listing not found|P0002/);
ok('a blocked pair cannot start a direct conversation');

const lid = uuid(900);
await db.query(`insert into public.listings (id,user_id,title,category,city,price,currency,status,images) values ($1,$2,'Laptop','electronics','Hargeisa',100,'USD','available',array['https://x.test/a.jpg'])`, [lid, shop]);
const lc = (await q(bob, `select * from public.find_or_create_conversation($1)`, [lid])).rows[0];
assert.equal(lc.listing_id, lid);
assert.notEqual(lc.id, c1.id);
ok('chat on a listing still works and is a separate thread from the direct one');

// category
await db.query(`update public.profiles set business_categories='{electronics}' where id=$1`, [shop]);
await db.query(`update public.profiles set business_categories='{electronics,vehicles,fashion,property,jobs}' where id=$1`, [shop]);
await assert.rejects(db.query(`update public.profiles set business_categories='{Bad Value!}' where id=$1`, [shop]), /business_categories_shape|check/);
await assert.rejects(db.query(`update public.profiles set business_categories='{electronics,x}' where id=$1`, [shop]), /business_categories_shape|check/);
await assert.rejects(db.query(`update public.profiles set business_categories='{aa,bb,cc,dd,ee,ff}' where id=$1`, [shop]), /business_categories_shape|check/);
await db.query(`update public.profiles set business_categories='{}' where id=$1`, [shop]);
await db.query(`update public.profiles set business_categories=null where id=$1`, [shop]);
ok('categories accept 1-5 ids, {} or NULL and reject other shapes');

// rollbacks
const rb66 = readFileSync(new URL('../rollback/0066_business_direct_chat_ROLLBACK.sql', import.meta.url), 'utf8');
await db.exec(rb66);
await db.exec(rb66);
assert.equal((await db.query(`select count(*)::int n from pg_proc where proname='start_business_conversation'`)).rows[0].n, 0);
assert.equal((await db.query(`select is_nullable from information_schema.columns where table_name='conversations' and column_name='listing_id'`)).rows[0].is_nullable, 'NO');
assert.equal((await db.query(`select count(*)::int n from public.conversations where id=$1`, [lc.id])).rows[0].n, 1);
assert.equal((await db.query(`select count(*)::int n from public.conversations where id=$1`, [c1.id])).rows[0].n, 0);
ok('0066 rollback removes direct chats only, keeps listing chats, restores NOT NULL, re-runnable');

const rb67 = readFileSync(new URL('../rollback/0067_business_category_ROLLBACK.sql', import.meta.url), 'utf8');
await db.exec(rb67);
await db.exec(rb67);
assert.equal((await db.query(`select count(*)::int n from information_schema.columns where table_name='profiles' and column_name='business_categories'`)).rows[0].n, 0);
ok('0067 rollback drops the column and is re-runnable');
console.log('business_chat_category: all passed');
