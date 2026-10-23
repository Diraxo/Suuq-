// 0048 on the REAL migration chain 0001..0047 in PGlite (real Postgres). Proves server-side enforcement of
// listing-photo scans: forged/missing scans can't publish, review holds a listing out of public view, staff
// review/audit/notices, replacement flow, hash lookup privacy, retention, and that enforcement-OFF changes nothing.
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, uuid, sqlFile } from './harness/db.mjs';

const { db } = await boot({ upTo: '0047' });
const { q, fails } = actors(db);
const [admin, mod, supp, seller, other] = await seedUsers(db, 5);
await db.query(`insert into public.admin_users(user_id, role) values ($1,'admin'), ($2,'moderator'), ($3,'support')`, [admin, mod, supp]);
await db.exec(`select set_config('suuqplus.skip_rate_limit','true',false)`);

await db.exec(sqlFile('migrations/0048_listing_image_scans.sql'));
ok('0048 applies on top of the real 0001..0047 chain');
await db.exec(sqlFile('migrations/0048_listing_image_scans.sql'));
ok('0048 is re-runnable (idempotent)');

let n = 5000;
const URL = (k) => `https://cdn.test/wm/listings/${seller}/x/${k}.jpg`;
const newListing = () => uuid(++n);
async function scan({ user = seller, listing, status = 'approved', images, held = false }) {
  const id = uuid(++n);
  await db.query(`insert into public.listing_scans(id,user_id,listing_id,fingerprint,category,status,held_listing) values ($1,$2,$3,$4,'phones',$5,$6)`, [id, user, listing, `fp${n}`, status, held]);
  let pos = 0;
  for (const im of images) {
    await db.query(
      `insert into public.listing_scan_images(scan_id,slot,source_key,public_key,public_url,sha256,phash,verdict,issues,internal,review_status)
       values ($1,$2,$3,$4,$5,'abc',$6,$7,$8,$9,$10)`,
      [id, pos++, `orig/${im.k}`, `wm/${im.k}`, URL(im.k), im.phash ?? null, im.verdict ?? 'pass', im.issues ?? [], JSON.stringify({ adult: 'POSSIBLE', weaponScore: 0.7 }), im.review ?? ((im.verdict ?? 'pass') === 'review' ? 'pending' : 'not_needed')],
    );
  }
  return id;
}
const insertListing = (uid, id, images, title = 'Phone') =>
  q(uid, `insert into public.listings(id,user_id,title,category,city,price,images) values ($1,$2,$3,'phones','Hargeisa',100,$4)`, [id, uid, title, images]);
const row = async (id) => (await db.query(`select status, status_before_moderation sb, images from public.listings where id=$1`, [id])).rows[0];

// ---------------------------------------------------------------- enforcement OFF (default) changes nothing
const L0 = newListing();
await insertListing(seller, L0, ['https://anything.example/legacy.jpg']);
assert.equal((await row(L0)).status, 'available');
ok('enforcement is OFF by default: today\'s publish path (any image URL) still works');
assert.equal((await db.query(`select enforce from public.image_scan_config`)).rows[0].enforce, false);

await db.query(`update public.image_scan_config set enforce = true`);

// ---------------------------------------------------------------- forged / missing scans
const L1 = newListing();
await fails(seller, `insert into public.listings(id,user_id,title,category,city,price,images) values ($1,$2,'P','phones','Hargeisa',1,$3)`, [L1, seller, ['https://anything.example/forged.jpg']], /42501|not been checked/);
ok('enforced: a photo with no scan cannot be published (client-forged URL)');
// a clean scan that belongs to ANOTHER user's listing/user cannot be borrowed
const otherScan = await scan({ user: other, listing: newListing(), images: [{ k: 'borrowed' }] });
await fails(seller, `insert into public.listings(id,user_id,title,category,city,price,images) values ($1,$2,'P','phones','Hargeisa',1,$3)`, [L1, seller, [URL('borrowed')]], /42501|not been checked/);
ok("enforced: another user's verified photo cannot be reused");
// a clean scan made for a DIFFERENT draft listing can't be attached here
await scan({ listing: newListing(), images: [{ k: 'otherdraft' }] });
await fails(seller, `insert into public.listings(id,user_id,title,category,city,price,images) values ($1,$2,'P','phones','Hargeisa',1,$3)`, [L1, seller, [URL('otherdraft')]], /42501|not been checked/);
ok('enforced: a scan is bound to the exact listing id it was made for');
// scan still processing is not trusted
await scan({ listing: L1, status: 'processing', images: [{ k: 'inflight' }] });
await fails(seller, `insert into public.listings(id,user_id,title,category,city,price,images) values ($1,$2,'P','phones','Hargeisa',1,$3)`, [L1, seller, [URL('inflight')]], /42501|not been checked/);
ok('enforced: an unfinished scan is not accepted');

