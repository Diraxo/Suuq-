// 0074 — account-deletion FK fix. Real Postgres (PGlite) running the REAL migrations from supabase/migrations, in disposable in-memory databases.
// Schema inspected: the LOCAL migration chain only (0001..0073 = "before", 0001..0076 = "head"). This is NOT the production schema and nothing here
// proves production matches it; production would need its own read-only pg_constraint query. NOT proven: GoTrue's admin.deleteUser (the tests delete from
// auth.users directly, which is what it does), the edge function itself, Storage/R2 cleanup, real concurrency (PGlite is single-connection).
// Covers: FK catalog (pg_constraint, multi-column aware), deletion policy per record kind, null-actor consumers, forward + rollback of 0074, the
// proposed 0077 fix for the boost-revoker defect, and the 0074/0075/0076 interaction (including rollback order).
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, uuid, sqlFile } from './harness/db.mjs';

const ROLLBACK_0074 = sqlFile('rollback/0074_account_deletion_fk_fix_ROLLBACK.sql');
const PROPOSED_0077 = 'proposed/0077_listing_boosts_revoker_deleted.sql';
const ROLLBACK_0077 = sqlFile('proposed/0077_listing_boosts_revoker_deleted_ROLLBACK.sql');
const ACTOR_COLS = ['admin_audit_log.admin_id', 'moderation_warnings.admin_id', 'profile_verification_events.actor_id', 'listing_boosts.granted_by', 'report_notes.author_id'];
const DEL = { a: 'no action', r: 'restrict', c: 'cascade', n: 'set null', d: 'set default' };

// ---- 1. FK catalog -------------------------------------------------------------------------------------------------------------------
// Every FK whose referenced table is auth.users or public.profiles, from pg_constraint. conkey/confkey are unnested WITH ORDINALITY so a
// multi-column constraint yields its columns in order and the text of the migration (one line or many) is irrelevant. The alias is not
// "notnull" on purpose (that is a SQL keyword and silently turns the column into an IS NOT NULL test).
const fkCatalog = async (db) =>
  (
    await db.query(`
      select c.conname, c.conrelid::regclass::text tbl, c.confrelid::regclass::text ref, c.confdeltype del, cardinality(c.conkey) ncols,
             (select string_agg(a.attname, ',' order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) cols,
             (select bool_and(a.attnotnull) from unnest(c.conkey) k(attnum)
                join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) cols_not_null
      from pg_constraint c
      where c.contype = 'f' and c.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
      order by 2, 1`)
  ).rows;
const key = (r) => `${r.tbl.replace(/^public\./, '')}.${r.cols}`;

/** FKs into ANY table reachable from auth.users/profiles through ON DELETE CASCADE that would BLOCK a user delete (no action / restrict / set default). */
const blockers = async (db) =>
  (
    await db.query(`
      with recursive reach(rel) as (
        select 'auth.users'::regclass union
        select c.conrelid from pg_constraint c join reach r on c.confrelid = r.rel where c.contype = 'f' and c.confdeltype = 'c'
      )
      select c.conrelid::regclass::text tbl, c.conname, c.confrelid::regclass::text ref, c.confdeltype del,
             (select string_agg(a.attname, ',' order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) cols
      from pg_constraint c where c.contype = 'f' and c.confrelid in (select rel from reach) and c.confdeltype in ('a', 'r', 'd')
      order by 1, 2`)
  ).rows;

const before = await boot({ upTo: '0073' });
const head = await boot();
const fixed = await boot({ extraMigrations: [PROPOSED_0077] });
assert.equal(head.applied.at(-1), '0076_nameless_business_compat.sql');

const fkBefore = await fkCatalog(before.db);
const fkHead = await fkCatalog(head.db);
assert.ok(fkBefore.length > 40, 'catalog query actually found the foreign keys');
assert.ok(fkBefore.every((r) => r.ncols >= 1));
const multi = fkHead.filter((r) => r.ncols > 1);
assert.equal(multi.length, 0, `no multi-column FK references profiles/auth.users in the local chain (found: ${multi.map(key)}); the query would list them with their columns if there were`);
ok(`FK catalog from pg_constraint on the LOCAL chain: ${fkBefore.length} FKs into profiles/auth.users at 0073, ${fkHead.length} at 0076; ${multi.length} multi-column`);

// Exactly what 0074 changed, nothing more and nothing less: the diff of the two catalogs restricted to 0073 -> 0074.
const at74 = await fkCatalog((await boot({ upTo: '0074' })).db);
const changed = at74.filter((r) => { const p = fkBefore.find((x) => x.conname === r.conname); return !p || p.del !== r.del; }).map((r) => `${key(r)} ${DEL[fkBefore.find((x) => x.conname === r.conname)?.del] ?? 'n/a'} -> ${DEL[r.del]}`).sort();
assert.deepEqual(changed, [
  'admin_audit_log.admin_id no action -> set null',
  'listing_boosts.granted_by no action -> set null',
  'listing_boosts.revoked_by no action -> set null',
  'moderation_warnings.admin_id no action -> set null',
  'offers.from_user_id no action -> cascade',
  'profile_verification_events.actor_id no action -> set null',
  'report_notes.author_id no action -> set null',
]);
const blockingBefore = fkBefore.filter((r) => r.del === 'a' || r.del === 'r').map((r) => `${key(r)} ${DEL[r.del]}`).sort();
assert.deepEqual(blockingBefore, [
  'admin_audit_log.admin_id no action', 'listing_boosts.granted_by no action', 'listing_boosts.revoked_by no action', 'moderation_warnings.admin_id no action',
  'offers.from_user_id no action', 'profile_verification_events.actor_id no action', 'report_notes.author_id no action', 'storefront_verification_requests.reviewed_by restrict',
]);
ok('0074 changes exactly 7 FK actions (6 staff/audit pointers -> SET NULL, offers.from_user_id -> CASCADE) and no other FK');

