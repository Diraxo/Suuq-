// 0058 — business media backfill. Real Postgres (PGlite), full chain 0001..0058.
// Proves the SQL state machine for rescanning logos/banners that were uploaded before the scanner existed: inventory is read-only and
// idempotent, the original state is recorded, work is claimed once (lease + skip locked), crashed claims are recovered, only an
// APPROVED scan can ever be applied, application is compare-and-swap, nothing is deleted, and none of it is reachable by a client.
// Not proven here: the Worker route, R2, Vision (see tests/businessMediaBackfill.test.ts for the control flow with fakes).
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, uuid } from './harness/db.mjs';

const { db } = await boot();
const { q, fails } = actors(db);
const [alice, bob, carol, dave, erin] = await seedUsers(db, 5);
const host = 'https://media.test';
await db.query(`insert into public.storefront_media_hosts(host) values ('media.test') on conflict do nothing`);
const k = (uid, kind, n) => `business/${uid}/${kind}/${uuid(n)}.jpg`;
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const rows = async (sql, p = []) => (await db.query(sql, p)).rows;
const setLegacyProfile = (uid, kind, key) => db.query(`update public.profiles set business_${kind}_url=$2, business_${kind}_public_id=$3 where id=$1`, [uid, `${host}/${key}`, key]);

// Legacy data, written by a non-client (the way pre-scan data exists): alice logo+banner, bob logo, carol external URL-only logo.
await setLegacyProfile(alice, 'logo', k(alice, 'logo', 1));
await setLegacyProfile(alice, 'banner', k(alice, 'banner', 2));
await setLegacyProfile(bob, 'logo', k(bob, 'logo', 3));
await db.query(`update public.profiles set business_logo_url='https://res.cloudinary.com/old/carol.jpg' where id=$1`, [carol]);
await db.query(`insert into public.storefronts(owner_id, name) values ($1,'Dave Store')`, [dave]);
await db.query(`update public.storefronts set logo_url=$2, logo_public_id=$3 where owner_id=$1`, [dave, `${host}/${k(dave, 'logo', 4)}`, k(dave, 'logo', 4)]);
// erin already has an approved scan for her current logo: nothing to backfill
const erinKey = k(erin, 'logo', 5);
await setLegacyProfile(erin, 'logo', erinKey);
await db.query(`insert into public.business_media_scans(user_id,kind,sha256,status,public_key) values ($1,'logo','s','approved',$2)`, [erin, erinKey]);

const profilesBefore = await rows(`select id, business_logo_url, business_logo_public_id, business_banner_url, business_banner_public_id from public.profiles order by id`);
const storefrontsBefore = await rows(`select owner_id, logo_url, logo_public_id, banner_url, banner_public_id from public.storefronts order by owner_id`);

// ---- inventory: records the original state, changes nothing else, idempotent
const inv = await one(`select * from public.business_media_backfill_inventory()`);
assert.equal(inv.queued, 4, 'alice logo, alice banner, bob logo, dave storefront logo');
assert.equal(inv.external, 1, "carol's third-party URL is recorded but cannot be fetched safely");
assert.deepEqual(await rows(`select id, business_logo_url, business_logo_public_id, business_banner_url, business_banner_public_id from public.profiles order by id`), profilesBefore);
assert.deepEqual(await rows(`select owner_id, logo_url, logo_public_id, banner_url, banner_public_id from public.storefronts order by owner_id`), storefrontsBefore);
ok('inventory records every unscanned slot (4 queued, 1 external) and changes no profile or storefront');

const again = await one(`select * from public.business_media_backfill_inventory()`);
assert.equal(again.queued, 0);
assert.equal((await one(`select count(*)::int n from public.business_media_backfill`)).n, 5);
ok('inventory is idempotent: running it again adds nothing');

const orig = await one(`select * from public.business_media_backfill where owner_id=$1 and kind='logo' and source='profile'`, [alice]);
assert.equal(orig.original_key, k(alice, 'logo', 1));
assert.equal(orig.original_url, `${host}/${k(alice, 'logo', 1)}`);
assert.equal(orig.status, 'pending');
ok('the original url and key are preserved on the row (recoverable record)');

assert.equal((await one(`select count(*)::int n from public.business_media_backfill where owner_id=$1`, [erin])).n, 0);
ok('a slot already backed by an approved scan is not queued');

const ext = await one(`select status, original_key from public.business_media_backfill where owner_id=$1`, [carol]);
assert.deepEqual([ext.status, ext.original_key], ['external', null]);
ok('a third-party URL-only value is parked as external (never fetched: SSRF), key is null');

