import test from 'node:test';
import assert from 'node:assert/strict';
import { categories } from '../data/categories';
import { categoryFields, getCategoryFields, CategoryField } from '../data/categoryFields';
import { getCategoryFeatures } from '../data/categoryFeatures';
import {
  DESCRIPTION_MAX_LENGTH,
  NUMERIC_RULES,
  PRICE_MAX,
  SELLER_NOTES_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  ATTRIBUTE_TEXT_MAX_LENGTH,
  fieldHint,
  keyboardFor,
  numericRuleFor,
  parseNumericInput,
  sanitizeAttributes,
  sanitizeFeatures,
  validateAttribute,
  validateAttributes,
  validateCondition,
  validateCurrency,
  validateDescription,
  validateListingDraft,
  validatePrice,
  validateSellerNotes,
  validateTitle,
} from '../data/sellRules';

const allFields = (): CategoryField[] => Object.values(categoryFields).flat();
const field = (key: string, label?: string): CategoryField => {
  const f = allFields().find((x) => x.key === key && x.type === 'text' && (!label || x.label === label));
  assert.ok(f, `field ${key} exists`);
  return f!;
};

// ── Percentage: battery health ─────────────────────────────────────────────
test('battery health is a 0–100 whole-number percentage', () => {
  const battery = field('battery');
  assert.equal(numericRuleFor(battery)?.kind, 'percent');
  for (const ok of ['0', '1', '50', '99', '100', ' 87 ']) assert.equal(validateAttribute(battery, ok), undefined, ok);
  for (const bad of ['101', '-1', '1000', '-5', '50.5', '90%', 'abc', '5 0', '1e2', 'NaN', 'Infinity', '٥٠', '0x10', '+50', '9'.repeat(40)]) {
    assert.ok(validateAttribute(battery, bad), `rejects ${JSON.stringify(bad)}`);
  }
  assert.equal(validateAttribute(battery, ''), undefined, 'optional field may stay blank');
  assert.equal(validateAttribute(battery, '   '), undefined, 'whitespace-only counts as blank, not as 0');
  assert.match(fieldHint(battery) ?? '', /percentage from 0 to 100/i);
  assert.equal(keyboardFor(battery), 'number-pad');
});

test('invalid numeric input is rejected, never silently coerced to 0 or stripped', () => {
  const rule = NUMERIC_RULES.mileage;
  const r = parseNumericInput('12abc', rule, 'Mileage');
  assert.equal(r.ok, false);
  assert.equal(parseNumericInput('', rule).ok, false);
  const ok = parseNumericInput('0', rule);
  assert.deepEqual(ok, { ok: true, value: 0 }, '0 km is a real mileage and is accepted');
});

// ── Other bounded numeric fields use their OWN domain, not the battery rule ──
test('every numeric rule accepts its bounds and rejects just outside them', () => {
  for (const [key, rule] of Object.entries(NUMERIC_RULES)) {
    const f = allFields().find((x) => x.key === key && x.type === 'text' && numericRuleFor(x));
    assert.ok(f, `numeric rule "${key}" matches at least one real text field (typo guard)`);
    assert.equal(validateAttribute(f!, String(rule.min)), undefined, `${key} min`);
    assert.equal(validateAttribute(f!, String(rule.max)), undefined, `${key} max`);
    assert.ok(validateAttribute(f!, String(rule.max + 1)), `${key} above max`);
    if (rule.min > 0) assert.ok(validateAttribute(f!, String(Math.max(rule.min - 1, 0))) !== undefined || rule.min - 1 < 0, `${key} below min`);
    assert.ok(validateAttribute(f!, '-1'), `${key} negative`);
  }
});

test('integer vs decimal semantics', () => {
  const gears = field('gears');
  assert.ok(validateAttribute(gears, '2.5'), 'gears is a whole number');
  const length = field('lengthMeters');
  assert.equal(validateAttribute(length, '12.5'), undefined);
  assert.ok(validateAttribute(length, '12.555'), 'too many decimal places');
  assert.ok(validateAttribute(length, '.5'), 'must start with a digit');
  assert.ok(validateAttribute(length, '1,5'), 'comma is not a decimal point');
  assert.equal(keyboardFor(length), 'decimal-pad');
  const sqm = field('size', 'Size (sqm)');
  assert.equal(validateAttribute(sqm, '120.5'), undefined);
  assert.ok(validateAttribute(sqm, '120 sqm'));
});