// ---------------------------------------------------------------- clean / review / reject
const L2 = newListing();
await scan({ listing: L2, images: [{ k: 'c1' }, { k: 'c2' }] });
await insertListing(seller, L2, [URL('c1'), URL('c2')]);
assert.equal((await row(L2)).status, 'available');
ok('enforced: a fully verified listing publishes normally');

const L3 = newListing();
await scan({ listing: L3, images: [{ k: 'rej', verdict: 'reject', issues: ['watermark_own'] }] });
await fails(seller, `insert into public.listings(id,user_id,title,category,city,price,images) values ($1,$2,'P','phones','Hargeisa',1,$3)`, [L3, seller, [URL('rej')]], /42501|not accepted/);
ok('enforced: a rejected photo can never be published by the client');

const L4 = newListing();
const scanReview = await scan({ listing: L4, status: 'pending_review', images: [{ k: 'ok4' }, { k: 'rev4', verdict: 'review', issues: ['duplicate_listing'] }], held: false });
await insertListing(seller, L4, [URL('ok4'), URL('rev4')], 'Held phone');
let r4 = await row(L4);
assert.equal(r4.status, 'deactivated');
assert.equal(r4.sb, 'available');
assert.equal((await db.query(`select held_listing from public.listing_scans where id=$1`, [scanReview])).rows[0].held_listing, true);
assert.equal((await q(other, `select id from public.listings where id=$1`, [L4])).rows.length, 0);
assert.equal((await q(seller, `select id from public.listings where id=$1`, [L4])).rows.length, 1);
ok('enforced: a photo needing review holds the listing hidden from the public (owner still sees it)');
await fails(seller, `update public.listings set title='x' where id=$1`, [L4], /42501|under review/);
ok('held listing stays locked for the owner (no edit around the review)');

// ---------------------------------------------------------------- visibility of scan data
await fails(seller, `select * from public.listing_scan_images`, [], /permission denied|42501/).catch(async () => {
  // RLS-only (no grant error): must at least return nothing
  assert.equal((await q(seller, `select * from public.listing_scan_images`)).rows.length, 0);
});
assert.equal((await q(seller, `select * from public.listing_scan_images`).catch(() => ({ rows: [] }))).rows.length, 0);
assert.equal((await q(seller, `select * from public.image_hashes`).catch(() => ({ rows: [] }))).rows.length, 0);
await fails(seller, `insert into public.listing_scans(user_id,listing_id,fingerprint,category,status) values ($1,$2,'forge','phones','approved')`, [seller, newListing()], /42501|permission denied|row-level/);
await fails(seller, `update public.listing_scan_images set verdict='pass', review_status='approved'`, [], /42501|permission denied|row-level/);
ok('clients cannot read evidence/hashes or write/forge scan results');
assert.equal((await q(supp, `select * from public.listing_scan_images`)).rows.length, 0);
assert.ok((await q(mod, `select * from public.listing_scan_images`)).rows.length >= 3);
ok('evidence is visible to moderators and admins only (not support, not sellers)');

const mine = (await q(seller, `select * from public.my_scan_result($1)`, [scanReview])).rows;
assert.equal(mine.length, 2);
assert.deepEqual(Object.keys(mine[0]).sort(), ['issues', 'public_url', 'review_status', 'scan_status', 'slot', 'verdict']);
assert.equal((await q(other, `select * from public.my_scan_result($1)`, [scanReview])).rows.length, 0);
ok('my_scan_result returns only sanitised fields, only to the scan owner');