// ---- claim: each row once; concurrent claimers split the work; lease recovery
const c1 = await rows(`select * from public.business_media_backfill_claim(2)`);
const c2 = await rows(`select * from public.business_media_backfill_claim(10)`);
assert.equal(c1.length, 2);
assert.equal(c2.length, 2);
assert.equal(new Set([...c1, ...c2].map((r) => r.id)).size, 4, 'no row handed out twice');
assert.equal((await rows(`select * from public.business_media_backfill_claim(10)`)).length, 0);
ok('claim hands out each pending row once; a third claim finds nothing');
assert.ok([...c1, ...c2].every((r) => r.original_key && r.owner_id && r.kind), 'claim returns what the Worker needs');

await db.query(`update public.business_media_backfill set lease_until = now() - interval '1 minute' where id=$1`, [c1[0].id]);
const rec = await rows(`select * from public.business_media_backfill_claim(10)`);
assert.deepEqual(rec.map((r) => r.id), [c1[0].id]);
assert.equal((await one(`select attempts from public.business_media_backfill where id=$1`, [c1[0].id])).attempts, 2);
ok('a crashed claim (expired lease) is recovered and counted as another attempt');

// Roles: A (profile) is approved and applied, B (profile) is rejected, C (profile) is retried/escalated and then raced, D is the storefront row.
const claimed = [...c1, ...c2];
const [A, B, C] = claimed.filter((r) => r.source === 'profile');
const D = claimed.find((r) => r.source === 'storefront');
const slotOf = async (r) => (await one(`select business_${r.kind}_public_id key, business_${r.kind}_url url from public.profiles where id=$1`, [r.owner_id]));
const approve = async (r, n) => {
  const key = k(r.owner_id, r.kind, n);
  const scan = (await one(`insert into public.business_media_scans(user_id,kind,sha256,status,public_key) values ($1,$2,'sha','approved',$3) returning id`, [r.owner_id, r.kind, key])).id;
  await db.query(`select public.business_media_backfill_record($1,'approved',$2,$3,$4,null)`, [r.id, scan, key, `${host}/${key}`]);
  return { key, scan };
};

// ---- record: only truthful outcomes
const newKeyA = k(A.owner_id, A.kind, 50);
await assert.rejects(db.query(`select public.business_media_backfill_record($1,'approved',null,$2,$3,null)`, [A.id, newKeyA, `${host}/${newKeyA}`]), /scan/i);
ok("'approved' without a matching approved scan row is refused");
const stranger = A.owner_id === bob ? carol : bob;
const strangerKey = k(stranger, A.kind, 51);
const otherScan = (await one(`insert into public.business_media_scans(user_id,kind,sha256,status,public_key) values ($1,$2,'sha','approved',$3) returning id`, [stranger, A.kind, strangerKey])).id;
await assert.rejects(db.query(`select public.business_media_backfill_record($1,'approved',$2,$3,$4,null)`, [A.id, otherScan, strangerKey, `${host}/${strangerKey}`]), /scan|owner|match/i);
ok("another user's approved scan cannot be recorded against this row");
const wrongKind = A.kind === 'logo' ? 'banner' : 'logo';
const wrongSlotKey = k(A.owner_id, wrongKind, 52);
const wrongSlotScan = (await one(`insert into public.business_media_scans(user_id,kind,sha256,status,public_key) values ($1,$2,'sha','approved',$3) returning id`, [A.owner_id, wrongKind, wrongSlotKey])).id;
await assert.rejects(db.query(`select public.business_media_backfill_record($1,'approved',$2,$3,$4,null)`, [A.id, wrongSlotScan, wrongSlotKey, `${host}/${wrongSlotKey}`]), /scan|match/i);
ok('an approval for the other slot (logo vs banner) cannot be recorded against this row');
const keyA = (await approve(A, 50)).key;
assert.equal((await one(`select status from public.business_media_backfill where id=$1`, [A.id])).status, 'approved');
ok('a matching approved scan is recorded');
await assert.rejects(db.query(`select public.business_media_backfill_record($1,'rejected',null,null,null,null)`, [A.id]), /not being scanned/i);
ok('a row that is not currently claimed cannot be recorded again');

