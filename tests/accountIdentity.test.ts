// One account, one identity. Display rules for personal vs business presentation (lib/profileIdentity.ts) plus source-level
// parity checks that mobile and web use them the same way. The database side is supabase/tests/listing_seller_presentation.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { accountPerson, businessPhone, listingPresentation, presentListingSeller, resolveIdentity, IdentitySource } from '../lib/profileIdentity';

const root = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const ahmed = (over: Partial<IdentitySource> = {}): IdentitySource => ({
  full_name: 'Ahmed Ali', avatar_url: 'https://cdn/a.jpg', phone: '+252611111111', verified_at: '2026-01-01T00:00:00Z',
  active_mode: 'business', business_name: 'Ahmed Motors', business_logo_url: 'https://cdn/logo.jpg', business_phone_public: false, ...over,
});

test('the account person is the same in both modes (chat, offers, reviews, followers, blocked)', () => {
  const a = accountPerson(ahmed({ active_mode: 'business' }));
  const b = accountPerson(ahmed({ active_mode: 'personal' }));
  assert.deepEqual(a, b);
  assert.deepEqual(a, { name: 'Ahmed Ali', avatarUrl: 'https://cdn/a.jpg' });
  assert.deepEqual(accountPerson(ahmed({ business_name: null, business_logo_url: null })), a);
  assert.deepEqual(accountPerson(null), { name: null, avatarUrl: null });
});

test('a business-mode listing shows the account name and photo: a business adds no second person', () => {
  const s = presentListingSeller(ahmed(), 'business');
  assert.equal(s.mode, 'business');
  assert.equal(s.name, 'Ahmed Ali');
  assert.equal(s.avatarUrl, 'https://cdn/a.jpg');
  assert.equal(s.ownerName, null);
  assert.ok(!JSON.stringify(s).includes('Ahmed Motors') && !JSON.stringify(s).includes('logo.jpg'));
});

test('a listing follows its own stored choice for the phone rule, never the owner current mode; the person is the same either way', () => {
  for (const mode of ['personal', 'business'] as const) {
    const owner = ahmed({ active_mode: mode });
    assert.equal(presentListingSeller(owner, 'personal').name, 'Ahmed Ali');
    assert.equal(presentListingSeller(owner, 'business').name, 'Ahmed Ali');
    assert.equal(presentListingSeller(owner, 'personal').mode, 'personal');
    assert.equal(presentListingSeller(owner, 'business').mode, 'business');
  }
});

test('unknown or missing presentation (database without 0068) is personal; a business account without any business name still shows the person', () => {
  assert.equal(listingPresentation(undefined), 'personal');
  assert.equal(listingPresentation(null), 'personal');
  assert.equal(listingPresentation('team'), 'personal');
  assert.equal(presentListingSeller(ahmed(), undefined).name, 'Ahmed Ali');
  const noBiz = presentListingSeller(ahmed({ business_name: null, business_logo_url: null }), 'business');
  assert.equal(noBiz.name, 'Ahmed Ali');
  assert.equal(noBiz.avatarUrl, 'https://cdn/a.jpg');
  assert.equal(noBiz.ownerName, null);
});

test('the legacy business logo is never used as a photo, and a missing personal photo stays missing', () => {
  assert.equal(presentListingSeller(ahmed({ avatar_url: null }), 'business').avatarUrl, null);
  assert.equal(presentListingSeller(ahmed(), 'personal').avatarUrl, 'https://cdn/a.jpg');
  assert.equal(accountPerson(ahmed()).avatarUrl, 'https://cdn/a.jpg');
});

test('the account phone is private under a business until the owner opts in; personal listings keep todays behaviour', () => {
  assert.equal(presentListingSeller(ahmed(), 'business').phone, null);
  assert.equal(businessPhone(ahmed()), null);
  assert.equal(businessPhone(ahmed({ business_phone_public: undefined })), null);
  assert.equal(presentListingSeller(ahmed({ business_phone_public: true }), 'business').phone, '+252611111111');
  assert.equal(businessPhone(ahmed({ business_phone_public: true })), '+252611111111');
  assert.equal(presentListingSeller(ahmed(), 'personal').phone, '+252611111111');
  assert.equal(businessPhone(ahmed({ business_phone_public: true, phone: '  ' })), null);
});

test('verification stays separate: the personal check follows the person in both modes, gold only from the staff-verified storefront', () => {
  assert.equal(resolveIdentity(ahmed(), { businessVerified: false }).businessVerified, false);
  assert.equal(resolveIdentity(ahmed(), { businessVerified: true }).businessVerified, true);
  assert.equal(resolveIdentity(ahmed(), { businessVerified: true }).verification, 'personal');
  assert.equal(resolveIdentity(ahmed({ active_mode: 'personal' }), { businessVerified: true }).businessVerified, false);
  assert.equal(resolveIdentity(ahmed({ active_mode: 'personal', verified_at: null }), { businessVerified: true }).verification, 'none');
});