test('text fields stay text — numeric rules are not applied to names, models or clothing sizes', () => {
  for (const key of ['brand', 'model', 'itemType', 'material', 'processor', 'storage', 'color', 'subject']) {
    for (const f of allFields().filter((x) => x.key === key && x.type === 'text')) {
      assert.equal(numericRuleFor(f), undefined, `${key} is not numeric`);
      assert.equal(validateAttribute(f, 'iPhone 15 Pro Max (A3108)/b'), undefined);
    }
  }
  const clothingSizes = allFields().filter((x) => x.key === 'size' && x.label === 'Size');
  assert.ok(clothingSizes.length > 0);
  for (const f of clothingSizes) {
    assert.equal(numericRuleFor(f), undefined);
    assert.equal(validateAttribute(f, 'XL'), undefined);
  }
  const model = field('model');
  assert.equal(validateAttribute(model, 'SM-A546B/DS'), undefined);
  assert.ok(validateAttribute(model, 'x'.repeat(ATTRIBUTE_TEXT_MAX_LENGTH + 1)), 'but length is bounded');
  assert.ok(validateAttribute(model, 'a\u0000b'), 'NUL / control characters rejected');
});

test('a select field only accepts its own options; a numeric rule never applies to selects', () => {
  const resolutionSelect = allFields().find((x) => x.key === 'resolution' && x.type === 'select')!;
  assert.equal(numericRuleFor(resolutionSelect), undefined);
  assert.equal(validateAttribute(resolutionSelect, '4K'), undefined);
  assert.ok(validateAttribute(resolutionSelect, '9999'));
  const ram = getCategoryFields('phones').find((f) => f.key === 'ram')!;
  assert.ok(validateAttribute(ram, '999GB'));
  for (const opt of ram.options!) assert.equal(validateAttribute(ram, opt), undefined);
});

// ── Title ───────────────────────────────────────────────────────────────────
test('title: required after trimming, bounded, no control characters, not truncated', () => {
  assert.ok(validateTitle(''));
  assert.ok(validateTitle('     '));
  assert.equal(validateTitle('  Used TV  '), undefined);
  assert.equal(validateTitle('TV'), undefined, 'short titles are legitimate');
  assert.ok(validateTitle('   '), 'whitespace-only is empty');
  assert.equal(validateTitle('x'.repeat(TITLE_MAX_LENGTH)), undefined);
  assert.match(validateTitle('x'.repeat(TITLE_MAX_LENGTH + 1))!, /at most 200/);
  assert.ok(validateTitle('Phone\nfor sale'));
  assert.ok(validateTitle('Phone\u0000'));
});

// ── Description ─────────────────────────────────────────────────────────────
test('description: any non-blank text is accepted — no arbitrary minimum length', () => {
  assert.equal(validateDescription('a'), undefined, 'a single character is enough');
  assert.equal(validateDescription('Good'), undefined);
  assert.equal(validateDescription('  ok  '), undefined);
  assert.ok(validateDescription(''));
  assert.ok(validateDescription('   \n\t  '), 'whitespace only is blank');
});

test('description: sensible maximum, multi-line allowed, never silently truncated', () => {
  assert.equal(validateDescription('line one\nline two\r\nline three'), undefined);
  assert.equal(validateDescription('x'.repeat(DESCRIPTION_MAX_LENGTH)), undefined);
  const tooLong = 'x'.repeat(DESCRIPTION_MAX_LENGTH + 1);
  assert.match(validateDescription(tooLong)!, /at most 5,000 characters \(currently 5,001\)/);
  assert.ok(validateDescription('bad\u0000char'));
  // surrounding whitespace is not counted towards the limit
  assert.equal(validateDescription(`  ${'x'.repeat(DESCRIPTION_MAX_LENGTH)}  `), undefined);
});

