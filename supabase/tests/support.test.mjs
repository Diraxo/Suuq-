// Phase 4 — 0040 on top of the REAL chain 0001..0039 in PGlite (real Postgres): support cases, seller
// conversations, appeals and authorized restoration; staff identity never reaches the seller; no unsolicited
// chat messages; restricted accounts can still reach support; rollback.
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, uuid, sqlFile } from './harness/db.mjs';

const { db } = await boot({ upTo: '0039' });
const { q, fails } = actors(db);
const fingerprint = async () =>
  (
    await db.query(`
    select 'col' k, table_name||'.'||column_name||':'||data_type v from information_schema.columns where table_schema='public'
    union all select 'fn', p.oid::regprocedure::text||':'||md5(regexp_replace(pg_get_functiondef(p.oid), '[[:space:]]+', ' ', 'g')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    union all select 'trg', tgrelid::regclass||'.'||tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'public.%'
    union all select 'pol', schemaname||'.'||tablename||'.'||policyname from pg_policies where schemaname='public'
    union all select 'idx', indexname from pg_indexes where schemaname='public'
    order by 1,2`)
  ).rows.map((r) => r.k + ' ' + r.v);
const before = await fingerprint();
const [admin, mod, supp, seller, seller2, buyer, appellant] = await seedUsers(db, 7);
await db.query(`insert into public.admin_users(user_id, role) values ($1,'admin'),($2,'moderator'),($3,'support')`, [admin, mod, supp]);

await db.exec(sqlFile('migrations/0040_support_appeals.sql'));
ok('0040 applies on top of the real 0001..0039 chain');
await db.exec(sqlFile('migrations/0040_support_appeals.sql'));
ok('0040 is re-runnable (idempotent)');

const skipRl = (on) => db.exec(`select set_config('suuqplus.skip_rate_limit','${on ? 'true' : ''}',false)`);
let n = 2000;
let rateLimitOff = false;
async function listing(owner, o = {}) {
  await skipRl(true);
  const id = uuid(++n);
  await db.query(`insert into public.listings(id,user_id,title,category,city,price,status) values ($1,$2,$3,'electronics','Hargeisa',100,$4)`, [id, owner, o.title ?? `Item ${n}`, o.status ?? 'available']);
  await skipRl(rateLimitOff);
  return id;
}
const count = async (sql, p) => (await db.query(sql, p)).rows[0].c;
const lstatus = async (id) => (await db.query(`select status from public.listings where id=$1`, [id])).rows[0].status;
const search = async (uid, p_query) => (await q(uid, `select listing->>'id' id from public.search_listings($1)`, [p_query])).rows.map((r) => r.id);

// ---------------------------------------------------------------- cases
const c1 = (await q(seller, `select public.support_open_case('Cannot upload photos','Photos fail on my phone.','general') id`)).rows[0].id;
assert.equal(await count(`select count(*)::int c from public.support_messages where case_id=$1`, [c1]), 1);
assert.equal((await db.query(`select status from public.support_cases where id=$1`, [c1])).rows[0].status, 'awaiting_staff');
ok('a seller opens a case; it starts as awaiting_staff with their first message');
assert.equal((await q(seller2, `select * from public.support_cases`)).rows.length, 0);
assert.equal((await q(seller2, `select * from public.support_messages`)).rows.length, 0);
assert.equal((await q(supp, `select * from public.support_cases where id=$1`, [c1])).rows.length, 1);
ok('another user cannot see the case or its messages; support staff can');
assert.equal(await count(`select count(*)::int c from public.notifications where user_id=$1 and type='support_staff'`, [supp]), 1);
ok('staff are notified of the new case');

await fails(seller, `insert into public.support_cases(user_id, subject) values ($1,'sneaky')`, [seller], /row-level security|42501/);
await fails(seller, `update public.support_cases set status='closed' where id=$1`, [c1], /./).catch(() => {});
assert.equal((await db.query(`select status from public.support_cases where id=$1`, [c1])).rows[0].status, 'awaiting_staff');
await fails(seller, `insert into public.support_messages(case_id, author_kind, body) values ($1,'staff','I am staff')`, [c1], /row-level security|42501/);
await fails(seller, `insert into public.moderation_appeals(case_id,user_id,kind,statement) values ($1,$2,'ban','x long statement here')`, [c1, seller], /row-level security|42501/);
ok('there is no direct write path to support tables (RLS), only the RPCs');
await fails(buyer, `select public.staff_support_reply($1,'hi')`, [c1], /Not authorized|42501/);
await fails(buyer, `select public.staff_set_case_status($1,'closed')`, [c1], /Not authorized|42501/);
await fails(buyer, `select public.staff_decide_appeal($1,'approve')`, [uuid(1)], /Appeal not found/);
ok('non-staff cannot call staff RPCs');