// Transitive check: FKs into tables that cascade from the user, that would still block the delete.
const blockHead = await blockers(head.db);
assert.deepEqual(blockHead.map((r) => `${r.tbl.replace(/^public\./, '')}.${r.cols} ${DEL[r.del]}`), ['storefront_verification_requests.reviewed_by restrict']);
const blockBefore = (await blockers(before.db)).map((r) => `${r.tbl.replace(/^public\./, '')}.${r.cols} ${DEL[r.del]}`);
assert.ok(blockBefore.length === 8 && blockBefore.includes('admin_audit_log.admin_id no action') && blockBefore.includes('offers.from_user_id no action'));
ok('after 0074 the only FK that can still block a user delete is storefront_verification_requests.reviewed_by (explicit RESTRICT: a staff account that decided a business verification cannot be hard-deleted); before 0074 there were 8');

// Which of the 5 actor columns are nullable now / before.
const nn = (cat) => Object.fromEntries(cat.filter((r) => ACTOR_COLS.includes(key(r))).map((r) => [key(r), r.cols_not_null]));
assert.ok(Object.values(nn(fkBefore)).every((v) => v === true));
assert.ok(Object.values(nn(fkHead)).every((v) => v === false));
ok('the five actor columns are NOT NULL at 0073 and nullable at head (listing_boosts.revoked_by was already nullable)');

// ---- 2. Seed a realistic world on a fresh DB ----------------------------------------------------------------------------------------
async function world(db) {
  const { q } = actors(db);
  const [admin, admin2, admin3, mod, alice, bob, carol, dave, erin] = await seedUsers(db, 9);
  await db.query(`insert into public.admin_users(user_id, role) values ($1,'admin'),($2,'admin'),($3,'admin'),($4,'moderator')`, [admin, admin2, admin3, mod]);
  await db.exec("select set_config('suuqplus.skip_rate_limit','true',false)");
  const mk = (id, owner, title) =>
    db.query(
      `insert into public.listings (id,user_id,title,description,category,city,price,currency,condition,images,status)
       values ($1,$2,$3,'Barely used, pickup only','sports','Hargeisa',120,'USD','used',array['r2/a.jpg','r2/b.jpg','r2/c.jpg'],'available')`,
      [id, owner, title],
    );
  const [L1, L2, L3, L4] = [901, 902, 903, 904].map(uuid);
  await mk(L1, alice, 'Alice red bicycle'); await mk(L2, alice, 'Alice blue bicycle'); await mk(L3, alice, 'Alice green bicycle'); await mk(L4, carol, 'Carol scooter');
  // offers: bob -> alice (then alice counters, so from_user_id is the seller on one row); dave -> carol (carol counters)
  const o1 = (await q(bob, `select * from public.create_offer($1, 80, 'can you do 80?')`, [L1])).rows[0];
  await q(alice, `select * from public.respond_to_offer($1,'counter',90,null)`, [o1.id]);
  const o2 = (await q(dave, `select * from public.create_offer($1, 50, 'hello')`, [L4])).rows[0];
  await q(carol, `select * from public.respond_to_offer($1,'counter',60,null)`, [o2.id]);
  // staff: warn, verify, boosts (granted by admin; one revoked by admin2), a report note by the moderator
  await q(admin, `select public.admin_warn_user($1,'spam','first warning')`, [alice]);
  await q(admin, `select public.admin_set_verified($1,true,'documents checked')`, [alice]);
  const bGrantedOnly = (await q(admin, `select public.admin_grant_boost($1,1,'promo')`, [L2])).rows[0].admin_grant_boost;
  const bRevoked = (await q(admin, `select public.admin_grant_boost($1,1,'promo')`, [L3])).rows[0].admin_grant_boost;
  await q(admin2, `select public.admin_revoke_boost($1,'policy review')`, [bRevoked]);
  const report = (await q(bob, `insert into public.reports(reporter_id,target_type,target_id,reason) values ($1,'listing',$2,'Scam or fraud') returning id`, [bob, L1])).rows[0].id;
  await q(mod, `select public.admin_add_report_note($1,'internal: repeat pattern')`, [report]);
  return { q, admin, admin2, admin3, mod, alice, bob, carol, dave, erin, L1, L2, L3, L4, o1, o2, bGrantedOnly, bRevoked, report };
}
const rows = async (db, sql, p) => (await db.query(sql, p)).rows;
const del = (db, id) => db.query(`delete from auth.users where id=$1`, [id]);
const delFails = async (db, id, re) => { try { await del(db, id); } catch (e) { assert.match(`${e.code} ${e.message}`, re); return e; } assert.fail('expected delete to fail'); };
const snap = async (db) => JSON.stringify({
  audit: await rows(db, `select id, admin_id, action, target_id from admin_audit_log order by id`),
  warn: await rows(db, `select id, admin_id from moderation_warnings order by id`),
  boosts: await rows(db, `select id, granted_by, revoked_by, revoked_at is not null revoked from listing_boosts order by id`),
  profiles: (await rows(db, `select count(*)::int c from profiles`))[0].c,
});

