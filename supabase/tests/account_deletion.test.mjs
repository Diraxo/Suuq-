// 0055 — account-deletion ledger (blocker B1). Real Postgres (PGlite) running the real migrations 0001..0055, driven through the
// real orchestration code (supabase/functions/_shared/deletionLedger.ts, compiled by `npm test` into .test-build) with a fake Storage
// remover. NOT proven here: the real Storage API's remove() semantics, the edge function itself, real concurrency across connections
// (PGlite is single-connection), real service-role grants. Those are staging gate S7.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { boot, actors, seedUsers, ok, uuid, root } from './harness/db.mjs';

const built = path.join(root, '.test-build', 'supabase', 'functions', '_shared', 'deletionLedger.js');
if (!fs.existsSync(built)) { console.error('Run `npm test` first: this suite imports the compiled deletionLedger.ts from .test-build.'); process.exit(2); }
const { recordVerificationObjects, drainClaimed } = createRequire(import.meta.url)(built);

const { db } = await boot({ upTo: '0055' });
const { fails } = actors(db);
const [alice, bob, carol, dan, erin] = await seedUsers(db, 5);

const addObj = (name, owner) => db.query(`insert into storage.objects(bucket_id,name,owner) values ('storefront-verification',$1,$2)`, [name, owner]);
const objects = async () => (await db.query(`select name from storage.objects where bucket_id='storefront-verification' order by name`)).rows.map((r) => r.name);

// adapter: PGlite as service_role, same rpc(fn, args) shape supabase-js gives the edge function
const TYPES = { p_user: 'uuid', p_job: 'uuid', p_objects: 'jsonb', p_results: 'jsonb', p_limit: 'int', p_max_attempts: 'int' };
const rpc = async (fn, args) => {
  const keys = Object.keys(args);
  const sql = `select * from public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}::${TYPES[k]}`).join(', ')})`;
  const vals = keys.map((k) => (TYPES[k] === 'jsonb' ? JSON.stringify(args[k]) : args[k]));
  try {
    await db.exec('reset role; set role service_role');
    const r = await db.query(sql, vals);
    const data = fn === 'account_deletion_claim' || fn === 'account_deletion_report' ? r.rows : r.rows[0]?.[fn];
    return { data: data ?? null, error: null };
  } catch (e) {
    return { data: null, error: { message: e.message } };
  } finally {
    await db.exec('reset role');
  }
};
/** Fake Storage: really deletes from storage.objects unless the test makes it fail. A missing object is not an error (like Storage). */
let failMode = null; // null | 'all' | Set of names (any batch containing one fails)
const calls = [];
const remover = async (bucket, names) => {
  calls.push({ bucket, names });
  if (failMode === 'all') return { error: { message: 'storage unavailable' } };
  if (failMode instanceof Set && names.some((n) => failMode.has(n))) return { error: { message: 'partial storage failure' } };
  await db.query(`delete from storage.objects where bucket_id=$1 and name = any($2)`, [bucket, names]);
  return { error: null };
};
const job = async (id) => (await db.query(`select * from public.account_deletion_jobs where id=$1`, [id])).rows[0];
const jobObjs = async (id) => (await db.query(`select * from public.account_deletion_objects where job_id=$1 order by name`, [id])).rows;
const due = (id) => db.query(`update public.account_deletion_jobs set next_attempt_at = now() - interval '1 second' where id=$1`, [id]);
const L = (n) => `${alice}/${uuid(n)}.jpg`;

// seed: alice has an attached request (two docs) + one UNATTACHED upload; bob/carol files must never be touched by alice's job
await db.query(`insert into public.storefronts(owner_id, name) values ($1,'Alice Shop')`, [alice]);
const sfAlice = (await db.query(`select id from public.storefronts where owner_id=$1`, [alice])).rows[0].id;
for (const n of [L(1), L(2), L(3)]) await addObj(n, alice);
await addObj(`${bob}/${uuid(9)}.jpg`, bob);
await addObj(`${carol}/${uuid(8)}.pdf`, carol);
await db.query(`insert into public.storefront_verification_requests(storefront_id, owner_id, document_paths, submitted_name) values ($1,$2,$3,'Alice Shop')`, [sfAlice, alice, [L(1), L(2)]]);

// 1. closed to clients
for (const who of [null, alice]) {
  await fails(who, `select * from public.account_deletion_jobs`, [], /42501|permission denied/);
  await fails(who, `select public.account_deletion_begin($1, '[]'::jsonb)`, [alice], /42501|permission denied/);
  await fails(who, `select public.account_deletion_collect_verification_paths($1)`, [alice], /42501|permission denied/);
  await fails(who, `select * from public.account_deletion_claim()`, [], /42501|permission denied/);
}
ok('ledger tables and every ledger function are closed to anon/authenticated (service role only)');

// 2. collection covers attached AND unattached files, only in the user's own folder
assert.deepEqual((await rpc('account_deletion_collect_verification_paths', { p_user: alice })).data, [L(1), L(2), L(3)].sort());
ok('collection: attached + unattached documents of that user only (bob/carol files not included)');

// 3. begin: idempotent, one open job, refuses names outside the user's folder
const j1 = await recordVerificationObjects(rpc, alice);
assert.equal(await recordVerificationObjects(rpc, alice), j1);
assert.equal((await jobObjs(j1)).length, 3);
assert.equal((await db.query(`select count(*)::int c from public.account_deletion_jobs where user_id=$1`, [alice])).rows[0].c, 1);
for (const bad of [`${bob}/x.jpg`, `${alice}/../${bob}/x.jpg`, `${alice}//x.jpg`, 'x.jpg']) {
  assert.ok((await rpc('account_deletion_begin', { p_user: alice, p_objects: [{ bucket: 'storefront-verification', name: bad }] })).error, `must refuse ${bad}`);
}
assert.equal((await jobObjs(j1)).length, 3, 'a refused request adds nothing');
ok("begin: repeated requests converge on ONE job; objects outside the user's own folder (other user, traversal, double slash, bare name) are refused");

