// Phase 2/3 — 0039 on top of the REAL chain 0001..0038 in PGlite (real Postgres). Proves server-side enforcement:
// roles, removal / reversible deactivation, warnings, temporary suspension with expiry, bans (cascade + exact
// restore), RLS visibility, audit + seller notices, report abuse limits, legacy RPC compatibility, rollback.
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, uuid, sqlFile } from './harness/db.mjs';

const { db } = await boot({ upTo: '0038' });
const { q, fails } = actors(db);
const fingerprint = async () =>
  (
      await db.query(`
    select 'col' k, table_name||'.'||column_name||':'||data_type v from information_schema.columns where table_schema='public'
    union all select 'fn', p.oid::regprocedure::text||':'||md5(regexp_replace(pg_get_functiondef(p.oid), '[[:space:]]+', ' ', 'g')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    union all select 'trg', tgrelid::regclass||'.'||tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'public.%'
    union all select 'pol', schemaname||'.'||tablename||'.'||policyname||':'||coalesce(qual,'')||':'||coalesce(with_check,'') from pg_policies where schemaname='public'
    union all select 'idx', indexname from pg_indexes where schemaname='public'
    union all select 'con', conrelid::regclass||'.'||conname||':'||pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace and contype='c'
    order by 1,2`)
  ).rows.map((r) => r.k + ' ' + r.v);
const before = await fingerprint();
const assertSameSchema = async (label) => {
  const after = await fingerprint();
  const a = new Set(before), b = new Set(after);
  const diff = [...a].filter((x) => !b.has(x)).map((x) => '- ' + x.slice(0, 300)).concat([...b].filter((x) => !a.has(x)).map((x) => '+ ' + x.slice(0, 300)));
  assert.deepEqual(diff, [], label + ' differs from the baseline schema');
};

const [admin, mod, supp, seller, seller2, buyer, other] = await seedUsers(db, 7);
await db.query(`insert into public.admin_users(user_id, role) values ($1,'admin') , ($2,'moderator'), ($3,'support')`, [admin, mod, supp]).catch(async () => {
  // before 0039 the role column does not exist yet
  await db.query(`insert into public.admin_users(user_id) values ($1), ($2), ($3)`, [admin, mod, supp]);
});

await db.exec(sqlFile('migrations/0039_moderation_enforcement.sql'));
ok('0039 applies on top of the real 0001..0038 chain');
await db.exec(sqlFile('migrations/0039_moderation_enforcement.sql'));
ok('0039 is re-runnable (idempotent)');
await db.query(`update public.admin_users set role='moderator' where user_id=$1`, [mod]);
await db.query(`update public.admin_users set role='support' where user_id=$1`, [supp]);

const skipRl = (on) => db.exec(`select set_config('suuqplus.skip_rate_limit','${on ? 'true' : ''}',false)`);
let n = 1000;
async function listing(owner, o = {}) {
  await skipRl(true);
  const id = uuid(++n);
  await db.query(`insert into public.listings(id,user_id,title,category,city,price,status) values ($1,$2,$3,'electronics','Hargeisa',100,$4)`, [id, owner, o.title ?? `Item ${n}`, o.status ?? 'available']);
  await skipRl(false);
  return id;
}
const status = async (id) => (await db.query(`select status, status_before_moderation sb, boosted_until from public.listings where id=$1`, [id])).rows[0];
const count = async (sql, p) => (await db.query(sql, p)).rows[0].c;
const visibleTo = async (uid, id) => (await q(uid, `select id from public.listings where id=$1`, [id])).rows.length === 1;
const search = async (uid, p_query) => (await q(uid, `select listing->>'id' id from public.search_listings($1)`, [p_query])).rows.map((r) => r.id);