// ---- 3. Control: the failure 0074 exists to fix, on the pre-0074 schema ------------------------------------------------------------
const B = await world(before.db);
await delFails(before.db, B.mod, /23503.*admin_audit_log_admin_id_fkey/);
await delFails(before.db, B.admin, /23503.*admin_audit_log_admin_id_fkey/);
await del(before.db, B.bob); await del(before.db, B.dave);
assert.equal((await rows(before.db, `select count(*)::int c from offers where buyer_id in ($1,$2)`, [B.bob, B.dave]))[0].c, 0);
ok('CONTROL at 0073: deleting any staff account fails with 23503 on admin_audit_log_admin_id_fkey; deleting a buyer (offer + counter-offer) already succeeds, because the offer is removed by the buyer_id/seller_id cascade first');

// ---- 4. Head: deletion policy per record kind ---------------------------------------------------------------------------------------
const H = await world(head.db);
const auditOf = (db, who) => rows(db, `select action, target_id from admin_audit_log where admin_id ${who ? '= $1' : 'is null'} order by created_at, id`, who ? [who] : []);
const startAudit = await rows(head.db, `select action from admin_audit_log order by created_at, id`);
assert.ok(startAudit.length >= 6 && ['warn_user', 'verify_user', 'grant_boost', 'revoke_boost', 'report_note'].every((a) => startAudit.some((r) => r.action === a)), `audit rows seeded through the real RPCs (${startAudit.map((r) => r.action)})`);

// 4a. buyer with an offer: deleted along with the user; the seller keeps their own data
assert.equal((await rows(head.db, `select count(*)::int c from offers where listing_id=$1`, [H.L1]))[0].c, 2, 'offer + counter seeded');
await del(head.db, H.bob);
assert.equal((await rows(head.db, `select count(*)::int c from offers where listing_id=$1`, [H.L1]))[0].c, 0, 'both offer rows (bob proposed one, alice the counter) are gone');
assert.equal((await rows(head.db, `select count(*)::int c from profiles where id=$1`, [H.alice]))[0].c, 1);
assert.equal((await rows(head.db, `select count(*)::int c from listings where id=$1`, [H.L1]))[0].c, 1, "the seller's listing stays");
// 4b. seller whose counter-offer has from_user_id = seller
await del(head.db, H.carol);
assert.equal((await rows(head.db, `select count(*)::int c from offers where listing_id=$1`, [H.L4]))[0].c, 0);
assert.equal((await rows(head.db, `select count(*)::int c from listings where id=$1`, [H.L4]))[0].c, 0);
assert.equal((await rows(head.db, `select count(*)::int c from profiles where id=$1`, [H.dave]))[0].c, 1, 'the other party survives');
ok('user with an offer: buyer deletion removes the offer chain (buyer proposal and seller counter), seller deletion removes their counter-offer and listing; the counterpart account is untouched');
// the report bob filed (and the staff note on it) went with the reporter: observed behaviour, see report
const noteAfterReporterGone = (await rows(head.db, `select count(*)::int c from report_notes where report_id=$1`, [H.report]))[0].c;
assert.equal((await rows(head.db, `select count(*)::int c from reports where id=$1`, [H.report]))[0].c, 0);
assert.equal(noteAfterReporterGone, 0);
ok('OBSERVED (policy decision for the owner, unchanged by 0074): deleting a REPORTER cascades the report and the staff notes on it (reports.reporter_id and report_notes.report_id are ON DELETE CASCADE)');

// 4c. moderator who wrote a note: note retained, author pointer null. A fresh report/note so 4a/4b do not interfere.
const rep2 = (await H.q(H.dave, `insert into public.reports(reporter_id,target_type,target_id,reason) values ($1,'listing',$2,'Spam') returning id`, [H.dave, H.L2])).rows[0].id;
await H.q(H.mod, `select public.admin_add_report_note($1,'second note')`, [rep2]);
const noteBefore = (await rows(head.db, `select id, note, created_at from report_notes where report_id=$1`, [rep2]))[0];
await del(head.db, H.mod);
const noteAfter = (await rows(head.db, `select id, note, created_at, author_id from report_notes where report_id=$1`, [rep2]))[0];
assert.equal(noteAfter.note, noteBefore.note); assert.equal(noteAfter.author_id, null);
assert.equal((await rows(head.db, `select count(*)::int c from admin_users where user_id=$1`, [H.mod]))[0].c, 0, "the deleted moderator's staff role goes with the account");
assert.ok((await auditOf(head.db, null)).some((r) => r.action === 'report_note'), 'the audit row for the note survives with a null admin');
ok('report note: the note text and timestamp are retained, author_id becomes NULL, the moderator\'s staff role is removed, the audit row for the note survives with admin_id NULL');

