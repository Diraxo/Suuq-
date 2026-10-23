// 0070 + 0071 on top of the REAL chain (0001..0069). Real Postgres (PGlite).
// Proves, for the one-account model (personal and business are modes of the same account):
//   * switching modes never creates an account, never changes listing ownership/presentation, never rewrites chat or reviews;
//   * a draft/suspended storefront is never published by switching modes; publication and verification are separate states;
//   * an owner can edit, mark sold and remove their own listings in either mode, and nobody else can (RLS, not the UI);
//   * mark_listing_sold cannot be used to un-remove a staff-removed listing or by a suspended owner (0070);
//   * the admin Businesses directory (0071) is staff_can('business_review')-only, shows the review facts, and nobody can
//     moderate or verify their own storefront;
//   * KNOWN GAPS pinned as characterization tests (so changing them is a deliberate, visible act):
//       - removing a listing deletes its conversations and messages (ON DELETE CASCADE, migration 0005);
//       - profiles.email is readable by anyone (profiles.phone was closed by 0072).
// Not proven here: PostgREST column behaviour, the apps (tests/*.test.ts cover the display rules), Supabase-hosted grants.
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, uuid } from './harness/db.mjs';

const { db, applied } = await boot();
assert.ok(applied.includes('0070_owner_mark_sold_guard.sql') && applied.includes('0071_admin_business_directory.sql'));
const { q, fails } = actors(db);
const [admin, moderator, support, alice, bob, carol, dave] = await seedUsers(db, 7);
await db.query(`insert into public.admin_users(user_id, role) values ($1,'admin'), ($2,'moderator'), ($3,'support')`, [admin, moderator, support]);
await db.exec("select set_config('suuqplus.skip_rate_limit','true',false)");

const addListing = (id, owner, extra = '') =>
  db.query(`insert into public.listings (id,user_id,title,category,city,price,currency,status,images${extra ? ',seller_presentation' : ''}) values ($1,$2,'Laptop','electronics','Hargeisa',100,'USD','available',array['https://x.test/a.jpg']${extra ? ',$3' : ''})`, extra ? [id, owner, extra] : [id, owner]);
const listing = async (id) => (await db.query(`select user_id, seller_presentation sp, status, title from public.listings where id=$1`, [id])).rows[0];
const sf = async (owner) => (await db.query(`select * from public.storefronts where owner_id=$1`, [owner])).rows[0];
const profile = async (id) => (await db.query(`select active_mode, business_name, full_name, phone, account_status from public.profiles where id=$1`, [id])).rows[0];
const publishStorefront = async (uid, name) => {
  await q(uid, `insert into public.storefronts(owner_id, name) values ($1,$2)`, [uid, name]);
  await q(uid, `select public.storefront_publish()`);
};

await db.query(`update public.profiles set full_name='Alice Ali', phone='+252611111111' where id=$1`, [alice]);
await publishStorefront(alice, 'Alice Shop');
assert.equal((await profile(alice)).business_name, 'Alice Shop');

// ---- 1. mode switching: one account, stable id ---------------------------------------------------------------------
const accountsBefore = (await db.query(`select count(*)::int n from public.profiles`)).rows[0].n;
const l1 = uuid(801), l2 = uuid(802);
await addListing(l1, alice);
await addListing(l2, alice, 'business');
const conv = (await q(carol, `select * from public.find_or_create_conversation($1)`, [l1])).rows[0];
await q(carol, `insert into public.messages(conversation_id, sender_id, text) values ($1,$2,'is it available?')`, [conv.id, carol]);
await db.query(`insert into public.reviews(reviewer_id, seller_id, rating, comment) values ($1,$2,5,'great')`, [carol, alice]);
const history = async () => ({
  msgs: (await db.query(`select id, sender_id, text from public.messages order by id`)).rows,
  convs: (await db.query(`select id, buyer_id, seller_id, listing_id from public.conversations order by id`)).rows,
  reviews: (await db.query(`select id, reviewer_id, seller_id, rating from public.reviews order by id`)).rows,
  follows: (await db.query(`select count(*)::int n from public.followers`)).rows[0].n,
});
const historyBefore = await history();
const snapshot = async () => ({ l1: await listing(l1), l2: await listing(l2), sf: (({ status, verification_status, published_at, id }) => ({ status, verification_status, published_at, id }))(await sf(alice)) });
const stateBefore = await snapshot();