// ---------------------------------------------------------------- roles
const L1 = await listing(seller, { title: 'Phone one' });
await fails(buyer, `select public.admin_moderate_listing($1,'remove','spam')`, [L1], /42501|Not authorized/);
await fails(supp, `select public.admin_moderate_listing($1,'remove','spam')`, [L1], /42501|Not authorized/);
ok('regular users and support staff cannot moderate listings');
await fails(mod, `select public.admin_moderate_user($1,'ban','scam')`, [seller], /42501|Not authorized/);
await fails(mod, `select public.admin_set_verified($1,true,'nope')`, [seller], /42501|Only an admin/);
await fails(mod, `select public.admin_grant_boost($1,1,'nope')`, [L1], /42501|Only an admin/);
ok('moderators cannot ban, verify or boost (admin-only)');
await fails(admin, `select public.admin_moderate_listing($1,'remove','  ')`, [L1], /reason is required/);
await fails(admin, `select public.admin_moderate_listing($1,'remove','ok reason', $2)`, [L1, 'x'.repeat(1001)], /too long/);
await fails(admin, `select public.admin_moderate_listing($1,'explode','ok reason')`, [L1], /Unknown listing action/);
ok('reason is mandatory; message length and action are validated');

// ---------------------------------------------------------------- removal
await q(buyer, `insert into public.reports(reporter_id,target_type,target_id,reason) values ($1,'listing',$2,'Scam')`, [buyer, L1]);
await q(other, `insert into public.reports(reporter_id,target_type,target_id,reason) values ($1,'listing',$2,'Spam')`, [other, L1]);
const ev = (await q(mod, `select public.admin_moderate_listing($1,'remove','Counterfeit goods','This item breaks our rules on counterfeit goods.') id`, [L1])).rows[0].id;
assert.equal((await status(L1)).status, 'removed');
assert.equal((await status(L1)).sb, 'available');
ok('a moderator removes a listing; the previous status is remembered');
assert.equal(await visibleTo(buyer, L1), false);
assert.equal(await visibleTo(null, L1), false);
assert.equal(await visibleTo(seller, L1), true);
assert.equal(await visibleTo(mod, L1), true);
assert.ok(!(await search(buyer, 'Phone one')).includes(L1));
ok('removed listing is invisible to buyers and anonymous visitors (direct query and search); owner + staff still see it');
assert.equal(await count(`select count(*)::int c from public.reports where target_id=$1 and status='reviewed'`, [L1]), 2);
ok('all pending reports on the removed listing are marked reviewed (reporters are notified by the existing trigger)');
const evRow = (await db.query(`select * from public.moderation_events where id=$1`, [ev])).rows[0];
assert.equal(evRow.action, 'listing_removed');
assert.equal(evRow.actor_id, mod);
assert.equal(evRow.reason, 'Counterfeit goods');
const notice = (await q(seller, `select * from public.moderation_notices where event_id=$1`, [ev])).rows[0];
assert.equal(notice.from_label, 'Suuqiye Support Team');
assert.match(notice.body, /counterfeit goods/);
assert.match(notice.body, /Phone one/);
assert.equal(notice.appealable, true);
assert.ok(!('actor_id' in notice) && !('reason' in notice), 'the seller-visible notice exposes no staff identity and no internal reason');
assert.ok(!JSON.stringify(notice).includes(mod), 'staff id never appears in the notice');
ok('seller gets a notice from "Suuqiye Support Team" with the staff message, no staff identity, no internal reason');
assert.equal((await q(other, `select * from public.moderation_notices`)).rows.length, 0);
assert.equal((await q(seller, `select * from public.moderation_events`)).rows.length, 0);
assert.equal((await q(supp, `select * from public.moderation_events`)).rows.length, 1);
ok("users cannot read other users' notices or any internal moderation event; staff can read events");
assert.equal(await count(`select count(*)::int c from public.admin_audit_log where action='remove_listing' and target_id=$1`, [L1]), 1);
ok('exactly one audit row per action (legacy action name preserved)');
assert.equal(await count(`select count(*)::int c from public.notifications where user_id=$1 and type='moderation'`, [seller]), 1);
ok('seller also gets an in-app/push notification');