// 4d. DEFECT: a staff account that REVOKED a boost cannot be deleted (CHECK listing_boosts_revoke_consistent)
const s0 = await snap(head.db);
await delFails(head.db, H.admin2, /23514.*listing_boosts_revoke_consistent/);
assert.equal(await snap(head.db), s0, 'the failed delete changed nothing (atomic)');
assert.equal((await rows(head.db, `select count(*)::int c from profiles where id=$1`, [H.admin2]))[0].c, 1);
ok('KNOWN DEFECT in 0074 (reproduced): deleting a staff account that revoked a boost fails with 23514 listing_boosts_revoke_consistent, atomically (SET NULL on revoked_by breaks (revoked_at is null) = (revoked_by is null))');

// 4e. the same world with the proposed 0077 applied
const F = await world(fixed.db);
await del(fixed.db, F.bob); await del(fixed.db, F.carol); await del(fixed.db, F.mod);
await del(fixed.db, F.admin2);
const revoked = (await rows(fixed.db, `select granted_by, revoked_by, revoked_at, revoke_reason from listing_boosts where id=$1`, [F.bRevoked]))[0];
assert.equal(revoked.granted_by, F.admin); assert.equal(revoked.revoked_by, null); assert.ok(revoked.revoked_at); assert.equal(revoked.revoke_reason, 'policy review');
ok('PROPOSED 0077: the revoker can be deleted; the boost keeps revoked_at and revoke_reason, revoked_by becomes NULL, granted_by is untouched');
await assert.rejects(() => fixed.db.query(`update listing_boosts set revoked_by = $1 where id = $2`, [F.admin, F.bGrantedOnly]), /23514|listing_boosts_revoke_consistent/);
ok('PROPOSED 0077 keeps the useful half of the invariant: a boost cannot name a revoker unless it is revoked');

// 4f. the granting staff account (warner, verifier, granter): every record is retained with a NULL pointer
const w0 = (await rows(fixed.db, `select count(*)::int c from admin_audit_log`))[0].c;
await del(fixed.db, F.admin);
assert.equal((await rows(fixed.db, `select count(*)::int c from admin_audit_log`))[0].c, w0, 'no audit row is deleted');
assert.equal((await rows(fixed.db, `select count(*)::int c from admin_audit_log where admin_id = $1`, [F.admin]))[0].c, 0);
const warn = await rows(fixed.db, `select admin_id, reason from moderation_warnings where user_id=$1`, [F.alice]);
assert.equal(warn.length, 1); assert.equal(warn[0].admin_id, null); assert.equal(warn[0].reason, 'spam');
const ver = await rows(fixed.db, `select actor_id, action from profile_verification_events where profile_id=$1`, [F.alice]);
assert.deepEqual(ver.map((v) => [v.action, v.actor_id]), [['grant', null]]);
const boosts = await rows(fixed.db, `select id, granted_by, revoked_by from listing_boosts order by id`);
assert.equal(boosts.length, 2); assert.ok(boosts.every((b) => b.granted_by === null && b.revoked_by === null));
assert.ok((await fixed.db.query(`select boosted_until from listings where id=$1`, [F.L2])).rows[0].boosted_until, 'the boost itself (listing visibility) is unaffected by the granter leaving');
assert.equal((await rows(fixed.db, `select count(*)::int c from admin_users where user_id in ($1,$2)`, [F.admin, F.admin2]))[0].c, 0);
ok('staff audit records (warning, verification event, boost grant/revoke, audit log): ALL retained, only the staff pointer is NULL; the staff role rows are removed; the boost stays in force');

// 4g. policy for records ABOUT a deleted subject
await del(fixed.db, F.alice);
assert.equal((await rows(fixed.db, `select count(*)::int c from moderation_warnings where user_id=$1`, [F.alice]))[0].c, 0, 'warnings about a deleted user go with the user');
assert.equal((await rows(fixed.db, `select count(*)::int c from profile_verification_events where profile_id=$1`, [F.alice]))[0].c, 0);
assert.equal((await rows(fixed.db, `select count(*)::int c from listing_boosts`))[0].c, 0, "boosts are removed with the listing they boost");
const orphanTargets = await rows(fixed.db, `select count(*)::int c from admin_audit_log where target_id = $1`, [F.alice]);
assert.ok(orphanTargets[0].c > 0, 'OBSERVED: audit rows keep the deleted user\'s id as target_id text (no FK); they hold no name/contact data');
ok('records about a deleted user (warnings, verification events, listing boosts) are deleted with them; the audit log keeps rows referencing their bare id as text (by design: the accountability trail)');