// ---------------------------------------------------------------- hashes
await db.query(`insert into public.image_hashes(phash,sha256,user_id,listing_id) values ('ffffffffffffffff','a',$1,$2), ('fffffffffffffff0','b',$3,$4), ('0000000000000000','c',$3,$4)`, [other, newListing(), seller, newListing()]);
await fails(seller, `select * from public.find_similar_images('ffffffffffffffff',$1,6,null)`, [seller], /42501|permission denied/);
await db.exec(`reset role; set role service_role`);
const sim = (await db.query(`select * from public.find_similar_images('fffffffffffffff0',$1,6,null)`, [seller])).rows;
await db.exec('reset role');
assert.deepEqual(sim.map((r) => [r.distance, r.same_owner]), [[0, true], [4, false]]);
assert.deepEqual(Object.keys(sim[0]).sort(), ['distance', 'same_owner']);
ok('near-duplicate lookup is service-role only, returns distance + same-owner only (no listing/owner ids)');

// ---------------------------------------------------------------- staff review
const imgs = (await db.query(`select id, public_url from public.listing_scan_images where scan_id=$1 order by slot`, [scanReview])).rows;
const revImg = imgs[1].id;
await fails(seller, `select public.admin_review_scan_image($1,'approve','fine')`, [revImg], /42501|Not authorized/);
await fails(supp, `select public.admin_review_scan_image($1,'approve','fine')`, [revImg], /42501|Not authorized/);
await fails(mod, `select public.admin_review_scan_image($1,'approve','')`, [revImg], /22023|reason/);
await fails(mod, `select public.admin_review_scan_image($1,'maybe','because')`, [revImg], /22023|Unknown/);
ok('review is staff-only, needs a reason and a known decision');

// moderator may not override a clear REJECT
const L5 = newListing();
const sc5 = await scan({ listing: L5, status: 'needs_changes', images: [{ k: 'r5', verdict: 'reject', issues: ['prohibited_content'] }] });
const r5 = (await db.query(`select id from public.listing_scan_images where scan_id=$1`, [sc5])).rows[0].id;
await fails(mod, `select public.admin_review_scan_image($1,'approve','looks fine')`, [r5], /42501|administrator/);
await q(admin, `select public.admin_review_scan_image($1,'approve','Reviewed: product photo, false positive')`, [r5]);
assert.equal((await db.query(`select review_status from public.listing_scan_images where id=$1`, [r5])).rows[0].review_status, 'approved');
await insertListing(seller, L5, [URL('r5')], 'Overridden');
assert.equal((await row(L5)).status, 'available');
ok('only an administrator can override an automatic rejection; the override then publishes');

// approve the held one → listing restored + seller notified + audit
const noticesBefore = (await db.query(`select count(*)::int c from public.moderation_notices where user_id=$1`, [seller])).rows[0].c;
await q(mod, `select public.admin_review_scan_image($1,'approve','Checked: genuine own photo')`, [revImg]);
r4 = await row(L4);
assert.equal(r4.status, 'available');
assert.equal(r4.sb, null);
assert.equal((await db.query(`select status from public.listing_scans where id=$1`, [scanReview])).rows[0].status, 'approved');
const notice = (await db.query(`select title, body from public.moderation_notices where user_id=$1 order by created_at desc limit 1`, [seller])).rows[0];
assert.equal((await db.query(`select count(*)::int c from public.moderation_notices where user_id=$1`, [seller])).rows[0].c, noticesBefore + 1);
assert.match(notice.title, /live again/);
assert.equal(/genuine|Checked/.test(notice.body), false);
const audit = (await db.query(`select admin_id, reason, metadata from public.admin_audit_log where action='review_scan_image' and target_id=$1`, [L4])).rows;
assert.equal(audit.length, 1);
assert.equal(audit[0].admin_id, mod);
assert.equal(audit[0].metadata.decision, 'approve');
ok('approve restores the listing, notifies the seller without internal notes, and writes an audit row');

// ---------------------------------------------------------------- request replacement → seller swaps photo
const L6 = newListing();
const sc6 = await scan({ listing: L6, status: 'pending_review', images: [{ k: 'g6' }, { k: 'bad6', verdict: 'review', issues: ['category_uncertain'] }] });
await insertListing(seller, L6, [URL('g6'), URL('bad6')], 'Needs swap');
assert.equal((await row(L6)).status, 'deactivated');
const bad6 = (await db.query(`select id from public.listing_scan_images where scan_id=$1 and slot=1`, [sc6])).rows[0].id;
await q(mod, `select public.admin_review_scan_image($1,'request_replacement','Photo shows a different item','Please upload a photo of the phone itself')`, [bad6]);
const n6 = (await db.query(`select kind, title, body from public.moderation_notices where user_id=$1 and listing_id=$2`, [seller, L6])).rows[0];
assert.equal(n6.kind, 'image_replacement_requested');
assert.match(n6.body, /phone itself/);
assert.equal(/different item/.test(n6.body), false);
ok('replacement request notifies the seller with the public message only (internal reason stays internal)');

