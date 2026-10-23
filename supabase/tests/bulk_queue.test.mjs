// 0051 on the REAL chain 0001..0051 in PGlite: the bulk photo queue's limits, fairness, retries, lease recovery, quota,
// authorization and its interaction with the photo-enforcement trigger. SQL behaviour only — the Worker side
// (workers/image-scan/src/bulk.ts) has its own tests with fakes, and nothing here has touched real storage or Vision.
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, uuid, sqlFile } from './harness/db.mjs';

const { db } = await boot({ upTo: '0051' });
const { q, fails } = actors(db);
const [admin, mod, seller, other, third] = await seedUsers(db, 5);
await db.query(`insert into public.admin_users(user_id, role) values ($1,'admin'), ($2,'moderator')`, [admin, mod]);
await db.exec(`select set_config('suuqplus.skip_rate_limit','true',false)`);

await db.exec(sqlFile('migrations/0051_bulk_photo_queue.sql'));
ok('0051 applies on the real chain and is re-runnable');

const cfg = async () => (await db.query(`select enabled, daily_photo_quota quota from public.bulk_scan_config`)).rows[0];
const URLS = (n, tag = 'a') => Array.from({ length: n }, (_, i) => `https://shop.example/${tag}${i}.jpg`);
const row = (n = 1, tag = 'a') => ({ payload: { title: `Item ${tag}`, price: 10, category: 'phones', city: 'Hargeisa' }, photoUrls: URLS(n, tag) });
const enqueue = (uid, rows) => q(uid, `select public.enqueue_bulk_import($1::jsonb) r`, [JSON.stringify(rows)]).then((r) => r.rows[0].r);
const status = async (id) => (await db.query(`select status, attempts, error_code, lease_until, next_attempt_at from public.bulk_import_rows where id=$1`, [id])).rows[0];
const claim = async (n = 10) => (await db.query(`select * from public.claim_bulk_rows($1)`, [n])).rows;
const asService = (sql, params) => db.query(sql, params); // superuser = service role stand-in

// ---------------------------------------------------------------- inactive by default
assert.deepEqual(await cfg(), { enabled: false, quota: 0 });
await fails(seller, `select public.enqueue_bulk_import($1::jsonb)`, [JSON.stringify([row()])], /bulk_disabled|not available yet/);
assert.equal((await claim()).length, 0);
assert.equal((await q(seller, `select public.bulk_scan_quota() r`)).rows[0].r.enabled, false);
ok('inactive after applying: enqueue is refused ("bulk_disabled"), claim returns nothing, quota reports disabled');

// ---------------------------------------------------------------- enabling needs: admin + reason + enforce mode
await fails(mod, `select public.admin_set_bulk_scan_config(true, 20, 'because')`, [], /42501|Only an administrator/);
await fails(admin, `select public.admin_set_bulk_scan_config(true, 20, 'owner approved')`, [], /55000|only be enabled while photo checks are enforced/);
await q(admin, `select public.admin_set_image_scan_mode('shadow','measure')`);
await db.query(`update public.image_scan_config set shadow_started_at = now() - interval '100 hours'`);
await q(admin, `select public.admin_set_image_scan_mode('enforce','measured')`);
await fails(admin, `select public.admin_set_bulk_scan_config(true, 0, 'no quota')`, [], /22023|quota of at least 1/);
await fails(admin, `select public.admin_set_bulk_scan_config(true, 20, '')`, [], /22023|reason/);
await q(admin, `select public.admin_set_bulk_scan_config(true, 20, 'owner approved 20 photos/day for staging')`);
assert.deepEqual(await cfg(), { enabled: true, quota: 20 });
assert.equal((await db.query(`select count(*)::int c from public.admin_audit_log where action='set_bulk_scan_config'`)).rows[0].c, 1);
ok('only an admin, with a reason, and only while enforcing, can enable bulk; the change is audited');