// 4h. The one remaining blocker (0054, explicit RESTRICT): a staff account that decided a business-verification request cannot be deleted.
await fixed.db.query(`insert into public.storefronts(owner_id, name) values ($1,'Dave Shop')`, [F.dave]);
const sf = (await rows(fixed.db, `select id from public.storefronts where owner_id=$1`, [F.dave]))[0].id;
await fixed.db.query(`insert into public.storefront_verification_requests(storefront_id, owner_id, document_paths, submitted_name, status, reviewed_by, reviewed_at) values ($1,$2,$3,'Dave Shop','approved',$4,now())`, [sf, F.dave, [`${F.dave}/${uuid(7)}.jpg`], F.admin3]);
const s1 = await snap(fixed.db);
await delFails(fixed.db, F.admin3, /23001.*storefront_verification_requests_reviewed_by_fkey/);
assert.equal(await snap(fixed.db), s1);
ok('REMAINING BLOCKER (by design, 0054): deleting a staff account that decided a storefront verification fails with 23001 (RESTRICT), atomically; the edge function would return 500 for that account');
await fixed.db.query(`update public.storefront_verification_requests set reviewed_by = null`);

// ---- 5. Null-actor consumers ---------------------------------------------------------------------------------------------------------
// 5a. Static: every use of an actor column in a function body or RLS policy, pinned to a reviewed list. A new use makes this fail and demands review.
//     Reviewed meaning: WRITES stamp the staff caller (`revoked_by = auth.uid()` in staff-only RPCs); READS are LEFT JOINs to profiles for a display
//     name (a NULL actor simply finds no profile). Nothing compares an actor column with the caller's identity, so a NULL actor can never match a caller
//     and can never be mistaken for "no caller".
const colRe = '(admin_id|actor_id|author_id|granted_by|revoked_by)';
const policies = await rows(head.db, `select tablename, policyname from pg_policies where schemaname in ('public','storage') and (coalesce(qual,'') || coalesce(with_check,'')) ~* $1`, [colRe]);
assert.deepEqual(policies, [], 'no RLS policy mentions a nullable actor column');
const useSql = `select p.proname, m[1] m from pg_proc p join pg_namespace n on n.oid=p.pronamespace, regexp_matches(p.prosrc, $1, 'gi') m where n.nspname in ('public','private') order by 1,2`;
const uses = [
  ...(await rows(head.db, useSql, [`(\\m${colRe}\\M\\s*(=|<>|!=|is\\s+(not\\s+)?distinct\\s+from)\\s*[^,;)]{0,30})`])),
  ...(await rows(head.db, useSql, [`((=|<>|!=|distinct\\s+from)\\s*(\\w+\\.)?${colRe}\\M)`])),
].map((r) => `${r.proname}: ${r.m}`);
assert.deepEqual(uses, [
  'admin_moderate_listing: revoked_by = auth.uid(',
  'admin_moderate_user: revoked_by = auth.uid(',
  'admin_revoke_boost: revoked_by = auth.uid(',
  'admin_listing_detail: = e.actor_id',
  'admin_report_detail: = au.admin_id',
  'admin_report_detail: = e.actor_id',
  'admin_report_detail: = e.actor_id',
  'admin_report_detail: = n.author_id',
]);
ok('static scan of pg_policies and function bodies: no RLS policy references an actor column; the 8 function uses are 3 staff-only writes (revoked_by = auth.uid()) and 5 LEFT-JOIN name lookups, none a comparison with the caller');

// 5b. Runtime: staff screens still work and show a neutral name when the actor is gone; authorization is unaffected.
const { q: qf, fails: failsF } = actors(fixed.db);
const reportNow = (await qf(F.admin3, `select public.admin_report_queue(null,null,null,null,null,null,25,0) r`)).rows[0].r;
const L5 = uuid(905);
await fixed.db.query(`insert into public.listings (id,user_id,title,description,category,city,price,currency,condition,images,status) values ($1,$2,'Dave lamp','Barely used, pickup only','sports','Hargeisa',20,'USD','used',array['r2/a.jpg','r2/b.jpg','r2/c.jpg'],'available')`, [L5, F.dave]);
const rep3 = (await F.q(F.erin, `insert into public.reports(reporter_id,target_type,target_id,reason) values ($1,'listing',$2,'Spam') returning id`, [F.erin, L5])).rows[0].id;
await F.q(F.admin3, `select public.admin_add_report_note($1,'by a staff member who stays')`, [rep3]);
// seed a note whose author is already gone (the state 0074 produces)
await fixed.db.query(`insert into report_notes(report_id, author_id, note) values ($1, null, 'orphan note')`, [rep3]);
const detail = (await qf(F.admin3, `select public.admin_report_detail($1) r`, [rep3])).rows[0].r;
assert.equal(detail.notes.length, 2);
assert.deepEqual(detail.notes.map((n) => n.author_name).sort(), ['Staff', `User 3`].sort(), 'a deleted note author is shown as "Staff", never null/blank');
const allNames = JSON.stringify(detail);
assert.ok(!/"(actor_name|author_name|admin_name)":null/.test(allNames), 'no null staff name in the report detail payload');
assert.ok(Array.isArray(reportNow));
const auditRpc = await rows(fixed.db, `select count(*)::int c from admin_audit_log where admin_id is null`);
assert.ok(auditRpc[0].c > 0);
ok('admin_report_detail / admin_report_queue run with NULL note authors and NULL audit actors and label them "Staff" (no crash, no null name)');

