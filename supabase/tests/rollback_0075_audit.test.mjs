// 0075 rollback — auditable, atomic, bypass-verified. Real Postgres (PGlite); the chain is applied to 0074, populated with LEGACY data,
// and then 0075 and 0076 are applied one after the other in migration order on that populated database (not just a fresh boot).
// Proves: the before-state of every demoted account is stored in the same transaction (legacy-named accounts are untouched; blank and
// whitespace-only names are demoted and recorded, including accounts that entered business mode after 0075); a failure during demotion
// aborts EVERYTHING (no demotion, no recovery rows, no dropped objects) and names the profile; a re-run is a no-op that adds no rows; the
// recovery data is readable by the owner role, unreadable by app roles, removed with the account, and can be used to restore the accounts
// after 0075 is re-applied; the profile triggers really do stand down under fursad.admin_write (client write refused, same write allowed);
// admin_reset_name_changes writes an audit row that matches the real admin_audit_log schema.
// Not proven here: PostgREST, multi-connection concurrency, a real Supabase project.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, actors, seedUsers, ok, uuid, sqlFile } from './harness/db.mjs';

const { db, applied } = await boot({ upTo: '0074' });
assert.ok(!applied.includes('0075_unified_identity_name_limit.sql'));
const { q, fails } = actors(db);
const [legacyBiz, nameless, blankSpaces, personal, failing, admin] = await seedUsers(db, 6);
await db.exec("select set_config('suuqplus.skip_rate_limit','true',false)");

// legacy data written BEFORE 0075 (business mode needs a name then)
await db.query(`update public.profiles set business_name='Old Shop', active_mode='business' where id=$1`, [legacyBiz]);
assert.equal((await db.query(`select active_mode m from public.profiles where id=$1`, [legacyBiz])).rows[0].m, 'business');
await fails(nameless, `select public.set_active_mode('business')`, [], /business name|business_profile_incomplete|22023/);
ok('setup on 0074: business mode needs a name');

await db.exec(sqlFile('migrations/0075_unified_identity_name_limit.sql'));
await db.exec(sqlFile('migrations/0076_nameless_business_compat.sql'));
ok('0075 then 0076 applied in order on the populated database');

