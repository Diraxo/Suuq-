// Owner listing management, bulk-upload presentation, the admin Businesses directory rules and contact privacy, on mobile and web.
// The database side (RLS, RPC authorization, state machines) is supabase/tests/owner_listing_business_admin.test.mjs; this file covers the
// pure rules and source-level parity so the two clients cannot drift apart.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { IdentitySource, businessPhone, presentListingSeller, rowPresentation } from '../lib/profileIdentity';
import { BusinessListItem, businessActions, PUBLICATION_LABEL, VERIFICATION_LABEL, ACTION_COPY, adminErrorMessage } from '../web/src/lib/storefrontAdmin';
import { STAFF_CAN, routePermission } from '../web/src/lib/adminGate';

const root = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const owner = (over: Partial<IdentitySource> = {}): IdentitySource => ({
  full_name: 'Ahmed Ali', avatar_url: 'https://cdn/a.jpg', phone: '+252611111111', active_mode: 'personal',
  business_name: 'Ahmed Motors', business_logo_url: 'https://cdn/logo.jpg', business_phone_public: false, ...over,
});
const biz = (over: Partial<BusinessListItem> = {}): BusinessListItem => ({
  storefrontId: 's1', ownerId: 'owner-1', ownerName: 'Ahmed', ownerAccountStatus: 'active', businessName: 'Ahmed Motors', status: 'published',
  verificationStatus: 'not_requested', publishedAt: null, verifiedAt: null, suspendedAt: null, updatedAt: '2026-10-22T00:00:00Z', activeListings: 3,
  openUserReports: 0, openListingReports: 0, pendingRequestId: null, ...over,
});

// ---- mode switching / stable identity -----------------------------------------------------------------------------------
test('a stored business listing never exposes the account phone unless the owner opted in, even when the business is no longer public', () => {
  // business still public
  assert.equal(presentListingSeller(owner(), 'business').phone, null);
  // legacy business name cleared: the person is shown either way (the name never came from the business), and the phone choice made for this listing is kept
  const gone = owner({ business_name: null });
  const s = presentListingSeller(gone, 'business');
  assert.equal(s.name, 'Ahmed Ali');
  assert.equal(s.phone, null);
  assert.equal(presentListingSeller(owner({ business_name: null, business_phone_public: true }), 'business').phone, '+252611111111');
  assert.equal(businessPhone(owner({ business_phone_public: true })), '+252611111111');
  // an ordinary personal listing keeps showing the personal phone
  assert.equal(presentListingSeller(gone, 'personal').phone, '+252611111111');
  assert.equal(presentListingSeller(gone, undefined).phone, '+252611111111');
});

test('presentation of a listing is independent of the owner mode in both directions, and the person is the same either way', () => {
  for (const mode of ['personal', 'business']) {
    const o = owner({ active_mode: mode });
    assert.equal(presentListingSeller(o, 'personal').name, 'Ahmed Ali');
    assert.equal(presentListingSeller(o, 'business').name, 'Ahmed Ali');
    assert.equal(presentListingSeller(o, 'personal').mode, 'personal');
    assert.equal(presentListingSeller(o, 'business').mode, 'business');
  }
});

// ---- bulk upload: one presentation per batch -------------------------------------------------------------------------------
test('a queued bulk row keeps the presentation it was queued with; only legacy rows use the current mode', () => {
  assert.equal(rowPresentation({ sellerPresentation: 'business' }, 'personal'), 'business');
  assert.equal(rowPresentation({ sellerPresentation: 'personal' }, 'business'), 'personal');
  assert.equal(rowPresentation({}, 'business'), 'business');
  assert.equal(rowPresentation({ sellerPresentation: 'team' }, 'personal'), 'personal');
  assert.equal(rowPresentation(null, 'personal'), 'personal');
  assert.equal(rowPresentation(undefined, 'business'), 'business');
});

