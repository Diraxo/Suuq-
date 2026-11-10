import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { categories } from '../data/categories';
import { categories as webCategories } from '../web/src/lib/categories';
import { serviceDetail, subcategoryIcon, summarizeDays } from '../data/serviceDetail';
import { SERVICE_SUBCATEGORIES, isContactPriceListing } from '../data/serviceConfig';
import { attributeRows, listingPriceText, priceUnitText } from '../data/sellText';
import { DICTIONARIES, makeT } from '../web/src/lib/webTranslate';

const root = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const en = makeT(DICTIONARIES.en);
const so = makeT(DICTIONARIES.so);
const am = makeT(DICTIONARIES.am);

const ALL_DAYS = { availableDays: 'Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday' };
// Mojibake is "â€" / "â‚¬" / "Ã©" etc.: UTF-8 bytes re-read as Windows-1252. Built from code points so this file stays clean itself.
const MOJIBAKE = new RegExp(`${String.fromCharCode(0xe2)}${String.fromCharCode(0x20ac)}|${String.fromCharCode(0xe2)}${String.fromCharCode(0x201a)}|${String.fromCharCode(0xc3)}[${String.fromCharCode(0xa9)}${String.fromCharCode(0xa8)}]`);

test('the web copy of the service detail rules is identical to the original', () => {
  assert.equal(read('data/serviceDetail.ts'), read('web/src/lib/serviceDetail.ts'));
});

test('every service subcategory has an icon on mobile and web; unknown ones fall back safely', () => {
  for (const sub of SERVICE_SUBCATEGORIES) {
    const icon = subcategoryIcon(categories, 'services', sub);
    assert.ok(icon, `${sub} has an icon`);
    assert.equal(subcategoryIcon(webCategories, 'services', sub), icon, `${sub} icon matches on web`);
  }
  assert.equal(subcategoryIcon(categories, 'services', 'Video Production'), 'videocam-outline');
  assert.equal(subcategoryIcon(categories, 'services', 'Photography'), 'camera-outline');
  assert.equal(subcategoryIcon(categories, 'services', 'Not a trade'), 'construct-outline'); // the category's own icon
  assert.equal(subcategoryIcon(categories, 'nonsense', undefined), 'construct-outline'); // generic fallback
});

test('every category and subcategory icon exists in the website icon set (none falls back to a question mark)', () => {
  const icons = read('web/src/lib/icons.tsx');
  for (const c of categories) {
    for (const icon of [c.icon, ...(c.subcategories ?? []).map((s) => s.icon)]) {
      if (icon.includes(':')) continue; // mci:/fa5: icons resolve through their own maps
      assert.ok(icons.includes("'" + icon + "'"), c.id + ' icon ' + icon + ' is missing on web');
    }
  }
});

test('only services get service sections', () => {
  assert.equal(serviceDetail(en, 'phones', 'Android', { specialty: 'Wiring' }), null);
  assert.ok(serviceDetail(en, 'services', 'Electrician', {}));
});

test('an individual never gets a business-name row or "Individual" as a name', () => {
  const d = serviceDetail(en, 'services', 'Video Production', { providerType: 'Individual', specialty: 'Video editing' })!;
  assert.equal(d.providerKind, 'individual');
  assert.deepEqual(d.provider, []);
  assert.ok(!/Your name or company name|Business name|Company/.test(JSON.stringify(d)));
  const named = serviceDetail(en, 'services', 'Video Production', { providerType: 'Individual', providerName: 'Hodan' })!;
  assert.deepEqual(named.provider.map((r) => [r.label, r.value]), [['Name', 'Hodan']]);
});

test('a business shows its public business name', () => {
  const d = serviceDetail(en, 'services', 'Plumber', { providerType: 'Company', providerName: 'Nasiib Plumbing' })!;
  assert.equal(d.providerKind, 'business');
  assert.deepEqual(d.provider.map((r) => [r.label, r.value]), [['Business name', 'Nasiib Plumbing']]);
});

test('available days are in week order, wrap into chips and collapse to a short summary', () => {
  const d = serviceDetail(en, 'services', 'Electrician', { availableDays: 'Friday, Monday, Wednesday' })!;
  assert.deepEqual(d.days, ['Monday', 'Wednesday', 'Friday']);
  assert.deepEqual(summarizeDays(d.days), { shown: ['Monday', 'Wednesday', 'Friday'], hidden: 0 });
  const week = serviceDetail(en, 'services', 'Electrician', ALL_DAYS)!;
  assert.equal(week.days.length, 7);
  assert.deepEqual(summarizeDays(week.days), { shown: ['Monday', 'Tuesday', 'Wednesday'], hidden: 4 });
  assert.deepEqual(summarizeDays(['A', 'B', 'C', 'D']), { shown: ['A', 'B', 'C', 'D'], hidden: 0 }); // "+1 more" would save nothing
  // days are never a plain row, so they can never overflow as one long value
  assert.ok(!week.highlights.concat(week.availability, week.more).some((r) => r.key === 'availableDays'));
});