for (const u of [nameless, blankSpaces, failing]) await q(u, `select public.set_active_mode('business')`);
await db.query(`update public.profiles set business_name='   ' where id=$1`, [blankSpaces]);
await q(nameless, `insert into public.listings (id,user_id,title,category,city,price,currency,status,images,seller_presentation) values ($1,$2,'Laptop','electronics','Hargeisa',100,'USD','available',array['https://x.test/a.jpg'],'business')`, [uuid(801), nameless]);
await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false)`); // the harness leaves the last actor's id on the session
await db.query(`update public.profiles set full_name='Nameless Original' where id=$1`, [nameless]);
await q(nameless, `update public.profiles set full_name='Nameless New' where id=$1`, [nameless]);
await db.query(`insert into public.admin_users(user_id, role) values ($1, 'admin')`, [admin]);
const mode = async (id) => (await db.query(`select active_mode m from public.profiles where id=$1`, [id])).rows[0].m;
for (const [id, m] of [[legacyBiz, 'business'], [nameless, 'business'], [blankSpaces, 'business'], [failing, 'business'], [personal, 'personal']]) assert.equal(await mode(id), m);
const historyBefore = (await db.query(`select count(*)::int n from public.profile_name_changes`)).rows[0].n;
assert.ok(historyBefore >= 1);
ok('state before rollback: 1 legacy-named, 3 nameless (incl. whitespace-only) business accounts, a name-change history, a business-presented listing');

// ---- admin_reset_name_changes vs the real admin_audit_log schema ----
const cols = (await db.query(`select column_name c, is_nullable n, data_type t from information_schema.columns where table_schema='public' and table_name='admin_audit_log'`)).rows;
const need = ['admin_id', 'action', 'target_type', 'target_id', 'reason', 'metadata'];
for (const c of need) assert.ok(cols.some((x) => x.c === c), `admin_audit_log.${c}`);
assert.equal(cols.find((x) => x.c === 'target_id').t, 'text');
const requiredOthers = cols.filter((x) => x.n === 'NO' && !need.includes(x.c)).map((x) => x.c);
assert.deepEqual(requiredOthers.filter((c) => !['id', 'created_at'].includes(c)), [], 'no other NOT NULL column without a default is left unset by the function');
const checks = (await db.query(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid='public.admin_audit_log'::regclass and contype='c'`)).rows;
assert.deepEqual(checks, [], 'no CHECK on admin_audit_log.action/target_type that could reject the event');
const waived = (await q(admin, `select public.admin_reset_name_changes($1, 'support ticket 7') n`, [nameless])).rows[0].n;
assert.equal(waived, 1);
const ev = (await db.query(`select admin_id, action, target_type, target_id, reason, metadata from public.admin_audit_log where action='reset_name_changes'`)).rows;
assert.equal(ev.length, 1);
assert.deepEqual({ ...ev[0], metadata: ev[0].metadata }, { admin_id: admin, action: 'reset_name_changes', target_type: 'user', target_id: nameless, reason: 'support ticket 7', metadata: { waived: 1 } });
assert.equal((await q(admin, `select count(*)::int n from public.admin_audit_log`)).rows[0].n, 1);
assert.equal((await q(nameless, `select count(*)::int n from public.admin_audit_log`)).rows[0].n, 0);
ok('admin_reset_name_changes writes a row that matches admin_audit_log (columns, text target_id, no CHECKs); admins can read it, other users cannot');

// ---- admin_write really bypasses the profile triggers (verify, do not assume) ----
const trg = (await db.query(`select t.tgname n, p.proname f, pg_get_functiondef(p.oid) d from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid='public.profiles'::regclass and not t.tgisinternal order by t.tgname`)).rows;
const standDown = trg.filter((t) => /is_client_write\(\)/.test(t.d)).map((t) => t.n);
const inline = trg.filter((t) => !/is_client_write\(\)/.test(t.d) && /fursad\.admin_write/.test(t.d)).map((t) => t.n);
const other = trg.filter((t) => !/is_client_write\(\)/.test(t.d) && !/fursad\.admin_write/.test(t.d)).map((t) => t.n);
console.log('      triggers on profiles that stand down via is_client_write():', standDown.join(', '));
console.log('      stand down via an inline fursad.admin_write test:', inline.join(', ') || '(none)');
console.log('      do not look at admin_write at all:', other.join(', ') || '(none)');
for (const n of ['profiles_b_guard_content', 'profiles_c_business_media_scan', 'profiles_c_media_host_pin', 'profiles_c_url_only_block', 'profiles_d_guard_active_mode']) assert.ok(standDown.includes(n), `${n} uses is_client_write()`);
assert.ok(inline.includes('profiles_e_limit_name_change'));
// The triggers that do not look at admin_write (notify / mirror / updated_at / phone divert) are not exercised one by one: that they accept an
// active_mode-only update is shown by the real rollback demotion below succeeding with all of them installed.

