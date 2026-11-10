import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { categories } from '../data/categories';
import { getCategoryFields } from '../data/categoryFields';
import { FACT_ICONS, FACT_LIMIT, listingDetail } from '../data/listingDetail';
import { DICTIONARIES, makeT } from '../web/src/lib/webTranslate';

const root = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const en = makeT(DICTIONARIES.en);
const so = makeT(DICTIONARIES.so);
const am = makeT(DICTIONARIES.am);

const CAR = { brand: 'Toyota', model: 'Corolla', year: '2018', mileage: '85000', transmission: 'Automatic', fuel: 'Petrol', engineSize: '1.6 L', color: 'White', registration: 'Registered', importStatus: 'Locally used' };
const flat = (d: ReturnType<typeof listingDetail>) => [...d.facts, ...d.sections.flatMap((s) => s.rows)];

test('a car leads with year, mileage, gearbox and fuel, then groups the rest', () => {
  const d = listingDetail(en, 'vehicles', 'Cars', CAR);
  assert.deepEqual(d.facts.map((f) => f.key), ['year', 'mileage', 'transmission', 'fuel']);
  assert.equal(d.facts[1].value, '85,000 km');
  assert.equal(d.facts[1].label, 'Mileage');
  assert.deepEqual(d.sections.map((s) => s.title), ['Vehicle', 'Performance', 'Registration & import']);
  assert.deepEqual(d.sections[0].rows.map((r) => r.key), ['brand', 'model', 'color']); // year is a fact, so it is not repeated
});

test('a phone leads with storage, RAM and battery; property with rooms and size', () => {
  const phone = listingDetail(en, 'phones', 'iPhone', { brand: 'Apple', model: 'iPhone 13', storage: '128 GB', ram: '4 GB', battery: '90', warranty: 'No' });
  assert.deepEqual(phone.facts.map((f) => f.key), ['storage', 'ram', 'battery']);
  assert.equal(phone.facts[2].value, '90 %');
  const home = listingDetail(en, 'property', 'House for Sale', { bedrooms: '3', bathrooms: '2', size: '220', furnished: 'No', electricity: 'Yes', water: 'Yes', neighborhood: 'Hodan', address: 'Street 4' });
  assert.deepEqual(home.facts.map((f) => f.key), ['bedrooms', 'bathrooms', 'size', 'furnished']);
  assert.equal(home.facts[2].value, '220 sqm');
  assert.deepEqual(home.sections.map((s) => s.id), ['utilities', 'location']);
});

test('land shows its size with the unit it was entered in', () => {
  const land = listingDetail(en, 'property', 'Land', { size: '500', unit: 'sqm', landType: 'Residential' });
  assert.ok(land.facts.some((f) => f.key === 'size'));
  assert.ok(!flat(land).some((r) => r.key === 'unit'), 'the unit row is folded into the size');
  assert.ok(/500.*sqm/.test(land.facts.find((f) => f.key === 'size')!.value));
});

test('every category and subcategory builds, never exceeds four tiles, and shows each answer exactly once', () => {
  for (const c of categories) {
    if (c.id === 'services') continue; // services use serviceDetail
    for (const s of c.subcategories ?? [{ name: undefined as string | undefined }]) {
      const attrs: Record<string, string> = {};
      for (const f of getCategoryFields(c.id, s.name)) attrs[f.key] = f.options?.[0] ?? '7';
      const d = listingDetail(en, c.id, s.name, attrs);
      assert.ok(d.facts.length <= FACT_LIMIT, `${c.id}/${s.name} tiles`);
      const keys = flat(d).map((r) => r.key);
      assert.equal(new Set(keys).size, keys.length, `${c.id}/${s.name} repeats an answer`);
      for (const f of d.facts) assert.ok(f.icon, `${c.id}/${s.name} ${f.key} has an icon`);
      for (const sec of d.sections) assert.ok(sec.rows.length > 0 && sec.title && !sec.title.startsWith('listing.'), `${c.id}/${s.name} section ${sec.id}`);
    }
  }
});

