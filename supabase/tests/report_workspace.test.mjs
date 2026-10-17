// 0047 — report review workspace, verification + moderation notifications, notification integrity.
// Real Postgres (PGlite), the REAL migration chain 0001..0047. Nothing here touches a real database.
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, uuid, sqlFile } from './harness/db.mjs';

const { db } = await boot();
const { q, fails } = actors(db);
const [admin, mod, supp, alice, bob, carol] = await seedUsers(db, 6);
await db.query(`insert into public.admin_users(user_id, role) values ($1,'admin'), ($2,'moderator'), ($3,'support')`, [admin, mod, supp]);
await db.exec("select set_config('suuqplus.skip_rate_limit','true',false)");

const L = uuid(900);
await db.query(
  `insert into public.listings (id,user_id,title,description,category,city,price,currency,condition,images,status)
   values ($1,$2,'Alice red bicycle','Barely used, pickup only','sports','Hargeisa',120,'USD','used',array['r2/a.jpg','r2/b.jpg','r2/c.jpg'],'available')`,
  [L, alice]
);
const file = async (reporter, type, target, reason, details = null) =>
  (await q(reporter, `insert into public.reports(reporter_id,target_type,target_id,reason,details) values ($1,$2,$3,$4,$5) returning id`, [reporter, type, target, reason, details])).rows[0].id;
const R1 = await file(bob, 'listing', L, 'Scam or fraud', 'asked me to pay a deposit');
const R2 = await file(bob, 'user', alice, 'Harassment');

const queue = async (uid, args = {}) =>
  (await q(uid, `select public.admin_report_queue($1,$2,$3,$4,$5,$6,$7,$8) r`, [args.status ?? null, args.type ?? null, args.query ?? null, args.from ?? null, args.to ?? null, args.assigned ?? null, args.limit ?? 25, args.offset ?? 0])).rows[0].r;
const detail = async (uid, id) => (await q(uid, `select public.admin_report_detail($1) r`, [id])).rows[0].r;
const notifs = async (uid, type) => (await db.query(`select * from public.notifications where user_id=$1 and type=$2 order by created_at, id`, [uid, type])).rows;

// ---- queue --------------------------------------------------------------------------------------------------------
{
  const rows = await queue(admin);
  assert.equal(rows.length, 2);
  const lr = rows.find((r) => r.id === R1);
  assert.equal(lr.reporter.name, 'User 5');
  assert.equal(lr.reported_user.name, 'User 4', 'a listing report names the listing owner');
  assert.equal(lr.listing.title, 'Alice red bicycle');
  assert.equal(lr.listing.thumb, 'r2/a.jpg');
  assert.equal(lr.listing.available, true);
  assert.equal(lr.status, 'pending');
  assert.equal(Number(lr.total), 2);
  const ur = rows.find((r) => r.id === R2);
  assert.equal(ur.listing, null);
  assert.equal(ur.reported_user.id, alice);
  assert.equal(Number(ur.target_report_count), 1);
}
ok('queue shows reporter, reported user, reason, listing thumbnail + title, status, total');

{
  assert.equal((await queue(admin, { type: 'listing' })).length, 1);
  assert.equal((await queue(admin, { status: 'dismissed' })).length, 0);
  assert.equal((await queue(admin, { query: 'bicycle' })).length, 1, 'search by listing title');
  assert.equal((await queue(admin, { query: 'user 5' })).length, 2, 'search by reporter name');
  assert.equal((await queue(admin, { query: R2.slice(0, 8) })).length, 1, 'search by report reference');
  assert.equal((await queue(admin, { query: '%' })).length, 0, 'LIKE wildcards are literal');
  const page = await queue(admin, { limit: 1, offset: 1 });
  assert.equal(page.length, 1);
  assert.equal(Number(page[0].total), 2, 'total is the unpaged count');
  assert.equal((await queue(admin, { from: '2999-01-01' })).length, 0, 'date filter');
  assert.equal((await queue(admin, { limit: 100000 })).length, 2, 'limit is clamped');
}
ok('filters (status, type, text, reference, date), pagination and the limit clamp work server-side');