test('empty answers are left out and nothing is repeated', () => {
  const d = serviceDetail(en, 'services', 'Electrician', { providerType: 'Individual', specialty: '', experience: '  ', serviceArea: '', availableFrom: '08:00' })!;
  assert.deepEqual([d.specialties, d.highlights, d.days, d.availability, d.provider, d.more], [[], [], [], [], [], []]);
  assert.equal(d.hours, undefined); // one end alone is not a window
  const full = serviceDetail(en, 'services', 'Electrician', {
    providerType: 'Company', providerName: 'X', specialty: 'Wiring, Lighting', experience: '5', serviceArea: 'Hodan, Wadajir',
    workPlace: 'I travel to customers', availableFrom: '08:00', availableTo: '17:00', emergency: 'Yes', priceUnit: 'Per hour',
  })!;
  assert.deepEqual(full.specialties, ['Wiring', 'Lighting']);
  assert.equal(full.hours, '08:00 – 17:00');
  const keys = [...full.highlights, ...full.availability, ...full.provider, ...full.more].map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(!keys.some((k) => ['providerType', 'priceUnit', 'priceMode', 'availableFrom', 'availableTo', 'specialty'].includes(k)), 'handled elsewhere, never a raw row');
  assert.equal(full.highlights.find((r) => r.key === 'experience')!.value, '5 years');
});

test('long values stay whole in the data so the layout, not the data, decides how they wrap', () => {
  const long = 'Hodan, Wadajir, Hawl-wadaag, Warta Nabadda, Yaaqshiid, Kaaraan, Dharkenley, Daynile, Heliwa, Abdiaziz, Shibis, Boondheere';
  const d = serviceDetail(en, 'services', 'Plumber', { serviceArea: long })!;
  assert.equal(d.highlights.find((r) => r.key === 'serviceArea')!.value, long);
});

test('layouts wrap or shrink instead of letting a long value push past the screen', () => {
  const web = read('web/src/components/ServiceDetails.tsx');
  assert.ok(/break-words/.test(web) && /min-w-0/.test(web) && /flex-wrap/.test(web));
  assert.ok(!/overflow-x-(auto|scroll)/.test(web), 'no sideways-scrolling row for essential facts');
  const mobile = read('components/ServiceDetails.tsx');
  assert.ok(/flexWrap: 'wrap'/.test(mobile) && /flexShrink: 1/.test(mobile));
  assert.ok(!/horizontal/.test(mobile), 'no sideways-scrolling row for essential facts');
  // the generic spec list (every other category) shrinks its label and value too
  assert.ok(/flexShrink: 1, maxWidth: '42%'/.test(read('components/ListingDetails.tsx')));
  assert.ok(/min-w-0 flex-1 break-words/.test(read('web/src/components/ListingDetails.tsx')));
});

test('price, price unit and Contact for price are untouched by the redesign', () => {
  const attrs = { priceUnit: 'Per hour' };
  assert.equal(priceUnitText(en, 'services', attrs), 'Per hour');
  assert.equal(listingPriceText(en, { category: 'services', price: 500, attributes: attrs }, (n) => `${n} Birr`), '500 Birr');
  const contact = { category: 'services', price: 0, attributes: { priceMode: 'Contact for price' } };
  assert.ok(isContactPriceListing(contact));
  assert.equal(listingPriceText(en, contact, (n) => `${n} Birr`), 'Contact for price');
  // the detail never adds a price row of its own
  assert.deepEqual(serviceDetail(en, 'services', 'Plumber', { ...attrs, priceMode: 'Contact for price' })!.more, []);
  assert.ok(!attributeRows(en, 'services', 'Plumber', { ...attrs, specialty: 'Pipes' }).some((r) => r.key === 'priceUnit'));
});

test('labels resolve in Somali, English and Amharic', () => {
  for (const [name, t] of [['en', en], ['so', so], ['am', am]] as const) {
    for (const key of ['overview', 'highlights', 'availability', 'provider', 'more', 'included', 'businessName', 'providerName', 'kind.individual', 'kind.business']) {
      const v = t(`listing.service.${key}`);
      assert.ok(v && !v.startsWith('listing.service.'), `${name} ${key}`);
    }
    assert.ok(t('listing.service.years', { count: 3 }).includes('3'), `${name} years`);
    assert.ok(t('listing.service.moreDays', { count: 4 }).includes('4'), `${name} moreDays`);
  }
  assert.notEqual(so('listing.service.provider'), en('listing.service.provider'));
  assert.notEqual(am('listing.service.provider'), en('listing.service.provider'));
  const d = serviceDetail(so, 'services', 'Plumber', { providerType: 'Company', providerName: 'Y', experience: '2' })!;
  assert.equal(d.provider[0].label, 'Magaca ganacsiga');
  assert.equal(d.providerKindLabel, 'Ganacsi');
});

test('mobile and web show the same sections, no broken UTF-8, and keep the Contact for price guard', () => {
  const mobile = read('components/ServiceDetails.tsx');
  const web = read('web/src/components/ServiceDetails.tsx');
  for (const key of ['overview', 'highlights', 'availability', 'provider', 'more']) {
    assert.ok(mobile.includes(`listing.service.${key}`) && web.includes(`listing.service.${key}`), key);
  }
  for (const file of ['app/listing/[id].tsx', 'web/src/app/listing/[id]/page.tsx', 'components/ServiceDetails.tsx', 'web/src/components/ServiceDetails.tsx']) {
    assert.ok(!MOJIBAKE.test(read(file)), `${file} has mojibake`);
  }
  for (const file of ['app/listing/[id].tsx', 'web/src/app/listing/[id]/page.tsx']) {
    assert.ok(/serviceDetail\(/.test(read(file)), `${file} uses the shared sections`);
    assert.ok(/contactPrice/.test(read(file)), `${file} still checks Contact for price`);
  }
});
