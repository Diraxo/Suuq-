import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { categories } from '../data/categories';
import { categories as webCategories } from '../web/src/lib/categories';
import { categoryFields, getCategoryFields, visibleFields, detailsFields, priceStepFields, type CategoryField } from '../data/categoryFields';
import {
  CONTACT_PRICE_ENABLED,
  PRICE_MODE_CONTACT,
  PRICE_MODE_SET,
  SERVICE_DEFS,
  SERVICE_PRICE_UNITS,
  SERVICE_SUBCATEGORIES,
  SERVICE_TIMES,
  TIME_ORDER_ERROR,
  amountInputToDigits,
  buildServiceFields,
  formatAmountInput,
  hoursText,
  isContactPrice,
  joinMulti,
  parseMulti,
  publishedPrice,
  toggleMulti,
} from '../data/serviceConfig';
import { sanitizeAttributes, validateAttributes, validateListingDraft, validatePrice } from '../data/sellRules';
import { attributeRows, contactForPriceText, groupBySection, priceUnitText, type Translate } from '../data/sellText';
import { PENDING } from './pending';

const root = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const en = JSON.parse(read('locales/en/translation.json'));
const so = JSON.parse(read('locales/so/translation.json'));
const am = JSON.parse(read('locales/am/translation.json'));

// English passthrough translator, like the app with no locale entry.
const tEn: Translate = (key, options = {}) => String(options.defaultValue ?? key);
const textKey = (s: string) => s.replace(/[.:]/g, '');

const ORIGINAL_SUBCATEGORIES = ['Electrician', 'Plumber', 'Painter', 'Cleaning', 'Internet', 'Transport', 'Mechanic', 'IT', 'Tutor', 'Salon', 'Solar Installation', 'Generator Repair', 'Photography'];
const servicesCategory = categories.find((c) => c.id === 'services')!;
const fieldsOf = (sub: string, contact = false) => buildServiceFields(sub, contact);
const keys = (fields: CategoryField[]) => fields.map((f) => f.key);

// ───────────────────────────── Taxonomy ─────────────────────────────

test('every original service subcategory keeps its name and position, and every subcategory has a definition', () => {
  const names = servicesCategory.subcategories!.map((s) => s.name);
  assert.deepEqual(names.slice(0, ORIGINAL_SUBCATEGORIES.length), ORIGINAL_SUBCATEGORIES);
  assert.deepEqual(names, SERVICE_SUBCATEGORIES);
  assert.deepEqual(webCategories.find((c) => c.id === 'services')!.subcategories!.map((s) => s.name), names);
  assert.equal(new Set(names).size, names.length, 'no duplicate subcategory');
});

test('the requested trades are all reachable, each through exactly one subcategory specialty', () => {
  const asked: [string, string][] = [
    ['Electrician', 'Wiring'], ['Electrician', 'Installation'], ['Plumber', 'Water pumps'], ['Plumber', 'Water tanks'],
    ['Generator Repair', 'Installation'], ['Generator Repair', 'Repair'], ['Appliance Repair', 'Refrigerator'], ['Appliance Repair', 'Freezer'],
    ['Mechanic', 'Car mechanic'], ['Mechanic', 'Motorcycle mechanic'], ['Cleaning', 'House cleaning'], ['Cleaning', 'Household assistance'],
    ['Painter', 'Interior painting'], ['Construction & Maintenance', 'Fabrication & welding'], ['Construction & Maintenance', 'General maintenance'],
    ['Internet', 'Wi-Fi setup'], ['IT', 'Website development'], ['IT', 'Software development'], ['IT', 'IT support & troubleshooting'],
    ['Graphic Design', 'Logo & branding'], ['Photography', 'Weddings'], ['Video Production', 'Video editing'], ['Video Production', 'Short-form & social media'],
    ['Tutor', 'School subjects'], ['Tutor', 'Vocational training'], ['Transport', 'Taxi'], ['Delivery & Courier', 'Parcels & documents'],
    ['Moving & Logistics', 'House moving'], ['Salon', 'Hair'], ['Events & Catering', 'Catering'], ['Events & Catering', 'DJ & sound'],
    ['Business Services', 'Accounting'], ['Other Services', 'Other service'],
  ];
  for (const [sub, specialty] of asked) assert.ok(SERVICE_DEFS[sub]?.specialties.includes(specialty), `${sub} → ${specialty}`);
});