test('mobile and web: person-centred screens use the stable account identity, never the mode-dependent one', () => {
  const personFiles = [
    'app/chat/[id].tsx', 'store/chatConversations.ts', 'store/offers.ts', 'store/reviews.ts', 'store/follow.ts', 'store/blockedUsers.ts',
    'web/src/services/chat.ts', 'web/src/services/reviews.ts', 'web/src/services/account.ts', 'web/src/store/offers.ts', 'web/src/store/blockedUsers.ts',
  ];
  for (const f of personFiles) {
    const src = read(f);
    assert.match(src, /accountPerson/, `${f} should use accountPerson`);
    assert.doesNotMatch(src, /shownPerson|resolveIdentity/, `${f} must not resolve a mode-dependent identity`);
  }
});

test('mobile and web build the listing seller through the same per-listing rule', () => {
  for (const f of ['lib/sellerStats.ts', 'web/src/services/profile.ts']) {
    const src = read(f);
    assert.match(src, /presentListingSeller\(profile, presentedAs\)/, f);
    assert.doesNotMatch(src, /resolveIdentity/, f);
  }
  for (const f of ['lib/homeFeedApi.ts', 'lib/listingsApi.ts', 'lib/searchApi.ts', 'store/myListings.ts', 'web/src/services/listings.ts']) {
    assert.match(read(f), /seller_presentation/, `${f} must pass the stored presentation of the row`);
  }
});

test('mobile and web publish flows store the owner mode, and only send it when business (works before 0068); there is no "present as" picker', () => {
  assert.match(read('store/myListings.ts'), /presentedAs === 'business' \? \{ seller_presentation: 'business' \}/);
  assert.match(read('web/src/services/listings.ts'), /sellerPresentation === 'business' \? \{ seller_presentation: 'business' \}/);
  assert.match(read('app/post/preview.tsx'), /const presentedAs = activeMode\(sellerProfile\)/);
  assert.match(read('web/src/app/sell/page.tsx'), /sellerPresentation: activeMode\(ownProfile\)/);
  for (const f of ['app/post/preview.tsx', 'web/src/app/sell/page.tsx']) {
    assert.doesNotMatch(read(f), /presentAsTitle|business_name|business_logo_url/, `${f} must not offer a second seller identity`);
  }
});

test('the business details show only the phone the database released (opt-in), and never read a business name or logo', () => {
  for (const f of ['components/BusinessProfileCard.tsx', 'web/src/components/BusinessProfileCard.tsx']) {
    const src = read(f);
    assert.match(src, /phone: callPhone/, f); // the number the database released (get_contact_phone, 0072), never one read off the row
    assert.doesNotMatch(src, /profile\.phone/, `${f} must not read the account phone directly`);
    assert.doesNotMatch(src, /profile\.business_name|profile\.business_logo_url|managedBy/, `${f} must not render a second identity`);
  }
});

test('the phone opt-in is a plain visibility column the owner edits on both clients (sent only when changed)', () => {
  assert.match(read('app/settings/business-profile.tsx'), /business_phone_public: phonePublic/);
  assert.match(read('web/src/app/settings/business-profile/page.tsx'), /business_phone_public: phonePublic/);
});

test('one identity on every profile: the shared header (banner behind it in business mode), then business details with no name or avatar of their own', () => {
  for (const f of ['app/seller/[id].tsx', 'web/src/app/seller/[id]/page.tsx', 'app/(tabs)/profile.tsx', 'web/src/app/profile/page.tsx']) {
    const src = read(f);
    assert.doesNotMatch(src, /resolveIdentity/, f);
    assert.match(src, /<ProfileHeaderCover/, `${f} should use the shared header`);
    assert.doesNotMatch(src, /business_name|business_logo_url|hasBusinessProfile/, `${f} must not read a second identity`);
    assert.doesNotMatch(src, /<BusinessProfileCard\s+embedded/, `${f}: the details card has no embedded variant any more`);
    assert.ok(src.indexOf('<ProfileHeaderCover') < src.indexOf('<BusinessProfileCard'), `${f}: header comes before the business details`);
  }
  for (const f of ['app/seller/[id].tsx', 'web/src/app/seller/[id]/page.tsx']) assert.match(read(f), /activeMode\(/, `${f}: the banner follows the owner's mode`);
  for (const f of ['components/ProfileHeaderCover.tsx', 'web/src/components/ProfileHeaderCover.tsx']) {
    const src = read(f);
    assert.match(src, /mode === 'business'/, f);
    assert.doesNotMatch(src, /business_name|full_name|avatar_url/, `${f} draws a backdrop only`);
  }
});

test('Edit Business cannot create a competing name or avatar (mobile and web)', () => {
  for (const f of ['app/settings/business-profile.tsx', 'web/src/app/settings/business-profile/page.tsx']) {
    const src = read(f);
    assert.doesNotMatch(src, /business_logo_url|business_name|nameLabel|kind="logo"|pickImage\('logo'\)/, `${f} must not edit a business name or logo`);
    assert.match(src, /identityNote/, `${f} points to Edit profile for the name, photo and bio`);
    assert.match(src, /business_banner_url|kind="banner"/, f);
  }
});
