// 0060 — edits, deletes, reviews, profile changes, blocks and account deletion alert staff; bursts collapse; a notify
// failure never blocks the user's action; health check is admin-only. Real Postgres (PGlite), real migration chain.
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, uuid, sqlFile } from './harness/db.mjs';

const { db } = await boot();
const { q, fails } = actors(db);
const [admin, moderator, support, alice, bob] = await seedUsers(db, 5);
await db.query(`insert into public.admin_users(user_id, role) values ($1,'admin'), ($2,'moderator'), ($3,'support')`, [admin, moderator, support]);
await db.exec("select set_config('suuqplus.skip_rate_limit','true',false)");

const notes = async (uid, type, kind) =>
  (await db.query(`select title, body, data, read from public.notifications where user_id = $1 and type = $2 and ($3::text is null or data->>'kind' = $3) order by created_at`, [uid, type, kind ?? null])).rows;
await db.query(`insert into public.listings (id,user_id,title,category,city,price,currency,status,images) values ($1,$2,'Alice laptop','electronics','Hargeisa',100,'USD','available','{https://cdn.test/a.jpg}')`, [uuid(900), alice]);

await db.query(`update public.listings set price = 90 where id = $1`, [uuid(900)]);
const e1 = await notes(moderator, 'listing_staff', 'edited');
assert.equal(e1.length, 1); assert.equal(e1[0].title, 'Listing edited');
assert.equal((await notes(support, 'listing_staff', 'edited')).length, 0, 'support staff are not alerted');
await db.query(`update public.listings set views = views + 1 where id = $1`, [uuid(900)]);
assert.equal((await notes(moderator, 'listing_staff', 'edited')).length, 1, 'a view counter bump is not an edit');
await db.query(`update public.listings set price = 80 where id = $1`, [uuid(900)]);
const e2 = await notes(moderator, 'listing_staff', 'edited');
assert.equal(e2.length, 1, 'edit burst stays one row'); assert.equal(e2[0].data.count, 2);
ok('listing edits alert admins+moderators, ignore counters, collapse bursts');

await db.query(`delete from public.listings where id = $1`, [uuid(900)]);
const d = await notes(admin, 'listing_staff', 'deleted');
assert.equal(d.length, 1); assert.equal(d[0].title, 'Listing deleted'); assert.equal(d[0].data.listingId, undefined);
ok('listing deletion alerts staff without a dead listing link');

await db.query(`insert into public.reviews (reviewer_id, seller_id, rating, comment) values ($1,$2,4,'ok')`, [alice, bob]);
assert.equal((await notes(moderator, 'activity_staff', 'review')).length, 1);
await db.query(`insert into public.blocked_users (blocker_id, blocked_id) values ($1,$2)`, [alice, bob]);
assert.equal((await notes(moderator, 'activity_staff', 'block')).length, 1);
ok('reviews and blocks alert admins+moderators');

await db.query(`update public.profiles set full_name = 'Alice B' where id = $1`, [alice]);
assert.equal((await notes(admin, 'activity_staff', 'profile_edited')).length, 1);
assert.equal((await notes(moderator, 'activity_staff', 'profile_edited')).length, 0, 'profile edits are admin-only');
await db.query(`update public.profiles set updated_at = now() where id = $1`, [alice]);
assert.equal((await notes(admin, 'activity_staff', 'profile_edited')).length, 1, 'untracked column change does not alert');
ok('profile edits alert admins only');

await db.query(`delete from public.profiles where id = $1`, [bob]);
const gone = await notes(admin, 'activity_staff', 'account_deleted');
assert.equal(gone.length, 1); assert.equal(gone[0].title, 'Account deleted');
ok('account deletion alerts admins');

await db.query(`update public.notifications set read = true where user_id = $1 and type = 'activity_staff'`, [admin]);
await db.query(`update public.profiles set full_name = 'Alice C' where id = $1`, [alice]);
assert.equal((await notes(admin, 'activity_staff', 'profile_edited')).length, 2, 'once read, the next event alerts again');
ok('read alerts do not swallow new ones');

await db.exec(`alter table public.notifications rename to notifications_x`);
await db.query(`update public.profiles set city = 'Burao' where id = $1`, [alice]);
await db.exec(`alter table public.notifications_x rename to notifications`);
assert.equal((await db.query(`select city from public.profiles where id = $1`, [alice])).rows[0].city, 'Burao', 'edit saved though notifying failed');
ok('a notification failure never blocks the action');

assert.ok((await q(admin, `select * from public.staff_alert_health()`)).rows.every((r) => r.present), 'all triggers present');
await fails(alice, `select * from public.staff_alert_health()`, [], /Admins only|permission denied/);
await fails(alice, `select public._staff_alert(array['admin'],'activity_staff','x',$1,'t','b','{}')`, [alice], /permission denied/);
ok('health check admin-only; writer not client-callable');

await db.exec(sqlFile('rollback/0060_staff_activity_alerts_v2_ROLLBACK.sql'));
await db.exec(sqlFile('rollback/0060_staff_activity_alerts_v2_ROLLBACK.sql'));
await db.exec(sqlFile('migrations/0060_staff_activity_alerts_v2.sql'));
ok('rollback re-runnable; re-apply works');
process.exit(0);