// Each write is refused for a client and allowed under admin_write, in a transaction that is always rolled back.
await db.query(`update public.business_media_config set enforce=true where id`);
const attempt = async (uid, sql, bypass) => {
  await db.exec('begin');
  let err = null;
  try {
    await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub','${uid}',true)`);
    if (bypass) await db.exec(`select set_config('fursad.admin_write','true',true)`);
    await db.query(sql);
  } catch (e) {
    err = e;
  }
  await db.exec('rollback');
  await db.exec('reset role');
  return err;
};
const writes = {
  '0056 content (invalid website)': `update public.profiles set business_website='ftp://bad' where id='${failing}'`,
  '0038 protected column (verified_at)': `update public.profiles set verified_at=now() where id='${failing}'`,
  '0057 media scan (enforce ON, unscanned logo key)': `update public.profiles set business_logo_url='https://cdn.test/business/${failing}/logo/00000000-0000-4000-8000-000000000001.jpg', business_logo_public_id='business/${failing}/logo/00000000-0000-4000-8000-000000000001.jpg' where id='${failing}'`,
  '0063 url-only (new URL-only avatar)': `update public.profiles set avatar_url='https://picsum.photos/200' where id='${failing}'`,
  '0064/0075 mode guard (client changes active_mode)': `update public.profiles set active_mode='personal' where id='${failing}'`,
};
for (const [label, sql] of Object.entries(writes)) {
  const refused = await attempt(failing, sql, false);
  assert.ok(refused, `${label}: expected the client write to be refused`);
  const allowed = await attempt(failing, sql, true);
  if (allowed) {
    // 0056's website rule and friends are the only thing that may still object; report it instead of hiding it
    assert.fail(`${label}: still refused under fursad.admin_write: ${allowed.message}`);
  }
}
await db.query(`update public.business_media_config set enforce=false where id`);
ok('every profile trigger that can reject a write (0038, 0056, 0057, 0062/0063 host+url rules, 0064/0075 mode) is refused for a client and allowed under fursad.admin_write');

// ---- simulated failure during demotion: atomic, names the profile ----
await db.exec(`
  create or replace function public._test_block_demote() returns trigger language plpgsql as $f$
  begin
    if new.id = '${failing}' and new.active_mode = 'personal' and old.active_mode = 'business' then raise exception 'simulated demotion failure'; end if;
    return new;
  end $f$;
  create trigger zz_test_block_demote before update on public.profiles for each row execute function public._test_block_demote();
`);
const rollback = readFileSync(new URL('../rollback/0075_unified_identity_name_limit_ROLLBACK.sql', import.meta.url), 'utf8');
let failure = null;
try {
  await db.exec(rollback);
} catch (e) {
  failure = e;
}
await db.exec('rollback'); // the script's own begin is still open after an error
assert.ok(failure, 'rollback must fail');
assert.match(failure.message, new RegExp(failing));
assert.match(failure.message, /simulated demotion failure/);
assert.match(failure.message, /nothing was changed/);
for (const id of [legacyBiz, nameless, blankSpaces, failing]) assert.equal(await mode(id), 'business', 'no account was demoted');
assert.equal((await db.query(`select to_regclass('private.rollback_0075_demoted_profiles') a, to_regclass('private.rollback_0075_name_change_archive') b`)).rows[0].a, null);
assert.equal((await db.query(`select to_regclass('private.rollback_0075_name_change_archive') b`)).rows[0].b, null);
assert.equal((await db.query(`select count(*)::int n from pg_proc where proname in ('my_name_change_status','admin_reset_name_changes','limit_name_change')`)).rows[0].n, 3);
assert.equal((await db.query(`select count(*)::int n from public.profile_name_changes`)).rows[0].n, historyBefore);
assert.equal((await db.query(`select count(*)::int n from pg_trigger where tgname='profiles_e_limit_name_change'`)).rows[0].n, 1);
ok('a failure while demoting one account aborts the whole rollback: nobody demoted, nothing dropped, no recovery rows left, error names the profile');

await db.exec(`drop trigger zz_test_block_demote on public.profiles; drop function public._test_block_demote();`);