await fails(seller, `update public.listings set images=$2 where id=$1`, [L6, [URL('g6'), 'https://forged.example/x.jpg']], /42501|not been checked/);
ok('while awaiting a replacement the owner still cannot slip in an unverified photo');
await fails(seller, `update public.listings set images=$2 where id=$1`, [L6, [URL('g6'), URL('bad6')]], /not accepted|42501|under review/).catch(() => {});
assert.equal((await row(L6)).status, 'deactivated');
await q(seller, `update public.listings set title='Still the old photo' where id=$1`, [L6]).catch(() => {});
assert.equal((await row(L6)).status, 'deactivated');
ok('keeping the flagged photo leaves the hold in place');

await scan({ listing: L6, images: [{ k: 'new6' }] }); // new fingerprint for the corrected set
// adding a clean photo while KEEPING the flagged one must not release the hold
await q(seller, `update public.listings set images=$2 where id=$1`, [L6, [URL('g6'), URL('bad6'), URL('new6')]]);
assert.equal((await row(L6)).status, 'deactivated');
ok('adding a clean photo while keeping the flagged one does not release the hold');
await q(seller, `update public.listings set images=$2 where id=$1`, [L6, [URL('g6'), URL('new6')]]);
const r6 = await row(L6);
assert.equal(r6.status, 'available');
assert.equal(r6.sb, null);
ok('replacing the flagged photo with a verified one lifts the hold');

// reject decision leaves it locked
const L7 = newListing();
const sc7 = await scan({ listing: L7, status: 'pending_review', images: [{ k: 'x7', verdict: 'review', issues: ['weapon_uncertain'] }] });
await insertListing(seller, L7, [URL('x7')]);
const x7 = (await db.query(`select id from public.listing_scan_images where scan_id=$1`, [sc7])).rows[0].id;
await q(mod, `select public.admin_review_scan_image($1,'reject','Firearm visible')`, [x7]);
assert.equal((await row(L7)).status, 'deactivated');
await fails(seller, `update public.listings set title='x' where id=$1`, [L7], /42501|under review/);
ok('a rejected photo keeps the listing hidden and locked');

// ---------------------------------------------------------------- duplicate jobs, retention
await assert.rejects(() => db.query(`insert into public.listing_scans(user_id,listing_id,fingerprint,category) values ($1,$2,'dupfp','phones'),($1,$2,'dupfp','phones')`, [seller, newListing()]), /duplicate key|unique/);
ok('the same (user, listing, fingerprint) cannot create two scan jobs');

await db.query(`update public.listing_scans set created_at = now() - interval '40 days'`);
await db.exec(`reset role; set role service_role`);
const purged = (await db.query(`select * from public.purge_scan_evidence()`)).rows.map((r) => r.source_key);
await db.exec('reset role');
assert.ok(purged.length > 0);
assert.equal(purged.includes('orig/rev4'), true);          // approved long ago → purged
assert.equal(purged.includes('orig/bad6'), false);         // awaiting replacement → kept
assert.equal(purged.includes('orig/x7'), true);            // rejected & finished → purged
assert.equal((await db.query(`select count(*)::int c from public.listing_scan_images where source_key is not null and review_status in ('pending','replacement_requested')`)).rows[0].c >= 1, true);
await fails(seller, `select * from public.purge_scan_evidence()`, [], /42501|permission denied/);
ok('retention purge returns private keys to delete, spares photos still awaiting review, is service-role only');

// ---------------------------------------------------------------- enforcement OFF again: still no effect
await db.query(`update public.image_scan_config set enforce = false`);
await insertListing(seller, newListing(), ['https://anything.example/again.jpg']);
ok('turning enforcement back off restores the legacy publish path (safe rollback)');

console.log('\nimage_scans: all assertions passed');