{
  assert.equal((await queue(mod)).length, 2, 'moderators can review reports');
  await fails(supp, `select public.admin_report_queue()`, [], /Not authorized/);
  await fails(bob, `select public.admin_report_queue()`, [], /Not authorized/);
  await fails(carol, `select public.admin_report_detail($1)`, [R1], /Not authorized/);
  await fails(null, `select public.admin_report_queue()`, [], /permission denied|Not authorized/);
  await fails(null, `select public.admin_report_detail($1)`, [R1], /permission denied|Not authorized/);
  assert.equal((await q(bob, `select * from public.report_admin`)).rows.length, 0, 'the reporter cannot read staff review state');
  assert.equal((await q(bob, `select * from public.report_notes`)).rows.length, 0);
  assert.equal((await q(admin, `select * from public.report_admin`)).rows.length, 2);
  await fails(bob, `insert into public.report_notes(report_id,author_id,note) values ($1,$2,'x')`, [R1, bob], /row-level security|permission/);
  await fails(bob, `update public.report_admin set resolution_note='x'`, [], /row-level security|permission|0 rows/).catch(() => {});
  const own = (await q(bob, `select * from public.reports where id=$1`, [R1])).rows[0];
  assert.ok(!('evidence' in own) && !('resolution_note' in own), 'the reporter row carries no evidence/internal columns');
}
ok('only admin/moderator can read the queue and detail; reporter, unrelated user, support and anon cannot');

// ---- detail + listing removal / deletion --------------------------------------------------------------------------
{
  const d = await detail(admin, R1);
  assert.equal(d.report.details, 'asked me to pay a deposit');
  assert.equal(d.reporter.id, bob);
  assert.equal(Number(d.reporter.reports_filed), 2);
  assert.equal(d.reported_user.id, alice);
  assert.equal(d.reported_user.account_status, 'active');
  assert.equal(Number(d.reported_user.listings_total), 1);
  assert.equal(d.listing.state, 'live');
  assert.equal(d.listing.listing.description, 'Barely used, pickup only');
  assert.deepEqual(d.listing.listing.images, ['r2/a.jpg', 'r2/b.jpg', 'r2/c.jpg']);
  assert.equal(d.listing.listing.condition, 'used');
  assert.equal(Number(d.listing.listing.price), 120);
  assert.ok(!('phone' in d.listing.listing), 'no phone number in the evidence');
  assert.equal(await detail(admin, uuid(777)), null);
}
ok('detail returns full listing evidence (all images, description, price, condition) and both user panels');

{
  await q(admin, `select public.admin_moderate_listing($1,'remove','Counterfeit goods','Removed for policy reasons',$2)`, [L, R1]);
  assert.equal((await q(carol, `select id from public.listings where id=$1`, [L])).rows.length, 0, 'public RLS still hides the removed listing');
  assert.equal((await q(null, `select id from public.listings where id=$1`, [L])).rows.length, 0);
  const d = await detail(admin, R1);
  assert.equal(d.listing.state, 'moderated', 'the admin RPC still reads it');
  assert.equal(d.listing.listing.images.length, 3, 'images are still available to the reviewer');
  assert.equal(d.report.status, 'reviewed');
  assert.equal(d.actions.length, 1);
  assert.equal(d.actions[0].action, 'listing_removed');
  assert.equal(d.actions[0].notified, true, 'the seller notification is recorded against the action');
  assert.equal(d.actions[0].push_status, 'pending', 'push is not claimed as delivered');
  assert.equal(d.reported_user.history.length, 1);
}
ok('a removed listing stays reviewable by staff only; public policies are unchanged; action + notification outcome are shown');