// ---- successful rollback ----
await db.exec(rollback);
assert.equal(await mode(legacyBiz), 'business');
for (const id of [nameless, blankSpaces, failing]) assert.equal(await mode(id), 'personal');
assert.equal(await mode(personal), 'personal');
const rec = (await db.query(`select * from private.rollback_0075_demoted_profiles order by profile_id`)).rows;
assert.deepEqual(rec.map((r) => r.profile_id).sort(), [nameless, blankSpaces, failing].sort());
assert.ok(rec.every((r) => r.before_active_mode === 'business' && r.run_id && r.rolled_back_at));
const byId = Object.fromEntries(rec.map((r) => [r.profile_id, r]));
assert.equal(byId[nameless].before_business_name, null);
assert.equal(byId[blankSpaces].before_business_name, '   ');
assert.equal(byId[nameless].before_full_name, 'Nameless New');
assert.equal(byId[nameless].before_account_status, 'active');
assert.equal(byId[nameless].business_presented_listings, 1);
assert.equal(byId[blankSpaces].business_presented_listings, 0);
assert.equal(new Set(rec.map((r) => r.run_id)).size, 1);
assert.ok(!rec.some((r) => r.profile_id === legacyBiz), 'legacy-named business account is not recorded because it is not touched');
const arch = (await db.query(`select count(*)::int n from private.rollback_0075_name_change_archive`)).rows[0].n;
assert.equal(arch, historyBefore);
assert.equal((await db.query(`select to_regclass('public.profile_name_changes') t`)).rows[0].t, null);
// the 0064 behaviour is back: a nameless account cannot enter business mode, a named one can
await fails(nameless, `select public.set_active_mode('business')`, [], /business name|business_profile_incomplete|22023/);
await q(legacyBiz, `select public.set_active_mode('personal')`);
await q(legacyBiz, `select public.set_active_mode('business')`);
assert.equal((await db.query(`select current_setting('fursad.admin_write', true) v`)).rows[0].v === 'true', false, 'admin_write is not left on for the session after the script');
ok('rollback commits: legacy accounts untouched, blank / whitespace / post-0075 accounts demoted and fully recorded, history archived, 0064 rules restored');

// ---- repeated rollback ----
await db.exec(rollback);
assert.equal((await db.query(`select count(*)::int n from private.rollback_0075_demoted_profiles`)).rows[0].n, 3);
assert.equal((await db.query(`select count(*)::int n from private.rollback_0075_name_change_archive`)).rows[0].n, arch);
ok('running the rollback again changes nothing and adds no recovery rows');

// ---- accessibility / privacy / retention of the recovery data ----
await fails(nameless, `select * from private.rollback_0075_demoted_profiles`, [], /permission denied|42501/);
await fails(admin, `select * from private.rollback_0075_demoted_profiles`, [], /permission denied|42501/);
await fails(null, `select * from private.rollback_0075_name_change_archive`, [], /permission denied|42501/);
assert.equal((await db.query(`select count(*)::int n from private.rollback_0075_demoted_profiles`)).rows[0].n, 3);
assert.equal((await db.query(`select relrowsecurity r from pg_class where oid='private.rollback_0075_demoted_profiles'::regclass`)).rows[0].r, true);
ok('recovery data: readable by the database owner, not by anon / users / app admins (RLS on, no grants)');

// ---- restore from the record ----
await db.exec(sqlFile('migrations/0075_unified_identity_name_limit.sql'));
await db.exec(`select set_config('fursad.admin_write', 'true', true);
  update public.profiles p set active_mode = 'business' from private.rollback_0075_demoted_profiles r where r.profile_id = p.id;`);
for (const id of [nameless, blankSpaces, failing]) assert.equal(await mode(id), 'business');
assert.equal(await mode(personal), 'personal');
ok('the documented restore (re-apply 0075, then update from the recovery table) returns exactly the recorded accounts to business mode');

// ---- retention: deleting an account removes its recovery rows ----
await db.query(`delete from public.profiles where id=$1`, [blankSpaces]);
assert.equal((await db.query(`select count(*)::int n from private.rollback_0075_demoted_profiles where profile_id=$1`, [blankSpaces])).rows[0].n, 0);
ok('recovery rows are removed with the account (ON DELETE CASCADE), so account deletion is not blocked or contradicted');

console.log('rollback_0075_audit: all passed');