// ---- apply: only approved, compare-and-swap, nothing deleted
const otherSlotBefore = await one(`select business_logo_public_id l, business_banner_public_id b from public.profiles where id=$1`, [A.owner_id]);
assert.equal((await one(`select public.business_media_backfill_apply($1) r`, [A.id])).r, 'applied');
const sA = await slotOf(A);
assert.equal(sA.key, keyA);
assert.equal(sA.url, `${host}/${keyA}`);
const otherSlotAfter = await one(`select business_logo_public_id l, business_banner_public_id b from public.profiles where id=$1`, [A.owner_id]);
assert.equal(A.kind === 'logo' ? otherSlotAfter.b : otherSlotAfter.l, A.kind === 'logo' ? otherSlotBefore.b : otherSlotBefore.l, 'the other slot is untouched');
const stA = await one(`select status, original_key, applied_at from public.business_media_backfill where id=$1`, [A.id]);
assert.equal(stA.status, 'applied');
assert.ok(stA.original_key && stA.applied_at, 'the original key stays on record for recovery');
ok('apply swaps exactly the one slot to the scanned key and records it; the original reference is kept');
assert.equal((await one(`select public.business_media_backfill_apply($1) r`, [A.id])).r, 'already_applied');
ok('applying twice is a no-op');
assert.equal((await one(`select public.business_media_backfill_apply($1) r`, [B.id])).r, 'not_approved');
ok('a row that was never approved cannot be applied');

// rejected / held / missing / unreadable never touch the slot
const sB = await slotOf(B);
for (const st of ['rejected', 'held', 'missing', 'unreadable']) {
  await db.query(`update public.business_media_backfill set status='scanning', lease_until=now()+interval '5 minutes' where id=$1`, [B.id]);
  await db.query(`select public.business_media_backfill_record($1,$2,null,null,null,$2)`, [B.id, st]);
  assert.equal((await one(`select status from public.business_media_backfill where id=$1`, [B.id])).status, st);
  assert.deepEqual(await slotOf(B), sB, `${st}: the slot is unchanged`);
  assert.equal((await one(`select public.business_media_backfill_apply($1) r`, [B.id])).r, 'not_approved');
}
ok('rejected, held, missing and unreadable legacy images are only reported: the slot is not changed and nothing is deleted');

// unavailable is retryable with backoff, then escalates
await db.query(`select public.business_media_backfill_record($1,'unavailable',null,null,null,'vision down')`, [C.id]);
const un = await one(`select status, next_attempt_at > now() as later from public.business_media_backfill where id=$1`, [C.id]);
assert.equal(un.status, 'unavailable');
assert.equal(un.later, true);
assert.equal((await rows(`select * from public.business_media_backfill_claim(10)`)).filter((r) => r.id === C.id).length, 0, 'not claimable before its backoff expires');
await db.query(`update public.business_media_backfill set next_attempt_at = now() - interval '1 second' where id=$1`, [C.id]);
assert.equal((await rows(`select * from public.business_media_backfill_claim(10)`)).filter((r) => r.id === C.id).length, 1);
ok('unavailable is retried after its backoff and not before');
for (let i = 0; i < 6; i++) {
  await db.query(`select public.business_media_backfill_record($1,'unavailable',null,null,null,'vision down')`, [C.id]).catch(() => {});
  await db.query(`update public.business_media_backfill set next_attempt_at = now() - interval '1 second' where id=$1 and status='unavailable'`, [C.id]);
  await rows(`select * from public.business_media_backfill_claim(10)`);
}
assert.equal((await one(`select status from public.business_media_backfill where id=$1`, [C.id])).status, 'escalated');
ok('persistent failure escalates instead of retrying forever');
const rep = await rows(`select * from public.business_media_backfill_report()`);
assert.ok(Number(rep.find((r) => r.status === 'escalated').rows) >= 1);
assert.equal(Number(rep.find((r) => r.status === 'applied').rows), 1);
ok('the report counts every status');
assert.ok((await one(`select public.business_media_backfill_requeue('escalated') n`)).n >= 1);
assert.equal((await one(`select status from public.business_media_backfill where id=$1`, [C.id])).status, 'pending');
await assert.rejects(db.query(`select public.business_media_backfill_requeue('applied')`), /only escalated or unavailable/);
ok('an operator can requeue escalated rows after fixing the cause, and nothing else');