for (const m of ['business', 'personal', 'business', 'personal', 'business']) await q(alice, `select public.set_active_mode('${m}')`);
assert.equal((await profile(alice)).active_mode, 'business');
assert.equal((await db.query(`select count(*)::int n from public.profiles`)).rows[0].n, accountsBefore);
assert.equal((await db.query(`select count(*)::int n from public.storefronts where owner_id=$1`, [alice])).rows[0].n, 1);
assert.deepEqual(await snapshot(), stateBefore);
assert.deepEqual(await history(), historyBefore);
assert.equal((await profile(alice)).full_name, 'Alice Ali');
ok('switching modes keeps one account, the same listings/owners/presentations/storefront state, and all chat/review/follow history');

// ---- 2. unpublished / suspended storefronts are never published by a mode switch ---------------------------------
await q(bob, `insert into public.storefronts(owner_id, name) values ($1,'Bob Draft')`, [bob]);
// 0075: business mode needs no business name, so the switch itself is allowed; it must still never publish the storefront.
await q(bob, `select public.set_active_mode('business')`);
assert.equal((await sf(bob)).status, 'draft');
await q(bob, `select public.set_active_mode('personal')`);
assert.equal((await profile(bob)).active_mode, 'personal');
ok('a draft storefront stays draft: switching mode never publishes it');

await db.query(`update public.profiles set full_name='Dave' where id=$1`, [dave]);
await publishStorefront(dave, 'Dave Store');
await q(dave, `select public.set_active_mode('business')`);
await q(admin, `select public.admin_set_storefront_status($1,'suspend','Counterfeit goods reported')`, [(await sf(dave)).id]);
let d = await profile(dave);
assert.equal(d.active_mode, 'personal');
assert.equal(d.business_name, null);
await fails(dave, `select public.set_active_mode('business')`, [], /suspended|business_suspended/);
assert.equal((await sf(dave)).status, 'suspended');
await fails(dave, `select public.storefront_publish()`, [], /suspended|42501/);
await fails(dave, `update public.storefronts set status='published' where owner_id=$1`, [dave], /42501|managed by the server|permission denied/);
ok('a suspended business flips the account back to personal, cannot be re-entered by switching modes, and the owner cannot republish it');

await q(admin, `select public.admin_set_storefront_status($1,'reinstate','Appeal accepted after review')`, [(await sf(dave)).id]);
assert.equal((await sf(dave)).status, 'published');
await q(dave, `select public.storefront_unpublish()`);
await q(admin, `select public.admin_set_storefront_status($1,'suspend','Second suspension for testing')`, [(await sf(dave)).id]);
await q(admin, `select public.admin_set_storefront_status($1,'reinstate','Second reinstatement for testing')`, [(await sf(dave)).id]);
assert.equal((await sf(dave)).status, 'draft', 'reinstating restores the state before suspension (draft stays draft)');
ok('reinstating restores the exact previous publication state; a draft is not published by reinstatement');

