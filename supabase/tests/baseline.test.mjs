// Baseline + regression for the pre-existing column-lock gap.
//
// FINDING (proven here on a real Postgres): migrations 0019 and 0027 try to protect columns with
// `REVOKE UPDATE (col) ON table FROM authenticated`. When the role also holds a TABLE-level UPDATE grant — which is
// Supabase's default for tables in `public` — a column-level REVOKE removes nothing. So on the pre-0038 schema a
// suspended user can lift their own suspension, and a seller can write listings.views / favorites_count.
// 0038/0039 add BEFORE-UPDATE triggers keyed on current_user, which DO work; this test proves both halves.
//
// Caveat (BLOCKED until checked on the real project): the harness reproduces Supabase's default grants; confirm with
//   select grantee, privilege_type from information_schema.role_table_grants where table_name='profiles';
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, sqlFile, uuid } from './harness/db.mjs';

const { db, applied } = await boot({ upTo: '0037' });
ok(`applied ${applied.length} migrations (${applied[0]} … ${applied.at(-1)}) on a fresh database`);
const { q, fails } = actors(db);
const [seller] = await seedUsers(db, 1);
await db.exec(`select set_config('suuqplus.skip_rate_limit','true',false)`);
const L = uuid(500);
await db.query(`insert into public.listings(id,user_id,title,category,city,price) values ($1,$2,'t','electronics','Hargeisa',5)`, [L, seller]);

// ---- BEFORE: the gap is real
await db.query(`update public.profiles set account_status='suspended' where id=$1`, [seller]);
await q(seller, `update public.profiles set account_status='active' where id=$1`, [seller]);
assert.equal((await db.query(`select account_status s from public.profiles where id=$1`, [seller])).rows[0].s, 'active');
ok('BEFORE 0038/0039: a suspended user can set their own account_status back to active (column REVOKE is inert)');
await q(seller, `update public.listings set views = 999999, favorites_count = 999999 where id=$1`, [L]);
assert.equal((await db.query(`select views v from public.listings where id=$1`, [L])).rows[0].v, 999999);
ok('BEFORE 0038/0039: a seller can write their own listings.views / favorites_count directly');

// ---- AFTER: triggers close it
await db.exec(sqlFile('migrations/0038_search_discovery.sql'));
await db.exec(sqlFile('migrations/0039_moderation_enforcement.sql'));
await db.query(`update public.profiles set account_status='suspended', suspended_until = now() + interval '3 days' where id=$1`, [seller]);
await fails(seller, `update public.profiles set account_status='active', suspended_until=null where id=$1`, [seller], /42501|managed by staff/);
await db.query(`update public.profiles set account_status='active', suspended_until=null where id=$1`, [seller]);
await fails(seller, `update public.listings set views = 5 where id=$1`, [L], /42501|Protected/);
ok('AFTER 0038/0039: the same writes are rejected with 42501');
console.log('\nOK baseline.test.mjs');