test('every subcategory builds a clean field list: unique keys, options present, no commas, units from the shared list', () => {
  for (const sub of SERVICE_SUBCATEGORIES) {
    for (const contact of [false, true]) {
      const fields = fieldsOf(sub, contact);
      assert.equal(new Set(keys(fields)).size, fields.length, `${sub}: duplicate field key`);
      for (const f of fields) {
        if (f.type === 'select' || f.type === 'multi') {
          assert.ok(f.options?.length, `${sub}.${f.key}: no options`);
          assert.equal(new Set(f.options).size, f.options!.length, `${sub}.${f.key}: duplicate option`);
          if (f.type === 'multi') for (const o of f.options!) assert.ok(!o.includes(','), `${sub}.${f.key}: option "${o}" contains a comma`);
        }
        assert.ok(f.section, `${sub}.${f.key}: no section`);
      }
      for (const unit of fields.find((f) => f.key === 'priceUnit')!.options!) assert.ok(SERVICE_PRICE_UNITS.includes(unit), `${sub}: unknown unit ${unit}`);
    }
    assert.ok(categoryFields[`services/${sub}`], `${sub} is registered in categoryFields`);
    assert.deepEqual(getCategoryFields('services', sub).map((f) => f.key), keys(fieldsOf(sub)));
  }
  assert.ok(categoryFields.services, 'the bare services entry (no subcategory) still exists');
});

test('only units that make sense are offered per trade', () => {
  const unitsOf = (sub: string) => fieldsOf(sub).find((f) => f.key === 'priceUnit')!.options!;
  assert.ok(unitsOf('Photography').includes('Per session') && !unitsOf('Photography').includes('Per video'));
  assert.ok(unitsOf('Video Production').includes('Per video') && !unitsOf('Video Production').includes('Per trip'));
  assert.ok(unitsOf('Transport').includes('Per trip') && !unitsOf('Transport').includes('Per video'));
  assert.ok(unitsOf('Delivery & Courier').includes('Per delivery'));
  assert.ok(unitsOf('IT').includes('Per project') && unitsOf('IT').includes('Per session'));
  assert.ok(unitsOf('Cleaning').includes('Per month') && !unitsOf('Cleaning').includes('Per video'));
  assert.ok(!unitsOf('Electrician').includes('Per video'));
});

// ───────────────────────────── Conditional fields ─────────────────────────────