// 4. nothing is drainable before the account is actually deleted
assert.equal((await rpc('account_deletion_claim', { p_job: j1 })).data.length, 0);
assert.equal((await job(j1)).status, 'awaiting_account_delete');
ok('a job whose account still exists is not drainable');

// 5. cancellation while the account exists: nothing removed
const jc = await recordVerificationObjects(rpc, carol);
assert.equal((await rpc('account_deletion_cancel', { p_job: jc })).error, null);
assert.equal((await job(jc)).status, 'cancelled');
assert.ok((await objects()).includes(`${carol}/${uuid(8)}.pdf`), 'cancelled job removed nothing');
const jc2 = await recordVerificationObjects(rpc, carol);
assert.notEqual(jc2, jc, 'a new request after a cancellation opens a new job');
await rpc('account_deletion_cancel', { p_job: jc2 });
ok('deleteUser failure path: cancel marks the job cancelled and nothing is removed');

// 6. the real deletion: the cascade removes the request rows, the LEDGER SURVIVES
await db.query(`delete from auth.users where id=$1`, [alice]);
assert.equal((await db.query(`select count(*)::int c from public.storefront_verification_requests where owner_id=$1`, [alice])).rows[0].c, 0, 'request rows cascaded away');
assert.equal((await jobObjs(j1)).length, 3, 'ledger objects survive the cascade');
assert.equal((await job(j1)).user_id, alice);
assert.match((await rpc('account_deletion_cancel', { p_job: j1 })).error.message, /already deleted/);
ok('account deletion cascades the request rows but the ledger (no FK) keeps every object; cancel is refused afterwards');

