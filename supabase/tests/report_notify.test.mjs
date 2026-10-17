// 0045 — a filed report notifies admins and moderators at once (not support, not the reporter), carries only ids, and can
// never block the report itself. Real Postgres (PGlite), real migration chain 0001..0045.
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, uuid, sqlFile } from './harness/db.mjs';

const { db } = await boot();
const { q, fails } = actors(db);
const [admin, moderator, support, alice, bob] = await seedUsers(db, 5);
await db.query(`insert into public.admin_users(user_id, role) values ($1,'admin'), ($2,'moderator'), ($3,'support')`, [admin, moderator, support]);
await db.exec("select set_config('suuqplus.skip_rate_limit','true',false)");
const L = uuid(900);
await db.query(`insert into public.listings (id,user_id,title,category,city,price,currency,status,images) values ($1,$2,'Alice laptop','electronics','Hargeisa',100,'USD','available','{https://cdn.test/a.jpg}')`, [L, alice]);

const notes = async (uid) => (await db.query(`select title, body, type, data from public.notifications where user_id = $1 and type = 'report_staff' order by created_at`, [uid])).rows;

await q(bob, `insert into public.reports(reporter_id, target_type, target_id, reason, details) values ($1,'listing',$2,'Scam or fraud','[From chat] he asked for a deposit')`, [bob, L]);
const a1 = await notes(admin);
assert.equal(a1.length, 1);
assert.equal(a1[0].title, 'New listing report');
assert.equal(a1[0].body, 'Scam or fraud');
assert.deepEqual({ ...a1[0].data }, { reportId: a1[0].data.reportId, targetType: 'listing', targetId: L });
assert.ok(!JSON.stringify(a1[0]).includes(bob), 'no reporter identity in the notification');
assert.ok(!JSON.stringify(a1[0]).includes('deposit'), 'no free-text details in the notification');
assert.equal((await notes(moderator)).length, 1, 'moderators are notified too');
assert.equal((await notes(support)).length, 0, 'support staff are not');
assert.equal((await notes(bob)).length, 0, 'the reporter is not');
ok('a listing report notifies every admin and moderator with category + reason + ids only (not support, not the reporter)');

await q(bob, `insert into public.reports(reporter_id, target_type, target_id, reason) values ($1,'user',$2,'Pressure to pay outside the app')`, [bob, alice]);
const a2 = await notes(admin);
assert.equal(a2.at(-1).title, 'New user report');
assert.equal(a2.at(-1).body, 'Pressure to pay outside the app');
ok('a user report is a different category in the notification');

await fails(bob, `insert into public.reports(reporter_id, target_type, target_id, reason) values ($1,'user',$2,'x')`, [bob, bob], /cannot report yourself/);
await fails(bob, `insert into public.reports(reporter_id, target_type, target_id, reason) values ($1,'listing',$2,'Scam or fraud')`, [bob, L], /duplicate|unique/);
assert.equal((await notes(admin)).length, 2, 'rejected reports notify nobody');
ok('rejected reports (self-report, duplicate) create no notification');

// a staff reporter is not notified of their own report; a broken notifications table never blocks a report
await db.query(`insert into public.reports(reporter_id, target_type, target_id, reason) values ($1,'listing',$2,'Prohibited item')`, [admin, L]);
assert.equal((await notes(admin)).length, 2, 'admin filing a report is not notified about it');
await db.exec(`alter table public.notifications rename to notifications_x`);
await db.query(`insert into public.reports(reporter_id, target_type, target_id, reason) values ($1,'listing',$2,'Duplicate listing')`, [moderator, L]);
await db.exec(`alter table public.notifications_x rename to notifications`);
assert.equal((await db.query(`select count(*)::int c from public.reports`)).rows[0].c, 4, 'the report was filed even though notifying failed');
ok('a notification failure never blocks a report');

await fails(bob, `select public.trg_reports_notify_staff()`, [], /permission denied|trigger/i);
await db.exec(sqlFile('rollback/0045_report_notifies_staff_ROLLBACK.sql'));
await db.exec(sqlFile('rollback/0045_report_notifies_staff_ROLLBACK.sql'));
await q(bob, `insert into public.reports(reporter_id, target_type, target_id, reason) values ($1,'user',$2,'Fake profile')`, [bob, support]);
assert.equal((await notes(admin)).length, 2, 'after rollback no notification');
await db.exec(sqlFile('migrations/0045_report_notifies_staff.sql'));
ok('trigger function is not callable by clients; rollback is re-runnable; re-apply works');
process.exit(0);