test('specialty questions appear only for the trades they belong to', () => {
  const has = (sub: string, key: string) => keys(fieldsOf(sub)).includes(key);
  // electrician / plumber: customer type + emergency
  for (const sub of ['Electrician', 'Plumber']) assert.ok(has(sub, 'workFor') && has(sub, 'emergency'), sub);
  // generator: type + capacity
  assert.ok(has('Generator Repair', 'generatorType') && has('Generator Repair', 'supportedCapacity'));
  assert.ok(!has('Electrician', 'generatorType'));
  // photographer: indoor/outdoor
  assert.ok(has('Photography', 'shootingSetting') && !has('Plumber', 'shootingSetting'));
  // transport + moving: vehicle and capacity; routes only for transport
  assert.ok(has('Transport', 'vehicleType') && has('Transport', 'serviceCapacity') && has('Transport', 'routes'));
  assert.ok(has('Moving & Logistics', 'vehicleType') && !has('Moving & Logistics', 'routes'));
  // delivery: areas, estimated time, same-day, vehicle
  for (const k of ['deliveryAreas', 'deliveryTime', 'sameDay', 'deliveryVehicle']) assert.ok(has('Delivery & Courier', k), k);
  // cleaning: frequency + emergency + same-day
  for (const k of ['serviceFrequency', 'emergency', 'workFor']) assert.ok(has('Cleaning', k), k);
  // unrelated trades do not get delivery questions
  for (const sub of ['Electrician', 'Photography', 'IT', 'Tutor', 'Salon', 'Graphic Design']) {
    for (const k of ['deliveryAreas', 'deliveryTime', 'deliveryVehicle']) assert.ok(!has(sub, k), `${sub} must not ask ${k}`);
    assert.ok(!(fieldsOf(sub).find((f) => f.key === 'workPlace')!.options!.includes('I deliver')), `${sub} must not offer delivery`);
  }
  // remote work only where it can be true
  assert.ok(fieldsOf('IT').find((f) => f.key === 'workPlace')!.options!.includes('Remote / online'));
  assert.ok(!fieldsOf('Plumber').find((f) => f.key === 'workPlace')!.options!.includes('Remote / online'));
  // individual vs company applies everywhere
  for (const sub of SERVICE_SUBCATEGORIES) assert.deepEqual(fieldsOf(sub).find((f) => f.key === 'providerType')!.options, ['Individual', 'Company']);
});

test('a "multi" answer shows a dependent field when any ticked choice matches', () => {
  const fields: CategoryField[] = [
    { key: 'kinds', label: 'Kinds', type: 'multi', options: ['A', 'B'] },
    { key: 'onlyB', label: 'Only B', type: 'text', showIf: { key: 'kinds', equals: ['B'] } },
  ];
  assert.deepEqual(keys(visibleFields(fields, { kinds: 'A' })), ['kinds']);
  assert.deepEqual(keys(visibleFields(fields, { kinds: 'A, B' })), ['kinds', 'onlyB']);
  assert.deepEqual(keys(visibleFields(fields, { kinds: 'B' })), ['kinds', 'onlyB']);
});

test('pricing questions are asked on the price step, not on the details step', () => {
  const fields = fieldsOf('Photography', true);
  assert.deepEqual(keys(priceStepFields(fields)), ['priceMode', 'priceUnit']);
  assert.ok(!keys(detailsFields(fields)).includes('priceUnit'));
  assert.equal(detailsFields(fields).length + priceStepFields(fields).length, fields.length);
});

// ───────────────────────────── Validation ─────────────────────────────

const GOOD: Record<string, string> = { providerType: 'Individual', specialty: 'Wiring', priceUnit: 'Per hour' };

test('a new service needs provider type, a specialty and a price unit; an old listing that predates them stays valid', () => {
  const fields = getCategoryFields('services', 'Electrician');
  const missing = validateAttributes(fields, {}, new Date(), true);
  assert.deepEqual(Object.keys(missing).sort(), ['priceUnit', 'providerType', 'specialty']);
  assert.deepEqual(validateAttributes(fields, GOOD, new Date(), true), {});
  // saved by the first version of this form: only years of experience and an availability type
  assert.deepEqual(validateAttributes(fields, { experience: '5 years', availability: 'On-call' }, new Date(), false), {});
  assert.deepEqual(sanitizeAttributes(fields, { experience: '5 years', availability: 'On-call' }), { experience: '5 years', availability: 'On-call' });
});

