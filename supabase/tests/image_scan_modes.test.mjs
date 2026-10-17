// 0050 on the REAL chain 0001..0050 in PGlite: the off → shadow → enforce ladder, what shadow records, who may move
// the ladder, the gated closure of the legacy upload path, one-statement rollback, and the compatibility of the old
// boolean. Proves SQL behaviour only — not PostgREST, not the Worker, not r2-presign (those have their own tests).
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, uuid, sqlFile } from './harness/db.mjs';

const { db } = await boot({ upTo: '0050' });
const { q, fails } = actors(db);
const [admin, mod, supp, seller, other] = await seedUsers(db, 5);
await db.query(`insert into public.admin_users(user_id, role) values ($1,'admin'), ($2,'moderator'), ($3,'support')`, [admin, mod, supp]);
await db.exec(`select set_config('suuqplus.skip_rate_limit','true',false)`);

await db.exec(sqlFile('migrations/0050_image_scan_rollout_modes.sql'));
ok('0050 is re-runnable (idempotent)');

const cfg = async () => (await db.query(`select mode, enforce, legacy_presign_closed closed, shadow_started_at from public.image_scan_config`)).rows[0];
const events = async () => (await db.query(`select op, photos_added, verified, unverified, rejected, held from public.image_scan_shadow_events order by id`)).rows;
let n = 9000;
const URL = (k) => `https://cdn.test/wm/listings/${seller}/x/${k}.jpg`;
async function scan({ listing, images }) {
  const id = uuid(++n);
  await db.query(`insert into public.listing_scans(id,user_id,listing_id,fingerprint,category,status) values ($1,$2,$3,$4,'phones','approved')`, [id, seller, listing, `fp${n}`]);
  let slot = 0;
  for (const im of images) {
    await db.query(
      `insert into public.listing_scan_images(scan_id,slot,source_key,public_key,public_url,sha256,phash,verdict,issues,internal,review_status)
       values ($1,$2,$3,$4,$5,'abc',null,$6,'{}','{}',$7)`,
      [id, slot++, `orig/${im.k}`, `wm/${im.k}`, URL(im.k), im.verdict ?? 'pass', (im.verdict ?? 'pass') === 'review' ? 'pending' : 'not_needed'],
    );
  }
}
const newListing = () => uuid(++n);
const insertListing = (uid, id, images) => q(uid, `insert into public.listings(id,user_id,title,category,city,price,images) values ($1,$2,'Phone','phones','Hargeisa',100,$3)`, [id, uid, images]);
const status = async (id) => (await db.query(`select status from public.listings where id=$1`, [id])).rows[0].status;

// ---------------------------------------------------------------- defaults: applying 0050 changes nothing
assert.deepEqual(await cfg(), { mode: 'off', enforce: false, closed: false, shadow_started_at: null });
ok('defaults: mode off, enforce false, legacy path open');
const legacy = newListing();
await insertListing(seller, legacy, ['https://anything.example/legacy.jpg']);
assert.equal(await status(legacy), 'available');
assert.equal((await events()).length, 0);
ok('off: any image URL still publishes and nothing is recorded');
assert.deepEqual((await q(null, `select public.image_scan_client_policy() p`)).rows[0].p, { mode: 'off', scanRequired: false, legacyUploadClosed: false });
ok('clients (even signed-out) can read the secret-free client policy; mode off → scan not required');

// ---------------------------------------------------------------- the ladder is admin-only, one rung at a time
await fails(mod, `select public.admin_set_image_scan_mode('shadow', 'trying it')`, [], /42501|Only an administrator/);
await fails(seller, `select public.admin_set_image_scan_mode('shadow', 'trying it')`, [], /42501|Only an administrator/);
await fails(null, `select public.admin_set_image_scan_mode('shadow', 'trying it')`, [], /42501|permission|Only an administrator/);
ok('only an administrator can move the ladder (moderator, seller, signed-out all refused)');
await fails(admin, `select public.admin_set_image_scan_mode('shadow', '')`, [], /22023|reason/);
await fails(admin, `select public.admin_set_image_scan_mode('turbo', 'x y z')`, [], /22023|Unknown mode/);
await fails(admin, `select public.admin_set_image_scan_mode('enforce', 'skip the queue')`, [], /55000|only follow shadow/);
ok('a reason is required, unknown modes are refused, and off → enforce cannot skip shadow');