test('empty answers are omitted and an empty listing has no sections', () => {
  const d = listingDetail(en, 'vehicles', 'Cars', { brand: '', model: '  ', year: '2020' });
  assert.deepEqual(d.facts.map((f) => f.key), ['year']);
  assert.deepEqual(d.sections, []);
  assert.deepEqual(listingDetail(en, 'vehicles', 'Cars', undefined), { facts: [], sections: [] });
});

test('long free text never becomes a tile and stays whole in its section', () => {
  const long = 'Imported from Dubai in 2021, one careful owner, full service history at the main dealer in Mogadishu';
  const d = listingDetail(en, 'vehicles', 'Cars', { year: '2019', mileage: long, transmission: 'Automatic' });
  assert.ok(!d.facts.some((f) => f.key === 'mileage'));
  assert.equal(flat(d).find((r) => r.key === 'mileage')!.value, long);
});

test('price keys are never shown as details', () => {
  const d = listingDetail(en, 'vehicles', 'Cars', { ...CAR, priceMode: 'Contact for price', priceUnit: 'Per hour' });
  assert.ok(!flat(d).some((r) => r.key === 'priceMode' || r.key === 'priceUnit'));
});

test('section titles resolve in Somali, English and Amharic', () => {
  for (const id of ['vehicle', 'performance', 'papers', 'rental', 'overview', 'specs', 'warranty', 'property', 'rooms', 'utilities', 'terms', 'ownership', 'location', 'details', 'more']) {
    for (const [name, t] of [['en', en], ['so', so], ['am', am]] as const) {
      const v = t(`listing.detail.sections.${id}`);
      assert.ok(v && !v.startsWith('listing.detail'), `${name} ${id}`);
    }
    assert.notEqual(so(`listing.detail.sections.${id}`), en(`listing.detail.sections.${id}`), `so ${id} is translated`);
  }
  assert.equal(listingDetail(so, 'vehicles', 'Cars', CAR).sections[0].title, 'Gaadhiga');
});

test('every tile icon exists in the website icon set, and both pages use the shared layout', () => {
  const icons = read('web/src/lib/icons.tsx');
  for (const icon of [...Object.values(FACT_ICONS), 'information-circle-outline']) assert.ok(icons.includes(`'${icon}'`), `${icon} missing on web`);
  for (const file of ['app/listing/[id].tsx', 'web/src/app/listing/[id]/page.tsx']) assert.ok(/listingDetail\(/.test(read(file)), `${file} uses the shared layout`);
  const mobile = read('components/ListingDetails.tsx');
  const web = read('web/src/components/ListingDetails.tsx');
  assert.ok(/flexWrap: 'wrap'/.test(mobile) && /flexShrink: 1/.test(mobile) && !/horizontal/.test(mobile));
  assert.ok(/break-words/.test(web) && /min-w-0/.test(web) && !/overflow-x-(auto|scroll)/.test(web));
});

import { adminAttributeRows, humanizeKey } from '../web/src/lib/adminAttributes';

test('the admin sees readable labels and full values, plus anything the form no longer asks', () => {
  const rows = adminAttributeRows(en, 'services', 'Electrician', { providerType: 'Individual', availableDays: 'Monday, Tuesday', availableFrom: '08:00', availableTo: '17:00', priceUnit: 'Per hour', oldField: 'kept', empty: '  ' });
  const labels = rows.map((r) => r.label);
  assert.ok(labels.includes('Available days') && labels.includes('Working hours'));
  assert.ok(!rows.some((r) => r.key === 'availableDays' && r.label === 'availableDays'), 'no raw database key as a label');
  assert.equal(rows.filter((r) => r.key === 'availableTo').length, 0, 'the two ends of the hours are one row');
  assert.deepEqual(rows.find((r) => r.key === 'priceUnit'), { key: 'priceUnit', label: 'Price unit', value: 'Per hour' });
  assert.equal(rows.find((r) => r.key === 'oldField')!.value, 'kept');
  assert.ok(!rows.some((r) => r.key === 'empty'));
  assert.deepEqual(adminAttributeRows(en, 'vehicles', 'Cars', null), []);
  assert.equal(humanizeKey('availableDays'), 'Available days');
  const page = read('web/src/app/admin/listings/[id]/page.tsx');
  assert.ok(/adminAttributeRows\(/.test(page) && /break-words/.test(page));
});