// 5c. Authorization: rows with NULL actors are not readable by non-staff or anonymous callers, and a caller without an id gains nothing.
const asDave = await qf(F.dave, `select count(*)::int c from public.admin_audit_log`);
const asAnon = await qf(null, `select count(*)::int c from public.admin_audit_log`).catch((e) => ({ rows: [{ c: 0, e: e.code }] }));
const asAdmin = await qf(F.admin3, `select count(*)::int c from public.admin_audit_log where admin_id is null`);
assert.equal(asDave.rows[0].c, 0, 'a regular user sees no audit rows (including NULL-actor rows)');
assert.equal(asAnon.rows[0].c, 0);
assert.ok(asAdmin.rows[0].c > 0, 'staff still read them');
await failsF(F.dave, `select public.admin_revoke_boost($1,'try')`, [uuid(1)], /42501|Only an admin/);
await failsF(null, `select public.admin_warn_user($1,'x','y')`, [F.dave], /42501|28000|Only|permission denied|admin/i);
// the NULL-pointer trap: auth.uid() is NULL for anon; make sure no staff check evaluates "NULL = NULL" as true
assert.equal((await fixed.db.query(`select (null::uuid = auth.uid()) is true t, public.is_admin() a`)).rows[0].t, false);
ok('authorization: NULL-actor audit rows are invisible to users and anon, staff RPCs refuse non-staff and anon, and public.is_admin() never keys off the actor columns');

// ---- 6. Forward migration + rollback on a disposable DB with representative data ----------------------------------------------------
// 6a. rollback is refused (atomically) once a NULL actor exists
const pre = await boot({ upTo: '0073' });
const P = await world(pre.db);
const before74 = await fkCatalog(pre.db);
await pre.db.exec(sqlFile('migrations/0074_account_deletion_fk_fix.sql'));
assert.deepEqual(await fkCatalog(pre.db).then((c) => c.filter((r) => r.del === 'n').map(key)).then((a) => a.sort()),
  ['admin_audit_log.admin_id', 'listing_boosts.granted_by', 'listing_boosts.revoked_by', 'moderation_warnings.admin_id', 'profile_verification_events.actor_id', 'report_notes.author_id'].concat(fkBefore.filter((r) => r.del === 'n').map(key)).sort());
const dataBefore = await snap(pre.db);
ok('forward 0074 applies on a populated 0073 database (staff audit rows, boosts, notes, verification events, offers present) without touching any row');
// 0074 is re-runnable (drop + add of the same names, DROP NOT NULL twice): running it again changes nothing
const cat74 = JSON.stringify(await fkCatalog(pre.db));
await pre.db.exec(sqlFile('migrations/0074_account_deletion_fk_fix.sql'));
assert.equal(JSON.stringify(await fkCatalog(pre.db)), cat74);
assert.equal(await snap(pre.db), dataBefore);
// 6b. rollback with no NULL actors present: clean, and the catalog equals the pre-0074 catalog exactly
await pre.db.exec(ROLLBACK_0074);
const after74rb = await fkCatalog(pre.db);
assert.deepEqual(after74rb.map((r) => [key(r), r.del, r.cols_not_null]), before74.map((r) => [key(r), r.del, r.cols_not_null]), 'rollback restores the pre-0074 FK actions and NOT NULL exactly');
assert.equal(await snap(pre.db), dataBefore, 'no row changed');
await delFails(pre.db, P.admin, /23503/);
ok('rollback 0074 with no NULL actors: FK actions and NOT NULL are restored exactly (catalog identical to 0073), data untouched, staff deletion is blocked again');
// 6c. re-apply forward after rollback
await pre.db.exec(sqlFile('migrations/0074_account_deletion_fk_fix.sql'));
ok('0074 re-applies cleanly after its rollback');

// 6d. failure path: rollback refuses when ANY of the five columns holds NULL, names it, and changes nothing
for (const [tbl, col, setup] of [
  ['admin_audit_log', 'admin_id', null],
  ['moderation_warnings', 'admin_id', null],
  ['profile_verification_events', 'actor_id', null],
  ['listing_boosts', 'granted_by', null],
  ['report_notes', 'author_id', null],
]) {
  const t = await boot({ upTo: '0074' });
  const T = await world(t.db);
  await del(t.db, T.admin); // leaves NULLs in the audit log, warnings, boosts, verification events
  await del(t.db, T.mod); // leaves a NULL report note author
  // repair every column except the one under test, so each case proves ITS column alone blocks the rollback
  const donor = T.admin3;
  for (const [t2, c2] of [['admin_audit_log', 'admin_id'], ['moderation_warnings', 'admin_id'], ['profile_verification_events', 'actor_id'], ['listing_boosts', 'granted_by'], ['report_notes', 'author_id']]) {
    if (t2 === tbl && c2 === col) continue;
    await t.db.query(`update public.${t2} set ${c2} = $1 where ${c2} is null`, [donor]);
  }
  const s = await snap(t.db);
  const cat = JSON.stringify(await fkCatalog(t.db));
  let err;
  try { await t.db.exec(ROLLBACK_0074); } catch (e) { err = e; }
  assert.ok(err, `${tbl}.${col}: rollback must refuse`);
  assert.match(err.message, new RegExp(`${tbl}\\.${col}=\\d+`));
  assert.match(err.message, /nothing was changed/);
  await t.db.exec('rollback').catch(() => {});
  assert.equal(JSON.stringify(await fkCatalog(t.db)), cat, 'catalog unchanged after the refusal');
  assert.equal(await snap(t.db), s, 'rows unchanged after the refusal');
  assert.equal((await t.db.query(`select is_nullable from information_schema.columns where table_name=$1 and column_name=$2`, [tbl, col])).rows[0].is_nullable, 'YES');
}
ok('rollback 0074 REFUSES (atomically, naming table.column=count) when any one of the five columns holds a NULL actor: admin_audit_log, moderation_warnings, profile_verification_events, listing_boosts.granted_by, report_notes; no FK, constraint or row changes');