test('mobile and web bulk upload write the presentation into every queued row and publish with it', () => {
  assert.match(read('app/business/bulk-upload.tsx'), /sellerPresentation: activeMode\(profile\)/);
  assert.match(read('web/src/app/business/bulk-upload/page.tsx'), /sellerPresentation: presentation/);
  assert.match(read('components/BulkQueuePanel.tsx'), /rowPresentation\(p, seller\.presentedAs/);
  assert.match(read('web/src/components/BulkQueuePanel.tsx'), /sellerPresentation: rowPresentation\(p, presentationRef\.current\)/);
});

test('bulk-uploaded listings are owned by the signed-in account on both clients (user_id set from the session, never from a row)', () => {
  assert.match(read('components/BulkQueuePanel.tsx'), /listingToRow\(listing, userId\)/);
  assert.match(read('app/business/bulk-upload.tsx'), /listingToRow\(listing, session\.user\.id\)/);
  assert.match(read('web/src/services/listings.ts'), /user_id: userId/);
});

// ---- owner listing management is not tied to the mode ---------------------------------------------------------------------
test('edit, mark sold and remove never read or write the active mode or the presentation (mobile and web)', () => {
  const mobile = read('store/myListings.ts');
  const web = read('web/src/services/listings.ts');
  const between = (src: string, from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from) + from.length));
  const updates = {
    mobile: between(mobile, 'updateListing: async', 'markSold: async'),
    web: between(web, 'export async function updateListing', 'export async function markListingSold'),
  };
  for (const [name, upd] of Object.entries(updates)) {
    assert.ok(upd.length > 200 && /\.update\(dbPatch\)/.test(upd), `${name}: found the update function`);
    assert.doesNotMatch(upd, /active_mode|activeMode|seller_presentation|sellerPresentation/, `${name} updateListing must not touch the presentation`);
  }
  assert.match(mobile, /rpc\('mark_listing_sold'/);
  assert.match(web, /rpc\('mark_listing_sold'/);
  // removal is a single-row delete by id (the database enforces ownership); it never deletes anything else
  assert.match(mobile, /from\('listings'\)\.delete\(\)\.eq\('id', id\)/);
  assert.match(web, /from\('listings'\)\.delete\(\)\.eq\('id', id\)/);
});

test('mobile account menu keeps My Listings, Seller dashboard and Business dashboard reachable in both modes', () => {
  const src = read('app/(tabs)/profile.tsx');
  for (const href of ['/my-listings', '/seller-dashboard', '/business/dashboard']) assert.match(src, new RegExp(`href: '${href.replace(/\//g, '\\/')}'`));
  assert.doesNotMatch(src, /MENU\.filter\([^)]*(mode|active)/i);
  for (const f of ['app/business/dashboard.tsx', 'app/business/storefront.tsx', 'app/my-listings.tsx', 'app/listing/edit/[id].tsx']) {
    assert.doesNotMatch(read(f), /activeMode|active_mode|useActiveMode/, `${f} must not depend on the active mode`);
  }
  for (const f of ['web/src/app/business/dashboard/page.tsx', 'web/src/app/my-listings/page.tsx', 'web/src/app/listing/edit/[id]/page.tsx']) {
    assert.doesNotMatch(read(f), /activeMode|active_mode|useActiveMode/, `${f} must not depend on the active mode`);
  }
});

// ---- admin Businesses ---------------------------------------------------------------------------------------------------------
test('the Businesses admin tab is its own nav entry behind business_review, which only admins have', () => {
  const layout = read('web/src/app/admin/layout.tsx');
  assert.match(layout, /href: '\/admin\/businesses', label: 'Businesses'.*needs: 'business_review'/);
  assert.ok(STAFF_CAN.admin.has('business_review'));
  for (const role of ['moderator', 'support'] as const) assert.ok(!STAFF_CAN[role].has('business_review'), role);
  assert.equal(routePermission('/admin/businesses'), 'business_review');
  assert.equal(routePermission('/admin/users'), 'warn');
});

test('the directory shows publication and verification as separate states and never merges them', () => {
  assert.deepEqual(Object.keys(PUBLICATION_LABEL).sort(), ['draft', 'published', 'suspended']);
  assert.deepEqual(Object.keys(VERIFICATION_LABEL).sort(), ['not_requested', 'pending', 'rejected', 'verified']);
  assert.notEqual(PUBLICATION_LABEL.published, VERIFICATION_LABEL.verified);
  assert.match(ACTION_COPY.approve.description, /does not change whether the storefront is published/);
  assert.match(ACTION_COPY.revoke.description, /stays published/);
  assert.match(ACTION_COPY.suspend.description, /account and listings are not changed/);
});

test('directory actions: suspension and verification are independent, and staff get no actions on their own business', () => {
  const published = businessActions(biz(), 'staff-1');
  assert.deepEqual(published, { ownBusiness: false, review: false, suspend: true, reinstate: false, revoke: false });
  const verified = businessActions(biz({ verificationStatus: 'verified' }), 'staff-1');
  assert.ok(verified.revoke && verified.suspend && !verified.review);
  const pending = businessActions(biz({ verificationStatus: 'pending', pendingRequestId: 'r1' }), 'staff-1');
  assert.ok(pending.review && pending.suspend && !pending.revoke);
  assert.ok(!businessActions(biz({ verificationStatus: 'pending', pendingRequestId: null }), 'staff-1').review, 'no request id, nothing to open');
  const suspended = businessActions(biz({ status: 'suspended', verificationStatus: 'verified' }), 'staff-1');
  assert.ok(suspended.reinstate && !suspended.suspend && suspended.revoke);
  for (const b of [biz(), biz({ verificationStatus: 'verified' }), biz({ status: 'suspended' }), biz({ verificationStatus: 'pending', pendingRequestId: 'r1' })]) {
    assert.deepEqual(businessActions(b, 'owner-1'), { ownBusiness: true, review: false, suspend: false, reinstate: false, revoke: false });
  }
  assert.equal(businessActions(biz(), null).ownBusiness, false);
});

test('the staff RPC refusal for acting on your own business is explained in plain language', () => {
  assert.match(adminErrorMessage({ code: '42501', message: 'You cannot moderate your own storefront' }), /your own storefront/);
  assert.match(adminErrorMessage({ code: '42501', message: 'Not authorized' }), /permission/);
  assert.match(adminErrorMessage({ code: 'PGRST202' }), /isn’t available on this project yet/);
});

test('the directory page only calls authorized server actions and never reads tables or contact data directly', () => {
  const ui = read('web/src/components/AdminBusinessDirectory.tsx');
  const svc = read('web/src/services/storefrontAdmin.ts');
  assert.doesNotMatch(ui, /supabase|\.from\(|phone|email/i);
  assert.match(svc, /rpc\('admin_list_businesses'/);
  assert.match(ui, /setStorefrontStatus|revokeStorefrontVerification/);
  assert.match(ui, /AdminActionModal/, 'consequential actions need the reason + confirm dialog');
  assert.doesNotMatch(ui, /decideStorefrontVerification/, 'verification approval stays in the audited review flow');
  assert.match(read('web/src/app/admin/businesses/page.tsx'), /AdminBusinessDirectory/);
});

test('migration 0071 is read-only for the directory, admin-only, and exposes no contact data or documents', () => {
  const sql = read('supabase/migrations/0071_admin_business_directory.sql');
  const fn = sql.slice(sql.indexOf('create or replace function public.admin_list_businesses'), sql.indexOf('revoke execute on function public.admin_list_businesses'));
  assert.match(fn, /staff_can\('business_review'\)/);
  assert.doesNotMatch(fn, /\bphone\b|\bemail\b|document_paths|owner_note/i);
  assert.doesNotMatch(fn, /\b(insert|update|delete)\b\s+(into\s+)?public\./i);
  assert.match(sql, /revoke execute on function public\.admin_list_businesses\(text, text, text, int, int\) from public, anon/);
  assert.match(sql, /grant execute on function public\.admin_list_businesses\(text, text, text, int, int\) to authenticated/);
  assert.equal((sql.match(/You cannot moderate your own storefront/g) ?? []).length, 2);
  assert.ok(fs.existsSync(path.join(root, 'supabase/rollback/0071_admin_business_directory_ROLLBACK.sql')));
});

test('migration 0070 refuses removed/deactivated listings and suspended owners in mark_listing_sold, keeping the 0029 behaviour otherwise', () => {
  const sql = read('supabase/migrations/0070_owner_mark_sold_guard.sql');
  assert.match(sql, /status in \('removed', 'deactivated'\)/);
  assert.match(sql, /account_effective_status\(v_seller_id\) in \('suspended', 'banned'\)/);
  assert.match(sql, /Not the owner of this listing/);
  assert.match(sql, /update public\.offers/);
  assert.ok(fs.existsSync(path.join(root, 'supabase/rollback/0070_owner_mark_sold_guard_ROLLBACK.sql')));
});

// ---- compatibility before the migrations are applied -----------------------------------------------------------------------------
test('person-centred joins select only the stable account columns, so chat, offers, reviews, followers and blocked lists work on a database without 0064', () => {
  const files = [
    'app/chat/[id].tsx', 'store/chatConversations.ts', 'store/offers.ts', 'store/reviews.ts', 'store/follow.ts', 'store/blockedUsers.ts',
    'web/src/services/chat.ts', 'web/src/services/reviews.ts', 'web/src/services/account.ts', 'web/src/store/offers.ts', 'web/src/store/blockedUsers.ts',
  ];
  for (const f of files) {
    const joins = [...read(f).matchAll(/profiles!\w+\(([^)]*)\)/g)].map((m) => m[1]);
    assert.ok(joins.length > 0, `${f} has a profiles join`);
    for (const cols of joins) {
      assert.doesNotMatch(cols, /active_mode|business_|seller_presentation/, `${f}: an explicit column that only exists after a migration makes PostgREST fail the whole list (${cols})`);
      assert.match(cols, /full_name/);
      assert.match(cols, /avatar_url/);
    }
  }
});

// ---- contact privacy ---------------------------------------------------------------------------------------------------------
test('the account phone is private (0072): no client selects it from profiles, and every Call link comes from get_contact_phone', () => {
  // Replaces the earlier characterization that pinned the exposure (docs/IDENTITY_LISTING_BUSINESS_FINALIZATION_2026-10-22.md section 4).
  for (const f of ['app/chat/[id].tsx', 'store/chatConversations.ts', 'web/src/services/chat.ts']) {
    for (const m of read(f).matchAll(/profiles!\w+\(([^)]*)\)/g)) assert.doesNotMatch(m[1], /\bphone\b/, `${f} must not select phone from profiles`);
  }
  const callers: Record<string, RegExp> = {
    'app/chat/[id].tsx': /useContactPhone\(resolved\?\.sellerId/,
    'app/listing/[id].tsx': /useContactPhone\(foundListing\?\.seller\.id/,
    'app/seller/[id].tsx': /useContactPhone\(isRealSeller/,
    'web/src/app/chat/[id]/page.tsx': /useContactPhone\(conversation\?\.sellerId/,
    'web/src/app/listing/[id]/page.tsx': /useContactPhone\(listing\?\.seller\.id/,
    'web/src/app/seller/[id]/page.tsx': /useContactPhone\(id,/,
  };
  for (const [f, re] of Object.entries(callers)) assert.match(read(f), re, f);
  // No screen builds a tel: link from a row it loaded; only the value the database released.
  for (const f of Object.keys(callers)) assert.doesNotMatch(read(f), /tel:\$\{[^}]*(\.phone)\}/, `${f}: tel: link built from a row`);
  // The business card takes the released number; it never derives one from the profile row.
  for (const f of ['components/BusinessProfileCard.tsx', 'web/src/components/BusinessProfileCard.tsx']) {
    assert.doesNotMatch(read(f), /businessPhone\(/, f);
    assert.match(read(f), /phone\?: string \| null/, f);
  }
  // One Call button per profile: when the business card is shown (it carries the Call), the personal header does not.
  assert.match(read('app/seller/[id].tsx'), /!showBusiness && sellerPhone/);
  assert.match(read('supabase/tests/owner_listing_business_admin.test.mjs'), /phone is private \(0072\)/);
  for (const f of ['supabase/migrations/0072_private_profile_phone.sql', 'supabase/rollback/0072_private_profile_phone_ROLLBACK.sql', 'supabase/tests/phone_privacy.test.mjs']) assert.ok(fs.existsSync(path.join(root, f)), f);
});