await q(supp, `select public.staff_support_reply($1,'Internal: looks like a known bug', true)`, [c1]);
assert.equal((await db.query(`select status from public.support_cases where id=$1`, [c1])).rows[0].status, 'awaiting_staff');
assert.equal(await count(`select count(*)::int c from public.notifications where user_id=$1 and type='support_reply'`, [seller]), 0);
await q(supp, `select public.staff_support_reply($1,'Hi! Please update the app and try again.')`, [c1]);
assert.equal((await db.query(`select status from public.support_cases where id=$1`, [c1])).rows[0].status, 'awaiting_user');
const sellerView = (await q(seller, `select * from public.support_messages where case_id=$1 order by created_at`, [c1])).rows;
assert.deepEqual(sellerView.map((m) => m.author_kind), ['user', 'staff']);
assert.ok(!sellerView.some((m) => m.internal || /known bug/.test(m.body)), 'internal notes are hidden from the seller');
assert.ok(!JSON.stringify(sellerView).includes(supp), 'the staff member id never appears in anything the seller can read');
assert.equal((await q(seller, `select * from public.support_message_staff`)).rows.length, 0);
assert.equal((await q(seller, `select * from public.support_case_assignments`)).rows.length, 0);
assert.ok(Object.keys(sellerView[0]).every((k) => !/staff|admin|actor|sender/.test(k)), 'no author-identifying column exists on seller-readable message rows');
const rn = (await q(seller, `select title, body from public.notifications where type='support_reply'`)).rows[0];
assert.equal(rn.title, 'Suuqiye Support Team');
ok('staff replies are signed "Suuqiye Support Team"; internal notes and staff ids never reach the seller');
assert.equal((await q(supp, `select staff_id from public.support_case_assignments where case_id=$1`, [c1])).rows[0].staff_id, supp);
ok('the replying staff member is recorded in staff-only tables');

await q(seller, `select public.support_reply($1,'Updated, still failing.')`, [c1]);
assert.equal((await db.query(`select status from public.support_cases where id=$1`, [c1])).rows[0].status, 'awaiting_staff');
await q(supp, `select public.staff_set_case_status($1,'resolved','fixed')`, [c1]);
assert.ok((await q(seller, `select 1 from public.support_messages where case_id=$1 and author_kind='system'`, [c1])).rows.length === 1);
await q(seller, `select public.support_reply($1,'It broke again')`, [c1]);
assert.equal((await db.query(`select status, resolved_at from public.support_cases where id=$1`, [c1])).rows[0].status, 'awaiting_staff');
await q(supp, `select public.staff_set_case_status($1,'resolved')`, [c1]);
await db.query(`update public.support_cases set resolved_at = now() - interval '15 days' where id=$1`, [c1]);
await fails(seller, `select public.support_reply($1,'too late')`, [c1], /closed/);
await q(supp, `select public.staff_set_case_status($1,'closed')`, [c1]);
await fails(seller, `select public.support_reply($1,'closed')`, [c1], /closed/);
await fails(supp, `select public.staff_support_reply($1,'closed')`, [c1], /closed/);
ok('case lifecycle: reply reopens a resolved case for 14 days; resolved-too-long and closed cases refuse replies');
await fails(seller2, `select public.support_reply($1,'not mine')`, [c1], /Case not found/);
await fails(seller, `select public.support_open_case('ab','body')`, [], /./);
await fails(seller, `select public.support_open_case('Valid subject', $1)`, ['x'.repeat(4001)], /1-4000/);
await fails(seller, `select public.support_open_case('Valid subject','body','general',$1)`, [await listing(seller2)], /not yours/);
ok('input validation and ownership checks hold');

assert.equal(await count(`select count(*)::int c from public.conversations`), 0);
assert.equal(await count(`select count(*)::int c from public.messages`), 0);
ok('support never writes into buyer/seller chat: zero conversations and zero chat messages were created');