// ---------------------------------------------------------------- validation is all-or-nothing
const before = async () => (await db.query(`select (select count(*) from public.bulk_import_batches)::int b, (select count(*) from public.bulk_import_rows)::int r`)).rows[0];
const b0 = await before();
for (const [rows, re] of [
  [[row(1), { payload: {}, photoUrls: ['http://shop.example/a.jpg'] }], /bulk_bad_url|plain https/],
  [[{ payload: {}, photoUrls: ['https://user:pw@shop.example/a.jpg'] }], /bulk_bad_url|plain https/],
  [[{ payload: {}, photoUrls: ['javascript:alert(1)'] }], /bulk_bad_url|plain https/],
  [[{ payload: {}, photoUrls: ['https://shop.example/a b.jpg'] }], /bulk_bad_url|plain https/],
  [[{ payload: {}, photoUrls: ['https://shop.example:8443/a.jpg'] }], /bulk_bad_url|plain https/],
  [[row(6)], /bulk_bad_photo_count|1 to 5 photos/],
  [[{ payload: {}, photoUrls: [] }], /bulk_bad_photo_count|1 to 5 photos/],
  [[{ payload: 'x', photoUrls: URLS(1) }], /22023|Malformed/],
  [[], /bulk_too_many_rows|1 to 50/],
  [Array.from({ length: 51 }, () => row(1)), /bulk_too_many_rows|1 to 50/],
]) await fails(seller, `select public.enqueue_bulk_import($1::jsonb)`, [JSON.stringify(rows)], re);
assert.deepEqual(await before(), b0);
ok('malformed rows / non-https / credentialed / ported URLs / bad photo counts / oversize batches are refused and nothing is written');

// ---------------------------------------------------------------- quota + one active batch
const A = await enqueue(seller, [row(5, 'a'), row(5, 'b'), row(5, 'c')]);
assert.equal(A.rows.length, 3);
assert.deepEqual((await q(seller, `select public.bulk_scan_quota() r`)).rows[0].r.remaining, 5);
await fails(seller, `select public.enqueue_bulk_import($1::jsonb)`, [JSON.stringify([row(1, 'z')])], /bulk_batch_active|Finish or cancel/);
ok('15 photos accepted against a 20/day quota; a second batch is refused while one is open');

// another user has their own quota and their own batch
const B = await enqueue(other, [row(5, 'o1'), row(5, 'o2'), row(5, 'o3')]);
assert.equal(B.rows.length, 3);
await fails(third, `select public.enqueue_bulk_import($1::jsonb)`, [JSON.stringify([row(5, 't1'), row(5, 't2'), row(5, 't3'), row(5, 't4'), row(1, 't5')])], /bulk_quota_exceeded|allowance exceeded/);
ok('quota is per user, and exceeding it is refused whole ("bulk_quota_exceeded")');

assert.equal((await q(seller, `select public.bulk_active_batch() r`)).rows[0].r, A.batchId);
assert.equal((await q(other, `select public.bulk_active_batch() r`)).rows[0].r, B.batchId);
assert.equal((await q(third, `select public.bulk_active_batch() r`)).rows[0].r, null);
ok('the app can find its own open batch to resume the progress screen, and never anyone else\'s');

// ---------------------------------------------------------------- status is own-only and exposes no source URLs
const stA = (await q(seller, `select public.bulk_batch_status($1) r`, [A.batchId])).rows[0].r;
assert.equal(stA.counts.queued, 3);
assert.equal(stA.rows.length, 3);
assert.equal(/shop\.example/.test(JSON.stringify(stA)), false, 'source photo URLs are never echoed back');
await fails(other, `select public.bulk_batch_status($1)`, [A.batchId], /P0002|Not found/);
ok('batch status shows counts/rows to its owner only and never echoes source URLs');

// ---------------------------------------------------------------- fairness + in-flight cap + lease
const first = await claim(10);
assert.equal(first.length, 4, '2 per user (max_in_flight_per_user), two users');
assert.deepEqual([...new Set(first.map((r) => r.user_id))].sort(), [seller, other].sort());
assert.ok(first.every((r) => r.attempts === 1));
assert.equal((await claim(10)).length, 0, 'rows in flight (live lease) are not handed out twice, and the cap holds');
const sellerClaimed = first.filter((r) => r.user_id === seller);
ok('claim is fair across users, capped at 2 in flight per user, and never double-hands a leased row');

await fails(seller, `select * from public.claim_bulk_rows(5)`, [], /permission|42501/);
await fails(seller, `select public.complete_bulk_row($1,'ready',null,null)`, [sellerClaimed[0].id], /permission|42501/);
await fails(seller, `select public.fail_bulk_row($1,'x',true)`, [sellerClaimed[0].id], /permission|42501/);
ok('claim / complete / fail are service-role only');