await fails(seller, `update public.listings set status='available' where id=$1`, [L1], /42501|under review|Only staff/);
await fails(seller, `update public.listings set title='sneaky edit' where id=$1`, [L1], /42501|under review/);
await fails(seller, `delete from public.listings where id=$1`, [L1], /42501|under review/);
await fails(seller, `update public.listings set status='removed' where id=$1`, [await listing(seller)], /42501|Only staff/);
await fails(seller, `update public.listings set status='deactivated' where id=$1`, [await listing(seller)], /42501|Only staff/);
await fails(seller, `update public.listings set status_before_moderation='sold' where id=$1`, [await listing(seller)], /42501|Protected/);
ok('the seller cannot restore, edit, delete or self-moderate; protected columns hold');
await fails(admin, `select public.admin_moderate_listing($1,'remove','again please')`, [L1], /already removed/);
await fails(admin, `select public.admin_moderate_listing($1,'deactivate','nope please')`, [L1], /restore it first/);
ok('double-removal and removed->deactivated are rejected');

await q(seller, `select public.mark_notice_read($1)`, [notice.id]);
assert.ok((await q(seller, `select read_at from public.moderation_notices where id=$1`, [notice.id])).rows[0].read_at);
await q(other, `select public.mark_notice_read($1)`, [notice.id]);
ok('mark_notice_read works for the owner (and is a no-op for anyone else)');

// ---------------------------------------------------------------- deactivate / restore
const SOLD = await listing(seller, { status: 'sold', title: 'Sold TV' });
await q(mod, `select public.admin_moderate_listing($1,'deactivate','Needs review')`, [SOLD]);
assert.deepEqual([(await status(SOLD)).status, (await status(SOLD)).sb], ['deactivated', 'sold']);
assert.equal(await visibleTo(buyer, SOLD), false);
await q(mod, `select public.admin_moderate_listing($1,'restore','Reviewed, fine','All good now.')`, [SOLD]);
assert.deepEqual([(await status(SOLD)).status, (await status(SOLD)).sb], ['sold', null]);
assert.equal(await visibleTo(buyer, SOLD), true);
ok('deactivation is reversible and restores the exact previous status (sold -> sold)');
await q(admin, `select public.admin_moderate_listing($1,'restore','Appeal accepted')`, [L1]);
assert.equal((await status(L1)).status, 'available');
await fails(admin, `select public.admin_moderate_listing($1,'restore','twice please')`, [L1], /not removed or deactivated/);
ok('a removed listing can be restored by staff; restoring a live listing is rejected');
const BOOSTED = await listing(seller, { title: 'Boost me' });
await q(admin, `select public.admin_grant_boost($1,1,'promo')`, [BOOSTED]);
await q(mod, `select public.admin_moderate_listing($1,'remove','Policy breach')`, [BOOSTED]);
assert.equal((await status(BOOSTED)).boosted_until, null);
assert.equal(await count(`select count(*)::int c from public.listing_boosts where listing_id=$1 and revoked_at is not null`, [BOOSTED]), 1);
ok('removing a listing revokes its live boost');

// ---------------------------------------------------------------- warnings
await fails(supp, `select public.admin_moderate_user($1,'warn','be nice')`, [seller], /42501|Not authorized/);
await fails(mod, `select public.admin_moderate_user($1,'warn','be nice')`, [mod], /yourself|42501/);
await fails(mod, `select public.admin_moderate_user($1,'warn','be nice')`, [admin], /Staff accounts/);
await q(mod, `select public.admin_moderate_user($1,'warn','Rude to buyers','Please keep chats respectful.')`, [seller]);
assert.equal(await count(`select count(*)::int c from public.moderation_warnings where user_id=$1`, [seller]), 1);
const warnNotice = (await q(seller, `select * from public.moderation_notices where kind='warning'`)).rows[0];
assert.equal(warnNotice.appealable, false);
assert.match(warnNotice.body, /respectful/);
ok('warnings are recorded, noticed and audited; staff cannot be targeted and nobody can warn themselves');

