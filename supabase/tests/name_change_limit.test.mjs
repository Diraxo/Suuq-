// 0075 — unified identity: business mode needs no business name, and display-name changes are limited to 2 per rolling 7 days.
// Real Postgres (PGlite), the REAL migration chain and the REAL rollback SQL.
// Proves: limit enforced in the database for direct client writes; unchanged name / avatar / bio / city edits are free; first name is
// free; the window rolls; per-account (another user is independent, mode switching does not reset); parallel attempts cannot exceed
// the limit; status RPC numbers; admin correction (admin only, reason required, audited); staff/service writes are not limited;
// history is private; rollback is clean.
// Not proven here: PostgREST, true multi-connection concurrency (PGlite is one connection: the parallel test proves the statements
// serialise and the trigger counts correctly, not lock behaviour across real connections), the apps.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, actors, seedUsers, ok } from './harness/db.mjs';

const { db, applied } = await boot();
assert.ok(applied.includes('0075_unified_identity_name_limit.sql'));
const { q, fails } = actors(db);
const [alice, bob, root] = await seedUsers(db, 3);
const name = async (uid) => (await db.query(`select full_name n from public.profiles where id=$1`, [uid])).rows[0].n;
const status = async (uid) => (await q(uid, `select public.my_name_change_status() s`)).rows[0].s;
const rename = (uid, n) => q(uid, `update public.profiles set full_name=$2 where id=$1`, [uid, n]);
const LIMIT = /name_change_limit/;
// The harness leaves the last actor's request.jwt.claim.sub set on the session; a real service-role / migration write carries no user id.
const asService = async (sql, params) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false)`);
  return db.query(sql, params);
};

await db.query(`update public.profiles set full_name='Alice One' where id=$1`, [alice]);
await db.query(`update public.profiles set full_name='Bob One' where id=$1`, [bob]);

let s = await status(alice);
assert.deepEqual({ limit: s.limit, used: s.used, remaining: s.remaining, next: s.next_available_at }, { limit: 2, used: 0, remaining: 2, next: null });
ok('a fresh (existing) account has both changes available');

await rename(alice, 'Alice One');
await q(alice, `update public.profiles set bio='hello', city='Hargeisa', avatar_url=null where id=$1`, [alice]);
await rename(alice, '  Alice One  ');
assert.equal((await status(alice)).used, 0);
ok('saving the same name, or editing bio / city / avatar, is not counted');

await rename(alice, 'Alice Two');
await rename(alice, 'Alice Three');
s = await status(alice);
assert.deepEqual({ used: s.used, remaining: s.remaining }, { used: 2, remaining: 0 });
assert.ok(s.next_available_at, 'next_available_at is set once the limit is reached');
ok('two real changes are counted and remaining drops to 0');

const e = await fails(alice, `update public.profiles set full_name='Alice Four' where id=$1`, [alice], LIMIT);
assert.match(String(e.detail ?? ''), /^\d{4}-\d\d-\d\d/);
assert.equal(await name(alice), 'Alice Three');
ok('the third change inside 7 days is refused by the database and reports when the next one is allowed');

await q(alice, `select public.set_active_mode('business')`);
await q(alice, `select public.set_active_mode('personal')`);
await fails(alice, `update public.profiles set full_name='Alice Five' where id=$1`, [alice], LIMIT);
ok('switching mode does not reset the limit');

await rename(bob, 'Bob Two');
assert.equal((await status(bob)).used, 1);
assert.equal((await status(alice)).used, 2);
ok('the limit is per account');

// rolling window: age the oldest change past 7 days
await db.query(`update public.profile_name_changes set changed_at = now() - interval '8 days' where id = (select id from public.profile_name_changes where user_id=$1 order by changed_at limit 1)`, [alice]);
s = await status(alice);
assert.equal(s.used, 1);
assert.equal(s.remaining, 1);
await rename(alice, 'Alice Six');
await fails(alice, `update public.profiles set full_name='Alice Seven' where id=$1`, [alice], LIMIT);
ok('the window rolls: a change older than 7 days frees one slot, and only one');

// parallel attempts: Bob has 1 used; fire 5 at once, exactly 1 may succeed
const results = await Promise.allSettled(['P1', 'P2', 'P3', 'P4', 'P5'].map((n) => rename(bob, `Bob ${n}`)));
assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
assert.equal(results.filter((r) => r.status === 'rejected' && LIMIT.test(String(r.reason?.message))).length, 4);
assert.equal((await status(bob)).used, 2);
ok('parallel attempts cannot exceed the limit');

// a failed update (another rule rejects it) leaves no phantom history row
const before = (await status(root)).used;
await asService(`update public.profiles set full_name='Root One' where id=$1`, [root]);
await fails(root, `update public.profiles set full_name='Root Two', active_mode='business' where id=$1`, [root], /set_active_mode/);
assert.equal((await status(root)).used, before);
ok('a rejected save does not consume a change');

// staff / service writes are not limited and not counted
const rootUsed = (await status(root)).used;
for (const n of ['R1', 'R2', 'R3', 'R4']) await asService(`update public.profiles set full_name=$2 where id=$1`, [root, n]);
assert.equal((await status(root)).used, rootUsed);
ok('writes outside a user session (service role, migrations) are neither limited nor counted');

// history is private
await fails(alice, `select * from public.profile_name_changes`, [], /permission denied|42501/);
await fails(null, `select public.my_name_change_status()`, [], /permission denied|42501|28000/);
ok('the history table is private and anon cannot read the status');

// admin correction
await fails(bob, `select public.admin_reset_name_changes($1, 'because')`, [alice], /Admins only|42501/);
await db.query(`insert into public.admin_users(user_id, role) values ($1, 'admin')`, [root]);
await fails(root, `select public.admin_reset_name_changes($1, '  ')`, [alice], /reason are required|22023/);
const waived = (await q(root, `select public.admin_reset_name_changes($1, 'Typo fixed by support ticket 123') n`, [alice])).rows[0].n;
assert.equal(waived, 2);
assert.equal((await status(alice)).used, 0);
await rename(alice, 'Alice Eight');
assert.equal((await status(alice)).used, 1);
const audit = (await db.query(`select action, target_id, reason from public.admin_audit_log where action='reset_name_changes'`)).rows;
assert.equal(audit.length, 1);
assert.equal(audit[0].target_id, alice);
ok('an admin can waive the window (reason required, audited); a normal user cannot');

// 0075 part 1: business mode without a business name, via the RPC, with no second identity created
await q(bob, `select public.set_active_mode('business')`);
const b = (await db.query(`select active_mode, business_name, business_logo_url, full_name from public.profiles where id=$1`, [bob])).rows[0];
assert.equal(b.active_mode, 'business');
assert.equal(b.business_name, null);
assert.equal(b.business_logo_url, null);
assert.ok(b.full_name);
ok('business mode works with no business name or logo; the canonical name is untouched');

// rollback
const rollback = readFileSync(new URL('../rollback/0075_unified_identity_name_limit_ROLLBACK.sql', import.meta.url), 'utf8');
await db.exec(rollback);
await db.exec(rollback);
assert.equal((await db.query(`select count(*)::int n from pg_proc where proname in ('my_name_change_status','admin_reset_name_changes','limit_name_change')`)).rows[0].n, 0);
assert.equal((await db.query(`select to_regclass('public.profile_name_changes') t`)).rows[0].t, null);
assert.equal((await db.query(`select active_mode m from public.profiles where id=$1`, [bob])).rows[0].m, 'personal');
const recovered = (await db.query(`select before_active_mode m, before_business_name n from private.rollback_0075_demoted_profiles where profile_id=$1`, [bob])).rows;
assert.deepEqual(recovered.map((r) => ({ ...r })), [{ m: 'business', n: null }], 'the demotion is recorded once, even though the rollback ran twice');
assert.ok((await db.query(`select count(*)::int n from private.rollback_0075_name_change_archive`)).rows[0].n > 0, 'name-change history archived before the table is dropped');
ok('rollback removes the limit and history, is re-runnable, and returns nameless business accounts to personal');
console.log('name_change_limit: all passed');
