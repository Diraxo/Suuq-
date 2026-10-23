import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeWebsite, normalizeSocial, safeHref, normalizeHours, validateFullName,
  validatePersonalProfile, validateBusinessProfile, cleanText, BusinessInput,
} from '../lib/profileRules';

const root = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const business = (over: Partial<BusinessInput> = {}): BusinessInput => ({
  description: '', address: '', website: '', hours: {}, social: {}, deliveryAvailable: false, ...over,
});

test('web copy of profileRules is byte-identical to the original', () => {
  assert.equal(read('lib/profileRules.ts'), read('web/src/lib/profileRules.ts'));
});

test('website: only http(s) with a real host; bare domains get https://', () => {
  assert.equal(normalizeWebsite(''), '');
  assert.equal(normalizeWebsite('example.com'), 'https://example.com');
  assert.equal(normalizeWebsite('https://shop.example.com/a?b=1'), 'https://shop.example.com/a?b=1');
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com', 'https://user:pw@example.com', 'http://localhost', 'https://127.0.0.1', 'https://example', 'not a url', 'https://exa mple.com']) {
    assert.equal(normalizeWebsite(bad), null, bad);
  }
});

test('social links must be on that network\'s own host', () => {
  assert.equal(normalizeSocial('facebook', 'facebook.com/myshop'), 'https://facebook.com/myshop');
  assert.equal(normalizeSocial('instagram', 'https://www.instagram.com/shop'), 'https://www.instagram.com/shop');
  assert.equal(normalizeSocial('whatsapp', 'https://wa.me/251911234567'), 'https://wa.me/251911234567');
  assert.equal(normalizeSocial('telegram', ''), '');
  assert.equal(normalizeSocial('facebook', 'https://evilfacebook.com/x'), null);
  assert.equal(normalizeSocial('facebook', 'https://facebook.com.evil.io/x'), null);
  assert.equal(normalizeSocial('instagram', 'https://facebook.com/x'), null);
  assert.equal(normalizeSocial('tiktok', 'javascript:alert(1)'), null);
});

test('safeHref only lets http(s) through', () => {
  assert.equal(safeHref('https://example.com'), 'https://example.com/');
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref(null), null);
});

test('hours: HH:MM, open before close, closed days normalised', () => {
  assert.deepEqual(normalizeHours({}), {});
  assert.notEqual(normalizeHours({ mon: { closed: false, open: '08:00', close: '17:30' } }), null);
  assert.equal(normalizeHours({ mon: { closed: false, open: '18:00', close: '09:00' } }), null);
  assert.equal(normalizeHours({ mon: { closed: false, open: '8am', close: '5pm' } }), null);
  assert.equal(normalizeHours({ mon: { closed: false, open: '24:00', close: '25:00' } }), null);
});

test('names: control/bidi characters stripped, symbols-only rejected', () => {
  assert.equal(cleanText('  A‮b​c  d '), 'Abc d');
  assert.deepEqual(validateFullName('Ab'), { ok: true, value: 'Ab' });
  assert.equal((validateFullName('A') as any).error, 'nameTooShort');
  assert.equal((validateFullName('1234') as any).error, 'nameInvalid');
  assert.equal((validateFullName('x'.repeat(101)) as any).error, 'nameTooLong');
  assert.equal(validatePersonalProfile({ fullName: 'Amina Ali', bio: 'b'.repeat(1001), city: '' }).ok, false);
});

test('business profile: payload is normalised, bad fields are all reported', () => {
  const ok = validateBusinessProfile(business({ website: 'example.com', social: { facebook: 'facebook.com/x' }, hours: { sun: { closed: true, open: '09:00', close: '18:00' } }, deliveryAvailable: true }));
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.business_website, 'https://example.com');
    assert.deepEqual(ok.value.social_links, { facebook: 'https://facebook.com/x' });
    assert.equal(ok.value.delivery_available, true);
  }
  const bad = validateBusinessProfile(business({ website: 'javascript:x', social: { tiktok: 'https://evil.io' } }));
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ['tiktok', 'website']);
  // The business editor never carries a name: saving it cannot write (or clear) the legacy business_name column.
  const empty = validateBusinessProfile(business());
  assert.equal(empty.ok && 'business_name' in empty.value, false);
});

test('social links: a phone number or @username is enough, and only the network\'s own host is ever produced', () => {
  assert.equal(normalizeSocial('whatsapp', '+251 91 123 4567'), 'https://wa.me/251911234567');
  assert.equal(normalizeSocial('whatsapp', '0911234567'), 'https://wa.me/0911234567');
  assert.equal(normalizeSocial('whatsapp', '123'), null, 'too short to be a number');
  assert.equal(normalizeSocial('whatsapp', 'https://wa.me/251911234567'), 'https://wa.me/251911234567');
  assert.equal(normalizeSocial('instagram', '@abdi.shop'), 'https://instagram.com/abdi.shop');
  assert.equal(normalizeSocial('tiktok', 'abdi'), 'https://tiktok.com/@abdi');
  assert.equal(normalizeSocial('telegram', '@abdi_shop'), 'https://t.me/abdi_shop');
  assert.equal(normalizeSocial('facebook', 'https://facebook.com/abdi'), 'https://facebook.com/abdi');
  assert.equal(normalizeSocial('facebook', 'https://evil.example/abdi'), null, 'another host is still refused');
  assert.equal(normalizeSocial('instagram', 'instagram.com/abdi'), 'https://instagram.com/abdi');
  assert.equal(normalizeSocial('whatsapp', '@abdi'), null, 'a WhatsApp handle is not a thing');
});

test('business categories: omitted leaves the column out, valid ids kept (deduped), empty clears, junk or >5 refused', () => {
  const none = validateBusinessProfile(business({}));
  assert.ok(none.ok && !('business_categories' in none.value), 'saving other fields must never write the category column');
  const set = validateBusinessProfile(business({ categories: ['electronics', 'vehicles', 'electronics'] }));
  assert.ok(set.ok && JSON.stringify(set.value.business_categories) === JSON.stringify(['electronics', 'vehicles']));
  const cleared = validateBusinessProfile(business({ categories: [] }));
  assert.ok(cleared.ok && cleared.value.business_categories?.length === 0);
  const bad = validateBusinessProfile(business({ categories: ['electronics', 'Bad Value!'] }));
  assert.ok(!bad.ok && bad.errors.category === 'categoryInvalid');
  const many = validateBusinessProfile(business({ categories: ['aa', 'bb', 'cc', 'dd', 'ee', 'ff'] }));
  assert.ok(!many.ok && many.errors.category === 'categoryInvalid');
});