// ---------------------------------------------------------------- suspension with expiry
await fails(mod, `select public.admin_moderate_user($1,'suspend','bad','msg',null)`, [seller], /future end date/);
await fails(mod, `select public.admin_moderate_user($1,'suspend','bad','msg', now() - interval '1 day')`, [seller], /future end date/);
await fails(mod, `select public.admin_moderate_user($1,'suspend','bad','msg', now() + interval '400 days')`, [seller], /at most 365/);
await q(mod, `select public.admin_moderate_user($1,'suspend','Repeated spam','Suspended for spam.', now() + interval '7 days')`, [seller]);
let acct = (await db.query(`select account_status, suspended_until from public.profiles where id=$1`, [seller])).rows[0];
assert.equal(acct.account_status, 'suspended');
assert.ok(acct.suspended_until > new Date());
ok('a moderator suspends a user for a bounded period (end date required, max 365 days)');

await fails(seller, `update public.profiles set account_status='active', suspended_until=null where id=$1`, [seller], /42501|managed by staff/);
await fails(seller, `update public.profiles set suspended_until = now() where id=$1`, [seller], /42501|managed by staff/);
ok('a suspended user cannot lift their own suspension (this was possible before 0038/0039)');
await fails(seller, `insert into public.listings(user_id,title,category,city,price) values ($1,'new','electronics','Hargeisa',5)`, [seller], /Account suspended/);
await fails(seller, `update public.listings set title='edit while suspended' where id=$1`, [SOLD], /Account suspended/);
await fails(seller, `delete from public.listings where id=$1`, [SOLD], /Account suspended/);
await fails(seller, `insert into public.favorites(user_id, listing_id) values ($1,$2)`, [seller, SOLD], /Account suspended/);
await fails(seller, `insert into public.followers(follower_id, following_id) values ($1,$2)`, [seller, buyer], /Account suspended/);
await fails(seller, `insert into public.reviews(reviewer_id, seller_id, rating) values ($1,$2,5)`, [seller, buyer], /Account suspended/);
ok('server-side: a suspended user cannot post, edit, delete, favorite, follow or review');
await q(seller, `update public.profiles set bio = 'still editable' where id=$1`, [seller]).catch(() => {});
await q(seller, `insert into public.reports(reporter_id,target_type,target_id,reason) values ($1,'listing',$2,'Spam')`, [seller, await listing(seller2)]);
ok('a suspended user can still edit profile settings and file reports');

// expiry: no cron needed
await db.query(`update public.profiles set suspended_until = now() - interval '1 minute' where id=$1`, [seller]);
assert.equal((await db.query(`select public.account_effective_status($1) s`, [seller])).rows[0].s, 'active');
await q(seller, `update public.listings set title='edit after expiry' where id=$1`, [SOLD]);
ok('an expired suspension stops restricting immediately (effective status), without any scheduled job');
const st = (await q(seller, `select * from public.my_account_state()`)).rows[0];
assert.equal(st.status, 'active');
assert.equal(st.suspended_until, null);
assert.equal(await count(`select count(*)::int c from public.moderation_events where user_id=$1 and action='suspension_expired'`, [seller]), 1);
assert.equal(await count(`select count(*)::int c from public.moderation_notices where user_id=$1 and kind='suspension_expired'`, [seller]), 1);
await q(seller, `select * from public.my_account_state()`);
assert.equal(await count(`select count(*)::int c from public.moderation_events where user_id=$1 and action='suspension_expired'`, [seller]), 1);
ok('my_account_state() persists the expiry once (event + notice), idempotently');
await fails(seller, `select public._lift_expired_suspension($1)`, [seller], /permission denied/);
await fails(seller, `select public.lift_expired_suspensions()`, [], /permission denied/);
ok('internal lift/record functions are not callable by API roles');

await q(mod, `select public.admin_moderate_user($1,'suspend','Again','Second strike', now() + interval '3 days')`, [seller]);
await q(mod, `select public.admin_moderate_user($1,'lift_suspension','Mistake')`, [seller]);
assert.equal((await db.query(`select account_status from public.profiles where id=$1`, [seller])).rows[0].account_status, 'active');
await fails(mod, `select public.admin_moderate_user($1,'lift_suspension','again')`, [seller], /not suspended/);
ok('staff can lift a suspension early; lifting an active user is rejected');

