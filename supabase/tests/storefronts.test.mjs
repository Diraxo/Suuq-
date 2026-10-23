// 0054 — storefronts: ownership, permitted fields, forbidden status changes, public path (view, not table), verification
// state machine, staff authorization, audit, backfill, legacy-app compatibility, failure cases.
// Real Postgres (PGlite). Boots 0001..0053, seeds LEGACY business data, THEN applies 0054 so the backfill is real.
// Not proven here (see docs/STOREFRONTS_0054_HARDENING.md): production Supabase grants/PostgREST, Storage API enforcement of the
// bucket size/MIME limits, the Security Advisor, real signed URLs.
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, uuid, sqlFile } from './harness/db.mjs';

const { db } = await boot({ upTo: '0053' });
const { q, fails } = actors(db);
const [admin, moderator, support, alice, bob, carol, dave, erin] = await seedUsers(db, 8);
await db.query(`insert into public.admin_users(user_id, role) values ($1,'admin'), ($2,'moderator'), ($3,'support')`, [admin, moderator, support]);

// ---- legacy data BEFORE the migration
await db.query(`update public.profiles set business_name='Alice Shop', business_description='Phones', business_address='Hargeisa', business_website='https://alice.example', business_logo_url='https://cdn/logo.png', business_logo_public_id='lp1' where id=$1`, [alice]);
await db.query(`update public.profiles set business_name='   ', business_description='' where id=$1`, [bob]); // blank only: not meaningful
await db.query(`update public.profiles set business_name='Carol', business_description=$2, business_website='not a url' where id=$1`, [carol, 'D'.repeat(3000)]); // dirty
const daveLogoKey = `business/${dave}/logo/${uuid(777)}.jpg`;
await db.query(`update public.profiles set business_description='Only a description', business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [dave, `https://media.test/${daveLogoKey}`, daveLogoKey]);
await db.query(`update public.profiles set business_hours='{"days":{"sun":{"open":"08:00"}}}'::jsonb, business_website='junk' where id=$1`, [admin]); // junk + hours-only (admin has no business name)
// Before the migration the legacy columns are PUBLIC (profiles is readable by anyone): this is the exposure being closed.
assert.equal((await q(null, `select business_name from public.profiles where id=$1`, [alice])).rows[0].business_name, 'Alice Shop');
const bobBefore = (await db.query(`select business_name, business_description from public.profiles where id=$1`, [bob])).rows[0];

await db.exec(sqlFile('migrations/0054_storefronts.sql'));
ok('0054 applies on top of 0001..0053');

// ---- backfill
const sf = async (owner) => (await db.query(`select * from public.storefronts where owner_id=$1`, [owner])).rows[0];
const a0 = await sf(alice);
assert.equal(a0.name, 'Alice Shop'); assert.equal(a0.status, 'draft'); assert.equal(a0.verification_status, 'not_requested');
assert.equal(a0.published_at, null); assert.equal(a0.website, 'https://alice.example');
assert.equal(a0.logo_url, null); assert.equal(a0.logo_public_id, null, 'an unmanaged legacy logo is not carried over');
ok('backfill: legacy business data becomes a DRAFT, unverified storefront (unmanaged legacy logo dropped, not copied)');
assert.equal(await sf(bob), undefined, 'blank-only data is not meaningful'); assert.equal(await sf(support), undefined);
const c0 = await sf(carol);
assert.equal(c0.description.length, 2000); assert.equal(c0.website, null);
assert.equal((await sf(dave)).name, null);
assert.equal((await sf(dave)).logo_url, null, 'allowlist is empty at backfill time: fail closed');
ok('backfill: blank profiles skipped; over-long TEXT trimmed; invalid website dropped; description-only keeps a nameless draft');
const adminSf = await sf(admin);
assert.equal(adminSf.name, null); assert.deepEqual(adminSf.hours, { days: { sun: { open: '08:00' } } }); assert.equal(adminSf.website, null);
ok('backfill: hours-only profile gets a draft; its junk website is not carried over');
assert.equal((await db.query(`select count(*)::int c from public.storefronts where status <> 'draft' or verification_status <> 'not_requested'`)).rows[0].c, 0);
ok('backfill publishes and verifies nobody');
// DRAFT MEANS PRIVATE: every backfilled draft is cleared from the public table; blank-only profile untouched; originals snapshotted.
const legacyCols = `business_name, business_description, business_address, business_website, business_logo_url, business_banner_url, business_logo_public_id, business_banner_public_id`;
for (const u of [alice, carol, dave, admin]) {
  const row = (await q(null, `select ${legacyCols}, business_hours from public.profiles where id=$1`, [u])).rows[0];
  for (const [k, v] of Object.entries(row)) assert.ok(v === null || (k === 'business_hours' && Object.keys(v).length === 0), `${k} of a draft owner must not be public`);
}
assert.deepEqual((await db.query(`select business_name, business_description from public.profiles where id=$1`, [bob])).rows[0], bobBefore);
const snapA = (await db.query(`select business from public.storefront_legacy_snapshot where owner_id=$1`, [alice])).rows[0].business;
assert.equal(snapA.name, 'Alice Shop'); assert.equal(snapA.logo_url, 'https://cdn/logo.png'); assert.equal(snapA.logo_public_id, 'lp1');
assert.equal((await db.query(`select count(*)::int c from public.storefront_legacy_snapshot where owner_id=$1`, [bob])).rows[0].c, 0);
assert.equal((await db.query(`select business from public.storefront_legacy_snapshot where owner_id=$1`, [carol])).rows[0].business.website, 'not a url');
await fails(alice, `select * from public.storefront_legacy_snapshot`, [], /42501|permission denied/);
await fails(null, `select * from public.storefront_legacy_snapshot`, [], /42501|permission denied/);
await fails(alice, `select * from public.storefront_media_hosts`, [], /42501|permission denied/);
ok('DRAFT IS PRIVATE: backfilled drafts are cleared from profiles (anon reads null); originals kept in a service-only snapshot; blank profile untouched');

// ---- the managed media host allowlist starts EMPTY (fail closed); the operator fills it, then can re-attach legacy images
await db.query(`insert into public.storefront_media_hosts(host) values ('media.test')`);
await fails(null, `select public._sf_reattach_legacy_images()`, [], /42501|permission denied/);
await fails(alice, `select public._sf_reattach_legacy_images()`, [], /42501|permission denied/);
assert.equal((await db.query(`select public._sf_reattach_legacy_images() n`)).rows[0].n, 1, 'only dave\'s managed logo validates; alice\'s cdn/lp1 does not');
assert.equal((await sf(dave)).logo_url, `https://media.test/${daveLogoKey}`);
assert.equal((await sf(alice)).logo_url, null);
assert.equal((await db.query(`select public._sf_reattach_legacy_images() n`)).rows[0].n, 0, 'idempotent');
assert.equal((await q(null, `select business_logo_url from public.profiles where id=$1`, [dave])).rows[0].business_logo_url, null, 'a draft stays private after re-attach');
ok('operator re-attach: after the host is listed, only still-valid legacy images return to the DRAFT storefront; not callable via the API; profile stays cleared');

// ---- permission matrix
const can = async (uid, a) => (await q(uid, `select public.staff_can($1) c`, [a])).rows[0].c;
assert.equal(await can(admin, 'business_review'), true);
assert.equal(await can(moderator, 'business_review'), false, 'moderators have no access to identity documents');
assert.equal(await can(support, 'business_review'), false);
assert.equal(await can(alice, 'business_review'), false);
assert.equal((await q(null, `select public.staff_can('business_review') c`)).rows[0].c, false);
assert.equal(await can(support, 'read'), true); assert.equal(await can(support, 'moderate_listing'), false);
assert.equal(await can(moderator, 'ban'), false); assert.equal(await can(moderator, 'decide_appeal_suspension'), true);
ok('staff_can(business_review): admin only (moderator and support excluded); the rest of the 0039 matrix is unchanged');

// ---- ownership & permitted fields
await q(bob, `insert into public.storefronts(owner_id, name) values ($1,'Bob Store')`, [bob]);
assert.equal((await sf(bob)).status, 'draft');
await fails(bob, `insert into public.storefronts(owner_id, name) values ($1,'Dup')`, [bob], /23505|duplicate/);
ok('an owner creates their own storefront; a second one is rejected (unique owner)');
await fails(carol, `insert into public.storefronts(owner_id, name) values ($1,'Impersonate')`, [bob], /row-level|42501/);
ok("cannot create a storefront for someone else");
await fails(erin, `insert into public.storefronts(owner_id, name, status) values ($1,'S','published')`, [erin], /42501|permission denied/);
await fails(erin, `insert into public.storefronts(owner_id, name, verification_status) values ($1,'S','verified')`, [erin], /42501|permission denied/);
assert.equal(await sf(erin), undefined);
ok('status / verification_status cannot even be named in a client INSERT (column grants)');
await q(bob, `update public.storefronts set description='Bags', hours='{"days":{"mon":{"open":"09:00"}}}', website='https://bob.example' where owner_id=$1`, [bob]);
assert.equal((await sf(bob)).description, 'Bags');
ok('an owner updates permitted fields');
for (const col of ["status='published'", "verification_status='verified'", "verified_at=now()", "published_at=now()", "status_before_suspension='draft'", `owner_id='${alice}'`]) {
  await fails(bob, `update public.storefronts set ${col} where owner_id=$1`, [bob], /42501|permission denied/);
}
ok('an owner cannot set status, verification, timestamps or owner via direct UPDATE');
// trigger layer on its own (column grants widened, as if the grants were mis-set in production)
await db.exec(`grant update on public.storefronts to authenticated`);
for (const col of ["status='published'", "verification_status='verified', verified_at=now()", "published_at=now()", "suspended_at=now()"]) {
  await fails(bob, `update public.storefronts set ${col} where owner_id=$1`, [bob], /42501|managed by the server/);
}
await fails(bob, `update public.storefronts set owner_id=$2 where owner_id=$1`, [bob, carol], /42501|cannot change owner|row-level/);
await db.exec(`revoke update on public.storefronts from authenticated; grant update (name, description, address, website, hours, logo_url, banner_url, logo_public_id, banner_public_id) on public.storefronts to authenticated`);
ok('defense in depth: even with a table-wide UPDATE grant the guard trigger blocks protected columns');
await fails(bob, `update public.storefronts set name=$2 where owner_id=$1`, [bob, ''], /23514|storefronts_name_check/);
await fails(bob, `update public.storefronts set website='javascript:alert(1)' where owner_id=$1`, [bob], /23514|website_check/);
await fails(bob, `update public.storefronts set description=$2 where owner_id=$1`, [bob, 'x'.repeat(2001)], /23514/);
ok('CHECK constraints: blank name, non-http website, over-long description rejected');
assert.equal((await q(bob, `update public.storefronts set name='Hack' where owner_id=$1 returning 1`, [alice])).rows.length, 0);
assert.equal((await sf(alice)).name, 'Alice Shop');
ok("an owner's UPDATE cannot reach someone else's storefront (RLS filters it to 0 rows)");
await fails(bob, `delete from public.storefronts where owner_id=$1`, [bob], /42501|permission denied/);
ok('an owner cannot delete their storefront (no DELETE grant)');

// ---- direct table access: only the owner sees the row; the public sees nothing
assert.equal((await q(carol, `select * from public.storefronts where owner_id=$1`, [bob])).rows.length, 0);
assert.equal((await q(bob, `select * from public.storefronts`)).rows.length, 1);
await fails(null, `select * from public.storefronts`, [], /42501|permission denied/);
await fails(null, `select * from public.storefront_verification_requests`, [], /42501|permission denied/);
await fails(bob, `select * from public.storefront_verification_requests`, [], /42501|permission denied/).catch(() => {});
ok('anon has no table access; another signed-in user sees 0 rows of someone else\'s storefront');

// ---- publish / public view
const pub = (uid) => q(uid, `select id, owner_id, name, description, address, website, logo_url, verified, published_at from public.public_storefronts order by name`);
assert.equal((await pub(null)).rows.length, 0, 'drafts are not public');
await fails(erin, `select public.storefront_publish()`, [], /Create your storefront|P0002/);
await q(alice, `select public.storefront_publish()`);
await fails(dave, `select public.storefront_publish()`, [], /needs a name|23514/);
const shown = (await pub(null)).rows;
assert.equal(shown.length, 1); assert.equal(shown[0].name, 'Alice Shop'); assert.equal(shown[0].verified, false);
assert.deepEqual(Object.keys(shown[0]).sort(), ['address', 'description', 'id', 'logo_url', 'name', 'owner_id', 'published_at', 'verified', 'website']);
const cols = (await db.query(`select column_name from information_schema.columns where table_name='public_storefronts'`)).rows.map((r) => r.column_name);
for (const forbidden of ['status', 'verification_status', 'verified_at', 'suspended_at', 'status_before_suspension', 'created_at', 'updated_at', 'logo_public_id', 'banner_public_id']) assert.ok(!cols.includes(forbidden), `view must not expose ${forbidden}`);
ok('PUBLIC PATH: anon sees only the published storefront, only public columns; drafts and the name-less one are absent');
await q(alice, `select public.storefront_unpublish()`);
assert.equal((await pub(null)).rows.length, 0);
await q(alice, `select public.storefront_publish()`);
ok('unpublish hides it; republish shows it');
const pubProfile = async (u) => (await q(null, `select business_name n, business_description d, business_website w from public.profiles where id=$1`, [u])).rows[0];
assert.equal((await pubProfile(alice)).n, 'Alice Shop', 'published + good standing: mirrored to profiles for old apps');
await db.query(`update public.profiles set account_status='suspended', suspended_until=now()+interval '1 day' where id=$1`, [alice]);
assert.equal((await pub(null)).rows.length, 0);
assert.deepEqual(await pubProfile(alice), { n: null, d: null, w: null }, 'suspended account: no business info in the PUBLIC profiles table either');
await db.query(`update public.profiles set account_status='active', suspended_until=null where id=$1`, [alice]);
assert.equal((await pub(null)).rows.length, 1);
assert.equal((await pubProfile(alice)).n, 'Alice Shop');
await db.query(`update public.profiles set account_status='banned' where id=$1`, [alice]);
assert.equal((await pub(null)).rows.length, 0); assert.equal((await pubProfile(alice)).n, null);
await db.query(`update public.profiles set account_status='suspended', suspended_until=null where id=$1`, [alice]);
assert.equal((await pubProfile(alice)).n, null, 'open-ended suspension');
await db.query(`update public.profiles set account_status='suspended', suspended_until=now()-interval '1 minute' where id=$1`, [alice]);
assert.equal((await pub(null)).rows.length, 1, 'an expired suspension no longer hides the view');
assert.equal((await pubProfile(alice)).n, 'Alice Shop', 'and the account_status/suspended_until write re-runs the mirror');
await db.query(`update public.profiles set account_status='active', suspended_until=null where id=$1`, [alice]);
// old app writes while the ACCOUNT is suspended cannot re-expose it
await db.query(`update public.profiles set account_status='banned' where id=$1`, [alice]);
await q(alice, `update public.profiles set business_description='Written while banned' where id=$1`, [alice]);
assert.equal((await pubProfile(alice)).d, null);
await db.query(`update public.profiles set account_status='active' where id=$1`, [alice]);
assert.equal((await pubProfile(alice)).d, 'Written while banned', 'the edit was kept in the storefront and returns with the account');
await q(alice, `update public.profiles set business_description='Phones' where id=$1`, [alice]);
ok('ACCOUNT suspension/ban/expiry/reinstatement drives BOTH the public view and the legacy profiles columns (all public read paths); old-app writes cannot bypass it');
await fails(null, `select public.storefront_publish()`, [], /42501|permission denied/);
await fails(null, `select public.admin_set_storefront_status('${a0.id}','suspend','a long enough reason')`, [], /42501|permission denied/);
ok('anon cannot execute owner or staff RPCs');

// ---- verification: request
const objs = async (rows) => { for (const [name, owner] of rows) await db.query(`insert into storage.objects(bucket_id,name,owner) values ('storefront-verification',$1,$2)`, [name, owner]); };
await objs([[`${alice}/id.jpg`, alice], [`${alice}/licence.pdf`, alice], [`${bob}/id.jpg`, bob]]);
await fails(alice, `select public.request_storefront_verification($1)`, [[`${bob}/id.jpg`]], /Unknown document|22023/);
await fails(alice, `select public.request_storefront_verification($1)`, [[`${alice}/missing.jpg`]], /Unknown document/);
await fails(alice, `select public.request_storefront_verification($1)`, [[]], /1 to 5|22023/);
await fails(alice, `select public.request_storefront_verification($1)`, [Array(6).fill(`${alice}/id.jpg`)], /1 to 5|22023/);
await fails(erin, `select public.request_storefront_verification($1)`, [[`${erin}/x.jpg`]], /Create your storefront/);
await fails(dave, `select public.request_storefront_verification($1)`, [[`${dave}/x.jpg`]], /business name/);
assert.equal((await sf(alice)).verification_status, 'not_requested');
ok("request failures: other user's file, missing file, 0 or 6 documents, no storefront, no name — nothing changes");
const reqId = (await q(alice, `select public.request_storefront_verification($1,'please check') id`, [[`${alice}/id.jpg`, `${alice}/licence.pdf`]])).rows[0].id;
assert.equal((await sf(alice)).verification_status, 'pending');
await fails(alice, `select public.request_storefront_verification($1)`, [[`${alice}/id.jpg`]], /already pending|23505/);
ok('request moves not_requested -> pending; a second request while pending is refused');
const mine = (await q(alice, `select public.my_storefront_verification() v`)).rows[0].v;
assert.equal(mine.status, 'pending'); assert.equal(mine.message, null);
ok('owner sees status only');
// identity freeze while pending
await fails(alice, `update public.storefronts set name='Changed During Review' where owner_id=$1`, [alice], /locked while verification is pending|55006/);
await fails(alice, `update public.storefronts set address='Elsewhere' where owner_id=$1`, [alice], /locked while verification is pending|55006/);
await db.query(`update public.storefronts set description='Phones and more' where owner_id=$1`, [alice]);
await assert.rejects(db.query(`update public.storefronts set name='Changed During Review' where owner_id=$1`, [alice]), /locked while verification is pending/, 'frozen for every writer, including the service role');
const pendingReq = (await db.query(`select submitted_name, submitted_address from public.storefront_verification_requests where owner_id=$1`, [alice])).rows[0];
assert.equal(pendingReq.submitted_name, 'Alice Shop'); assert.equal(pendingReq.submitted_address, 'Hargeisa');
// old app: saving the business form during review must not fail or change the frozen identity
await q(alice, `update public.profiles set business_name='Old App During Review', business_address='Mogadishu', business_description='Phones' where id=$1`, [alice]);
let ap = await sf(alice);
assert.equal(ap.name, 'Alice Shop'); assert.equal(ap.address, 'Hargeisa'); assert.equal(ap.description, 'Phones');
assert.equal((await pubProfile(alice)).n, 'Alice Shop', 'the legacy columns show the frozen identity, not the rejected edit');
ok('PENDING FREEZE: name and address cannot change for any writer; other fields can; old-app saves are accepted but the identity is kept; the request records the submitted identity');

// ---- staff-only access
await fails(alice, `select public.admin_get_storefront_review($1)`, [reqId], /Not authorized|42501/);
await fails(support, `select public.admin_get_storefront_review($1)`, [reqId], /Not authorized|42501/);
await fails(support, `select public.admin_list_storefront_reviews()`, [], /Not authorized|42501/);
await fails(alice, `select public.admin_decide_storefront_verification($1,'approve','a long enough reason')`, [reqId], /Not authorized/);
await fails(support, `select public.admin_decide_storefront_verification($1,'approve','a long enough reason')`, [reqId], /Not authorized/);
await fails(alice, `select public.admin_set_storefront_status($1,'suspend','a long enough reason')`, [a0.id], /Not authorized/);
await fails(support, `select public.admin_set_storefront_status($1,'suspend','a long enough reason')`, [a0.id], /Not authorized/);
await fails(moderator, `select public.admin_decide_storefront_verification($1,'approve','a long enough reason')`, [reqId], /Not authorized/);
await fails(moderator, `select public.admin_get_storefront_review($1)`, [reqId], /Not authorized/);
assert.equal((await q(alice, `select * from public.storefront_verification_requests`)).rows.length, 0);
assert.equal((await q(support, `select * from public.storefront_verification_requests`)).rows.length, 0);
assert.equal((await q(moderator, `select * from public.storefront_verification_requests`)).rows.length, 0);
assert.equal((await q(admin, `select * from public.storefront_verification_requests`)).rows.length, 1);
ok('only admins can list/open/decide/suspend; owner, moderator and support read 0 request rows');
const list = (await q(admin, `select public.admin_list_storefront_reviews('pending') l`)).rows[0].l;
assert.equal(list.length, 1); assert.equal(list[0].documentCount, 2); assert.ok(!JSON.stringify(list).includes('id.jpg'), 'list does not leak paths');
const auditCount = async (action) => (await db.query(`select count(*)::int c from public.admin_audit_log where action=$1`, [action])).rows[0].c;
const detail = (await q(admin, `select public.admin_get_storefront_review($1) d`, [reqId])).rows[0].d;
assert.deepEqual(detail.documentPaths, [`${alice}/id.jpg`, `${alice}/licence.pdf`]);
assert.equal(await auditCount('view_storefront_verification'), 1);
ok('opening documents returns the paths to authorized staff and is itself audited');

// ---- decisions
await fails(admin, `select public.admin_decide_storefront_verification($1,'approve','short')`, [reqId], /10 characters|22023/);
await fails(admin, `select public.admin_decide_storefront_verification($1,'maybe','a long enough reason')`, [reqId], /approve or reject/);
await fails(admin, `select public.admin_decide_storefront_verification($1,'approve',null)`, [reqId], /reason/);
await fails(admin, `select public.admin_decide_storefront_verification($1,'approve','a long enough reason')`, [uuid(999)], /not found|P0002/);
assert.equal((await sf(alice)).verification_status, 'pending');
ok('decision failures (short/null reason, bad decision, unknown request) change nothing');
await q(admin, `select public.admin_decide_storefront_verification($1,'reject','Licence photo unreadable','Please upload a clearer licence')`, [reqId]);
let a = await sf(alice);
assert.equal(a.verification_status, 'rejected'); assert.equal(a.verified_at, null);
const m1 = (await q(alice, `select public.my_storefront_verification() v`)).rows[0].v;
assert.equal(m1.status, 'rejected'); assert.equal(m1.message, 'Please upload a clearer licence');
assert.ok(!JSON.stringify(m1).includes('unreadable'), 'internal reason never reaches the owner');
const au = (await db.query(`select * from public.admin_audit_log where action='reject_storefront_verification'`)).rows;
assert.equal(au.length, 1); assert.equal(au[0].admin_id, admin); assert.equal(au[0].target_type, 'storefront'); assert.equal(au[0].target_id, a.id);
assert.equal(au[0].reason, 'Licence photo unreadable'); assert.ok(au[0].created_at);
assert.equal((await db.query(`select count(*)::int c from public.notifications where user_id=$1 and type='storefront'`, [alice])).rows[0].c, 1);
ok('reject: state, owner-facing message only, audit row (actor/action/target/reason/time), owner notified');
await fails(admin, `select public.admin_decide_storefront_verification($1,'approve','a long enough reason')`, [reqId], /already decided|23505/);
ok('a decided request cannot be decided twice');
const req2 = (await q(alice, `select public.request_storefront_verification($1) id`, [[`${alice}/id.jpg`]])).rows[0].id;
assert.equal((await sf(alice)).verification_status, 'pending');
ok('rejected -> pending: the owner can re-apply');
await q(admin, `select public.admin_decide_storefront_verification($1,'approve','Documents match the business')`, [req2]);
a = await sf(alice);
assert.equal(a.verification_status, 'verified'); assert.ok(a.verified_at);
assert.equal((await pub(null)).rows[0].verified, true);
assert.equal((await db.query(`select verified_at from public.profiles where id=$1`, [alice])).rows[0].verified_at, null, 'personal verification is separate');
ok('approve: verified + visible as verified in the public view; profiles.verified_at untouched');
// verified identity: an address change voids it just like a name change
await q(alice, `update public.storefronts set address='Burao' where owner_id=$1`, [alice]);
assert.equal((await sf(alice)).verification_status, 'not_requested'); assert.equal((await sf(alice)).verified_at, null);
await q(alice, `update public.storefronts set address='Hargeisa' where owner_id=$1`, [alice]);
const reqAddr = (await q(alice, `select public.request_storefront_verification($1) id`, [[`${alice}/id.jpg`]])).rows[0].id;
// approval is only valid for the identity that was reviewed (defense in depth: the freeze already prevents this)
await db.query(`alter table public.storefronts disable trigger storefronts_a_guard`);
await db.query(`update public.storefronts set address='Somewhere else' where owner_id=$1`, [alice]);
await db.query(`alter table public.storefronts enable trigger storefronts_a_guard`);
await fails(admin, `select public.admin_decide_storefront_verification($1,'approve','a long enough reason')`, [reqAddr], /identity changed|23514/);
await db.query(`alter table public.storefronts disable trigger storefronts_a_guard`);
await db.query(`update public.storefronts set address='Hargeisa' where owner_id=$1`, [alice]);
await db.query(`alter table public.storefronts enable trigger storefronts_a_guard`);
await q(admin, `select public.admin_decide_storefront_verification($1,'approve','Documents match the business')`, [reqAddr]);
assert.equal((await sf(alice)).verification_status, 'verified');
ok('verified + address change voids the verification; an approval for a changed identity is refused');
await fails(alice, `update public.storefronts set verification_status='not_requested' where owner_id=$1`, [alice], /42501|permission denied/);

// self-review
await q(admin, `update public.storefronts set name='Mod shop' where owner_id=$1`, [admin]); // admin's draft came from the hours-only backfill
await objs([[`${admin}/id.jpg`, admin]]);
const modReq = (await q(admin, `select public.request_storefront_verification($1) id`, [[`${admin}/id.jpg`]])).rows[0].id;
await fails(admin, `select public.admin_decide_storefront_verification($1,'approve','a long enough reason')`, [modReq], /own storefront|42501/);
await db.query(`insert into public.admin_users(user_id, role) values ($1,'admin')`, [erin]);
await q(erin, `select public.admin_decide_storefront_verification($1,'approve','Reviewed by another admin')`, [modReq]);
await db.query(`delete from public.admin_users where user_id = $1`, [erin]);
ok('staff cannot approve their own storefront; another reviewer can');

// name change voids verification
await q(alice, `update public.storefronts set name='Alice Phones' where owner_id=$1`, [alice]);
a = await sf(alice);
assert.equal(a.verification_status, 'not_requested'); assert.equal(a.verified_at, null);
ok('renaming a verified storefront voids the verification (granted for the old name)');
await q(alice, `update public.storefronts set description='Better phones' where owner_id=$1`, [alice]);
// revoke
const req3 = (await q(alice, `select public.request_storefront_verification($1) id`, [[`${alice}/id.jpg`]])).rows[0].id;
await q(admin, `select public.admin_decide_storefront_verification($1,'approve','Name now matches the licence')`, [req3]);
await fails(admin, `select public.admin_revoke_storefront_verification($1,'too short')`, [a.id], /10 characters/);
await q(admin, `select public.admin_revoke_storefront_verification($1,'Licence found to be forged')`, [a.id]);
assert.equal((await sf(alice)).verification_status, 'not_requested');
assert.equal(await auditCount('revoke_storefront_verification'), 1);
await fails(admin, `select public.admin_revoke_storefront_verification($1,'Licence found to be forged')`, [a.id], /not verified|23514/);
ok('revoke: needs a reason, audited, only from verified');

// ---- suspension
await fails(admin, `select public.admin_set_storefront_status($1,'suspend','x')`, [a.id], /10 characters/);
await fails(admin, `select public.admin_set_storefront_status($1,'freeze','a long enough reason')`, [a.id], /Unknown action/);
await fails(admin, `select public.admin_set_storefront_status($1,'reinstate','a long enough reason')`, [a.id], /not suspended|23514/);
await q(admin, `select public.admin_set_storefront_status($1,'suspend','Sells counterfeit goods','Counterfeits are not allowed')`, [a.id]);
a = await sf(alice);
assert.equal(a.status, 'suspended'); assert.equal(a.status_before_suspension, 'published'); assert.ok(a.suspended_at);
assert.equal((await pub(null)).rows.length, 0);
assert.equal(await auditCount('suspend_storefront'), 1);
ok('suspend: hidden from the public view, previous status remembered, audited');
await fails(alice, `select public.storefront_publish()`, [], /suspended/);
await fails(alice, `select public.storefront_unpublish()`, [], /suspended/);
assert.equal((await q(alice, `update public.storefronts set name='Evade' where owner_id=$1 returning 1`, [alice])).rows.length, 0);
await fails(alice, `select public.request_storefront_verification($1)`, [[`${alice}/id.jpg`]], /suspended/);
await fails(admin, `select public.admin_set_storefront_status($1,'suspend','a long enough reason')`, [a.id], /Already suspended|23505/);
ok('a suspended owner cannot publish, unpublish, edit or request verification');
await q(admin, `select public.admin_set_storefront_status($1,'reinstate','Appeal accepted, items removed')`, [a.id]);
a = await sf(alice);
assert.equal(a.status, 'published'); assert.equal(a.suspended_at, null); assert.equal(a.status_before_suspension, null);
assert.equal((await pub(null)).rows.length, 1);
assert.equal(await auditCount('reinstate_storefront'), 1);
ok('reinstate restores the previous status and visibility');

// ---- legacy-app compatibility (old versions write profiles.business_*)
const prof = async (id) => (await db.query(`select business_name n, business_description d, business_address a, business_website w, business_hours h from public.profiles where id=$1`, [id])).rows[0];
// (a) published storefront: old app saves a form with some blanks
await q(alice, `update public.profiles set business_name='Old App Name', business_description=null, business_address=null, business_website=null, business_hours='{}'::jsonb where id=$1`, [alice]);
a = await sf(alice);
assert.equal(a.name, 'Old App Name'); assert.equal(a.description, 'Better phones'); assert.equal(a.address, 'Hargeisa');
let p = await prof(alice);
assert.equal(p.n, 'Old App Name'); assert.equal(p.d, 'Better phones', 'blanks written by an old app are re-derived from the storefront');
assert.equal(a.status, 'published');
ok('old app edit on a published storefront: non-empty values flow in, blanks never erase it, profile re-derived (one source of truth)');
// (b) old app cannot publish/verify anything by writing profiles
assert.equal((await sf(bob)).status, 'draft');
await q(bob, `update public.profiles set business_name='Bob via old app' where id=$1`, [bob]);
assert.equal((await sf(bob)).name, 'Bob via old app'); assert.equal((await sf(bob)).status, 'draft');
assert.equal((await pubProfile(bob)).n, null, 'old-app edits of a draft are kept in the storefront and NOT public');
assert.equal((await pub(null)).rows.filter((r) => r.owner_id === bob).length, 0);
ok('old app writes keep a draft a draft (nothing becomes public via the legacy path)');
// (c) new user via old app creates a draft
assert.equal(await sf(erin), undefined);
await q(erin, `update public.profiles set business_name='Erin Co', business_website='https://erin.example' where id=$1`, [erin]);
const e = await sf(erin);
assert.equal(e.name, 'Erin Co'); assert.equal(e.status, 'draft');
assert.equal((await pubProfile(erin)).n, null, 'a first-time old-app write creates a PRIVATE draft');
await q(erin, `update public.profiles set bio='hello' where id=$1`, [erin]);
ok('first old-app business write creates a draft storefront; unrelated profile edits do nothing');
// (d) unpublished/suspended after publication: legacy columns are cleared and cannot be re-exposed
await q(alice, `select public.storefront_unpublish()`);
p = await prof(alice);
assert.equal(p.n, null); assert.equal(p.d, null); assert.deepEqual(p.h, {});
assert.equal((await sf(alice)).name, 'Old App Name', 'storefront data is kept');
await q(alice, `update public.profiles set business_name='Sneaky' where id=$1`, [alice]);
p = await prof(alice);
assert.equal(p.n, null, 'an old app cannot re-expose an unpublished storefront through profiles');
assert.equal((await sf(alice)).name, 'Sneaky', 'but the edit is kept in the draft');
await q(alice, `select public.storefront_publish()`);
p = await prof(alice);
assert.equal(p.n, 'Sneaky');
ok('unpublish clears legacy columns; old-app writes cannot re-expose them; republish mirrors back');
await q(admin, `select public.admin_set_storefront_status($1,'suspend','Policy violation confirmed')`, [a.id]);
assert.equal((await prof(alice)).n, null);
await q(alice, `update public.profiles set business_name='Evading suspension', business_description='x' where id=$1`, [alice]);
p = await prof(alice);
assert.equal(p.n, null); assert.equal(p.d, null);
assert.equal((await sf(alice)).name, 'Sneaky', 'suspended storefronts ignore legacy writes');
ok('suspension clears legacy columns and old-app writes cannot bypass it');
await q(admin, `select public.admin_set_storefront_status($1,'reinstate','Reinstated after review')`, [a.id]);
assert.equal((await prof(alice)).n, 'Sneaky');
// a never-published draft never reaches the legacy columns
await q(dave, `update public.storefronts set name='Dave Co' where owner_id=$1`, [dave]);
assert.equal((await prof(dave)).d, null); assert.equal((await prof(dave)).n, null);
ok('never-published drafts stay out of the legacy columns (draft means private); originals are in the snapshot');
// profile with no storefront: junk written by an old app is cleared, not left in a public table
await q(support, `update public.profiles set business_website='javascript:alert(1)', business_logo_url='https://evil.example/x.png', business_logo_public_id='x' where id=$1`, [support]);
assert.equal(await sf(support), undefined);
assert.deepEqual((await q(null, `select business_website w, business_logo_url l, business_logo_public_id i from public.profiles where id=$1`, [support])).rows[0], { w: null, l: null, i: null });
ok('old-app junk with nothing meaningful (invalid website / foreign image) creates no storefront and is not left public');
// (e) rate limit is not double-charged by the mirror
const rl = async (u) => (await db.query(`select count(*)::int c from public.rate_limit_events where user_id=$1 and action='update_profile'`, [u])).rows[0].c;
const r0 = await rl(carol);
await q(carol, `update public.profiles set business_name='Carol Co' where id=$1`, [carol]);
assert.equal((await rl(carol)) - r0, 1, 'one user action = one rate-limit event');
ok('the legacy-sync/mirror does not consume extra profile-update rate limit');

// ---- storage policies (harness grants only SELECT on storage.objects; INSERT granted here to mimic Supabase)
await db.exec(`grant insert on storage.objects to authenticated`);
const ins = (uid, name) => q(uid, `insert into storage.objects(bucket_id,name,owner) values ('storefront-verification', $1, $2)`, [name, uid]);
await ins(carol, `${carol}/id.jpg`);
await fails(carol, `insert into storage.objects(bucket_id,name,owner) values ('storefront-verification', $1, $2)`, [`${alice}/evil.jpg`, carol], /row-level|42501/);
await fails(carol, `insert into storage.objects(bucket_id,name,owner) values ('storefront-verification', 'root.jpg', $1)`, [carol], /row-level|42501/);
const visible = async (uid) => (await q(uid, `select name from storage.objects where bucket_id='storefront-verification'`)).rows.map((r) => r.name);
assert.deepEqual((await visible(carol)).sort(), [`${carol}/id.jpg`]);
assert.equal((await visible(bob)).includes(`${alice}/id.jpg`), false);
assert.equal((await visible(support)).length, 0, 'support cannot read identity documents');
assert.equal((await visible(moderator)).length, 0, 'moderators cannot read identity documents');
assert.ok((await visible(admin)).every((n) => n.startsWith(`${admin}/`)), 'even admins have NO direct Storage read: bytes only via the audited Edge Function path');
assert.equal((await visible(null)).length, 0);
assert.equal((await db.query(`select public from storage.buckets where id='storefront-verification'`)).rows[0].public, false);
ok('storage: bucket private; upload only into own folder; read = own folder ONLY (staff included); support/anon/others see none');
{
  const aliceReq = (await db.query(`select r.id, r.document_paths from public.storefront_verification_requests r join public.storefronts s on s.id = r.storefront_id where s.owner_id=$1 limit 1`, [alice])).rows[0];
  const p0 = aliceReq.document_paths[0];
  const audits = async () => (await db.query(`select count(*)::int c from public.admin_audit_log where action='view_storefront_verification_document'`)).rows[0].c;
  const a0n = await audits();
  assert.equal((await q(admin, `select public.admin_authorize_verification_document($1,$2) p`, [aliceReq.id, p0])).rows[0].p, p0);
  assert.equal(await audits(), a0n + 1, 'every authorized document access writes an audit row');
  await fails(admin, `select public.admin_authorize_verification_document($1,$2)`, [aliceReq.id, `${bob}/b1.jpg`], /Document not found/);
  await fails(admin, `select public.admin_authorize_verification_document($1,$2)`, [aliceReq.id, null], /Document not found/);
  for (const u of [moderator, support, bob]) await fails(u, `select public.admin_authorize_verification_document($1,$2)`, [aliceReq.id, p0], /Not authorized/);
  await fails(null, `select public.admin_authorize_verification_document($1,$2)`, [aliceReq.id, p0], /42501|permission denied/);
  assert.equal(await audits(), a0n + 1, 'refused attempts write no access row');
  ok('staff document access: admin_authorize_verification_document audits each access, only for a path attached to that request; moderator/support/other users/anon refused');
}
// bounded uploads: path shape + count of unattached files
for (const bad of ['a.exe', 'a.html', 'a.svg', 'a', '.jpg', 'sub/a.jpg', 'a/b/c.jpg', 'a b.jpg', 'a.jpg.exe', `${'x'.repeat(101)}.jpg`, '../a.jpg']) {
  await fails(carol, `insert into storage.objects(bucket_id,name,owner) values ('storefront-verification', $1, $2)`, [`${carol}/${bad}`, carol], /row-level|42501/);
}
for (const good of ['a.PDF', 'scan-1_final.png', 'b.webp', 'c.jpeg']) await ins(carol, `${carol}/${good}`);
ok('storage: only <own uid>/<flat name>.<jpg|jpeg|png|webp|pdf> is accepted (no .exe/.html/.svg, no nesting, no traversal, bounded name length)');
const used = async (u) => (await q(u, `select public.verification_upload_slots_used() n`)).rows[0].n;
assert.equal(await used(carol), 5);
for (let i = 0; i < 5; i++) await ins(carol, `${carol}/more${i}.jpg`);
assert.equal(await used(carol), 10);
await fails(carol, `insert into storage.objects(bucket_id,name,owner) values ('storefront-verification', $1, $2)`, [`${carol}/eleventh.jpg`, carol], /row-level|42501/);
assert.equal(await used(alice), 0, 'files attached to a request do not count against the cap');
await ins(alice, `${alice}/extra1.jpg`); // alice is unaffected by carol's cap
await fails(null, `select public.verification_upload_slots_used()`, [], /42501|permission denied/);
ok('storage: at most 10 unattached uploads per user (the 11th is refused); attached files do not count; the cap is per user');
await fails(carol, `update storage.objects set name='x/y.jpg' where owner=$1`, [carol], /42501|permission denied/);
await fails(carol, `delete from storage.objects where owner=$1`, [carol], /42501|permission denied/);
ok('storage: an owner cannot rename or delete uploaded documents');
const bucket = (await db.query(`select file_size_limit, allowed_mime_types from storage.buckets where id='storefront-verification'`)).rows[0];
assert.equal(Number(bucket.file_size_limit), 10 * 1024 * 1024);
assert.deepEqual([...bucket.allowed_mime_types].sort(), ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
ok('bucket settings recorded: 10 MiB limit, JPEG/PNG/WebP/PDF only (ENFORCEMENT by the Storage API is not provable on this stub — staging check S2)');
{
  const old = await boot({ upTo: '0053' });
  await old.db.exec(`alter table storage.buckets drop column file_size_limit`);
  await assert.rejects(old.db.exec(sqlFile('migrations/0054_storefronts.sql')), /upgrade Supabase Storage/);
  ok('the migration REFUSES to run on a Storage schema without size/MIME columns (never creates an unrestricted bucket)');
}
// request-time document checks
await objs([[`${alice}/shape.txt`, alice]]); // inserted as superuser to prove the RPC re-checks the shape itself
await fails(alice, `select public.request_storefront_verification($1)`, [[`${alice}/shape.txt`]], /Unknown document/);
await fails(alice, `select public.request_storefront_verification($1)`, [[`${alice}/extra1.jpg`, `${alice}/extra1.jpg`]], /once|22023/);
ok('request RPC re-checks the path shape (a wrongly-named object is refused) and rejects duplicates');

// ---- verification-file lifecycle report (read-only)
await fails(alice, `select public.admin_verification_files_report()`, [], /Not authorized/);
await fails(support, `select public.admin_verification_files_report()`, [], /Not authorized/);
await fails(moderator, `select public.admin_verification_files_report()`, [], /Not authorized/);
await fails(null, `select public.admin_verification_files_report()`, [], /42501|permission denied/);
await db.query(`insert into storage.objects(bucket_id,name,owner,created_at) values ('storefront-verification', $1, null, now() - interval '30 days')`, [`${uuid(31337)}/gone.jpg`]); // uploader's account no longer exists
await db.query(`update storage.objects set created_at = now() - interval '30 days' where name = $1`, [`${carol}/more0.jpg`]);
const rep1 = (await q(admin, `select public.admin_verification_files_report() r`)).rows[0].r;
assert.equal(rep1.ownerAccountDeleted, 1);
assert.ok(rep1.unattached >= 12 && rep1.unattachedOlderThan >= 2 && rep1.attachedPending + rep1.attachedApproved + rep1.attachedRejectedOnly >= 2);
assert.equal(rep1.total, (await db.query(`select count(*)::int c from storage.objects where bucket_id='storefront-verification'`)).rows[0].c);
const before2 = (await db.query(`select count(*)::int c from storage.objects`)).rows[0].c;
await q(admin, `select public.admin_verification_files_report('1 day')`);
assert.equal((await db.query(`select count(*)::int c from storage.objects`)).rows[0].c, before2, 'the report deletes nothing');
ok('lifecycle report: admin only, counts unattached/old/attached/orphaned-by-account-deletion files, deletes nothing');

// ---- reviewed_by / audit history
await db.query(`insert into public.admin_users(user_id, role) values ($1,'admin')`, [erin]);
await db.query(`insert into storage.objects(bucket_id,name,owner) values ('storefront-verification', $1, $2)`, [`${bob}/b1.jpg`, bob]);
const bobReq = (await q(bob, `select public.request_storefront_verification($1) id`, [[`${bob}/b1.jpg`]])).rows[0].id;
await q(erin, `select public.admin_decide_storefront_verification($1,'approve','Reviewed by erin for FK test')`, [bobReq]);
await db.query(`delete from public.admin_users where user_id = $1`, [erin]);
await assert.rejects(db.query(`delete from public.profiles where id = $1`, [erin]), /violates foreign key|23503/);
assert.equal((await db.query(`select reviewed_by from public.storefront_verification_requests where id=$1`, [bobReq])).rows[0].reviewed_by, erin);
const fk = (await db.query(`select confdeltype from pg_constraint where conrelid='public.storefront_verification_requests'::regclass and contype='f' and conkey = (select array_agg(attnum) from pg_attribute where attrelid='public.storefront_verification_requests'::regclass and attname='reviewed_by')`)).rows[0];
assert.equal(fk.confdeltype, 'r', 'reviewed_by is ON DELETE RESTRICT');
ok('reviewed_by is RESTRICT: a staff account that decided a request cannot be hard-deleted (history preserved, same as admin_audit_log)');
const auditBefore = (await db.query(`select count(*)::int c from public.admin_audit_log where target_type='storefront' and target_id=$1`, [(await sf(bob)).id])).rows[0].c;
assert.ok(auditBefore >= 1);
const bobStore = (await sf(bob)).id;
await db.query(`delete from public.profiles where id = $1`, [bob]);
assert.equal((await db.query(`select count(*)::int c from public.storefront_verification_requests where owner_id=$1`, [bob])).rows[0].c, 0, 'requests cascade with the owner');
assert.equal((await db.query(`select count(*)::int c from public.admin_audit_log where target_type='storefront' and target_id=$1`, [bobStore])).rows[0].c, auditBefore, 'the audit trail of the approval survives account deletion');
assert.equal((await db.query(`select count(*)::int c from storage.objects where name=$1`, [`${bob}/b1.jpg`])).rows[0].c, 1, 'but the stored document is NOT removed by deleting the profile (launch blocker B1)');
ok('owner deletion cascades the request rows, keeps the audit trail, and (as documented) leaves the stored document behind — B1');

// ---- logo / banner validation (managed host + owner key; reject, never truncate)
const U = (u, kind, n) => `business/${u}/${kind}/${uuid(n)}.jpg`;
const setImg = (uid, kind, url, id) => q(uid, `update public.storefronts set ${kind}_url=$2, ${kind}_public_id=$3 where owner_id=$1`, [uid, url, id]);
const goodKey = U(carol, 'logo', 5001);
await setImg(carol, 'logo', `https://media.test/${goodKey}`, goodKey);
assert.equal((await sf(carol)).logo_public_id, goodKey);
const goodB = U(carol, 'banner', 5002);
await setImg(carol, 'banner', `https://MEDIA.test/${goodB}`, goodB); // host case-insensitive
const reject = [
  ['http (not https)', `http://media.test/${goodKey}`, goodKey],
  ['unlisted host', `https://evil.example/${goodKey}`, goodKey],
  ['listed host as a subdomain trick', `https://media.test.evil.example/${goodKey}`, goodKey],
  ['listed host as userinfo', `https://media.test@evil.example/${goodKey}`, goodKey],
  ['port', `https://media.test:8443/${goodKey}`, goodKey],
  ['query string', `https://media.test/${goodKey}?x=1`, goodKey],
  ['fragment', `https://media.test/${goodKey}#x`, goodKey],
  ['trailing space', `https://media.test/${goodKey} `, goodKey],
  ['embedded whitespace', `https://media.test/${goodKey.replace('logo', 'lo go')}`, goodKey.replace('logo', 'lo go')],
  ['path does not match the stored key', `https://media.test/${U(carol, 'logo', 5009)}`, goodKey],
  ["another user's key", `https://media.test/${U(alice, 'logo', 5003)}`, U(alice, 'logo', 5003)],
  ['banner key used as logo', `https://media.test/${goodB}`, goodB],
  ['path traversal', `https://media.test/business/${carol}/logo/../../${alice}/logo/${uuid(5004)}.jpg`, `business/${carol}/logo/../../${alice}/logo/${uuid(5004)}.jpg`],
  ['wrong extension', `https://media.test/business/${carol}/logo/${uuid(5005)}.svg`, `business/${carol}/logo/${uuid(5005)}.svg`],
  ['data: URI', 'data:image/png;base64,AAAA', 'x'],
  ['javascript: URI', 'javascript:alert(1)', 'x'],
  ['internal address (SSRF-style)', `https://169.254.169.254/${goodKey}`, goodKey],
  ['localhost', `https://localhost/${goodKey}`, goodKey],
  ['over-long URL (not truncated)', `https://media.test/${goodKey}${'a'.repeat(2100)}`, goodKey],
  ['over-long public id', `https://media.test/${goodKey}`, goodKey + 'a'.repeat(300)],
  ['empty url', '', goodKey],
];
for (const [why, url, id] of reject) {
  await fails(carol, `update public.storefronts set logo_url=$2, logo_public_id=$3 where owner_id=$1`, [carol, url, id], /Invalid logo|23514|storefronts_image/);
}
assert.equal((await sf(carol)).logo_public_id, goodKey, 'a rejected value changes nothing');
await fails(carol, `update public.storefronts set logo_url=$2 where owner_id=$1`, [carol, `https://media.test/${U(carol, 'logo', 5300)}`], /23514|Invalid logo/); // url changed without its matching key
await fails(carol, `update public.storefronts set logo_public_id=null where owner_id=$1`, [carol], /23514|Invalid logo/);
ok(`logo/banner: accepted only as https + listed host + the owner's own key; ${reject.length} malformed/foreign/overlong/SSRF-style values are REJECTED (nothing is trimmed)`);
// INSERT path and the trigger layer on its own
await fails(support, `insert into public.storefronts(owner_id,name,logo_url,logo_public_id) values ($1,'S','https://evil.example/x.jpg','x')`, [support], /Invalid logo|23514/);
assert.equal(await sf(support), undefined);
ok('image validation also applies on INSERT');
// legacy old-app path: invalid images are ignored (the save still succeeds), valid managed ones are carried over
const legKey = U(carol, 'banner', 5100);
await q(carol, `update public.profiles set business_logo_url='https://evil.example/x.png', business_logo_public_id='x', business_banner_url=$1, business_banner_public_id=$2, business_description='legacy save' where id=$3`, [`https://media.test/${legKey}`, legKey, carol]);
const cs = await sf(carol);
assert.equal(cs.logo_public_id, goodKey, 'foreign logo ignored'); assert.equal(cs.banner_public_id, legKey, 'managed banner accepted'); assert.equal(cs.description, 'legacy save');
ok('old-app writes: foreign image ignored without failing the save; a valid managed image is carried over');
// a removed host does not break unrelated edits, and the value is revalidated when it changes
await db.query(`delete from public.storefront_media_hosts where host='media.test'`);
await q(carol, `update public.storefronts set description='after host removal' where owner_id=$1`, [carol]);
await fails(carol, `update public.storefronts set logo_url=$2, logo_public_id=$3 where owner_id=$1`, [carol, `https://media.test/${U(carol, 'logo', 5200)}`, U(carol, 'logo', 5200)], /Invalid logo/);
await db.query(`insert into public.storefront_media_hosts(host) values ('media.test')`);
ok('removing a host blocks NEW image values but never blocks unrelated edits');
await assert.rejects(db.query(`insert into public.storefront_media_hosts(host) values ('Bad_Host/x')`), /check|23514/);
ok('the host allowlist itself only accepts lower-case host names');

// ---- public view: privilege model and leakage
const reloptions = (await db.query(`select reloptions from pg_class where oid = 'public.public_storefronts'::regclass`)).rows[0].reloptions ?? [];
assert.ok(reloptions.includes('security_barrier=true'), 'view must be security_barrier');
assert.ok(!reloptions.some((o) => /security_invoker=(true|on)/.test(o)), 'owner-privilege view is intentional and documented');
const vg = (await db.query(`select grantee, privilege_type from information_schema.role_table_grants where table_name='public_storefronts' order by 1,2`)).rows.filter((g) => ['anon', 'authenticated', 'PUBLIC'].includes(g.grantee));
assert.deepEqual(vg, [{ grantee: 'anon', privilege_type: 'SELECT' }, { grantee: 'authenticated', privilege_type: 'SELECT' }]);
await fails(null, `insert into public.public_storefronts(id) values (gen_random_uuid())`, [], /42501|permission denied/);
await fails(alice, `update public.public_storefronts set name='x'`, [], /42501|permission denied/);
await fails(alice, `delete from public.public_storefronts`, [], /42501|permission denied/);
// a published-and-eligible, a draft, a suspended storefront, a banned owner and a suspended-account owner all exist: only the first is visible
await q(carol, `select public.storefront_publish()`);
await db.exec(`create table public.t_leaks(v text); grant insert on public.t_leaks to anon, authenticated;
  create function public.t_leak(text) returns boolean language plpgsql cost 0.00001 as $f$ begin insert into public.t_leaks values ($1); return true; end $f$;
  grant execute on function public.t_leak(text) to anon, authenticated;`);
await q(null, `select * from public.public_storefronts where public.t_leak(name)`);
const leaked = (await db.query(`select v from public.t_leaks`)).rows.map((r) => r.v);
const eligible = (await db.query(`select name from public.public_storefronts`)).rows.map((r) => r.name);
assert.ok(leaked.length >= 1 && leaked.every((v) => eligible.includes(v)),`a caller-supplied function saw non-public rows: ${leaked}`);
const everyName = (await db.query(`select name from public.storefronts where name is not null and id not in (select id from public.public_storefronts)`)).rows.map((r) => r.name);
assert.ok(everyName.length >= 2 && !leaked.some((v) => everyName.includes(v)));
ok('public view: owner-privilege + security_barrier (a leaky predicate function sees only public rows); SELECT-only grants; no write path');
{ // eligible = published AND storefront not suspended AND owner in good standing; checked against ALL four ineligible states at once
  const rows = (await q(null, `select owner_id from public.public_storefronts`)).rows.map((r) => r.owner_id);
  const expected = (await db.query(`select s.owner_id from public.storefronts s join public.profiles p on p.id = s.owner_id
     where s.status='published' and p.account_status <> 'banned' and not (p.account_status='suspended' and (p.suspended_until is null or p.suspended_until > now()))`)).rows.map((r) => r.owner_id);
  assert.deepEqual(rows.sort(), expected.sort());
  assert.ok(rows.includes(carol));
}
ok('public view returns exactly the published storefronts of owners in good standing — nothing else');

// ---- function security review (catalog assertions)
const defs = (await db.query(`
  select p.proname, p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('authenticated', p.oid, 'execute') auth_x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'admin\\_%storefront%' or p.proname like '%storefront%' or p.proname like '\\_sf\\_%' or p.proname = 'trg_profile_business_legacy_sync')`)).rows;
assert.ok(defs.length >= 17);
for (const f of defs) {
  if (f.prosecdef) assert.ok((f.proconfig ?? []).some((c) => /search_path=.*pg_temp|search_path=public/.test(c)), `${f.proname} must pin search_path`);
  assert.equal(f.anon_x, false, `${f.proname} must not be executable by anon`);
  if (f.proname.startsWith('_sf_') || f.proname.startsWith('trg_')) assert.equal(f.auth_x, false, `${f.proname} is internal`);
}
for (const f of ['trg_storefront_guard', 'trg_profile_business_legacy_sync']) assert.equal(defs.find((d) => d.proname === f).prosecdef, false, `${f} must be INVOKER (it inspects current_user)`);
ok('every storefront SECURITY DEFINER function pins search_path and is closed to anon; internal helpers are closed to authenticated; guard triggers are INVOKER');
const grants = (await db.query(`select grantee, privilege_type from information_schema.role_table_grants where table_name='storefronts' and grantee in ('anon','authenticated') order by 1,2`)).rows;
assert.deepEqual(grants.filter((g) => g.grantee === 'anon'), []);
assert.ok(!grants.some((g) => g.privilege_type === 'DELETE' || g.privilege_type === 'TRUNCATE'));
ok('table grants: anon none; authenticated has no DELETE/TRUNCATE');

// ---- full-chain sanity
const fresh = await boot();
assert.ok(fresh.applied.includes('0054_storefronts.sql') && fresh.applied.at(-1) >= '0054', 'chain includes 0054 (later migrations may follow)');
assert.equal((await fresh.db.query(`select count(*)::int c from public.storefronts`)).rows[0].c, 0);
ok('a fresh database applies the whole chain (including 0054) with an empty backfill');

// ---- rollback script: legacy seed -> apply -> edit -> rollback restore
{
  const rb = await boot({ upTo: '0053' });
  const [, rA, rB, rC, rD] = await seedUsers(rb.db, 5);
  const act = actors(rb.db);
  await rb.db.query(`update public.profiles set business_name='Old A', business_description='orig A' where id=$1`, [rA]); // will stay draft, edited
  await rb.db.query(`update public.profiles set business_name='Old B', business_description='orig B' where id=$1`, [rB]); // will be published, edited
  await rb.db.query(`update public.profiles set business_name='Old C' where id=$1`, [rC]); // published once, then unpublished
  await rb.db.exec(sqlFile('migrations/0054_storefronts.sql'));
  await act.q(rA, `update public.storefronts set description='draft edit A' where owner_id=$1`, [rA]);
  await act.q(rB, `update public.storefronts set name='New B' where owner_id=$1`, [rB]);
  await act.q(rB, `select public.storefront_publish()`);
  await act.q(rC, `select public.storefront_publish()`);
  await act.q(rC, `select public.storefront_unpublish()`);
  await act.q(rD, `insert into public.storefronts(owner_id, name) values ($1,'Born after')`, [rD]);
  const files = (await rb.db.query(`select count(*)::int c from storage.objects`)).rows[0].c;
  await rb.db.exec(sqlFile('rollback/0054_rollback_restore.sql'));
  const prof = async (id) => (await rb.db.query(`select business_name n, business_description d from public.profiles where id=$1`, [id])).rows[0];
  assert.deepEqual(await prof(rA), { n: 'Old A', d: 'orig A' }, 'never-published owner gets the ORIGINAL legacy values back');
  assert.deepEqual((await prof(rB)).n, 'New B', 'published owner keeps the post-migration edit');
  assert.equal((await prof(rC)).n, null, 'published-then-unpublished owner stays cleared');
  assert.equal((await prof(rD)).n, null, 'storefront created after 0054 (no snapshot) stays cleared');
  const exp = (await rb.db.query(`select owner_id, description from public.storefront_rollback_export`)).rows;
  assert.equal(exp.length, 4); assert.equal(exp.find((r) => r.owner_id === rA).description, 'draft edit A', 'draft edits survive in the export');
  const rep = Object.fromEntries((await rb.db.query(`select owner_id, outcome from public.storefront_rollback_report`)).rows.map((r) => [r.owner_id, r.outcome]));
  assert.deepEqual([rep[rA], rep[rB], rep[rC], rep[rD]], ['restored_original_legacy', 'preserved_current_values', 'left_cleared_published_then_unpublished', 'left_cleared_created_after_0054'], 'report names every owner outcome');
  assert.equal((await rb.db.query(`select count(*)::int c from storage.objects`)).rows[0].c, files, 'no storage object touched');
  await assert.rejects(rb.db.exec(sqlFile('rollback/0054_rollback_restore.sql')), /already exists/); await rb.db.exec('rollback');
  await act.fails(rA, `select * from public.storefront_rollback_export`, [], /42501|permission denied/);
  ok('rollback restore: originals for never-published owners, post-migration edits kept for published ones, drafts exported, no-snapshot/unpublished stay cleared, bucket untouched, re-run refused');
}

console.log('\nstorefronts: all assertions passed');
process.exit(0);