// complete one → the third row becomes claimable (cap counts only live in-flight rows)
await asService(`select public.complete_bulk_row($1,'ready',null,$2::text[])`, [sellerClaimed[0].id, [`https://cdn.test/wm/listings/${seller}/x/${uuid(1)}.jpg`]]);
const next = await claim(10);
assert.equal(next.filter((r) => r.user_id === seller).length, 1);
ok('finishing a row frees a slot for that user\'s next row');

// lease expiry → crash recovery
await asService(`update public.bulk_import_rows set lease_until = now() - interval '1 second' where id = $1`, [sellerClaimed[1].id]);
const recovered = await claim(10);
const again = recovered.find((r) => r.id === sellerClaimed[1].id);
assert.ok(again && again.attempts === 2);
ok('a row whose Worker died (lease expired) is picked up again with attempts+1');

// ---------------------------------------------------------------- retries, backoff, give-up, manual retry
const t = again.id;
assert.equal((await asService(`select public.fail_bulk_row($1,'image_unreachable',true) s`, [t])).rows[0].s, 'queued');
let s1 = await status(t);
assert.deepEqual([s1.status, s1.error_code], ['queued', 'image_unreachable']);
assert.ok(new Date(s1.next_attempt_at) > new Date(), 'backs off into the future');
assert.equal((await claim(10)).some((r) => r.id === t), false, 'not claimable before its backoff has passed');
await asService(`update public.bulk_import_rows set next_attempt_at = now() - interval '1 second' where id = $1`, [t]);
assert.equal((await claim(10)).find((r) => r.id === t)?.attempts, 3);
await asService(`update public.bulk_scan_config set max_attempts = 3`);
assert.equal((await asService(`select public.fail_bulk_row($1,'image_unreachable',true) s`, [t])).rows[0].s, 'failed');
assert.equal((await status(t)).status, 'failed');
ok('retryable failure → queued with backoff → claimed again → after max_attempts it settles as failed');

// permanent failure goes straight to failed
const other1 = (await claim(10)).find((r) => r.user_id === other) ?? (await db.query(`select id from public.bulk_import_rows where user_id=$1 and status='processing' limit 1`, [other])).rows[0];
assert.equal((await asService(`select public.fail_bulk_row($1,'image_invalid',false) s`, [other1.id])).rows[0].s, 'failed');
ok('a permanent failure (e.g. not an image) does not retry');

const quotaBefore = (await q(seller, `select public.bulk_scan_quota() r`)).rows[0].r.usedToday;
await fails(other, `select public.bulk_retry_row($1)`, [t], /./).catch(() => {});
assert.equal((await q(other, `select public.bulk_retry_row($1) r`, [t])).rows[0].r, false);
assert.equal((await q(seller, `select public.bulk_retry_row($1) r`, [t])).rows[0].r, true);
s1 = await status(t);
assert.deepEqual([s1.status, s1.attempts], ['queued', 0]);
assert.equal((await q(seller, `select public.bulk_scan_quota() r`)).rows[0].r.usedToday, quotaBefore);
assert.equal((await q(seller, `select public.bulk_retry_row($1) r`, [t])).rows[0].r, false, 'only failed rows can be retried');
ok('the owner (only) can retry a failed row; it does not consume quota twice');