await q(admin, `select public.admin_set_image_scan_mode('shadow', 'start measuring old clients')`);
let c = await cfg();
assert.equal(c.mode, 'shadow');
assert.equal(c.enforce, false);
assert.ok(c.shadow_started_at);
ok('admin moves off → shadow; enforce stays false, shadow start time recorded');
assert.equal((await db.query(`select count(*)::int c from public.admin_audit_log where action='set_image_scan_mode'`)).rows[0].c, 1);
ok('mode change is audited with from/to and reason');

// ---------------------------------------------------------------- shadow: never blocks, never holds, records evidence
const S1 = newListing();
await insertListing(seller, S1, ['https://old-app.example/direct-upload.jpg', 'https://old-app.example/two.jpg']);
assert.equal(await status(S1), 'available');
assert.deepEqual((await events()).at(-1), { op: 'INSERT', photos_added: 2, verified: 0, unverified: 2, rejected: 0, held: 0 });
ok('shadow: an old-style unscanned publish succeeds and is counted as 2 unverified photos');

const S2 = newListing();
await scan({ listing: S2, images: [{ k: 's2a' }, { k: 's2b', verdict: 'reject' }, { k: 's2c', verdict: 'review' }] });
await insertListing(seller, S2, [URL('s2a'), URL('s2b'), URL('s2c'), 'https://old-app.example/x.jpg']);
assert.equal(await status(S2), 'available');
assert.deepEqual((await events()).at(-1), { op: 'INSERT', photos_added: 4, verified: 1, unverified: 1, rejected: 1, held: 1 });
ok('shadow: records verified / unverified / would-be-rejected / would-be-held separately — and still publishes, un-held');

const before = (await events()).length;
await q(seller, `update public.listings set title='New title' where id=$1`, [S1]);
assert.equal((await events()).length, before);
ok('shadow: an edit that does not touch photos records nothing');
await q(seller, `update public.listings set images = images || $2::text[] where id=$1`, [S1, ['https://old-app.example/three.jpg']]);
assert.deepEqual((await events()).at(-1), { op: 'UPDATE', photos_added: 1, verified: 0, unverified: 1, rejected: 0, held: 0 });
ok('shadow: adding a photo on edit counts only the NEW photo');

await db.query(`insert into public.listings(id,user_id,title,category,city,price,images) values ($1,$2,'Server write','phones','Hargeisa',1,'{https://x.example/a.jpg}')`, [newListing(), seller]);
assert.equal((await events()).length, before + 1, 'server-side (non-client) writes are not counted');
ok('shadow: only client writes are recorded — service/superuser writes are not');

assert.equal((await q(seller, `select * from public.image_scan_shadow_events`)).rows.length, 0);
assert.ok((await q(mod, `select * from public.image_scan_shadow_events`)).rows.length === 3);
ok('shadow events are staff-only (seller sees none, moderator sees them)');

const status1 = (await q(supp, `select public.admin_image_scan_rollout_status() s`)).rows[0].s;
assert.equal(status1.mode, 'shadow');
assert.equal(status1.last7d.unverifiedPhotos, 4);
assert.equal(status1.last7d.verifiedPhotos, 1);
assert.equal(status1.last7d.rejectedPhotos, 1);
assert.equal(status1.last7d.wouldHold, 1);
assert.equal(status1.last7d.distinctUsersWithUnverified, 1);
await fails(seller, `select public.admin_image_scan_rollout_status()`, [], /42501|Not authorized/);
ok('rollout status reports the shadow evidence to staff and refuses everyone else');

// ---------------------------------------------------------------- enforce needs shadow time, then 0048 rules apply
await fails(admin, `select public.admin_set_image_scan_mode('enforce', 'go live now')`, [], /55000|at least 72 hours/);
ok('enforcement is refused until shadow has run for min_shadow_hours');
await db.query(`update public.image_scan_config set shadow_started_at = now() - interval '73 hours'`);
// a closure attempt before enforce is refused
await fails(admin, `select public.admin_set_legacy_presign_closed(true, 'close it early')`, [], /55000|only be closed while/);
ok('the legacy upload path cannot be closed while photo checks are not enforced');
await q(admin, `select public.admin_set_image_scan_mode('enforce', 'shadow showed no old clients')`);
c = await cfg();
assert.deepEqual([c.mode, c.enforce], ['enforce', true]);
assert.equal((await db.query(`select public.image_scan_enforced() e`)).rows[0].e, true);
ok('after enough shadow time, admin can enforce; the 0048 boolean follows');