test('seller notes: optional, bounded', () => {
  assert.equal(validateSellerNotes(''), undefined);
  assert.equal(validateSellerNotes('Battery health 90%\nBox included'), undefined);
  assert.ok(validateSellerNotes('x'.repeat(SELLER_NOTES_MAX_LENGTH + 1)));
});

// ── Price / currency / condition ────────────────────────────────────────────
test('price: finite positive whole amount, validated as typed', () => {
  for (const ok of ['1', '1500', ' 1500 ', String(PRICE_MAX)]) assert.equal(validatePrice(ok), undefined, ok);
  for (const bad of ['', '   ', '0', '00', '-5', '12.5', '1,500', '1 500', 'abc', '12abc', '1e3', 'NaN', 'Infinity', '٣٠٠', String(PRICE_MAX + 1), '9'.repeat(30)]) {
    assert.ok(validatePrice(bad), `rejects ${JSON.stringify(bad)}`);
  }
});

test('currency and condition must be real values', () => {
  assert.equal(validateCurrency('ETB', ['ETB', 'USD']), undefined);
  assert.ok(validateCurrency('SOS', ['ETB', 'USD']), 'not offered at this place');
  assert.ok(validateCurrency('etb'));
  assert.ok(validateCurrency(undefined));
  assert.ok(validateCurrency('<script>'));
  for (const c of ['new', 'like-new', 'used', 'for-parts']) assert.equal(validateCondition(c), undefined);
  assert.ok(validateCondition(undefined));
  assert.ok(validateCondition('mint'));
});

// ── Category schemas ────────────────────────────────────────────────────────
test('every category and subcategory resolves to a schema whose fields are well-formed', () => {
  assert.ok(categories.length > 5);
  for (const c of categories) {
    const sets = [getCategoryFields(c.id), ...(c.subcategories ?? []).map((s) => getCategoryFields(c.id, s.name))];
    for (const fields of sets) {
      const keys = fields.map((f) => f.key);
      assert.equal(new Set(keys).size, keys.length, `${c.id}: duplicate field keys`);
      for (const f of fields) {
        if (f.type === 'select') assert.ok(f.options && f.options.length > 0, `${c.id}.${f.key} select has options`);
        assert.equal(new Set(f.options ?? []).size, (f.options ?? []).length, `${c.id}.${f.key} duplicate options`);
        // required fields can't be satisfied by blank, and a valid sample satisfies them
        if (f.required) assert.ok(validateAttribute(f, ''), `${c.id}.${f.key} required`);
      }
    }
  }
});

test('phones: required brand/model, battery percentage, RAM/storage selectors', () => {
  const phones = getCategoryFields('phones');
  assert.deepEqual(phones.filter((f) => f.required).map((f) => f.key), ['brand', 'model']);
  assert.deepEqual(validateAttributes(phones, {}), { brand: 'Brand is required.', model: 'Model is required.' });
  const errors = validateAttributes(phones, { brand: 'Samsung', model: 'A54', battery: '150', ram: '8GB', storage: '256GB' });
  assert.deepEqual(Object.keys(errors), ['battery']);
});

test('vehicles use their own fields (cars need a year, bajaj do not)', () => {
  const cars = getCategoryFields('vehicles', 'Cars');
  assert.ok(cars.some((f) => f.key === 'year' && f.required));
  assert.ok(validateAttributes(cars, { brand: 'Toyota', model: 'Corolla' }).year);
  assert.equal(validateAttribute(cars.find((f) => f.key === 'year')!, '2018', new Date('2026-06-01')), undefined);
  assert.ok(validateAttribute(cars.find((f) => f.key === 'year')!, '1850', new Date('2026-06-01')));
  assert.ok(validateAttribute(cars.find((f) => f.key === 'year')!, '2099', new Date('2026-06-01')));
  assert.ok(validateAttribute(cars.find((f) => f.key === 'mileage')!, '-100'));
  assert.equal(validateAttribute(cars.find((f) => f.key === 'mileage')!, '85000'), undefined);
});