test('choices are checked against the field’s own options', () => {
  const fields = getCategoryFields('services', 'Electrician');
  assert.ok(validateAttributes(fields, { ...GOOD, providerType: 'Government' }, new Date(), true).providerType);
  assert.ok(validateAttributes(fields, { ...GOOD, specialty: 'Wiring, Brain surgery' }, new Date(), true).specialty);
  assert.ok(validateAttributes(fields, { ...GOOD, priceUnit: 'Per video' }, new Date(), true).priceUnit, 'a unit that does not fit the trade');
  assert.deepEqual(validateAttributes(fields, { ...GOOD, specialty: 'Wiring, Lighting', workFor: 'Residential, Commercial' }, new Date(), true), {});
  assert.deepEqual(sanitizeAttributes(fields, { ...GOOD, specialty: 'Wiring, Brain surgery, Lighting' }).specialty, 'Wiring, Lighting');
  assert.equal(sanitizeAttributes(fields, { ...GOOD, specialty: 'Brain surgery' }).specialty, undefined);
});

test('availability: both ends or neither, and the end must be later', () => {
  const fields = getCategoryFields('services', 'Electrician');
  const check = (extra: Record<string, string>) => validateAttributes(fields, { ...GOOD, ...extra }, new Date(), true);
  assert.deepEqual(check({}), {});
  assert.deepEqual(check({ availableFrom: '08:00', availableTo: '17:30' }), {});
  assert.equal(check({ availableFrom: '17:00', availableTo: '08:00' }).availableTo, TIME_ORDER_ERROR);
  assert.equal(check({ availableFrom: '08:00', availableTo: '08:00' }).availableTo, TIME_ORDER_ERROR);
  assert.match(check({ availableFrom: '08:00' }).availableTo, /Available until is required/);
  assert.match(check({ availableTo: '08:00' }).availableFrom, /Available from is required/);
  assert.ok(check({ availableFrom: '25:00', availableTo: '26:00' }).availableFrom, 'a time that is not on the list');
  assert.equal(hoursText({ availableFrom: '08:00', availableTo: '17:00' }), '08:00 – 17:00');
  assert.equal(hoursText({ availableFrom: '08:00' }), undefined);
  assert.equal(SERVICE_TIMES.length, 48);
  // the rule does not touch other categories
  assert.deepEqual(validateAttributes(getCategoryFields('phones', 'iPhone'), { availableFrom: '17:00', availableTo: '08:00' }, new Date(), true), validateAttributes(getCategoryFields('phones', 'iPhone'), {}, new Date(), true));
});

// ───────────────────────────── Pricing ─────────────────────────────

test('amounts are grouped as they are typed and stored as plain digits', () => {
  assert.equal(formatAmountInput('1000'), '1,000');
  assert.equal(formatAmountInput('10000'), '10,000');
  assert.equal(formatAmountInput('100000'), '100,000');
  assert.equal(formatAmountInput('999'), '999');
  assert.equal(formatAmountInput(''), '');
  assert.equal(formatAmountInput('007'), '7', 'leading zeros are not shown');
  assert.equal(amountInputToDigits('100,000'), '100000');
  assert.equal(amountInputToDigits('1 000 000'), '1000000');
  for (const digits of ['5', '50', '500', '5000', '50000', '500000', '5000000']) assert.equal(amountInputToDigits(formatAmountInput(digits)), digits);
  // junk is not hidden: it stays visible and validation rejects it
  assert.equal(formatAmountInput('12a4'), '12a4');
  assert.ok(validatePrice(amountInputToDigits('12a4')));
  assert.equal(validatePrice(amountInputToDigits('1,000')), undefined);
});

test('a price must be a positive whole amount: no zero, negative or malformed values', () => {
  for (const bad of ['', '0', '00', '-5', '1.5', '1e3', 'NaN', '١٢٣', '1_000']) assert.ok(validatePrice(bad), `"${bad}" should be rejected`);
  for (const good of ['1', '250', '1000000']) assert.equal(validatePrice(good), undefined);
  assert.equal(publishedPrice('100000', false), 100000);
  assert.ok(Number.isInteger(publishedPrice(amountInputToDigits('1,250,000'), false)));
});