// 6e. the refusal does not fabricate or delete anything: row counts and null counts identical before/after
const nul = async (db) => (await rows(db, `select (select count(*) from admin_audit_log where admin_id is null)::int a, (select count(*) from admin_audit_log)::int n`))[0];
const t2 = await boot({ upTo: '0074' }); const T2 = await world(t2.db); await del(t2.db, T2.admin);
const n0 = await nul(t2.db);
await assert.rejects(() => t2.db.exec(ROLLBACK_0074), /nothing was changed/); await t2.db.exec('rollback').catch(() => {});
assert.deepEqual(await nul(t2.db), n0);
assert.ok(n0.a > 0);
ok('after a refused rollback the NULL actors are still NULL (nothing invented, nothing deleted): audit rows and null counts identical');

// 6f. proposed 0077 forward + rollback, including its refusal
const r77 = await boot({ upTo: '0074', extraMigrations: [PROPOSED_0077] }); const R77 = await world(r77.db);
await r77.db.exec(ROLLBACK_0077); // nothing orphaned yet -> allowed
await r77.db.exec(sqlFile(PROPOSED_0077));
await del(r77.db, R77.admin2);
await assert.rejects(() => r77.db.exec(ROLLBACK_0077), /revoker|nothing was changed/); await r77.db.exec('rollback').catch(() => {});
assert.equal((await r77.db.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname='listing_boosts_revoke_consistent'`)).rows[0].d, 'CHECK (((revoked_by IS NULL) OR (revoked_at IS NOT NULL)))');
ok('proposed 0077 round-trips while no revoker has been deleted; its rollback REFUSES (and changes nothing) once a revoked boost has lost its revoker');

// ---- 7. Interaction with 0075 / 0076 -----------------------------------------------------------------------------------------------
// 7a. FK policy of the 0075 additions agrees with 0074: profile_name_changes.user_id cascades, waived_by is SET NULL.
const names = fkHead.filter((r) => r.tbl.endsWith('profile_name_changes')).map((r) => `${r.cols} ${DEL[r.del]}`).sort();
assert.deepEqual(names, ['user_id cascade', 'waived_by set null']);
const x = await boot({ extraMigrations: [PROPOSED_0077] });
const X = await world(x.db);
const { q: qx } = actors(x.db);
await qx(X.alice, `update profiles set full_name='Alice One' where id=$1`, [X.alice]);
await qx(X.alice, `update profiles set full_name='Alice Two' where id=$1`, [X.alice]);
await qx(X.admin3, `select public.admin_reset_name_changes($1,'support request')`, [X.alice]);
assert.equal((await rows(x.db, `select count(*)::int c from profile_name_changes where waived_by=$1`, [X.admin3]))[0].c, 2);
await del(x.db, X.admin3);
assert.equal((await rows(x.db, `select count(*)::int c from profile_name_changes where waived_at is not null and waived_by is null`))[0].c, 2, 'waiver rows kept, waiver actor NULL');
assert.ok((await rows(x.db, `select count(*)::int c from admin_audit_log where action='reset_name_changes' and admin_id is null`))[0].c === 1, '0075 audit row retained with NULL admin (0074 makes this deletion possible)');
await del(x.db, X.alice);
assert.equal((await rows(x.db, `select count(*)::int c from profile_name_changes`))[0].c, 0, "the user's name history is deleted with them");
ok('0075 under 0074: admin_reset_name_changes audit row and waived_by survive the admin\'s deletion with NULL; the subject\'s name history is deleted with the subject');

// 7b. rollback order. Apply 0076's rollback then 0075's (documented order) vs the reverse, and compare the final catalog + function bodies.
const RB75 = sqlFile('rollback/0075_unified_identity_name_limit_ROLLBACK.sql');
const RB76 = sqlFile('rollback/0076_nameless_business_compat_ROLLBACK.sql');
const fingerprint = async (db) => JSON.stringify({
  fns: await rows(db, `select n.nspname, p.proname, md5(pg_get_functiondef(p.oid)) h from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') order by 1,2,3`),
  tables: await rows(db, `select table_schema, table_name from information_schema.tables where table_schema in ('public','private') order by 1,2`),
  trig: await rows(db, `select tgname from pg_trigger where not tgisinternal order by 1`),
  fk: (await fkCatalog(db)).map((r) => [key(r), r.del]),
  modes: await rows(db, `select id, active_mode from profiles order by id`),
});
async function populated() {
  const d = await boot();
  const [a1, a2, n1, n2, n3] = await seedUsers(d.db, 5); // a1 admin, n1: nameless business, n2: named business, n3: regular
  await d.db.query(`insert into admin_users(user_id, role) values ($1,'admin')`, [a1]);
  const { q } = actors(d.db);
  await d.db.query(`update profiles set business_name='Named Shop' where id=$1`, [n2]);
  await d.db.exec("select set_config('fursad.admin_write','true',false)");
  await d.db.query(`update profiles set active_mode='business' where id in ($1,$2)`, [n1, n2]);
  await d.db.exec("select set_config('fursad.admin_write','',false)");
  await q(n1, `insert into listings (user_id,title,description,category,city,price,currency,condition,images,status,seller_presentation) values ($1,'Nameless biz item','Barely used, pickup only','sports','Hargeisa',10,'USD','used',array['r2/a.jpg','r2/b.jpg','r2/c.jpg'],'available','business')`, [n1]);
  await q(n3, `select * from public.start_business_conversation($1)`, [n1]);
  await q(n1, `update profiles set full_name='Renamed Once' where id=$1`, [n1]);
  return { ...d, a1, n1, n2, n3 };
}
const right = await populated();
await right.db.exec(RB76); await right.db.exec(RB75);
const wrong = await populated();
await wrong.db.exec(RB75); await wrong.db.exec(RB76);
const fpRight = await fingerprint(right.db), fpWrong = await fingerprint(wrong.db);
const demotedRight = (await rows(right.db, `select count(*)::int c from private.rollback_0075_demoted_profiles`))[0].c;
const demotedWrong = (await rows(wrong.db, `select count(*)::int c from private.rollback_0075_demoted_profiles`))[0].c;
assert.equal(demotedRight, 1); assert.equal(demotedWrong, 1);
const orderMatters = fpRight !== fpWrong;
ok(`ROLLBACK ORDER measured: 0076->0075 (documented) and 0075->0076 (reverse) end in ${orderMatters ? 'DIFFERENT' : 'IDENTICAL'} catalogs/function bodies/modes; both demote exactly 1 nameless business account`);