// compare-and-swap: the owner replaced the image while it was being scanned
{
  const mine = (await rows(`select * from public.business_media_backfill_claim(10)`)).filter((r) => r.id === C.id);
  assert.equal(mine.length, 1, 'C is claimable again after requeue');
  await approve(C, 60);
  const replacement = k(C.owner_id, C.kind, 61);
  await db.query(`update public.profiles set business_${C.kind}_url=$2, business_${C.kind}_public_id=$3 where id=$1`, [C.owner_id, `${host}/${replacement}`, replacement]);
  assert.equal((await one(`select public.business_media_backfill_apply($1) r`, [C.id])).r, 'superseded');
  assert.equal((await slotOf(C)).key, replacement);
  ok("apply never overwrites an image the owner replaced meanwhile ('superseded')");
}

// storefront rows are applied to the storefront
{
  await db.query(`update public.business_media_backfill set status='scanning', lease_until=now()+interval '5 minutes' where id=$1`, [D.id]);
  const { key } = await approve(D, 70);
  assert.equal((await one(`select public.business_media_backfill_apply($1) r`, [D.id])).r, 'applied');
  assert.equal((await one(`select logo_public_id v from public.storefronts where owner_id=$1`, [dave])).v, key);
  ok('a storefront slot is applied on the storefront');
}

// a URL on a host that is not managed is never applied
const evilRow = (await one(`insert into public.business_media_backfill(source, owner_id, kind, original_key, original_url, status) values ('profile',$1,'banner',$2,$3,'scanning') returning id`, [bob, k(bob, 'banner', 80), `${host}/${k(bob, 'banner', 80)}`])).id;
await db.query(`update public.profiles set business_banner_url=$2, business_banner_public_id=$3 where id=$1`, [bob, `${host}/${k(bob, 'banner', 80)}`, k(bob, 'banner', 80)]);
const evilKey = k(bob, 'banner', 81);
const evilScan = (await one(`insert into public.business_media_scans(user_id,kind,sha256,status,public_key) values ($1,'banner','s','approved',$2) returning id`, [bob, evilKey])).id;
await assert.rejects(db.query(`select public.business_media_backfill_record($1,'approved',$2,$3,$4,null)`, [evilRow, evilScan, evilKey, `https://evil.example/${evilKey}`]), /url|host/i);
ok('an approved key paired with an unmanaged host is refused at record time');

// ---- clients cannot touch any of it
for (const fn of ['business_media_backfill_inventory()', 'business_media_backfill_claim(1)', 'business_media_backfill_report()', `business_media_backfill_apply('${uuid(999)}')`, `business_media_backfill_requeue('escalated')`]) {
  await fails(alice, `select public.${fn}`, [], /permission denied|42501/);
}
await fails(alice, `select * from public.business_media_backfill`, [], /permission denied|42501/).catch(async () => {
  assert.equal((await q(alice, `select * from public.business_media_backfill`)).rows.length, 0);
});
await fails(alice, `update public.business_media_backfill set status='applied'`, [], /permission denied|row-level|42501/);
ok('clients can neither call the backfill functions nor read or write its table');

// ---- account deletion removes the rows with the account
await db.query(`delete from auth.users where id=$1`, [bob]).catch(() => {});
assert.equal((await one(`select count(*)::int n from public.business_media_backfill where owner_id=$1`, [bob])).n, 0);
ok('deleting the account removes its backfill rows (cascade)');

// ---- rollback on disposable data: bookkeeping goes, applied images and scan rows stay, the migration can be applied again
{
  const { readFileSync } = await import('node:fs');
  const dir = new URL('../', import.meta.url);
  const imagesBefore = await rows(`select id, business_logo_public_id l, business_banner_public_id b from public.profiles order by id`);
  const scansBefore = (await one(`select count(*)::int n from public.business_media_scans`)).n;
  await db.exec(readFileSync(new URL('rollback/0058_business_media_backfill_ROLLBACK.sql', dir), 'utf8'));
  const left = await one(`select to_regclass('public.business_media_backfill') t, (select count(*)::int from pg_proc where proname like 'business_media_backfill%' or proname = '_bmb_current_ref') f`);
  assert.deepEqual([left.t, left.f], [null, 0]);
  assert.deepEqual(await rows(`select id, business_logo_public_id l, business_banner_public_id b from public.profiles order by id`), imagesBefore);
  assert.equal((await one(`select count(*)::int n from public.business_media_scans`)).n, scansBefore);
  ok('rollback removes only the backfill bookkeeping; images already swapped and all scan rows stay');
  await db.exec(readFileSync(new URL('migrations/0058_business_media_backfill.sql', dir), 'utf8'));
  assert.equal((await one(`select * from public.business_media_backfill_inventory()`)).queued >= 0, true);
  ok('0058 can be re-applied after a rollback');
}

console.log('business_media_backfill: all assertions passed');