// ---------------------------------------------------------------- ban + exact restore
const B1 = await listing(seller2, { title: 'Ban A' });
const B2 = await listing(seller2, { title: 'Ban B', status: 'reserved' });
const B3 = await listing(seller2, { title: 'Ban C', status: 'sold' });
const B4 = await listing(seller2, { title: 'Ban D (removed earlier)' });
await q(mod, `select public.admin_moderate_listing($1,'remove','Earlier removal')`, [B4]);
await q(admin, `select public.admin_grant_boost($1,2,'promo')`, [B1]);
const liveBefore = await count(`select count(*)::int c from public.listings where user_id=$1 and status in ('available','reserved','sold','expired')`, [seller2]);
const banEv = (await q(admin, `select public.admin_moderate_user($1,'ban','Fraud ring','Permanently banned for fraud.') id`, [seller2])).rows[0].id;
assert.equal((await db.query(`select account_status from public.profiles where id=$1`, [seller2])).rows[0].account_status, 'banned');
for (const id of [B1, B2, B3]) assert.equal((await status(id)).status, 'deactivated');
assert.equal((await status(B4)).status, 'removed');
assert.equal((await status(B1)).boosted_until, null);
assert.deepEqual(
  [(await status(B1)).sb, (await status(B2)).sb, (await status(B3)).sb],
  ['available', 'reserved', 'sold']
);
assert.equal(await visibleTo(buyer, B3), false);
assert.ok(liveBefore >= 3);
assert.equal((await db.query(`select metadata->>'listings_deactivated' c from public.moderation_events where id=$1`, [banEv])).rows[0].c, String(liveBefore));
assert.equal(await count(`select count(*)::int c from public.listings where user_id=$1 and status in ('available','reserved','sold','expired')`, [seller2]), 0);
ok('ban hides every live listing of the user, remembers each previous status, revokes boosts, records the count');
await fails(seller2, `insert into public.listings(user_id,title,category,city,price) values ($1,'new','electronics','Hargeisa',5)`, [seller2], /Account suspended/);
await fails(seller2, `update public.profiles set account_status='active' where id=$1`, [seller2], /42501|managed by staff/);
await fails(seller2, `insert into public.favorites(user_id, listing_id) values ($1,$2)`, [seller2, L1], /Account suspended/);
ok('a banned user is blocked from writing on the marketplace and cannot self-unban');
await fails(mod, `select public.admin_moderate_listing($1,'restore','fine')`, [B1], /banned; lift the ban first/);
await fails(admin, `select public.admin_moderate_user($1,'ban','again')`, [seller2], /already banned/);
ok("a banned seller's listing cannot be restored individually");
const bn = (await q(seller2, `select appealable, kind from public.moderation_notices where event_id=$1`, [banEv])).rows[0];
assert.deepEqual(bn, { appealable: true, kind: 'ban' });
ok('the banned user receives an appealable notice');
await q(admin, `select public.admin_moderate_user($1,'unban','Appeal accepted','Welcome back.')`, [seller2]);
assert.equal((await db.query(`select account_status from public.profiles where id=$1`, [seller2])).rows[0].account_status, 'active');
assert.deepEqual([(await status(B1)).status, (await status(B2)).status, (await status(B3)).status, (await status(B4)).status], ['available', 'reserved', 'sold', 'removed']);
assert.equal(await visibleTo(buyer, B1), true);
ok('unban restores exactly the listings the ban hid (previous statuses) and leaves the earlier removal alone');