// 7c. mid-way state: 0075 rolled back while 0076 is still applied. What does the 0076 behaviour do to the account that was just demoted?
{
  const mid = await populated();
  await mid.db.exec(RB75);
  const failsMid = await actors(mid.db).fails(mid.n3, `select * from public.start_business_conversation($1)`, [mid.n1], /Business not found/);
  assert.ok(failsMid, 'the demoted account is no longer reachable by direct business chat');
  // 0076 is still installed (it accepts active_mode='business' OR a business name) and is harmless on its own, but the documented pair is no longer coherent:
  const gdef = (await mid.db.query(`select pg_get_functiondef('public.guard_listing_seller_presentation'::regproc) d`)).rows[0].d;
  assert.match(gdef, /active_mode = 'business'/);
  await mid.db.exec(RB76); // still runs after the wrong order
}
ok('wrong order (0075 first) leaves 0076 installed on top of a schema whose "business without a name" rule is gone, until 0076 is rolled back too; it still completes');

// 7d. 0074 rollback position: independent of 0075/0076 object-wise, but must come last (see headers) - prove it runs after both with data present
{
  const full = await populated();
  await full.db.exec(RB76); await full.db.exec(RB75); await full.db.exec(ROLLBACK_0074);
  assert.ok((await fkCatalog(full.db)).filter((r) => ACTOR_COLS.includes(key(r))).every((r) => r.del === 'a' && r.cols_not_null));
  const fix2 = await populated(); // and the other way round: 0074 rolled back while 0075/0076 are still applied
  await fix2.db.exec(ROLLBACK_0074);
  assert.ok((await fkCatalog(fix2.db)).filter((r) => ACTOR_COLS.includes(key(r))).every((r) => r.del === 'a'));
  // 0075's own rollback archive table has an FK to profiles with ON DELETE CASCADE: deleting a demoted account must still work after all rollbacks
  await fix2.db.exec(RB76); await fix2.db.exec(RB75);
  await del(fix2.db, fix2.n1);
  assert.equal((await rows(fix2.db, `select count(*)::int c from private.rollback_0075_demoted_profiles where profile_id=$1`, [fix2.n1]))[0].c, 0, 'recovery rows do not outlive the account');
  assert.equal((await rows(fix2.db, `select count(*)::int c from private.rollback_0075_name_change_archive where user_id=$1`, [fix2.n1]))[0].c, 0);
}
ok('0074 rollback composes with the 0076 and 0075 rollbacks in either position; the 0075 recovery tables (private.rollback_0075_*) are removed with a deleted account, so account-deletion rules still hold');

console.log('account_deletion_0074: all assertions passed');
process.exit(0);
