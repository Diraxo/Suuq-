// 0052 — new listings / new users alert staff; bursts collapse; failures never block; web push subscriptions are
// own-rows-only. Real Postgres (PGlite), real migration chain 0001..0052.
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, uuid, sqlFile } from './harness/db.mjs';

const { db } = await boot();
const { q, fails } = actors(db);
const [admin, moderator, support, alice, bob] = await seedUsers(db, 5);
await db.query(`insert into public.admin_users(user_id, role) values ($1,'admin'), ($2,'moderator'), ($3,'support')`, [admin, moderator, support]);
await db.exec("select set_config('suuqplus.skip_rate_limit','true',false)");

const notes = async (uid, type) => (await db.query(`select title, body, type, data, read from public.notifications where user_id = $1 and type = $2 order by created_at`, [uid, type])).rows;
const addListing = (n, owner, title) =>
  db.query(`insert into public.listings (id,user_id,title,category,city,price,currency,status,images) values ($1,$2,$3,'electronics','Hargeisa',100,'USD','available','{https://cdn.test/a.jpg}')`, [uuid(n), owner, title]);

await addListing(900, alice, 'Alice laptop');
const m1 = await notes(moderator, 'listing_staff');
assert.equal(m1.length, 1);
assert.equal(m1[0].title, 'New listing');
assert.match(m1[0].body, /Alice laptop/);
assert.equal((await notes(admin, 'listing_staff')).length, 1, 'admins are notified');
assert.equal((await notes(support, 'listing_staff')).length, 0, 'support staff are not');
assert.equal((await notes(alice, 'listing_staff')).length, 0, 'the seller is not');
ok('a new listing notifies every admin and moderator (not support, not the seller)');

await addListing(901, alice, 'Alice phone');
await addListing(902, alice, 'Alice tv');
const m2 = await notes(moderator, 'listing_staff');
assert.equal(m2.length, 1, 'a burst from one seller stays one row (one push)');
assert.equal(m2[0].data.count, 3);
assert.match(m2[0].title, /^3 new listings from /);
await addListing(903, bob, 'Bob bike');
assert.equal((await notes(moderator, 'listing_staff')).length, 2, 'a different seller is a separate alert');
await db.query(`update public.notifications set read = true where user_id = $1 and type = 'listing_staff'`, [moderator]);
await addListing(904, alice, 'Alice sofa');
assert.equal((await notes(moderator, 'listing_staff')).length, 3, 'once read, the next listing alerts again');
ok('bursts collapse per seller while unread; read alerts do not swallow new ones');

await addListing(905, moderator, 'Staff listing');
assert.equal((await notes(moderator, 'listing_staff')).length, 3, 'staff are not alerted about their own listings');
ok('staff are not alerted about their own listings');

const before = (await notes(admin, 'user_staff')).length;
await db.query(`insert into auth.users(id,email,raw_user_meta_data) values ($1,'new@test.dev',$2)`, [uuid(50), JSON.stringify({ full_name: 'Newcomer' })]);
const after = await notes(admin, 'user_staff');
assert.equal(after.length, before + 1);
assert.equal(after.at(-1).title, 'New user joined');
assert.equal(after.at(-1).body, 'Newcomer');
assert.equal((await notes(moderator, 'user_staff')).filter((r) => r.body === 'Newcomer').length, 0, 'user alerts are admin-only');
ok('a new sign-up notifies admins only');

await db.exec(`alter table public.notifications rename to notifications_x`);
await addListing(906, alice, 'Alice while broken');
await db.query(`insert into auth.users(id,email) values ($1,'broken@test.dev')`, [uuid(51)]);
await db.exec(`alter table public.notifications_x rename to notifications`);
assert.equal((await db.query(`select count(*)::int c from public.listings where id = $1`, [uuid(906)])).rows[0].c, 1, 'listing saved though notifying failed');
assert.equal((await db.query(`select count(*)::int c from public.profiles where id = $1`, [uuid(51)])).rows[0].c, 1, 'profile saved though notifying failed');
ok('a notification failure never blocks a listing or a sign-up');

await q(alice, `select public.register_web_push('https://push.example/a','pk','au','UA')`);
await q(alice, `select public.register_web_push('https://push.example/a','pk2','au2','UA')`);
assert.equal((await db.query(`select count(*)::int c from public.web_push_subscriptions`)).rows[0].c, 1, 'same endpoint upserts');
await q(bob, `select public.register_web_push('https://push.example/a','pk3','au3','UA')`);
assert.equal((await db.query(`select user_id from public.web_push_subscriptions`)).rows[0].user_id, bob, 'endpoint moves to the account now using the browser');
assert.equal((await q(alice, `select * from public.web_push_subscriptions`)).rows.length, 0, 'a user cannot read another user\'s subscription');
await fails(null, `select public.register_web_push('https://push.example/x','a','b')`, [], /permission denied|Not authenticated/);
ok('web push subscriptions: upsert, move between accounts, own rows only, signed-in only');

await fails(bob, `select public.trg_listings_notify_staff()`, [], /permission denied|trigger/i);
await db.exec(sqlFile('rollback/0052_staff_activity_alerts_ROLLBACK.sql'));
await db.exec(sqlFile('rollback/0052_staff_activity_alerts_ROLLBACK.sql'));
await db.exec(sqlFile('migrations/0052_staff_activity_alerts.sql'));
ok('trigger functions are not client-callable; rollback is re-runnable; re-apply works');
process.exit(0);