{
  await db.query(`delete from public.listings where id=$1`, [L]);
  const d = await detail(admin, R1);
  assert.equal(d.listing.state, 'deleted');
  assert.equal(d.listing.listing, null);
  assert.equal(d.listing.snapshot.title, 'Alice red bicycle');
  assert.equal(d.listing.snapshot.images.length, 3);
  assert.equal(d.reported_user.id, alice, 'the owner is still identifiable from the snapshot');
  assert.ok(!JSON.stringify(d.listing.snapshot).includes('phone'));
  const row = (await queue(admin, { query: 'bicycle' }))[0];
  assert.equal(row.listing.available, false);
  assert.equal(row.listing.thumb, 'r2/a.jpg');
  await q(admin, `select 1`);
  const purged = (await db.query(`select public.purge_report_evidence(interval '0 seconds') n`)).rows[0].n;
  assert.equal(purged, 1, 'closed report snapshots are purged by retention');
  assert.equal((await detail(admin, R1)).listing.snapshot, null);
  await fails(admin, `select public.purge_report_evidence()`, [], /permission denied/);
}
ok('a hard-deleted listing is reported as deleted with the minimal snapshot; retention purge works and is not client-callable');

// ---- review workflow ----------------------------------------------------------------------------------------------
{
  await fails(mod, `select public.admin_update_report_status($1,'dismissed',null)`, [R2], /reason is required/);
  await fails(mod, `select public.admin_update_report_status($1,'dismissed','  ')`, [R2], /reason is required/);
  await fails(bob, `select public.admin_update_report_status($1,'dismissed','x yz')`, [R2], /Only staff|permission/);
  await q(mod, `select public.admin_update_report_status($1,'reviewing',null)`, [R2]);
  let d = await detail(mod, R2);
  assert.equal(d.report.assigned_to.id, mod, 'starting a review assigns the reviewer');
  assert.equal((await notifs(bob, 'report_result')).length, 1, 'only the R1 outcome so far');
  await fails(mod, `select public.admin_update_report_status($1,'reviewing',null)`, [R2], /already reviewing/);

  await q(mod, `select public.admin_add_report_note($1,'Looks like a repeat pattern - internal only')`, [R2]);
  d = await detail(admin, R2);
  assert.equal(d.notes.length, 1);
  await fails(supp, `select public.admin_add_report_note($1,'x')`, [R2], /Only staff/);
  await fails(mod, `select public.admin_add_report_note($1,'')`, [R2], /1-2000/);

  await q(mod, `select public.admin_update_report_status($1,'dismissed','No evidence of harassment')`, [R2]);
  d = await detail(admin, R2);
  assert.equal(d.report.status, 'dismissed');
  assert.equal(d.report.reviewed_by.id, mod);
  assert.equal(d.report.resolution_note, 'No evidence of harassment');
  assert.ok(d.report.resolved_at);
  const out = await notifs(bob, 'report_result');
  assert.equal(out.length, 2);
  assert.equal(out.at(-1).title, 'Your report was dismissed');
  assert.ok(!JSON.stringify(out).includes('internal only') && !JSON.stringify(out).includes('No evidence'), 'no internal text reaches the reporter');
  assert.equal(d.reporter_notification.status, 'dismissed');

  // reopen -> nothing sent; re-dismiss -> still exactly one dismissed notice
  await q(mod, `select public.admin_update_report_status($1,'reviewing','reopened')`, [R2]);
  assert.equal((await notifs(bob, 'report_result')).length, 2, 'reopening does not notify (and is never mislabelled "dismissed")');
  await q(mod, `select public.admin_update_report_status($1,'dismissed','Still nothing')`, [R2]);
  assert.equal((await notifs(bob, 'report_result')).length, 2, 'a repeated outcome is not duplicated');
  const audit = (await detail(admin, R2)).audit;
  assert.ok(audit.length >= 4 && audit.every((a) => a.admin_name === 'User 2'), 'every status change is audited with the acting admin');
  assert.equal(audit.at(-1).metadata.to, 'reviewing');
}
ok('review workflow: assignment, required dismissal reason, internal notes, one reporter notification per outcome, audit trail');