// open-case cap
for (let i = 0; i < 3; i++) await q(seller2, `select public.support_open_case('Question ${i}','hello there') id`);
await fails(seller2, `select public.support_open_case('Question 4','hello there')`, [], /already have 3 open cases/);
ok('a seller can hold at most 3 open cases');
await db.query(`update public.support_cases set status='resolved', resolved_at=now() where user_id=$1`, [seller2]);
for (let i = 0; i < 2; i++) await q(seller2, `select public.support_open_case('Another ${i}','hello again')`);
await db.query(`update public.support_cases set status='resolved', resolved_at=now() where user_id=$1`, [seller2]);
await fails(seller2, `select public.support_open_case('One too many','hello again')`, [], /Rate limit/);
ok('opening cases is rate limited (5/day) even when older cases are resolved');
rateLimitOff = true;
await skipRl(true); // the remaining sections open many cases/appeals; the quota itself is proven above
await db.query(`delete from public.support_cases where user_id=$1`, [seller2]);

// ---------------------------------------------------------------- listing appeal
const L = await listing(seller, { title: 'Appealed phone', status: 'reserved' });
await q(mod, `select public.admin_moderate_listing($1,'remove','Suspected counterfeit','This looks counterfeit.')`, [L]);
await fails(seller2, `select public.support_open_appeal('listing',$1,'This is not mine to appeal')`, [L], /Listing not found/);
await fails(seller, `select public.support_open_appeal('listing',$1,'short')`, [L], /10-2000/);
await fails(seller, `select public.support_open_appeal('listing',$1,'Please look again at this listing')`, [await listing(seller)], /Only a removed or deactivated/);
const ap = (await q(seller, `select public.support_open_appeal('listing',$1,'It is genuine, here is the receipt number 12345.') id`, [L])).rows[0].id;
await fails(seller, `select public.support_open_appeal('listing',$1,'Second try while pending, please')`, [L], /unique|duplicate/);
const apRow = (await db.query(`select a.*, c.category, c.status cs from public.moderation_appeals a join public.support_cases c on c.id=a.case_id where a.id=$1`, [ap])).rows[0];
assert.equal(apRow.status, 'pending');
assert.equal(apRow.category, 'appeal');
assert.ok(apRow.event_id && apRow.listing_id === L);
ok('a seller appeals a removed listing: one case + one pending appeal linked to the decision; duplicates rejected');
await fails(supp, `select public.staff_decide_appeal($1,'approve')`, [ap], /Not authorized/);
await fails(seller, `select public.staff_decide_appeal($1,'approve')`, [ap], /Not authorized/);
ok('support staff and the seller cannot decide an appeal');
await q(mod, `select public.staff_decide_appeal($1,'reject','The receipt does not match the item.')`, [ap]);
assert.equal(await lstatus(L), 'removed');
const rej = (await q(seller, `select kind, body from public.moderation_notices where kind='appeal_rejected'`)).rows;
assert.equal(rej.length, 1);
assert.match(rej[0].body, /receipt does not match/);
assert.equal((await db.query(`select status from public.support_cases where id=$1`, [apRow.case_id])).rows[0].status, 'resolved');
await fails(mod, `select public.staff_decide_appeal($1,'approve')`, [ap], /already decided/);
ok('rejecting keeps the listing removed, tells the seller once, resolves the case, and cannot be decided twice');

const ap2 = (await q(seller, `select public.support_open_appeal('listing',$1,'New evidence: here is the original invoice.') id`, [L])).rows[0].id;
await q(mod, `select public.staff_decide_appeal($1,'approve','Thanks for the invoice.')`, [ap2]);
assert.equal(await lstatus(L), 'reserved');
assert.ok((await search(buyer, 'Appealed phone')).includes(L));
const notices = (await q(seller, `select kind from public.moderation_notices order by created_at`)).rows.map((r) => r.kind);
assert.equal(notices.filter((k) => k === 'appeal_approved').length, 1);
assert.equal(notices.filter((k) => k === 'listing_restored').length, 0, 'the quiet restore produced no second notice');
assert.equal(await count(`select count(*)::int c from public.moderation_events where listing_id=$1 and action='listing_restored'`, [L]), 1);
assert.equal(await count(`select count(*)::int c from public.moderation_events where listing_id=$1 and action='appeal_approved'`, [L]), 1);
assert.equal(await count(`select count(*)::int c from public.admin_audit_log where target_id=$1 and action='restore_listing'`, [L]), 1);
ok('approving restores the exact previous status (reserved), is audited, and sends the seller ONE notice');
await fails(seller, `select public.support_open_appeal('listing',$1,'Appealing again after restore')`, [L], /Only a removed or deactivated/);

