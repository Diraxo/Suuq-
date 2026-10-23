import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { activeMode, hasBusinessDetails, resolveIdentity, accountPerson, IdentitySource } from '../lib/profileIdentity';

const root = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

// A deliberately "legacy" account: it still carries a business_name and logo that must never become an identity.
const owner = (over: Partial<IdentitySource> = {}): IdentitySource => ({
  full_name: 'Abdirahman Mohamed', avatar_url: 'https://cdn/avatars/me.jpg', bio: 'Personal bio', verified_at: '2026-01-01T00:00:00Z',
  active_mode: 'personal', business_name: 'Abdi Legacy Name', business_description: 'We sell phones', business_logo_url: 'https://cdn/business/legacy-logo.jpg', business_banner_url: 'https://cdn/business/banner.jpg', ...over,
});

test('web copy of profileIdentity is byte-identical to the original', () => {
  assert.equal(read('lib/profileIdentity.ts'), read('web/src/lib/profileIdentity.ts'));
});

test('personal mode: the canonical name, photo and bio, and no banner', () => {
  const id = resolveIdentity(owner(), { businessVerified: true });
  assert.deepEqual(id, { mode: 'personal', name: 'Abdirahman Mohamed', avatarUrl: 'https://cdn/avatars/me.jpg', bio: 'Personal bio', bannerUrl: null, verification: 'personal', businessVerified: false });
});

test('business mode: the SAME name, photo and bio, plus the banner; legacy business name and logo are never used', () => {
  const id = resolveIdentity(owner({ active_mode: 'business' }));
  assert.equal(id.mode, 'business');
  assert.equal(id.name, 'Abdirahman Mohamed');
  assert.equal(id.avatarUrl, 'https://cdn/avatars/me.jpg');
  assert.equal(id.bio, 'Personal bio');
  assert.equal(id.bannerUrl, 'https://cdn/business/banner.jpg');
  assert.ok(!JSON.stringify(id).includes('Legacy') && !JSON.stringify(id).includes('legacy-logo'));
});

test('both modes resolve to one person: name, avatar and bio are identical whichever mode is active', () => {
  const a = resolveIdentity(owner({ active_mode: 'business' }));
  const b = resolveIdentity(owner({ active_mode: 'personal' }));
  assert.deepEqual({ n: a.name, v: a.avatarUrl, b: a.bio, k: a.verification }, { n: b.name, v: b.avatarUrl, b: b.bio, k: b.verification });
  assert.deepEqual(accountPerson(owner({ active_mode: 'business' })), accountPerson(owner({ active_mode: 'personal' })));
});

test('changing the canonical name, avatar or bio is reflected in both modes at once', () => {
  for (const mode of ['personal', 'business'] as const) {
    const id = resolveIdentity(owner({ active_mode: mode, full_name: 'New Name', avatar_url: 'https://cdn/avatars/new.jpg', bio: 'New bio' }));
    assert.deepEqual({ n: id.name, a: id.avatarUrl, b: id.bio }, { n: 'New Name', a: 'https://cdn/avatars/new.jpg', b: 'New bio' });
  }
});

test('a missing photo is never replaced by a business image, in either mode', () => {
  for (const mode of ['personal', 'business'] as const) assert.equal(resolveIdentity(owner({ active_mode: mode, avatar_url: null })).avatarUrl, null);
});

test('the banner exists only in business mode, whatever is stored', () => {
  assert.equal(resolveIdentity(owner({ active_mode: 'personal' })).bannerUrl, null);
  assert.equal(resolveIdentity(owner({ active_mode: 'business', business_banner_url: null })).bannerUrl, null);
  assert.equal(resolveIdentity(owner({ active_mode: 'business', business_banner_url: '  ' })).bannerUrl, null);
});

test('gold business verification comes only from the staff-verified flag, and never replaces the personal check', () => {
  const b = owner({ active_mode: 'business' });
  assert.equal(resolveIdentity(b).businessVerified, false);
  assert.equal(resolveIdentity(b, { businessVerified: true }).businessVerified, true);
  assert.equal(resolveIdentity(owner({ active_mode: 'personal' }), { businessVerified: true }).businessVerified, false);
  assert.equal(resolveIdentity(b, { businessVerified: true }).verification, 'personal');
  assert.equal(resolveIdentity(owner({ active_mode: 'business', verified_at: null }), { businessVerified: true }).verification, 'none');
});

test('Business mode needs no business name or logo: an account with neither can be in business mode', () => {
  const bare = owner({ active_mode: 'business', business_name: null, business_logo_url: null, business_description: null, business_banner_url: null });
  assert.equal(activeMode(bare), 'business');
  const id = resolveIdentity(bare);
  assert.equal(id.name, 'Abdirahman Mohamed');
  assert.equal(id.bannerUrl, null);
});

test('an account with no business record at all is personal until the column says otherwise', () => {
  const none: IdentitySource = { full_name: 'Plain User', avatar_url: null, bio: null };
  assert.equal(hasBusinessDetails(none), false);
  assert.equal(activeMode(none), 'personal');
  assert.equal(activeMode({ ...none, active_mode: 'business' }), 'business');
  assert.equal(activeMode(null), 'personal');
  assert.equal(hasBusinessDetails(null), false);
});

test('before migration 0064 (no active_mode column) an account with business content keeps showing it; others stay personal', () => {
  assert.equal(activeMode(owner({ active_mode: undefined })), 'business');
  assert.equal(activeMode(owner({ active_mode: undefined, business_name: null, business_logo_url: null, business_description: null, business_banner_url: null })), 'personal');
  assert.equal(activeMode(owner({ active_mode: 'garbage' })), 'business');
});

test('hasBusinessDetails: each business-specific field counts; blanks do not; a lone legacy name is only evidence of an old business', () => {
  const blank: IdentitySource = { full_name: 'X', business_description: '  ', business_address: '', business_website: null, business_categories: [], business_hours: {}, social_links: {} };
  assert.equal(hasBusinessDetails(blank), false);
  assert.equal(hasBusinessDetails({ ...blank, business_description: 'd' }), true);
  assert.equal(hasBusinessDetails({ ...blank, business_banner_url: 'https://x/b.jpg' }), true);
  assert.equal(hasBusinessDetails({ ...blank, business_address: 'a' }), true);
  assert.equal(hasBusinessDetails({ ...blank, business_website: 'https://x' }), true);
  assert.equal(hasBusinessDetails({ ...blank, business_categories: ['vehicles'] }), true);
  assert.equal(hasBusinessDetails({ ...blank, business_hours: { days: { mon: { open: '09:00', close: '17:00' } } } }), true);
  assert.equal(hasBusinessDetails({ ...blank, social_links: { facebook: 'https://facebook.com/x' } }), true);
  assert.equal(hasBusinessDetails({ ...blank, business_name: 'Old Shop' }), true);
});