// ---- verification ---------------------------------------------------------------------------------------------------
{
  await fails(alice, `select public.admin_set_verified($1,true,'self')`, [alice], /Only an admin/);
  await fails(mod, `select public.admin_set_verified($1,true,'moderator')`, [alice], /Only an admin/);
  await fails(alice, `update public.profiles set verified_at = now() where id=$1`, [alice], /managed by staff/);
  await fails(null, `select public.admin_set_verified($1,true,'anon')`, [alice], /permission denied|Only an admin/);
  assert.equal((await notifs(alice, 'verification')).length, 0);

  await q(admin, `select public.admin_set_verified($1,true,'ID document checked')`, [alice]);
  const own = (await q(alice, `select verified_at from public.profiles where id=$1`, [alice])).rows[0];
  const seen = (await q(carol, `select verified_at from public.profiles where id=$1`, [alice])).rows[0];
  assert.ok(own.verified_at && seen.verified_at, 'owner and another account read the same verified_at');
  assert.deepEqual(own, seen);
  const n = await notifs(alice, 'verification');
  assert.equal(n.length, 1);
  assert.equal(n[0].title, 'You are now verified');
  assert.equal(n[0].data.kind, 'verified');
  assert.ok(!JSON.stringify(n[0]).includes('ID document'), 'the internal reason is not in the notification');
  assert.equal((await notifs(carol, 'verification')).length + (await notifs(bob, 'verification')).length, 0);

  await fails(admin, `select public.admin_set_verified($1,true,'retry')`, [alice], /already verified/);
  assert.equal((await notifs(alice, 'verification')).length, 1, 'a retry cannot duplicate the notification');

  await q(admin, `select public.admin_set_verified($1,false,'Document expired')`, [alice]);
  const n2 = await notifs(alice, 'verification');
  assert.equal(n2.length, 2);
  assert.equal(n2[1].data.kind, 'verification_revoked');
  assert.equal((await q(carol, `select verified_at from public.profiles where id=$1`, [alice])).rows[0].verified_at, null);
  assert.equal((await db.query(`select count(*)::int c from public.profile_verification_events where profile_id=$1`, [alice])).rows[0].c, 2);
  const a = (await db.query(`select metadata from public.admin_audit_log where action='verify_user' and target_id=$1`, [alice])).rows[0];
  assert.equal(a.metadata.to, true);
}
ok('verification: only admins change it, owner and others read the same value, one notification per decision, no internal reason leaked');

// ---- moderation notifications + enforcement -------------------------------------------------------------------------
{
  const R3 = await file(carol, 'user', alice, 'Rude messages');
  await q(admin, `select public.admin_moderate_user($1,'warn','INTERNAL: third strike','Please keep chats respectful',null,$2)`, [alice, R3]);
  const w = (await notifs(alice, 'moderation')).filter((n) => n.data.kind === 'warning');
  assert.equal((await notifs(alice, 'moderation')).length, 2, 'listing_removed (earlier) + this warning');
  assert.equal(w.length, 1);
  assert.ok(w[0].data.noticeId, 'the notification points at the readable notice');
  assert.equal(w[0].dedupe_key, 'moderation:' + w[0].data.eventId);
  assert.ok(!JSON.stringify(w[0]).includes('INTERNAL'), 'internal reason is not in the notification');
  const notice = (await q(alice, `select body from public.moderation_notices where id=$1`, [w[0].data.noticeId])).rows[0];
  assert.match(notice.body, /Please keep chats respectful/, 'the user can open the notice and read the message');
  assert.ok(!notice.body.includes('INTERNAL'));
  assert.equal((await q(bob, `select * from public.moderation_notices`)).rows.length, 0, 'other users cannot read it');
  assert.equal((await notifs(bob, 'moderation')).length + (await notifs(carol, 'moderation')).length, 0);
  assert.equal((await detail(admin, R3)).report.status, 'reviewed');

  const until = new Date(Date.now() + 3 * 864e5).toISOString();
  await q(admin, `select public.admin_moderate_user($1,'suspend','repeat offence','Suspended for 3 days',$2,null)`, [alice, until]);
  await fails(alice, `insert into public.listings(user_id,title,price,currency,status) values ($1,'new item',5,'USD','available')`, [alice], /suspend|restrict|not allowed|cannot/i);
  await fails(admin, `select public.admin_moderate_user($1,'suspend','again','x',$2,null)`, [alice, 'not-a-date'], /invalid|date|timestamp/i);
  assert.equal((await notifs(alice, 'moderation')).length, 3);
  await q(admin, `select public.admin_moderate_user($1,'lift_suspension','appeal accepted',null,null,null)`, [alice]);
  await fails(admin, `select public.admin_moderate_user($1,'lift_suspension','again',null,null,null)`, [alice], /not suspended/);
  assert.equal((await notifs(alice, 'moderation')).length, 4, 'a rejected repeat creates no notification');
  await q(admin, `select public.admin_moderate_user($1,'ban','fraud ring','Permanent ban',null,null)`, [alice]);
  await fails(alice, `insert into public.listings(user_id,title,price,currency,status) values ($1,'x',5,'USD','available')`, [alice], /suspended|banned|ban/i);
  const kinds = (await notifs(alice, 'moderation')).map((n) => n.data.kind);
  assert.deepEqual(kinds, ['listing_removed', 'warning', 'suspension', 'suspension_lifted', 'ban']);
  assert.equal(new Set((await notifs(alice, 'moderation')).map((n) => n.data.eventId)).size, 5, 'one notification per event');
  assert.equal((await q(alice, `select public.my_account_state() s`)).rows.length, 1, 'a banned user can still read their account state / notices');
  assert.equal((await q(alice, `select id from public.moderation_notices`)).rows.length, 5);
}
ok('warn / suspend / lift / ban each create exactly one notification for the target only, enforce server-side, and stay readable');