// max two appeals per listing
const L2 = await listing(seller, { title: 'Stubborn' });
await q(mod, `select public.admin_moderate_listing($1,'remove','Spam')`, [L2]);
for (const i of [1, 2]) {
  const a = (await q(seller, `select public.support_open_appeal('listing',$1,'Please reconsider, attempt number ${i}') id`, [L2])).rows[0].id;
  await q(mod, `select public.staff_decide_appeal($1,'reject')`, [a]);
}
await fails(seller, `select public.support_open_appeal('listing',$1,'Please reconsider, attempt number 3')`, [L2], /maximum number of appeals/);
ok('a listing can be appealed at most twice');
const W = await listing(seller, { title: 'Withdraw me' });
await q(mod, `select public.admin_moderate_listing($1,'deactivate','Review')`, [W]);
const wa = (await q(seller, `select public.support_open_appeal('listing',$1,'I changed my mind about this') id`, [W])).rows[0].id;
await q(seller, `select public.support_withdraw_appeal($1)`, [wa]);
assert.equal((await db.query(`select status from public.moderation_appeals where id=$1`, [wa])).rows[0].status, 'withdrawn');
await fails(seller, `select public.support_withdraw_appeal($1)`, [wa], /No pending appeal/);
ok('a seller can withdraw a pending appeal');

// ---------------------------------------------------------------- suspension + ban appeals (restricted accounts reach support)
rateLimitOff = false;
await skipRl(false); // enforcement checks below need the real gate (the skip GUC also skips the suspension check)
await db.query(`update public.support_cases set status='resolved', resolved_at=now() where user_id=$1`, [appellant]);
await q(mod, `select public.admin_moderate_user($1,'suspend','Spam','Suspended.', now() + interval '10 days')`, [appellant]);
await fails(appellant, `insert into public.favorites(user_id, listing_id) values ($1,$2)`, [appellant, L], /Account suspended/);
const sa = (await q(appellant, `select public.support_open_appeal('suspension',null,'I was not spamming, please check again.') id`)).rows[0].id;
await q(appellant, `select public.support_reply((select case_id from public.moderation_appeals where id=$1), 'Adding more details')`, [sa]);
ok('a suspended account can still open an appeal and write to support');
await q(mod, `select public.staff_decide_appeal($1,'approve','Sorry about that.')`, [sa]);
assert.equal((await db.query(`select account_status from public.profiles where id=$1`, [appellant])).rows[0].account_status, 'active');
ok('a moderator approves a suspension appeal: the account is active again');

const B1 = await listing(appellant, { title: 'Ban victim listing' });
await q(admin, `select public.admin_moderate_user($1,'ban','Fraud')`, [appellant]);
assert.equal(await lstatus(B1), 'deactivated');
await fails(appellant, `select public.support_open_appeal('listing',$1,'Please restore this single listing')`, [B1], /appeal the ban instead/);
const ba = (await q(appellant, `select public.support_open_appeal('ban',null,'This was a mistake; I never sold anything.') id`)).rows[0].id;
await fails(mod, `select public.staff_decide_appeal($1,'approve')`, [ba], /Not authorized/);
await q(admin, `select public.staff_decide_appeal($1,'approve','Welcome back.')`, [ba]);
assert.equal((await db.query(`select account_status from public.profiles where id=$1`, [appellant])).rows[0].account_status, 'active');
assert.equal(await lstatus(B1), 'available');
ok('ban appeals: moderators cannot decide, an admin can; approval unbans and restores the hidden listings');
await fails(buyer, `select public.support_open_appeal('ban',null,'I am not even banned, hello')`, [], /not banned/);
await fails(buyer, `select public.support_open_appeal('suspension',null,'I am not even suspended')`, [], /not suspended/);
ok('appeals require the matching restriction');

// deleting a listing / account that has appeals must still work (FK set null / cascade)
await db.query(`delete from public.listings where id=$1`, [W]);
await db.query(`delete from public.profiles where id=$1`, [buyer]);
ok('deleting a listing or account with support history does not fail');

// ---------------------------------------------------------------- rollback
await db.exec(sqlFile('rollback/0040_support_appeals_ROLLBACK.sql'));
const after = await fingerprint();
const a = new Set(before), b = new Set(after);
assert.deepEqual([...a].filter((x) => !b.has(x)).concat([...b].filter((x) => !a.has(x))), []);
ok('rollback restores the exact pre-0040 schema');
await db.exec(sqlFile('migrations/0040_support_appeals.sql'));
ok('0040 re-applies cleanly after rollback');
console.log('\nOK support.test.mjs');