await addObj(L(4), alice); // upload that landed between the first collection and the user delete
assert.equal(await recordVerificationObjects(rpc, alice), j1, 'late file joins the same job');
assert.equal((await jobObjs(j1)).length, 4);
await rpc('account_deletion_mark_user_deleted', { p_job: j1 });
assert.equal((await job(j1)).status, 'pending');
ok('a file uploaded after the first collection joins the same job on re-collection');

// 7. partial failure -> pending with backoff, never complete, other users untouched
failMode = new Set([L(2)]);
let res = await drainClaimed(rpc, remover, j1);
assert.equal(res[0].outcome, 'pending');
let jj = await job(j1);
assert.equal(jj.status, 'pending'); assert.equal(jj.attempts, 1); assert.ok(new Date(jj.next_attempt_at) > new Date(), 'backoff scheduled');
assert.match(jj.last_error, /partial storage failure/);
assert.equal(jj.completed_at, null);
assert.ok((await jobObjs(j1)).some((o) => o.state !== 'deleted'));
assert.ok((await objects()).includes(L(2)), 'the failed object is still there');
assert.ok((await objects()).includes(`${bob}/${uuid(9)}.jpg`) && (await objects()).includes(`${carol}/${uuid(8)}.pdf`), "other users' files never touched");
ok('partial storage failure: job stays pending with backoff + error recorded, NEVER completed while an object remains');

// 8. not due yet -> nothing claimed
assert.equal((await rpc('account_deletion_claim', {})).data.length, 0);
ok('retry respects the backoff window');

// 9. retry after the cause is fixed: a missing object counts as deleted, completes, names scrubbed
await due(j1);
await db.query(`delete from storage.objects where name=$1`, [L(3)]); // already gone out-of-band
failMode = null;
res = await drainClaimed(rpc, remover, null);
assert.equal(res[0].outcome, 'completed');
jj = await job(j1);
assert.equal(jj.status, 'completed'); assert.ok(jj.completed_at); assert.equal(jj.attempts, 2);
assert.equal((await objects()).filter((n) => n.startsWith(alice)).length, 0, 'every document is gone from storage');
assert.ok((await jobObjs(j1)).every((o) => o.state === 'deleted' && o.scrubbed && /^[0-9a-f]{64}$/.test(o.name)), 'names scrubbed to digests after completion');
ok('retry succeeds: missing objects count as deleted, job completes, object names are scrubbed from the ledger');

// 10. repeated execution after completion is a no-op
calls.length = 0;
assert.equal((await rpc('account_deletion_claim', { p_job: j1 })).data.length, 0);
assert.deepEqual(await drainClaimed(rpc, remover, null), []);
assert.equal(calls.length, 0);
ok('draining again after completion does nothing');

// 11. escalation at the ceiling, stops auto-retrying, operator requeue resumes
await addObj(`${bob}/${uuid(21)}.jpg`, bob);
const jb = await recordVerificationObjects(rpc, bob);
await db.query(`delete from auth.users where id=$1`, [bob]);
await rpc('account_deletion_mark_user_deleted', { p_job: jb });
failMode = 'all';
const MAX = 3;
for (let i = 1; i <= MAX; i++) {
  await due(jb);
  res = await drainClaimed(rpc, remover, null, { maxAttempts: MAX });
  assert.equal(res[0].outcome, i < MAX ? 'pending' : 'escalated');
}
jj = await job(jb);
assert.equal(jj.status, 'escalated'); assert.ok(jj.escalated_at);
assert.equal((await rpc('account_deletion_claim', {})).data.length, 0, 'escalated jobs are not auto-claimed');
assert.ok((await rpc('account_deletion_report', {})).data.some((r) => r.status === 'escalated' && Number(r.jobs) === 1));
failMode = null;
assert.equal((await rpc('account_deletion_requeue', { p_job: jb })).error, null);
assert.equal((await job(jb)).status, 'pending'); assert.equal((await job(jb)).attempts, 0);
assert.equal((await drainClaimed(rpc, remover, null))[0].outcome, 'completed');
ok('bounded retries: escalates at the ceiling, shows in the report, stops auto-retrying; operator requeue then completes');