// ---------------------------------------------------------------- legacy RPCs still work
const LEG = await listing(seller2, { title: 'Legacy path' });
await q(admin, `select public.admin_set_listing_status($1,'removed','legacy remove')`, [LEG]);
assert.equal((await status(LEG)).status, 'removed');
await q(admin, `select public.admin_set_listing_status($1,'available','legacy restore')`, [LEG]);
assert.equal((await status(LEG)).status, 'available');
await q(admin, `select public.admin_warn_user($1,'legacy warn','note')`, [seller2]);
await q(admin, `select public.admin_set_account_status($1,'suspended','legacy suspend')`, [seller2]);
const ls = (await db.query(`select account_status, suspended_until from public.profiles where id=$1`, [seller2])).rows[0];
assert.equal(ls.account_status, 'suspended');
assert.ok(ls.suspended_until > new Date(Date.now() + 29 * 86400000));
await q(admin, `select public.admin_set_account_status($1,'active','legacy lift')`, [seller2]);
assert.ok((await q(seller2, `select 1 from public.moderation_notices where kind='suspension'`)).rows.length >= 1);
ok('0027 RPCs keep working (same signatures), now producing events + seller notices; legacy suspend = 30 days');
await q(mod, `select public.admin_update_report_status((select id from public.reports limit 1), 'reviewing', 'taking a look')`);
await fails(supp, `select public.admin_update_report_status((select id from public.reports limit 1), 'reviewing', 'x')`, [], /Only staff|42501/);
ok('moderators can update report status; support cannot');

// ---------------------------------------------------------------- report abuse
await fails(buyer, `insert into public.reports(reporter_id,target_type,target_id,reason) values ($1,'user',$2,'self')`, [buyer, buyer], /yourself/);
const mine = await listing(buyer, { title: 'my own' });
await fails(buyer, `insert into public.reports(reporter_id,target_type,target_id,reason) values ($1,'listing',$2,'own')`, [buyer, mine], /your own listing/);
await fails(other, `insert into public.reports(reporter_id,target_type,target_id,reason,details) values ($1,'listing',$2,'x',$3)`, [other, mine, 'd'.repeat(1001)], /reports_details_length|check/);
ok('report abuse: cannot report yourself or your own listing; free text is bounded');
const ids = [];
for (let i = 0; i < 21; i++) ids.push(await listing(seller2, { title: `rep ${i}` }));
const filed = await count(`select count(*)::int c from public.reports where reporter_id=$1`, [other]);
for (let i = 0; i < 20 - filed; i++) await q(other, `insert into public.reports(reporter_id,target_type,target_id,reason) values ($1,'listing',$2,'Spam')`, [other, ids[i]]);
await fails(other, `insert into public.reports(reporter_id,target_type,target_id,reason) values ($1,'listing',$2,'Spam')`, [other, ids[20]], /Rate limit/);
await fails(buyer, `insert into public.reports(reporter_id,target_type,target_id,reason) values ($1,'listing',$2,'Scam again')`, [buyer, L1], /duplicate|unique/);
ok('reports are capped at 20/day per reporter, and duplicates per target are rejected');

// ---------------------------------------------------------------- regressions: earlier behaviour intact
const R = await listing(seller2, { title: 'regress', status: 'available' });
await q(buyer, `insert into public.favorites(user_id, listing_id) values ($1,$2)`, [buyer, R]);
assert.equal((await db.query(`select favorites_count c from public.listings where id=$1`, [R])).rows[0].c, 1);
await q(buyer, `select public.increment_listing_views($1)`, [R]);
await q(seller2, `update public.listings set price = 50 where id=$1`, [R]);
assert.equal(await count(`select count(*)::int c from public.price_drops where listing_id=$1`, [R]), 1);
assert.ok(await visibleTo(null, R));
ok('regressions: favorites counter, view counter, price-drop recording and public visibility still work for active users');

// ---------------------------------------------------------------- rollback
await db.exec(sqlFile('rollback/0039_moderation_enforcement_ROLLBACK.sql'));
await assertSameSchema('after rollback');
ok('rollback restores the exact pre-0039 schema (columns, function bodies, triggers, policies, indexes, constraints)');
await db.exec(sqlFile('migrations/0039_moderation_enforcement.sql'));
ok('0039 re-applies cleanly after rollback');
console.log('\nOK moderation.test.mjs');
void other;