test('"Contact for price" is off until the migration is approved, and then needs no amount', () => {
  assert.equal(CONTACT_PRICE_ENABLED, false);
  for (const sub of SERVICE_SUBCATEGORIES) assert.ok(!keys(fieldsOf(sub)).includes('priceMode'), `${sub}: priceMode must not be asked while the switch is off`);
  const fields = fieldsOf('Photography', true);
  const mode = fields.find((f) => f.key === 'priceMode')!;
  assert.deepEqual(mode.options, [PRICE_MODE_SET, PRICE_MODE_CONTACT]);
  assert.equal(mode.control, 'radio');
  // the unit is asked only for "Set a price" (and when no mode was chosen yet)
  assert.ok(keys(visibleFields(fields, { priceMode: PRICE_MODE_SET })).includes('priceUnit'));
  assert.ok(keys(visibleFields(fields, {})).includes('priceUnit'));
  assert.ok(!keys(visibleFields(fields, { priceMode: PRICE_MODE_CONTACT })).includes('priceUnit'));
  assert.equal(sanitizeAttributes(fields, { ...GOOD, specialty: 'Weddings', priceMode: PRICE_MODE_CONTACT }).priceUnit, undefined, 'a hidden unit is not published');

  const draft = (attributes: Record<string, string>, price: string, withFields = fields) =>
    validateListingDraft({ photoCount: 1, category: 'services', subcategory: 'Photography', title: 't', description: 'd', city: 'Jigjiga', price, currency: 'ETB', attributes, fields: withFields, categories });
  const base = { providerType: 'Individual', specialty: 'Weddings' };
  assert.equal(draft({ ...base, priceMode: PRICE_MODE_CONTACT }, '').ok, true, 'contact for price needs no amount');
  assert.equal(draft({ ...base, priceMode: PRICE_MODE_SET, priceUnit: 'Per session' }, '').errors.price, 'Price is required.');
  assert.equal(draft({ ...base, priceMode: PRICE_MODE_SET, priceUnit: 'Per session' }, '1500').ok, true);
  assert.equal(draft({ ...base, priceMode: PRICE_MODE_SET }, '1500').errors['attr:priceUnit'], 'Price is charged is required.');
  assert.equal(draft({ ...base, priceMode: PRICE_MODE_SET }, '1500').firstInvalidStep, 'price', 'a missing unit sends the seller to the price step');
  // a forged "contact" answer cannot skip the price while the question is off
  const off = getCategoryFields('services', 'Photography');
  assert.equal(draft({ ...base, priceUnit: 'Per session', priceMode: PRICE_MODE_CONTACT }, '', off).errors.price, 'Price is required.');
  // and only services can use it
  assert.equal(isContactPrice('services', { priceMode: PRICE_MODE_CONTACT }), true);
  assert.equal(isContactPrice('phones', { priceMode: PRICE_MODE_CONTACT }), false);
  assert.equal(isContactPrice('services', { priceMode: PRICE_MODE_SET }), false);
  assert.equal(isContactPrice('services', undefined), false);
  assert.equal(publishedPrice('', true), 0);
});

test('with the switch off, a service publishes with a real amount and its unit', () => {
  const fields = getCategoryFields('services', 'Plumber');
  const attributes = { ...GOOD, specialty: 'Leak repair, Water pumps', priceUnit: 'Per visit' };
  const result = validateListingDraft({ photoCount: 1, category: 'services', subcategory: 'Plumber', title: 'Plumber', description: 'd', city: 'Jigjiga', price: amountInputToDigits('1,500'), currency: 'ETB', attributes, fields, categories });
  assert.deepEqual(result.errors, {});
  assert.deepEqual(sanitizeAttributes(fields, attributes), attributes);
});

// ───────────────────────────── Multiple choices ─────────────────────────────