// 12. claims are exclusive while leased; a crashed worker's expired lease is reclaimable
await addObj(`${carol}/${uuid(31)}.jpg`, carol);
const jd = await recordVerificationObjects(rpc, carol);
await db.query(`delete from auth.users where id=$1`, [carol]);
await rpc('account_deletion_mark_user_deleted', { p_job: jd });
assert.ok((await rpc('account_deletion_claim', { p_job: jd })).data.length >= 1, 'first worker claims');
assert.equal((await rpc('account_deletion_claim', { p_job: jd })).data.length, 0, 'a second worker gets nothing while the lease is live');
await db.query(`update public.account_deletion_jobs set lease_until = now() - interval '1 second' where id=$1`, [jd]);
assert.ok((await rpc('account_deletion_claim', { p_job: jd })).data.length >= 1, 'expired lease is reclaimed');
await db.query(`update public.account_deletion_jobs set lease_until = now() - interval '1 second' where id=$1`, [jd]);
assert.equal((await drainClaimed(rpc, remover, jd))[0].outcome, 'completed');
ok('claims are exclusive while leased and recoverable after a worker crash');

// 13. record/finish only on a claimed job
assert.match((await rpc('account_deletion_record', { p_job: j1, p_results: [] })).error.message, /not in progress/);
assert.match((await rpc('account_deletion_finish', { p_job: j1 })).error.message, /not in progress/);
ok('record/finish refuse a job that is not claimed');

// 14. reconciliation of a crash between begin and mark
await addObj(`${dan}/${uuid(41)}.jpg`, dan); await addObj(`${erin}/${uuid(42)}.jpg`, erin);
const jdan = await recordVerificationObjects(rpc, dan); const jerin = await recordVerificationObjects(rpc, erin);
await db.query(`update public.account_deletion_jobs set created_at = now() - interval '1 hour' where id = any($1)`, [[jdan, jerin]]);
await db.query(`delete from auth.users where id=$1`, [erin]); // erin's deletion went through; dan's did not
await rpc('account_deletion_claim', { p_job: uuid(999) });
assert.equal((await job(jdan)).status, 'cancelled', 'account still exists -> cancelled, nothing removed');
assert.notEqual((await job(jerin)).status, 'awaiting_account_delete', 'account gone -> becomes drainable');
assert.ok((await objects()).includes(`${dan}/${uuid(41)}.jpg`));
ok('reconciliation: a stale awaiting job is cancelled if the account survived, resumed if it is gone');

// 15. failure to enqueue: the orchestration throws (the edge function then aborts before deleting anything)
const broken = async () => ({ data: null, error: { message: 'db down' } });
await assert.rejects(recordVerificationObjects(broken, alice), /db down/);
await assert.rejects(recordVerificationObjects(async (fn) => (fn === 'account_deletion_begin' ? { data: null, error: null } : { data: [], error: null }), alice), /no job id/);
ok('failure to record the ledger throws, so delete-account can abort before touching anything');

// 16. a remover that throws is treated as a failure, not a crash, not a success
await due(jb); // no-op (completed); build a fresh job instead
await addObj(`${dan}/${uuid(51)}.jpg`, dan);
await db.query(`delete from auth.users where id=$1`, [dan]);
const jdan2 = await recordVerificationObjects(rpc, dan);
await rpc('account_deletion_mark_user_deleted', { p_job: jdan2 });
res = await drainClaimed(rpc, async () => { throw new Error('network reset'); }, jdan2);
assert.equal(res[0].outcome, 'pending');
assert.match((await job(jdan2)).last_error, /network reset/);
ok('a throwing Storage client leaves the job pending with the error, never completed');

console.log('account_deletion: all assertions passed');
process.exit(0);
