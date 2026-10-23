// 0064 — active profile identity. Real Postgres (PGlite), the REAL migration chain and the REAL rollback SQL.
// Proves: default personal; business needs a name; only the RPC switches (direct writes refused); other users read the new mode
// straight away; clearing the business name falls back to personal; switching never touches names, photos or verification;
// anon cannot switch; backfill rule; rollback is clean and re-runnable.
// Not proven here: PostgREST, Realtime delivery, the apps (see tests/profileIdentity.test.ts for the display rules).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, actors, seedUsers, ok } from './harness/db.mjs';

const { db, applied } = await boot();
assert.ok(applied.includes('0064_profile_active_mode.sql'));
const { q, fails } = actors(db);
const [alice, bob] = await seedUsers(db, 2);
const mode = async (uid) => (await db.query(`select active_mode m from public.profiles where id=$1`, [uid])).rows[0].m;

assert.equal(await mode(alice), 'personal');
ok('a new profile is personal');

await fails(alice, `select public.set_active_mode('team')`, [], /22023|Unknown/);
await fails(null, `select public.set_active_mode('personal')`, [], /permission denied|42501|28000/);
ok('unknown modes and anon are refused');

await db.query(`update public.profiles set business_name='Abdi', business_logo_url=null, full_name='Alice Personal', verified_at=now(), avatar_url=null where id=$1`, [alice]);
await q(alice, `select public.set_active_mode('business')`);
assert.equal(await mode(alice), 'business');
const seenByBob = (await q(bob, `select active_mode, business_name, full_name from public.profiles where id=$1`, [alice])).rows[0];
assert.deepEqual({ ...seenByBob }, { active_mode: 'business', business_name: 'Abdi', full_name: 'Alice Personal' });
ok('the owner switches to business and another user reads the new mode immediately');

await q(alice, `select public.set_active_mode('personal')`);
const back = (await db.query(`select active_mode, business_name, full_name, (verified_at is not null) v from public.profiles where id=$1`, [alice])).rows[0];
assert.deepEqual({ ...back }, { active_mode: 'personal', business_name: 'Abdi', full_name: 'Alice Personal', v: true });
ok('switching back changes only the mode: names and personal verification are untouched');

await fails(alice, `update public.profiles set active_mode='business' where id=$1`, [alice], /active_mode_rpc_only|Use set_active_mode/);
await fails(bob, `update public.profiles set active_mode='business' where id=$1`, [alice]).catch(() => {});
assert.equal(await mode(alice), 'personal');
ok('a direct client write of active_mode is refused');

// 0075: business mode needs no business name (one identity per account); clearing the legacy name does not flip the mode.
await q(alice, `select public.set_active_mode('business')`);
await q(alice, `update public.profiles set business_name=null where id=$1`, [alice]);
assert.equal(await mode(alice), 'business');
ok('business mode does not depend on the legacy business name (0075)');

// backfill rule, replayed on the migration's own statement
await db.query(`update public.profiles set business_name='Shop' where id=$1`, [bob]);
await db.query(`update public.profiles set active_mode='business' where nullif(btrim(business_name),'') is not null and id=$1`, [bob]);
assert.equal(await mode(bob), 'business');
ok('accounts that already had a business name can be backfilled to business');

// rollback
const rollback = readFileSync(new URL('../rollback/0064_profile_active_mode_ROLLBACK.sql', import.meta.url), 'utf8');
await db.exec(rollback);
await db.exec(rollback);
assert.equal((await db.query(`select count(*)::int n from information_schema.columns where table_name='profiles' and column_name='active_mode'`)).rows[0].n, 0);
assert.equal((await db.query(`select count(*)::int n from pg_proc where proname='set_active_mode'`)).rows[0].n, 0);
ok('rollback removes the column, trigger and RPC and is re-runnable');
console.log('profile_active_mode: all passed');