// ---- 3. publication is not verification --------------------------------------------------------------------------
let a = await sf(alice);
assert.equal(a.status, 'published');
assert.equal(a.verification_status, 'not_requested');
assert.equal((await q(null, `select verified from public.public_storefronts where owner_id=$1`, [alice])).rows[0].verified, false);
await db.query(`insert into storage.objects(bucket_id,name,owner) values ('storefront-verification',$1,$2)`, [`${alice}/licence.pdf`, alice]);
const req = (await q(alice, `select public.request_storefront_verification($1) id`, [[`${alice}/licence.pdf`]])).rows[0].id;
assert.equal((await sf(alice)).status, 'published');
assert.equal((await sf(alice)).verification_status, 'pending');
await fails(alice, `select public.admin_decide_storefront_verification($1,'approve','I verify myself please')`, [req], /Not authorized/);
await fails(alice, `update public.storefronts set verification_status='verified' where owner_id=$1`, [alice], /42501|managed by the server|permission denied/);
await fails(alice, `select public.admin_revoke_storefront_verification($1,'a long enough reason')`, [a.id], /Not authorized/);
assert.equal((await sf(alice)).verification_status, 'pending');
await q(admin, `select public.admin_decide_storefront_verification($1,'approve','Licence matches name and address')`, [req]);
a = await sf(alice);
assert.equal(a.verification_status, 'verified');
assert.equal(a.status, 'published');
assert.equal((await q(null, `select verified from public.public_storefronts where owner_id=$1`, [alice])).rows[0].verified, true);
ok('publication and verification are separate: publishing does not verify, owners cannot self-verify, staff approval does not change publication');

// ---- 4. nobody moderates their own storefront ----------------------------------------------------------------------
await q(admin, `insert into public.storefronts(owner_id, name) values ($1,'Admin Shop')`, [admin]);
await q(admin, `select public.storefront_publish()`);
const adminSf = (await sf(admin)).id;
await fails(admin, `select public.admin_set_storefront_status($1,'suspend','Suspending my own shop now')`, [adminSf], /own storefront/);
await db.query(`update public.storefronts set status='suspended', suspended_at=now(), status_before_suspension='published' where id=$1`, [adminSf]); // as another admin would
await fails(admin, `select public.admin_set_storefront_status($1,'reinstate','Reinstating my own shop now')`, [adminSf], /own storefront/);
await db.query(`update public.storefronts set verification_status='pending' where id=$1`, [adminSf]);
await db.query(`update public.storefronts set verification_status='verified', verified_at=now() where id=$1`, [adminSf]);
await fails(admin, `select public.admin_revoke_storefront_verification($1,'Removing my own badge now')`, [adminSf], /own storefront/);
ok('staff cannot suspend, reinstate or revoke verification on their own storefront (approve was already blocked by 0054)');