// ---------------------------------------------------------------- publication stays the trigger-guarded client write
const ready = sellerClaimed[0];
const readyListing = ready.listing_id;
const derivative = `https://cdn.test/wm/listings/${seller}/${readyListing}/${uuid(1)}.jpg`;
await asService(`update public.bulk_import_rows set image_urls = $2::text[] where id = $1`, [ready.id, [derivative]]);
// the scan the Worker would have recorded for this listing (source 'bulk')
const scanId = uuid(7001);
await db.query(`insert into public.listing_scans(id,user_id,listing_id,fingerprint,category,status,source) values ($1,$2,$3,'fpbulk','phones','approved','bulk')`, [scanId, seller, readyListing]);
await db.query(`insert into public.listing_scan_images(scan_id,slot,source_key,public_key,public_url,sha256,phash,verdict,issues,internal,review_status) values ($1,0,'orig/x','wm/x',$2,'abc',null,'pass','{}','{}','not_not_needed')`.replace('not_not_needed', 'not_needed'), [scanId, derivative]);
await fails(seller, `insert into public.listings(id,user_id,title,category,city,price,images) values ($1,$2,'Bulk item','phones','Hargeisa',10,$3)`, [readyListing, seller, URLS(1)], /42501|not been checked/);
ok('enforced: the CSV\'s own (source) URLs cannot be published — only scanned derivatives');
await fails(seller, `select public.bulk_mark_published($1)`, [ready.id], /./).catch(() => {});
assert.equal((await q(seller, `select public.bulk_mark_published($1) r`, [ready.id])).rows[0].r, false, 'cannot be marked published before the listing exists');
await q(seller, `insert into public.listings(id,user_id,title,category,city,price,images) values ($1,$2,'Bulk item','phones','Hargeisa',10,$3)`, [readyListing, seller, [derivative]]);
assert.equal((await q(other, `select public.bulk_mark_published($1) r`, [ready.id])).rows[0].r, false, "another user can't mark someone else's row");
assert.equal((await q(seller, `select public.bulk_mark_published($1) r`, [ready.id])).rows[0].r, true);
assert.equal((await status(ready.id)).status, 'published');
ok('the app publishes with the derivative URLs through the normal guarded write, then marks the row published (owner only, only once the listing exists)');

// ---------------------------------------------------------------- cancel
const cancelled = (await q(seller, `select public.bulk_cancel_batch($1) n`, [A.batchId])).rows[0].n;
assert.ok(cancelled >= 1);
assert.equal((await status(ready.id)).status, 'published', 'a published row is never un-published by cancelling');
assert.equal((await q(other, `select public.bulk_cancel_batch($1) n`, [A.batchId])).rows[0].n, 0, 'not your batch → nothing happens');
assert.equal((await db.query(`select status from public.bulk_import_batches where id=$1`, [A.batchId])).rows[0].status, 'cancelled');
assert.equal((await db.query(`select count(*)::int c from public.bulk_import_rows where batch_id=$1 and status in ('queued','processing')`, [A.batchId])).rows[0].c, 0);
assert.equal((await claim(10)).some((r) => r.user_id === seller), false, 'a cancelled batch is never claimed');
assert.equal((await q(seller, `select public.bulk_active_batch() r`)).rows[0].r, null, 'a cancelled batch is no longer "active"');
ok('cancel stops the queue for that batch, spares published rows, and only works for the owner');

// cancelled-after-processing still counts against the quota (no free re-scans by cancel-and-resubmit)
const used = (await q(seller, `select public.bulk_scan_quota() r`)).rows[0].r;
assert.ok(used.usedToday >= 5, 'rows a Worker already started on still count after cancel');
ok('cancelling after processing started does not refund quota');

// ---------------------------------------------------------------- rolling back the photo ladder switches bulk off
await q(admin, `select public.admin_set_image_scan_mode('shadow','incident rollback')`);
assert.equal((await cfg()).enabled, false);
await fails(other, `select public.enqueue_bulk_import($1::jsonb)`, [JSON.stringify([row(1, 'q')])], /bulk_disabled|not available yet/);
assert.equal((await claim(10)).length, 0);
ok('leaving enforce switches the bulk queue off at once (enqueue refused, nothing claimed)');

// ---------------------------------------------------------------- the rollback script really restores 0050
await db.exec(sqlFile('rollback/0051_bulk_photo_queue_ROLLBACK.sql'));
assert.equal((await db.query(`select count(*)::int c from information_schema.tables where table_name like 'bulk\\_%'`)).rows[0].c, 0);
assert.equal((await db.query(`select count(*)::int c from information_schema.columns where table_name='listing_scans' and column_name='source'`)).rows[0].c, 0);
await db.query(`update public.image_scan_config set mode='enforce'`);
assert.equal((await db.query(`select enforce from public.image_scan_config`)).rows[0].enforce, true);
await db.query(`update public.image_scan_config set mode='off'`);
await db.exec(sqlFile('migrations/0051_bulk_photo_queue.sql'));
assert.deepEqual(await cfg(), { enabled: false, quota: 0 });
ok('ROLLBACK SCRIPT: queue objects gone, 0050 behaviour intact; 0051 re-applies cleanly (round trip)');

console.log('\nbulk_queue: all assertions passed');
process.exit(0);