test('multi-choice values round-trip in option order', () => {
  const days = ['Monday', 'Tuesday', 'Wednesday'];
  assert.deepEqual(parseMulti('Monday, Wednesday'), ['Monday', 'Wednesday']);
  assert.deepEqual(parseMulti(undefined), []);
  assert.deepEqual(parseMulti(' Monday ,, Monday'), ['Monday']);
  assert.equal(joinMulti(['Monday', 'Tuesday']), 'Monday, Tuesday');
  assert.equal(toggleMulti('Wednesday', 'Monday', days), 'Monday, Wednesday');
  assert.equal(toggleMulti('Monday, Wednesday', 'Monday', days), 'Wednesday');
  assert.equal(toggleMulti('', 'Tuesday', days), 'Tuesday');
});

// ───────────────────────────── Display ─────────────────────────────

test('a published service shows its details without empty or irrelevant rows', () => {
  const rows = attributeRows(tEn, 'services', 'Photography', {
    providerType: 'Company',
    providerName: 'Hodan Studio',
    specialty: 'Weddings, Events',
    shootingSetting: 'Indoor, Outdoor',
    experience: '5 years',
    availableDays: 'Saturday, Sunday',
    availableFrom: '08:00',
    availableTo: '18:00',
    booking: 'Appointment required',
    priceUnit: 'Per event',
    deliveryAreas: 'Stale value from another trade',
  });
  const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
  assert.equal(byLabel['Provider type'], 'Company');
  assert.equal(byLabel['Your name or company name'], 'Hodan Studio');
  assert.equal(byLabel['What you offer'], 'Weddings, Events');
  assert.equal(byLabel['Working hours'], '08:00 – 18:00');
  assert.equal(byLabel['Available days'], 'Saturday, Sunday');
  assert.equal(byLabel['Booking'], 'Appointment required');
  const labels = rows.map((r) => r.label);
  assert.ok(!labels.includes('Price is charged'), 'the unit is shown beside the price');
  assert.ok(!labels.includes('Available until') && !labels.includes('Available from'), 'the two ends share one line');
  assert.ok(!labels.some((l) => /delivery/i.test(l)), 'a field this trade does not ask is not shown');
  assert.deepEqual(attributeRows(tEn, 'services', 'Photography', {}), []);
  assert.equal(priceUnitText(tEn, 'services', { priceUnit: 'Per event' }), 'Per event');
  assert.equal(priceUnitText(tEn, 'phones', { priceUnit: 'Per event' }), undefined);
  assert.equal(priceUnitText(tEn, 'services', {}), undefined);
  assert.equal(contactForPriceText(tEn), 'Contact for price');
  // a half-filled window shows nothing rather than half a line
  assert.ok(!attributeRows(tEn, 'services', 'Photography', { availableFrom: '08:00' }).some((r) => r.key === 'availableFrom'));
});

test('a listing saved by the first version of the form still shows its two answers', () => {
  const rows = attributeRows(tEn, 'services', 'Electrician', { experience: '5 years', availability: 'On-call' });
  assert.deepEqual(rows.map((r) => [r.key, r.value]), [['experience', '5 years'], ['availability', 'On-call']]);
});

test('fields are grouped under section headings in a stable order', () => {
  const groups = groupBySection(detailsFields(fieldsOf('Electrician')));
  assert.deepEqual(groups.map((g) => g.section), ['provider', 'service', 'availability']);
  assert.deepEqual(groupBySection(priceStepFields(fieldsOf('Electrician'))).map((g) => g.section), ['pricing']);
  assert.deepEqual(groupBySection([{ section: undefined }, { section: undefined }]).map((g) => g.fields.length), [2]);
});

// ───────────────────────── Mobile / web parity and wiring ─────────────────────────

test('the website’s copies of the service rules are identical to the originals', () => {
  for (const f of ['serviceConfig', 'categoryFields', 'sellRules', 'sellText']) assert.equal(read(`data/${f}.ts`), read(`web/src/lib/${f}.ts`), `${f} drifted`);
});