const E1 = newListing();
await fails(seller, `insert into public.listings(id,user_id,title,category,city,price,images) values ($1,$2,'P','phones','Hargeisa',1,$3)`, [E1, seller, ['https://old-app.example/forged.jpg']], /42501|not been checked/);
await scan({ listing: E1, images: [{ k: 'e1' }] });
await insertListing(seller, E1, [URL('e1')]);
assert.equal(await status(E1), 'available');
const E2 = newListing();
await scan({ listing: E2, images: [{ k: 'e2', verdict: 'review' }] });
await insertListing(seller, E2, [URL('e2')]);
assert.equal(await status(E2), 'deactivated');
ok('enforce: unscanned photo refused, scanned one publishes, review-photo listing is held hidden (0048 behaviour intact)');
// ---------------------------------------------------------------- closing the legacy path, and one-statement rollback
await fails(mod, `select public.admin_set_legacy_presign_closed(true, 'moderator tries')`, [], /42501|Only an administrator/);
await q(admin, `select public.admin_set_legacy_presign_closed(true, 'old app versions gone')`);
assert.equal((await cfg()).closed, true);
assert.equal((await db.query(`select public.legacy_presign_closed() c`)).rows[0].c, true);
assert.equal((await db.query(`select count(*)::int c from public.admin_audit_log where action='set_legacy_presign_closed'`)).rows[0].c, 1);
ok('admin closes the legacy upload path while enforcing (audited); only service code can read the flag');
await fails(seller, `select public.legacy_presign_closed()`, [], /42501|permission/);
ok('the closure flag function is not callable by clients');

await q(admin, `select public.admin_set_image_scan_mode('shadow', 'rolling back after an incident')`);
c = await cfg();
assert.deepEqual([c.mode, c.enforce, c.closed], ['shadow', false, false]);
ok('ROLLBACK: one statement leaves enforce AND re-opens the legacy upload path');
await insertListing(seller, newListing(), ['https://old-app.example/after-rollback.jpg']);
ok('after rollback the old publish path works again');

await q(admin, `select public.admin_set_image_scan_mode('off', 'back to baseline')`);
c = await cfg();
assert.deepEqual([c.mode, c.shadow_started_at], ['off', null]);
ok('shadow → off clears the shadow clock');

// ---------------------------------------------------------------- compatibility with the 0048 boolean
await db.query(`update public.image_scan_config set enforce = true`);
assert.equal((await cfg()).mode, 'enforce');
await db.query(`update public.image_scan_config set enforce = false`);
assert.equal((await cfg()).mode, 'off');
await db.query(`update public.image_scan_config set mode = 'shadow'`);
await db.query(`update public.image_scan_config set mode = 'enforce'`);
assert.equal((await cfg()).enforce, true);
ok('the legacy `enforce` boolean and `mode` can never disagree, whichever is edited');
await db.query(`update public.image_scan_config set mode='enforce', legacy_presign_closed=true`);
await db.query(`update public.image_scan_config set mode='off'`);
assert.equal((await cfg()).closed, false);
ok('even a raw edit that leaves enforce re-opens the legacy path (cannot strand users with no upload route)');
await assert.rejects(() => db.query(`update public.image_scan_config set mode='bogus'`), /check|violates/i);
ok('an invalid mode is rejected by the table itself');

// ---------------------------------------------------------------- the rollback script really restores 0048
await db.query(`update public.image_scan_config set mode='enforce'`);
await db.exec(sqlFile('rollback/0050_image_scan_rollout_modes_ROLLBACK.sql'));
assert.equal((await db.query(`select count(*)::int c from information_schema.columns where table_name='image_scan_config' and column_name in ('mode','legacy_presign_closed')`)).rows[0].c, 0);
assert.equal((await db.query(`select enforce from public.image_scan_config`)).rows[0].enforce, false);
await insertListing(seller, newListing(), ['https://old-app.example/after-0050-rollback.jpg']);
await db.query(`update public.image_scan_config set enforce = true`);
await fails(seller, `insert into public.listings(id,user_id,title,category,city,price,images) values ($1,$2,'P','phones','Hargeisa',1,$3)`, [newListing(), seller, ['https://old-app.example/forged2.jpg']], /42501|not been checked/);
await db.query(`update public.image_scan_config set enforce = false`);
ok('ROLLBACK SCRIPT: 0050 objects are gone, 0048 boolean enforcement works exactly as before');
await db.exec(sqlFile('migrations/0050_image_scan_rollout_modes.sql'));
assert.equal((await cfg()).mode, 'off');
ok('0050 re-applies cleanly after a rollback (round trip)');

console.log('\nimage_scan_modes: all assertions passed');
process.exit(0);
