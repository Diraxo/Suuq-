// Rollback of 0055 (account-deletion ledger). Real Postgres (PGlite), the REAL migration and rollback SQL.
// Proves: the rollback refuses while any job is open (so no pending Storage cleanup is orphaned), succeeds when every job is settled,
// leaves no ledger object behind, and the forward migration re-applies cleanly afterwards.
// Not proven here: that the pre-ledger delete-account function is redeployed first (operator step, supabase/rollback header).
import assert from 'node:assert/strict';
import { boot, seedUsers, ok, uuid, sqlFile } from './harness/db.mjs';

const { db } = await boot({ upTo: '0055' });
const [alice, bob] = await seedUsers(db, 2);
const rollback = sqlFile('rollback/0055_account_deletion_ledger_ROLLBACK.sql');
const begin = (u, n) => db.query(`select public.account_deletion_begin($1, $2::jsonb) id`, [u, JSON.stringify([{ bucket: 'storefront-verification', name: `${u}/${uuid(n)}.jpg` }])]).then((r) => r.rows[0].id);
const ledgerObjects = async () => (await db.query(`select (select count(*) from pg_proc where proname like 'account_deletion%')::int fns, to_regclass('public.account_deletion_jobs') j, to_regclass('public.account_deletion_objects') o`)).rows[0];

// 1. refused while a job is open, and the refusal changes nothing
const j1 = await begin(alice, 1);
await assert.rejects(() => db.exec(`begin; ${rollback}; commit;`), /still open/);
await db.exec('rollback').catch(() => {});
const after = await ledgerObjects();
assert.ok(after.j && after.o && after.fns >= 9, 'refused rollback leaves the ledger intact');
assert.equal((await db.query(`select count(*)::int c from public.account_deletion_objects where job_id=$1`, [j1])).rows[0].c, 1);
ok('rollback refuses while a job is open and leaves tables, functions and rows untouched');

// 2. every open status blocks it, not just the first one
for (const status of ['pending', 'in_progress', 'escalated']) {
  await db.query(`update public.account_deletion_jobs set status=$2 where id=$1`, [j1, status]);
  await assert.rejects(() => db.exec(`begin; ${rollback}; commit;`), /still open/, status);
  await db.exec('rollback').catch(() => {});
}
ok("'pending', 'in_progress' and 'escalated' jobs each block the rollback");

// 3. settled jobs (completed/cancelled) do not block it
await db.query(`update public.account_deletion_jobs set status='completed', completed_at=now() where id=$1`, [j1]);
await db.query(`update public.account_deletion_jobs set status='cancelled' where id <> $1`, [j1]);
await db.exec(rollback);
const gone = await ledgerObjects();
assert.deepEqual([gone.fns, gone.j, gone.o], [0, null, null]);
ok('with only completed/cancelled jobs the rollback removes every ledger table and function');

// 4. re-applying 0055 afterwards works (and needs nothing the rollback left behind)
await db.exec(sqlFile('migrations/0055_account_deletion_ledger.sql'));
const again = await ledgerObjects();
assert.ok(again.j && again.o && again.fns >= 9);
assert.ok(await begin(bob, 2));
ok('0055 re-applies cleanly after the rollback and the ledger works again');

console.log('account_deletion_rollback: all assertions passed');
process.exit(0);