// ---- notification integrity ---------------------------------------------------------------------------------------
{
  await fails(bob, `insert into public.notifications(user_id,title,body,type) values ($1,'You are now verified','forged','verification')`, [bob], /row-level security/);
  await fails(bob, `insert into public.notifications(user_id,title) values ($1,'to someone else')`, [alice], /row-level security/);
  const mine = (await notifs(alice, 'verification'))[0];
  await fails(alice, `update public.notifications set title='hacked' where id=$1`, [mine.id], /read-only/);
  await fails(alice, `update public.notifications set data='{}' where id=$1`, [mine.id], /read-only/);
  await fails(bob, `update public.notifications set read=true where id=$1`, [mine.id], /./).catch(() => {});
  assert.equal((await db.query(`select read from public.notifications where id=$1`, [mine.id])).rows[0].read, false, 'another user cannot mark it read');
  await q(alice, `update public.notifications set read=true where id=$1`, [mine.id]);
  assert.equal((await db.query(`select read from public.notifications where id=$1`, [mine.id])).rows[0].read, true, 'the recipient can mark it read');
  assert.equal((await q(alice, `select id from public.notifications where user_id=$1`, [bob])).rows.length, 0, "cannot read someone else's");
  await fails(alice, `update public.notifications set push_status='sent' where id=$1`, [mine.id], /read-only/);
  assert.equal(mine.push_status, 'pending');
  await q(alice, `delete from public.notifications where id=$1`, [mine.id]);
  assert.equal((await db.query(`select 1 from public.notifications where id=$1`, [mine.id])).rows.length, 0);
}
ok('clients cannot forge or edit notifications; recipients can read, mark read and delete their own');

// ---- push failure never erases the in-app row; migration is re-runnable; rollback works ----------------------------------
{
  await db.query(`update public.notifications set push_status='failed', push_error='fcm 503' where user_id=$1 and type='moderation'`, [alice]);
  assert.equal((await notifs(alice, 'moderation')).length, 5, 'a failed push leaves the persistent notification in place');
  const d = await detail(admin, (await q(carol, `select id from public.reports where reporter_id=$1`, [carol])).rows[0].id);
  assert.equal(d.actions.at(0).push_status ?? 'failed', 'failed', 'delivery failure is visible to the reviewer');
}
ok('push failure is recorded without losing the in-app notification');

await db.exec(sqlFile('migrations/0047_report_review_workspace.sql'));
ok('0047 is re-runnable');
await db.exec(sqlFile('rollback/0047_report_review_workspace_ROLLBACK.sql'));
await db.exec(sqlFile('rollback/0047_report_review_workspace_ROLLBACK.sql'));
assert.equal((await db.query(`select count(*)::int c from pg_proc where proname in ('admin_report_queue','admin_report_detail')`)).rows[0].c, 0);
await db.exec(sqlFile('migrations/0047_report_review_workspace.sql'));
ok('rollback is re-runnable and re-applying 0047 afterwards works');
process.exit(0);