test('switching category cannot leak the previous category’s specs or features', () => {
  const phoneAttrs = { brand: 'Samsung', model: 'A54', battery: '90', ram: '8GB', storage: '256GB', color: 'Blue', sim: 'Dual SIM' };
  const carFields = getCategoryFields('vehicles', 'Cars');
  const carAttrs = sanitizeAttributes(carFields, phoneAttrs);
  // Shared keys survive (Brand, Model, Color); phone-only specs are dropped.
  assert.deepEqual(carAttrs, { brand: 'Samsung', model: 'A54', color: 'Blue' });
  assert.equal('battery' in carAttrs, false);
  assert.equal('ram' in carAttrs, false);

  // A select value that the new schema doesn't offer is dropped, not carried over.
  const furnitureFields = getCategoryFields('furniture');
  assert.equal(sanitizeAttributes(furnitureFields, { color: 'Not-A-Colour' }).color, undefined);

  // Features: only what the new category offers.
  const phoneFeatures = getCategoryFeatures('phones', 'iPhone');
  assert.ok(phoneFeatures.includes('Face ID'));
  assert.deepEqual(sanitizeFeatures(getCategoryFeatures('vehicles', 'Cars'), ['Face ID', 'Sunroof', 'Sunroof']), ['Sunroof']);
});

test('sanitizeAttributes trims and drops blanks; injected unknown keys never survive', () => {
  const fields = getCategoryFields('phones');
  const out = sanitizeAttributes(fields, { brand: '  Tecno ', model: '   ', __proto__x: 'evil', isAdmin: 'true', battery: '88' } as Record<string, string>);
  assert.deepEqual(out, { brand: 'Tecno', battery: '88' });
});

// ── Whole-listing gate ──────────────────────────────────────────────────────
const goodDraft = () => ({
  photoCount: 3,
  category: 'phones',
  subcategory: 'Samsung',
  title: 'Samsung Galaxy A54 128GB',
  description: 'Clean phone.',
  condition: 'used',
  sellerNotes: '',
  city: 'Addis Ababa',
  price: '25000',
  currency: 'ETB',
  allowedCurrencies: ['ETB'],
  attributes: { brand: 'Samsung', model: 'A54', battery: '92' },
  fields: getCategoryFields('phones', 'Samsung'),
  categories,
});

test('validateListingDraft accepts a complete, valid listing', () => {
  const r = validateListingDraft(goodDraft());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.firstInvalidStep, undefined);
});

test('validateListingDraft re-checks every step and reports the earliest broken one', () => {
  const bad = { ...goodDraft(), photoCount: 0, price: 'abc', attributes: { brand: 'Samsung', model: 'A54', battery: '101' } };
  const r = validateListingDraft(bad);
  assert.equal(r.ok, false);
  assert.equal(r.firstInvalidStep, 'photos');
  assert.ok(r.errors.photos && r.errors.price && r.errors['attr:battery']);

  assert.equal(validateListingDraft({ ...goodDraft(), photoCount: 6 }).errors.photos, 'You can add up to 5 photos.');
  assert.equal(validateListingDraft({ ...goodDraft(), category: 'nope' }).firstInvalidStep, 'category');
  assert.ok(validateListingDraft({ ...goodDraft(), subcategory: 'Nokia-Not-A-Subcategory' }).errors.subcategory);
  assert.ok(validateListingDraft({ ...goodDraft(), subcategory: undefined }).errors.subcategory, 'a category that has subcategories needs one');
  assert.equal(validateListingDraft({ ...goodDraft(), condition: undefined }).firstInvalidStep, 'details');
  assert.equal(validateListingDraft({ ...goodDraft(), city: undefined }).firstInvalidStep, 'location');
  assert.equal(validateListingDraft({ ...goodDraft(), currency: 'USD' }).errors.currency !== undefined, true, 'currency not offered at the chosen place');
  assert.equal(validateListingDraft({ ...goodDraft(), description: '   ' }).firstInvalidStep, 'details');
  assert.ok(validateListingDraft({ ...goodDraft(), phoneError: 'Enter a valid phone number.' }).errors.phone);
});

test('a one-letter description publishes (no arbitrary minimum)', () => {
  assert.equal(validateListingDraft({ ...goodDraft(), description: 'x' }).ok, true);
});