// ---- 5. admin Businesses directory --------------------------------------------------------------------------------
const list = async (uid, ...args) => (await q(uid, `select public.admin_list_businesses(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).rows[0].r;
await fails(alice, `select public.admin_list_businesses()`, [], /Not authorized/);
await fails(bob, `select public.admin_list_businesses()`, [], /Not authorized/);
await fails(moderator, `select public.admin_list_businesses()`, [], /Not authorized/);
await fails(support, `select public.admin_list_businesses()`, [], /Not authorized/);
await fails(null, `select public.admin_list_businesses()`, [], /42501|permission denied|Not authorized/);
ok('the directory is admin-only: owners, other users, moderators, support and anonymous callers are refused');

await db.query(`insert into public.reports(reporter_id, target_type, target_id, reason) values ($1,'user',$2,'Scam'), ($1,'listing',$3,'Fake')`, [carol, alice, l2]);
await db.query(`insert into public.reports(reporter_id, target_type, target_id, reason, status) values ($1,'user',$2,'Old','dismissed')`, [bob, alice]);
await addListing(uuid(803), alice);
await db.query(`update public.listings set status='sold' where id=$1`, [uuid(803)]);
const rows = await list(admin);
const ar = rows.find((r) => r.ownerId === alice);
assert.equal(ar.businessName, 'Alice Shop');
assert.equal(ar.storefrontId, a.id);
assert.equal(ar.status, 'published');
assert.equal(ar.verificationStatus, 'verified');
assert.equal(ar.ownerAccountStatus, 'active');
assert.equal(ar.activeListings, 2, 'sold listings are not active');
assert.equal(ar.openUserReports, 1);
assert.equal(ar.openListingReports, 1);
assert.ok(!('phone' in ar) && !('email' in ar), 'no contact data in the directory');
assert.deepEqual(rows.map((r) => r.ownerId).sort(), [admin, alice, bob, dave].sort());
assert.deepEqual((await list(admin, 'draft')).map((r) => r.ownerId).sort(), [bob, dave].sort());
assert.deepEqual((await list(admin, null, 'verified')).map((r) => r.ownerId).sort(), [admin, alice].sort());
assert.deepEqual((await list(admin, null, null, 'ALICE')).map((r) => r.ownerId), [alice]);
assert.deepEqual((await list(admin, null, null, '%')).map((r) => r.ownerId), [], 'search is a plain substring, not a wildcard');
await fails(admin, `select public.admin_list_businesses('bogus')`, [], /Unknown status|22023/);
const before = (await db.query(`select count(*)::int n from public.admin_audit_log`)).rows[0].n;
await list(admin);
assert.equal((await db.query(`select count(*)::int n from public.admin_audit_log`)).rows[0].n, before, 'listing is read-only');
ok('the directory shows publication, verification, owner account id/status, active listing count and open reports, filters work, and it is read-only');

// ---- 6. owner listing management is mode-independent and owner-only -------------------------------------------------
for (const mode of ['business', 'personal']) {
  await q(alice, `select public.set_active_mode('${mode}')`);
  const id = uuid(810 + (mode === 'business' ? 0 : 1));
  await addListing(id, alice);
  const upd = await q(alice, `update public.listings set title='Edited in ${mode}' where id=$1 returning id`, [id]);
  assert.equal(upd.rows.length, 1);
  assert.equal((await listing(id)).title, `Edited in ${mode}`);
  assert.equal((await listing(id)).sp, 'personal', 'editing never rewrites presentation');
  await q(alice, `select public.mark_listing_sold($1)`, [id]);
  assert.equal((await listing(id)).status, 'sold');
  const del = await q(alice, `delete from public.listings where id=$1 returning id`, [id]);
  assert.equal(del.rows.length, 1);
}
ok('an owner can edit, mark sold and delete their own listings from either mode');

const l5 = uuid(820);
await addListing(l5, alice);
assert.equal((await q(bob, `update public.listings set title='hijack' where id=$1 returning id`, [l5])).rows.length, 0);
assert.equal((await q(bob, `delete from public.listings where id=$1 returning id`, [l5])).rows.length, 0);
assert.equal((await q(null, `delete from public.listings where id=$1 returning id`, [l5])).rows.length, 0);
await fails(bob, `select public.mark_listing_sold($1)`, [l5], /Not the owner/);
await fails(null, `select public.mark_listing_sold($1)`, [l5], /42501|permission denied|Not authenticated/);
await fails(alice, `update public.listings set user_id=$2 where id=$1`, [l5, bob], /row-level|42501/);
await fails(bob, `insert into public.listings (user_id,title,category,city,price,currency,images) values ($1,'forged','electronics','Hargeisa',1,'USD',array['https://x.test/a.jpg'])`, [alice], /row-level|42501/);
assert.deepEqual(await listing(l5), { user_id: alice, sp: 'personal', status: 'available', title: 'Laptop' });
ok('other users and anonymous callers cannot edit, delete, sell, reassign or forge listings (enforced by the database)');

// removal scope: only that listing
const l6 = uuid(821), l7 = uuid(822);
await addListing(l6, alice, 'business');
await addListing(l7, alice);
const totalListings = (await db.query(`select count(*)::int n from public.listings where user_id=$1`, [alice])).rows[0].n;
await q(alice, `delete from public.listings where id=$1`, [l6]);
assert.equal((await db.query(`select count(*)::int n from public.listings where user_id=$1`, [alice])).rows[0].n, totalListings - 1);
assert.equal((await db.query(`select count(*)::int n from public.profiles where id=$1`, [alice])).rows[0].n, 1);
assert.equal((await sf(alice)).status, 'published');
assert.equal((await sf(alice)).verification_status, 'verified');
assert.ok(await listing(l7));
ok('removing a listing does not remove the account, storefront, verification or the owner\'s other listings');

// KNOWN GAP (characterization): the same removal deletes the listing's chat. Change this test together with the fix proposed in
// docs/IDENTITY_LISTING_BUSINESS_FINALIZATION_2026-10-22.md section 3.
const convDelete = (await q(carol, `select * from public.find_or_create_conversation($1)`, [l7])).rows[0];
await q(carol, `insert into public.messages(conversation_id, sender_id, text) values ($1,$2,'hello')`, [convDelete.id, carol]);
await q(alice, `delete from public.listings where id=$1`, [l7]);
assert.equal((await db.query(`select count(*)::int n from public.conversations where id=$1`, [convDelete.id])).rows[0].n, 0);
assert.equal((await db.query(`select count(*)::int n from public.messages where conversation_id=$1`, [convDelete.id])).rows[0].n, 0);
assert.equal((await db.query(`select count(*)::int n from public.messages where conversation_id=$1`, [conv.id])).rows[0].n, 1, 'other conversations are untouched');
ok('KNOWN GAP pinned: deleting a listing cascades to ITS conversations and messages (others untouched)');

// ---- 7. moderation cannot be bypassed through the owner paths ---------------------------------------------------
const l8 = uuid(830);
await addListing(l8, alice);
await q(admin, `select public.admin_set_listing_status($1,'removed','Prohibited item reported')`, [l8]);
assert.equal((await listing(l8)).status, 'removed');
await fails(alice, `update public.listings set status='available' where id=$1`, [l8], /42501|Only staff|under review/);
await fails(alice, `delete from public.listings where id=$1`, [l8], /42501|under review/);
await fails(alice, `select public.mark_listing_sold($1)`, [l8], /under review|42501/);
assert.equal((await listing(l8)).status, 'removed', 'mark_listing_sold must not restore a staff-removed listing');
ok('a staff-removed listing cannot be edited, deleted or restored by its owner (including via mark_listing_sold)');

const l9 = uuid(831);
await addListing(l9, bob);
await db.query(`update public.profiles set account_status='suspended' where id=$1`, [bob]);
await fails(bob, `select public.mark_listing_sold($1)`, [l9], /suspended|42501/);
await fails(bob, `update public.listings set title='x' where id=$1`, [l9], /suspended|42501/);
assert.equal((await listing(l9)).status, 'available');
ok('a suspended owner cannot edit or mark sold');

// ---- 8. contact privacy (phone closed by 0072; email is still a KNOWN EXPOSURE, characterization) -----------------------------------------------------------
await q(alice, `update public.profiles set business_phone_public=false where id=$1`, [alice]);
for (const who of [null, carol]) {
  const r = await q(who, `select phone, email from public.profiles where id=$1`, [alice]);
  assert.equal(r.rows[0].phone, null, 'since 0072 profiles.phone is NULL for everyone (see phone_privacy.test.mjs)');
  assert.equal(r.rows[0].email, 'u4@test.dev', 'profiles.email is readable by anyone too (policy "profiles are publicly readable" using (true), no column restriction)');
}
const star = await q(null, `select * from public.profiles where id=$1`, [alice]);
assert.equal(star.rows[0].phone, null);
assert.ok('email' in star.rows[0], 'select * as anon (what the feed loaders do) still returns the email');
ok('phone is private (0072); KNOWN EXPOSURE pinned: the sign-in email is still readable by anon and other users through profiles');

console.log('owner_listing_business_admin: all passed');