test('mobile and web both render every field kind the service form uses', () => {
  const mobile = read('components/DynamicField.tsx');
  const web = read('web/src/components/SellField.tsx');
  for (const marker of ["field.type === 'multi'", "field.control === 'dropdown'", "field.control === 'radio'"]) {
    assert.ok(mobile.includes(marker), `mobile DynamicField: ${marker}`);
    assert.ok(web.includes(marker), `web SellField: ${marker}`);
  }
  // both sell flows ask the pricing questions beside the price and group the rest under headings
  for (const f of ['app/post/price.tsx', 'web/src/app/sell/page.tsx']) {
    const src = read(f);
    assert.ok(/priceStepFields\(/.test(src), `${f}: pricing questions`);
    assert.ok(/formatAmountInput\(/.test(src) && /amountInputToDigits\(/.test(src), `${f}: thousands separators`);
  }
  for (const f of ['app/post/details.tsx', 'web/src/app/sell/page.tsx', 'app/listing/edit/[id].tsx', 'web/src/app/listing/edit/[id]/page.tsx']) assert.ok(/groupBySection\(/.test(read(f)), `${f}: section headings`);
  // and both publish paths store the same price
  for (const f of ['app/post/preview.tsx', 'web/src/app/sell/page.tsx', 'app/listing/edit/[id].tsx', 'web/src/app/listing/edit/[id]/page.tsx']) assert.ok(/publishedPrice\(/.test(read(f)), `${f}: publishedPrice`);
  // every place that shows a price shows the unit / contact wording
  for (const f of ['components/ListingCard.tsx', 'web/src/components/ListingCard.tsx', 'app/listing/[id].tsx', 'web/src/app/listing/[id]/page.tsx']) {
    assert.ok(/priceUnitText\(/.test(read(f)) && /(contactForPriceText|listingPriceText)\(/.test(read(f)), `${f}: price display`);
  }
});

test('editing a service keeps its availability and unit, lets both change, and re-checks them', () => {
  const fields = getCategoryFields('services', 'Plumber');
  const stored = { ...GOOD, specialty: 'Leak repair', priceUnit: 'Per visit', availableDays: 'Monday, Tuesday', availableFrom: '08:00', availableTo: '17:00' };
  const dayKey = fields.find((f) => f.key === 'availableDays') ? 'availableDays' : undefined;
  // reopening a saved listing: nothing it stored is dropped by the edit form
  assert.deepEqual(sanitizeAttributes(fields, stored), Object.fromEntries(Object.entries(sanitizeAttributes(fields, stored))), 'sanitize is stable');
  assert.equal(sanitizeAttributes(fields, stored).priceUnit, 'Per visit');
  assert.equal(sanitizeAttributes(fields, stored).availableFrom, '08:00');
  assert.deepEqual(validateAttributes(fields, stored), {}, 'a valid saved listing opens without errors');
  if (dayKey) assert.equal(sanitizeAttributes(fields, stored)[dayKey], 'Monday, Tuesday');
  // changed values are what gets saved
  const changed = { ...stored, priceUnit: 'Per hour', availableTo: '18:30' };
  assert.equal(sanitizeAttributes(fields, changed).priceUnit, 'Per hour');
  assert.equal(sanitizeAttributes(fields, changed).availableTo, '18:30');
  // and a bad edit is refused
  assert.ok(validateAttributes(fields, { ...stored, availableTo: '07:00' }).availableTo, 'end before start is refused on edit too');
  assert.ok(validateAttributes(fields, { ...stored, priceUnit: 'Per banana' }).priceUnit, 'a unit outside the list is refused');
});

test('with the switch off, editing cannot turn a stored "contact" answer into a free listing', () => {
  const fields = getCategoryFields('services', 'Plumber');
  assert.ok(!fields.some((f) => f.key === 'priceMode'));
  // both edit screens only skip the price check when the form actually asks the question
  for (const f of ['app/listing/edit/[id].tsx', 'web/src/app/listing/edit/[id]/page.tsx']) {
    assert.ok(/allFields\.some\(\(f\) => f\.key === 'priceMode'\) && isContactPrice\(/.test(read(f)), `${f}: contact only counts when the question is asked`);
  }
  // so a forged answer on a priced listing still has to pass the positive-price rule
  assert.ok(validatePrice('0'), 'zero is refused');
  assert.ok(validatePrice(''), 'empty is refused');
});

test('the web edit page edits service questions through the shared field renderer and saves them', () => {
  const src = read('web/src/app/listing/edit/[id]/page.tsx');
  assert.ok(/<SellField/.test(src) && /validateAttributes\(allFields, attributes\)/.test(src), 'renders and validates the service fields');
  assert.ok(/attributes: sanitizeAttributes\(allFields, attributes\)/.test(src), 'saves the edited answers');
  assert.ok(/editsAttributes = category === 'services'/.test(src), 'limited to services; other categories are untouched');
});

// ───────────────────────────── Localization ─────────────────────────────

test('every English service string has a locale entry, so Somali and Amharic can be added next to it', () => {
  const missing: string[] = [];
  const need = (group: Record<string, string> | undefined, label: string, text: string) => {
    if (!group || typeof group[textKey(text)] !== 'string') missing.push(`${label}: ${text}`);
  };
  const times = new Set(SERVICE_TIMES);
  for (const sub of SERVICE_SUBCATEGORIES) {
    need(en.subcategoryNames, 'subcategoryNames', `services/${sub}`);
    assert.ok(en.post.titleExamples[`services/${sub}`], `title example for ${sub}`);
    for (const f of fieldsOf(sub, true)) {
      need(en.post.fieldLabels, 'fieldLabels', f.label);
      if (f.hint) need(en.post.fieldHints, 'fieldHints', f.hint);
      for (const o of f.options ?? []) if (!times.has(o)) need(en.post.fieldOptions, 'fieldOptions', o);
    }
  }
  for (const s of ['provider', 'service', 'availability', 'pricing']) assert.equal(typeof en.post.sections[s], 'string');
  assert.equal(en.post.serviceDisplay.contactForPrice, 'Contact for price');
  assert.deepEqual(missing, []);
});

const dig = (json: unknown, dotted: string): unknown => dotted.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], json);

test('Somali and Amharic show English for the new service strings until a native speaker reviews them — and the pending list is exact', () => {
  for (const [lang, json] of [['so', so], ['am', am]] as const) {
    assert.ok(PENDING[lang].length > 150, `${lang}: the pending list should cover the service strings`);
    for (const dotted of PENDING[lang]) {
      const value = dig(json, dotted);
      assert.equal(typeof value, 'string', `${lang} ${dotted} is missing`);
      // A listed path must still be the English placeholder; once it is translated it has to leave the list.
      assert.equal(value, dig(en, dotted), `${lang} ${dotted} is translated now: remove it from locales/pending-review.json`);
    }
    // Every service string is either translated or listed — nothing slips through half-done.
    const times = new Set(SERVICE_TIMES);
    for (const sub of SERVICE_SUBCATEGORIES) {
      const texts: [string, string][] = [['subcategoryNames', `services/${sub}`]];
      for (const f of fieldsOf(sub, true)) {
        texts.push(['post.fieldLabels', textKey(f.label)]);
        for (const o of f.options ?? []) if (!times.has(o)) texts.push(['post.fieldOptions', textKey(o)]);
      }
      for (const [group, key] of texts) {
        const value = (dig(json, group) as Record<string, string>)[key];
        assert.equal(typeof value, 'string', `${lang} ${group}.${key} missing`);
      }
    }
  }
  console.log(`awaiting native-speaker review — Somali: ${PENDING.so.length}, Amharic: ${PENDING.am.length} (locales/pending-review.json)`);
});
