import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { categories } from '../data/categories';
import {
  fieldExamples,
  getCategoryFields,
  getTitleExample,
  getTitlePlaceholder,
  titleExampleKey,
  titleExamples,
  visibleFields,
} from '../data/categoryFields';
import {
  conditionApplies,
  conditionOptionsFor,
  isRentalListing,
  sanitizeAttributes,
  validateAttribute,
  validateAttributes,
  validateListingDraft,
  yearOptions,
} from '../data/sellRules';
import { fieldLabelText, fieldPlaceholderText, numericHintText, optionText, titlePlaceholderText, textKey, type Translate } from '../lib/sellText';

const root = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const locale = (lang: string) => JSON.parse(read(`locales/${lang}/translation.json`));

// A stand-in for i18next's t(): dotted-path lookup, {{x}} interpolation, defaultValue fallback.
function makeT(lang: string): Translate {
  const json = locale(lang);
  return (key, options = {}) => {
    let node: unknown = json;
    for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
    const raw = typeof node === 'string' ? node : (options.defaultValue as string | undefined) ?? key;
    return raw.replace(/\{\{(\w+)\}\}/g, (_, name) => String(options[name] ?? ''));
  };
}

const allScopes = categories.flatMap((c) => (c.subcategories?.length ? c.subcategories.map((s) => ({ category: c.id, subcategory: s.name })) : [{ category: c.id, subcategory: undefined as string | undefined }]));
const NOW = new Date(2026, 9, 22);

// ───────────────────────── Title examples ─────────────────────────

test('every category/subcategory has its own title example, never a borrowed one', () => {
  assert.ok(allScopes.length > 100, 'the whole taxonomy is covered');
  for (const { category, subcategory } of allScopes) {
    const own = subcategory ? `${category}/${subcategory}` : category;
    assert.equal(titleExampleKey(category, subcategory), own, `${own} falls back to another category's example`);
  }
  // no two subcategories of different categories share an example (a copied placeholder)
  const seen = new Map<string, string>();
  for (const [key, text] of Object.entries(titleExamples)) {
    const category = key.split('/')[0];
    // brand-only phone examples are intentionally per brand; the fallback entry for "phones" equals the Samsung one
    if (key === 'phones') continue;
    const other = seen.get(text);
    assert.ok(!other || other.split('/')[0] === category, `${key} reuses the example of ${other}`);
    seen.set(text, key);
  }
});

test('title examples match the subcategory they describe', () => {
  assert.equal(getTitleExample('vehicles', 'Cars'), 'Toyota Corolla 2018, Automatic');
  assert.equal(getTitleExample('phones', 'Samsung'), 'Samsung Galaxy A55, 256 GB');
  assert.equal(getTitleExample('baby', 'Baby Gear'), 'Foldable baby stroller');
  assert.equal(getTitleExample('property', 'House for Rent'), '2-bedroom house for rent in 01');
  assert.equal(getTitleExample('property', 'Single Room for Rent'), 'Single room for rent in 01');
  assert.equal(getTitleExample('property', 'Land'), 'Residential land for sale in 01');
  // changing subcategory changes the example immediately
  assert.notEqual(getTitleExample('vehicles', 'Cars'), getTitleExample('phones', 'Samsung'));
  assert.notEqual(getTitleExample('property', 'Land'), getTitleExample('property', 'House for Rent'));
  assert.equal(getTitlePlaceholder('vehicles', 'Cars'), 'e.g. Toyota Corolla 2018, Automatic');
});

test('food examples are food, never music or a song, and never leak into other categories', () => {
  const food = Object.entries(titleExamples).filter(([k]) => k.startsWith('food/'));
  assert.ok(food.length >= 6);
  for (const [, text] of food) assert.ok(!/song|music|album|singer/i.test(text), text);
  for (const [k, text] of Object.entries(titleExamples)) {
    if (!k.startsWith('food/')) assert.ok(!/song|music|album|singer/i.test(text), `${k}: ${text}`);
  }
  for (const lang of ['en', 'so', 'am']) {
    for (const [k, text] of Object.entries(locale(lang).post.titleExamples as Record<string, string>)) assert.ok(!/song|music|album|singer|muusik|ዘፈን|ሙዚቃ/i.test(text), `${lang} ${k}`);
  }
});

test('property examples never contain product wording and the generic fallback is neutral', () => {
  for (const [k, text] of Object.entries(titleExamples)) {
    if (k.startsWith('property/')) assert.ok(!/phone|samsung|galaxy|iphone/i.test(text), `${k}: ${text}`);
  }
  assert.ok(!/samsung|phone|music|song/i.test(getTitleExample(undefined, undefined)));
  assert.ok(!/samsung|phone/i.test(getTitleExample('nonexistent', 'whatever')));
});

// ───────────────────── English / Somali / Amharic ─────────────────────

test('title examples exist in English, Somali and Amharic for every subcategory', () => {
  const keys = Object.keys(titleExamples).sort();
  for (const lang of ['en', 'so', 'am']) {
    const entries = locale(lang).post.titleExamples as Record<string, string>;
    assert.deepEqual(Object.keys(entries).sort(), keys, `${lang} title examples differ from the schema`);
    for (const [k, v] of Object.entries(entries)) assert.ok(typeof v === 'string' && v.trim().length > 0, `${lang} ${k} is empty`);
  }
  // wording that has to be translated really is (brand/model-only examples may stay identical)
  const en = locale('en').post.titleExamples as Record<string, string>;
  for (const lang of ['so', 'am']) {
    const tr = locale(lang).post.titleExamples as Record<string, string>;
    for (const k of ['property/House for Rent', 'property/Single Room for Rent', 'property/Land', 'food/Groceries', 'baby/Baby Gear', 'jobs/Driver Jobs', 'services/Plumber']) {
      assert.notEqual(tr[k], en[k], `${lang} ${k} was not translated`);
    }
  }
  assert.ok(locale('so').post.titleExamples['property/House for Rent'].includes('kiro'));
  assert.ok(locale('am').post.titleExamples['property/House for Rent'].includes('ለኪራይ'));
});

test('the title placeholder follows the active language and falls back to English', () => {
  assert.equal(titlePlaceholderText(makeT('en'), 'property', 'Single Room for Rent'), 'e.g. Single room for rent in 01');
  assert.equal(titlePlaceholderText(makeT('so'), 'property', 'Single Room for Rent'), 'tusaale: Qol keliya oo kiro ah, Degmada 01');
  assert.ok(titlePlaceholderText(makeT('am'), 'property', 'Single Room for Rent').startsWith('ለምሳሌ፦ '));
  const missing: Translate = (key, o = {}) => (o.defaultValue as string) ?? key; // a language with no entries at all
  assert.equal(titlePlaceholderText(missing, 'vehicles', 'Cars'), 'e.g. Toyota Corolla 2018, Automatic');
});

test('field labels, options and examples are translated, and fall back to English', () => {
  const rent = getCategoryFields('property', 'House for Rent').find((f) => f.key === 'rentPeriod')!;
  assert.equal(fieldLabelText(makeT('en'), rent), 'Rent is paid');
  assert.equal(fieldLabelText(makeT('so'), rent), 'Kirada waxaa la bixiyaa');
  assert.equal(fieldLabelText(makeT('am'), rent), 'ኪራይ የሚከፈለው');
  assert.equal(optionText(makeT('so'), 'Per month'), 'Bil kasta');
  assert.equal(optionText(makeT('am'), 'Not sure'), 'እርግጠኛ አይደለሁም');
  assert.equal(optionText(makeT('so'), 'Some option nobody translated'), 'Some option nobody translated');
  const address = getCategoryFields('property', 'Single Room for Rent').find((f) => f.key === 'address')!;
  assert.equal(fieldPlaceholderText(makeT('en'), address), 'e.g. House 12, District 01');
  assert.equal(fieldPlaceholderText(makeT('so'), address), 'tusaale: Guriga 12, Degmada 01');
  // every translation group has the same keys in all three languages
  for (const group of ['fieldLabels', 'fieldHints', 'fieldOptions', 'examples']) {
    const keys = Object.keys(locale('en').post[group]).sort();
    assert.ok(keys.length > 0, group);
    for (const lang of ['so', 'am']) assert.deepEqual(Object.keys(locale(lang).post[group]).sort(), keys, `${lang} post.${group}`);
  }
  for (const lang of ['en', 'so', 'am']) {
    const post = locale(lang).post;
    for (const k of ['exampleWrap', 'requiredNote', 'titleExampleDefault']) assert.ok(post.details[k], `${lang} post.details.${k}`);
    for (const k of ['rentLabel', 'rentHint']) assert.ok(post.price[k], `${lang} post.price.${k}`);
    assert.ok(post.details.exampleWrap.includes('{{example}}'));
  }
});

test('every translated label/option/example key is one i18next can look up (no "." or ":")', () => {
  for (const lang of ['en', 'so', 'am']) {
    for (const group of ['fieldLabels', 'fieldHints', 'fieldOptions', 'examples']) {
      for (const key of Object.keys(locale(lang).post[group])) assert.ok(!/[.:]/.test(key), `${lang} post.${group}.${key}`);
    }
  }
  assert.equal(textKey('Optional — leave blank if you are not sure.'), 'Optional — leave blank if you are not sure');
  // the rent-related options and labels the property forms use all have translations
  const t = makeT('so');
  for (const scope of ['House for Rent', 'Apartment for Rent', 'Single Room for Rent']) {
    for (const f of getCategoryFields('property', scope)) {
      if (['neighborhood', 'address', 'landmark', 'rentPeriod', 'electricity', 'water', 'furnished', 'availability', 'bedrooms', 'bathrooms', 'bathroomType', 'utilitiesIncluded', 'leaseTerm', 'parking'].includes(f.key)) {
        assert.notEqual(fieldLabelText(t, f), f.label, `Somali label missing for ${scope}/${f.key}`);
        for (const opt of f.options ?? []) if (!/^\d/.test(opt)) assert.notEqual(optionText(t, opt), opt, `Somali option missing: ${opt}`);
      }
    }
  }
});

test('every free-text field has a concrete example for its own subcategory, not just its label', () => {
  for (const { category, subcategory } of allScopes) {
    for (const f of getCategoryFields(category, subcategory)) {
      if (f.type === 'text') assert.ok(f.placeholder, `${category}/${subcategory} › ${f.key} has no example`);
    }
  }
  // brand examples follow the subcategory: a Samsung is never suggested while listing an iPhone or a motorcycle
  assert.equal(getCategoryFields('phones', 'iPhone').find((f) => f.key === 'brand')!.placeholder, 'Apple');
  assert.equal(getCategoryFields('phones', 'Tecno').find((f) => f.key === 'brand')!.placeholder, 'Tecno');
  assert.equal(getCategoryFields('vehicles', 'Motorcycles').find((f) => f.key === 'brand')!.placeholder, 'Honda');
  assert.equal(getCategoryFields('kitchen', 'Appliances').find((f) => f.key === 'brand')!.placeholder, 'Hisense');
  // every example scope names a real category (or category/subcategory)
  for (const scope of Object.keys(fieldExamples)) {
    const [cat, sub] = scope.split('/');
    const category = categories.find((c) => c.id === cat);
    assert.ok(category && (!sub || category.subcategories?.some((s) => s.name === sub)), `fieldExamples has an unknown scope ${scope}`);
  }
});

// ─────────────────────── Condition vs rental details ───────────────────────

test('item condition only applies where it makes sense', () => {
  for (const sub of ['House for Sale', 'House for Rent', 'Apartment for Rent', 'Single Room for Rent', 'Land', 'Shop', 'Office', 'Warehouse', 'Guest House / Villa']) {
    assert.deepEqual([...conditionOptionsFor('property', sub)], [], sub);
    assert.equal(conditionApplies('property', sub), false);
  }
  for (const [c, s] of [['food', 'Groceries'], ['food', 'Bakery'], ['animals', 'Pets'], ['animals', 'Livestock'], ['jobs', 'Driver Jobs'], ['services', 'Plumber'], ['agriculture', 'Livestock'], ['agriculture', 'Seeds & Crops']] as const) {
    assert.equal(conditionApplies(c, s), false, `${c}/${s}`);
  }
  // physical products keep the full set, vehicles and baby gear unchanged
  const full = ['new', 'like-new', 'used', 'for-parts'];
  for (const [c, s] of [['vehicles', 'Cars'], ['vehicles', 'Trucks'], ['vehicles', 'Spare Parts'], ['phones', 'Samsung'], ['electronics', 'Laptops'], ['furniture', 'Sofas'], ['baby', 'Baby Gear'], ['business', 'Generators'], ['kitchen', 'Appliances']] as const) {
    assert.deepEqual([...conditionOptionsFor(c, s)], full, `${c}/${s}`);
  }
  // "Needs repair" is not offered for things that are not repaired
  for (const [c, s] of [['fashion', 'Shoes'], ['beauty', 'Skincare'], ['books', 'Novels'], ['baby', 'Clothing'], ['kitchen', 'Utensils'], ['construction', 'Cement & Blocks']] as const) {
    assert.deepEqual([...conditionOptionsFor(c, s)], ['new', 'like-new', 'used'], `${c}/${s}`);
  }
  // nothing was invented: every category still resolves to a defined set
  for (const { category, subcategory } of allScopes) assert.ok(conditionOptionsFor(category, subcategory) !== undefined);
});

const baseDraft = (over: Partial<Parameters<typeof validateListingDraft>[0]>) => ({
  photoCount: 1,
  title: 'Test',
  description: 'Test',
  city: 'Mogadishu',
  price: '300',
  currency: 'USD',
  attributes: {} as Record<string, string>,
  categories,
  ...over,
} as Parameters<typeof validateListingDraft>[0]);

test('a rental is valid without a product condition; a product still needs one', () => {
  const rental = baseDraft({ category: 'property', subcategory: 'Single Room for Rent', attributes: { rentPeriod: 'Per month', address: 'Room 3, District 01' }, fields: getCategoryFields('property', 'Single Room for Rent') });
  assert.equal(validateListingDraft(rental).ok, true);

  const phone = baseDraft({ category: 'phones', subcategory: 'Samsung', attributes: { brand: 'Samsung', model: 'A55' }, fields: getCategoryFields('phones', 'Samsung') });
  const missing = validateListingDraft(phone);
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.condition);
  assert.equal(validateListingDraft({ ...phone, condition: 'used' }).ok, true);

  // a condition from a previous category that this one does not offer is rejected, not silently kept
  const shoes = baseDraft({ category: 'fashion', subcategory: 'Shoes', attributes: { size: '42' }, condition: 'for-parts', fields: getCategoryFields('fashion', 'Shoes') });
  assert.ok(validateListingDraft(shoes).errors.condition);
  assert.equal(validateListingDraft({ ...shoes, condition: 'like-new' }).ok, true);

  const food = baseDraft({ category: 'food', subcategory: 'Groceries', attributes: { itemType: 'Rice' }, fields: getCategoryFields('food', 'Groceries') });
  assert.equal(validateListingDraft(food).ok, true);
});

test('rental forms ask rent questions, not product-condition questions', () => {
  for (const sub of ['House for Rent', 'Apartment for Rent', 'Single Room for Rent']) {
    const keys = getCategoryFields('property', sub).map((f) => f.key);
    for (const k of ['rentPeriod', 'electricity', 'water', 'furnished', 'address', 'landmark', 'neighborhood', 'availability']) assert.ok(keys.includes(k), `${sub} › ${k}`);
    assert.ok(!keys.includes('condition'));
    assert.ok(!keys.includes('titleDeed'), `${sub} should not ask about a title deed`);
  }
});

// ───────────────────── Property: single room, utilities, address ─────────────────────

test('a single room does not ask for bedrooms, parking or size', () => {
  const room = getCategoryFields('property', 'Single Room for Rent');
  const keys = room.map((f) => f.key);
  for (const k of ['bedrooms', 'parking', 'size', 'floor']) assert.ok(!keys.includes(k), k);
  assert.ok(room.every((f) => !f.required), 'nothing in a single-room listing is mandatory except the rent period for new listings');
  assert.ok(categories.find((c) => c.id === 'property')!.subcategories!.some((s) => s.name === 'Single Room for Rent'));
  assert.equal(isRentalListing('property', 'Single Room for Rent'), true);
  assert.equal(isRentalListing('property', 'House for Sale'), false);
  assert.equal(isRentalListing('property', 'Shop', { offer: 'For rent' }), true);
  assert.equal(isRentalListing('property', 'Shop', { offer: 'For sale' }), false);
  assert.equal(isRentalListing('phones', 'Samsung', { offer: 'For rent' }), false);
});

test('electricity and water accept Available / Not available / Not sure and are never mandatory', () => {
  for (const sub of ['House for Rent', 'Single Room for Rent', 'Apartment for Sale']) {
    for (const key of ['electricity', 'water']) {
      const f = getCategoryFields('property', sub).find((x) => x.key === key)!;
      assert.deepEqual(f.options, ['Available', 'Not available', 'Not sure']);
      assert.ok(!f.required);
      assert.equal(validateAttribute(f, ''), undefined);
      assert.equal(validateAttribute(f, 'Not sure'), undefined);
      assert.ok(validateAttribute(f, 'Maybe'));
    }
  }
});

test('address is required for new property listings (free text, no street name, no GPS); landmark stays optional', () => {
  for (const sub of ['House for Rent', 'Single Room for Rent', 'Land', 'Shop']) {
    const address = getCategoryFields('property', sub).find((f) => f.key === 'address')!;
    const landmark = getCategoryFields('property', sub).find((f) => f.key === 'landmark')!;
    assert.equal(address.label, 'Address / exact location');
    assert.equal(landmark.label, 'Directions / nearby landmark');
    assert.ok(!address.required && address.requiredForNew && !landmark.required && !landmark.requiredForNew);
    assert.ok(validateAttribute(address, '', new Date(), true)); // required when creating
    assert.equal(validateAttribute(address, ''), undefined); // editing an older listing is never blocked
    assert.equal(validateAttribute(address, 'House 12, District 01'), undefined); // no street required
    assert.equal(validateAttribute(address, 'x'.repeat(150)), undefined);
    assert.ok(validateAttribute(address, 'x'.repeat(151)));
    assert.equal(validateAttribute(landmark, 'x'.repeat(200)), undefined);
    assert.ok(validateAttribute(landmark, 'x'.repeat(201)));
  }
  // manual address entry never asks for a location permission
  for (const f of ['app/post/details.tsx', 'components/DynamicField.tsx', 'web/src/components/SellField.tsx']) {
    assert.ok(!/geolocation|expo-location|requestForegroundPermissions/.test(read(f)), `${f} requests location access`);
  }
});

test('the rent period is required for a new rental, optional when editing an older listing', () => {
  const fields = getCategoryFields('property', 'House for Rent');
  const home = { rentalKind: 'Empty home', bedrooms: '2' };
  assert.ok(validateAttributes(fields, home, NOW, true).rentPeriod);
  assert.equal(validateAttributes(fields, home, NOW, false).rentPeriod, undefined);
  assert.deepEqual(validateAttributes(fields, { ...home, rentPeriod: 'Per month', address: 'House 12' }, NOW, true), {});
  assert.ok(validateAttributes(fields, { ...home, rentPeriod: 'Per month' }, NOW, true).address, 'a new rental needs an address');
  assert.equal(validateAttributes(fields, { ...home, rentPeriod: 'Per month' }, NOW, false).address, undefined);
  assert.ok(validateAttributes(fields, { bedrooms: '2', rentPeriod: 'Per month', address: 'House 12' }, NOW, true).rentalKind, 'a new home rental says what is rented');
  assert.equal(validateAttributes(fields, { bedrooms: '2' }, NOW, false).rentalKind, undefined, 'editing an older rental is not blocked');
});

test('sale versus rent: commercial property shows only the matching questions', () => {
  const shop = getCategoryFields('property', 'Shop');
  const keysFor = (attrs: Record<string, string>) => visibleFields(shop, attrs).map((f) => f.key);
  assert.ok(!keysFor({}).includes('rentPeriod') && !keysFor({}).includes('titleDeed'));
  assert.ok(keysFor({ offer: 'For rent' }).includes('rentPeriod'));
  assert.ok(!keysFor({ offer: 'For rent' }).includes('titleDeed'));
  assert.ok(keysFor({ offer: 'For sale' }).includes('titleDeed'));
  assert.ok(!keysFor({ offer: 'For sale' }).includes('rentPeriod'));

  // for rent: the period is required; for sale it is neither asked nor saved
  assert.ok(validateAttributes(shop, { size: '40', offer: 'For rent' }, NOW, true).rentPeriod);
  assert.deepEqual(validateAttributes(shop, { size: '40', offer: 'For sale', address: 'Shop 5' }, NOW, true), {});
  assert.ok(validateAttributes(shop, { size: '40' }, NOW, true).offer, 'a new shop listing says whether it is for sale or rent');
  assert.equal(validateAttributes(shop, { size: '40' }, NOW, false).offer, undefined, 'but editing an older shop listing is not blocked');
  assert.deepEqual(sanitizeAttributes(shop, { size: '40', offer: 'For sale', rentPeriod: 'Per month', titleDeed: 'Yes' }), { size: '40', offer: 'For sale', titleDeed: 'Yes' });
  assert.deepEqual(sanitizeAttributes(shop, { size: '40', offer: 'For rent', rentPeriod: 'Per month', titleDeed: 'Yes' }), { size: '40', offer: 'For rent', rentPeriod: 'Per month' });

  // land, shop, office, warehouse, guest house keep their own fields rather than residential ones
  const keys = (sub: string) => getCategoryFields('property', sub).map((f) => f.key);
  assert.ok(keys('Land').includes('landType') && !keys('Land').includes('bedrooms'));
  assert.ok(keys('Warehouse').includes('loadingDock') && !keys('Warehouse').includes('bedrooms'));
  assert.ok(keys('Shop').includes('floor') && !keys('Shop').includes('bedrooms'));
  assert.ok(keys('Guest House / Villa').includes('bedrooms') && keys('Guest House / Villa').includes('pool'));
  assert.deepEqual(getCategoryFields('property', 'Guest House / Villa').find((f) => f.key === 'rentPeriod')!.options, ['Per night', 'Per week', 'Per month']);
  // sale forms lead with ownership, not rent
  assert.ok(keys('House for Sale').includes('titleDeed') && !keys('House for Sale').includes('rentPeriod'));
});

test('listings saved with the older property forms still validate and keep their answers', () => {
  const legacyRent = { bedrooms: '2', bathrooms: '1', size: '80', furnished: 'Yes', parking: 'No', leaseTerm: 'Yearly', utilitiesIncluded: 'Yes', neighborhood: 'Hodan' };
  const fields = getCategoryFields('property', 'House for Rent');
  assert.deepEqual(validateAttributes(fields, legacyRent, NOW, false), {});
  assert.deepEqual(sanitizeAttributes(fields, legacyRent), legacyRent);
  const legacyLand = { size: '500', unit: 'sqm', landType: 'Residential', titleDeed: 'Yes', roadAccess: 'No', water: 'Yes', electricity: 'No' };
  const land = getCategoryFields('property', 'Land');
  assert.deepEqual(validateAttributes(land, { ...legacyLand, address: 'Plot 4' }, NOW, true), {});
  assert.deepEqual(validateAttributes(land, legacyLand, NOW, false), {});
  assert.deepEqual(sanitizeAttributes(land, legacyLand), legacyLand);
});

// ───────────────────────── Vehicles ─────────────────────────

test('the car form keeps its useful fields in the same order', () => {
  assert.deepEqual(
    getCategoryFields('vehicles', 'Cars').map((f) => f.key),
    ['offer', 'rentPeriod', 'brand', 'model', 'year', 'mileage', 'transmission', 'fuel', 'engineSize', 'drivetrain', 'color', 'seats', 'registration', 'importStatus']
  );
  const byKey = Object.fromEntries(getCategoryFields('vehicles', 'Cars').map((f) => [f.key, f]));
  assert.equal(byKey.mileage.label, 'Mileage (km)');
  assert.deepEqual(byKey.transmission.options, ['Automatic', 'Manual']);
  assert.deepEqual(byKey.fuel.options, ['Petrol', 'Diesel', 'Hybrid', 'Electric']);
  assert.deepEqual(byKey.drivetrain.options, ['FWD', 'RWD', '4WD', 'AWD']);
  assert.deepEqual(byKey.importStatus.options, ['Locally used', 'Imported']);
  assert.equal(byKey.brand.placeholder, 'Toyota');
  assert.equal(byKey.model.placeholder, 'Corolla');
  // only what every seller knows is required
  assert.deepEqual(getCategoryFields('vehicles', 'Cars').filter((f) => f.required).map((f) => f.key), ['brand', 'model', 'year']);
});

test('engine size is optional and shows a plain example', () => {
  for (const sub of ['Cars', 'SUVs']) {
    const engine = getCategoryFields('vehicles', sub).find((f) => f.key === 'engineSize')!;
    assert.equal(engine.type, 'text');
    assert.ok(!engine.required && !engine.requiredForNew);
    assert.equal(engine.placeholder, sub === 'Cars' ? '1.6 L' : '2.7 L');
    assert.match(engine.hint ?? '', /Optional/);
    assert.equal(validateAttribute(engine, ''), undefined);
    assert.equal(validateAttribute(engine, '1.6 L'), undefined);
    assert.equal(validateAttribute(engine, '1.5L'), undefined, 'values saved by the old chip list are still valid');
  }
  const car = baseDraft({ category: 'vehicles', subcategory: 'Cars', condition: 'used', attributes: { offer: 'For sale', brand: 'Toyota', model: 'Corolla', year: '2018' }, fields: getCategoryFields('vehicles', 'Cars') });
  assert.equal(validateListingDraft(car).ok, true, 'a car can be published without engine size, mileage or any other optional spec');
  assert.ok(validateListingDraft({ ...car, attributes: { brand: 'Toyota', model: 'Corolla', year: '2018' } }).errors['attr:offer'], 'a new car says whether it is for sale or for rent');
});

test('the year list includes this year and next year, and no year is pre-selected', () => {
  const years = yearOptions(NOW);
  assert.equal(years[0], '2027');
  assert.ok(years.includes('2026'));
  assert.equal(years[years.length - 1], '1950');
  assert.equal(new Set(years).size, years.length);
  assert.equal(yearOptions(new Date(2030, 0, 1))[0], '2031', 'not a hard-coded range');

  const year = getCategoryFields('vehicles', 'Cars').find((f) => f.key === 'year')!;
  assert.equal(validateAttribute(year, '2026', NOW), undefined);
  assert.equal(validateAttribute(year, '2027', NOW), undefined);
  assert.ok(validateAttribute(year, '2028', NOW));
  assert.ok(validateAttribute(year, '', NOW), 'the year is required, so it cannot be left unchosen');

  // the picker only scrolls to the current year; it never writes one into the draft
  assert.match(read('components/YearPicker.tsx'), /yearOptions\(\)/);
  assert.ok(!/useState\(\s*String\(CURRENT_YEAR\)/.test(read('components/YearPicker.tsx')));
  assert.match(read('web/src/components/SellField.tsx'), /yearOptions\(\)/);
  assert.match(read('store/postDraft.ts'), /attributes: \{\}/);
});

// ─────────────────────── Scrolling, no scrollbar indicator ───────────────────────

test('no Sell step on mobile shows a scroll indicator, and none disables scrolling', () => {
  const files = ['app/post/index.tsx', 'app/post/category.tsx', 'app/post/details.tsx', 'app/post/location.tsx', 'app/post/price.tsx', 'app/post/preview.tsx', 'app/post/success.tsx', 'components/LocationList.tsx', 'components/YearPicker.tsx'];
  let lists = 0;
  for (const f of files) {
    const src = read(f);
    // (a generic such as useRef<ScrollView> is not a rendered list). The tag ends at the first ">" outside any {...} — attributes contain "=>" and ">" comparisons.
    for (const m of src.matchAll(/(?<![\w>])<(ScrollView|FlatList|SectionList|DraggableFlatList)\b/g)) {
      lists++;
      let depth = 0;
      let i = m.index! + m[0].length;
      for (; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        else if (ch === '>' && depth === 0) break;
      }
      const tag = src.slice(m.index!, i);
      const horizontal = /\bhorizontal\b/.test(tag);
      assert.ok(
        horizontal ? /showsHorizontalScrollIndicator=\{false\}/.test(tag) : /showsVerticalScrollIndicator=\{false\}/.test(tag),
        `${f}: <${m[1]}> still shows its scroll indicator`
      );
      assert.ok(!/scrollEnabled=\{false\}/.test(tag), `${f}: <${m[1]}> has scrolling disabled`);
    }
  }
  assert.ok(lists >= 9, `expected to inspect every scroll container, saw ${lists}`);
  // the step screens still scroll their content
  for (const f of ['app/post/index.tsx', 'app/post/details.tsx', 'app/post/price.tsx', 'app/post/preview.tsx']) assert.match(read(f), /<ScrollView/);
  for (const f of ['app/post/category.tsx', 'components/LocationList.tsx']) assert.match(read(f), /<FlatList/);
});

test('the web Sell flow hides the scrollbar without disabling scrolling', () => {
  const page = read('web/src/app/sell/page.tsx');
  assert.match(page, /documentElement/);
  assert.match(page, /classList\.add\('no-scrollbar'\)/);
  assert.match(page, /classList\.remove\('no-scrollbar'\)/, 'the class is removed again when leaving the Sell flow');
  assert.ok(!/overflow-hidden|overflow:\s*hidden|overscroll-none/.test(read('web/src/app/globals.css').split('.no-scrollbar')[1]?.split('}')[0] ?? ''), '.no-scrollbar must not turn scrolling off');
  const css = read('web/src/app/globals.css');
  assert.match(css, /\.no-scrollbar::-webkit-scrollbar\s*\{\s*display:\s*none/);
  assert.match(css, /scrollbar-width:\s*none/);
  const picker = read('web/src/components/LocationPicker.tsx');
  assert.match(picker, /no-scrollbar[^"]*overflow-y-auto/, 'the nested city list is still scrollable, just without a bar');
  assert.ok(!/<(div|section)[^>]*(overflow-hidden)[^>]*>\s*\{?\s*step/.test(page));
});

// ───────────────────── Draft persistence, payload compatibility, parity ─────────────────────

test('draft persistence keeps its storage key and the condition/attribute fields', () => {
  const draft = read('store/postDraft.ts');
  assert.match(draft, /name: 'suuqplus\.postDraft\.v1'/, 'renaming the key would orphan every saved draft');
  assert.match(draft, /condition\?: 'new' \| 'like-new' \| 'used' \| 'for-parts'/);
  assert.match(draft, /attributes: Record<string, string>/);
  assert.match(draft, /partialize/);
});

test('publishing stores no item condition where none applies, and keeps the same payload shape elsewhere', () => {
  assert.match(read('store/myListings.ts'), /condition: conditionApplies\(listing\.category, listing\.subcategory\) \? listing\.condition : null/);
  assert.match(read('web/src/services/listings.ts'), /condition: conditionApplies\(input\.category, input\.subcategory\) \? input\.condition \?\? null : null/);
  // the database column is nullable and its constraint already allows null
  assert.match(read('supabase/migrations/0001_init.sql'), /condition text,/);
  assert.match(read('supabase/migrations/0049_sell_server_validation.sql'), /condition is null or condition in/);
  // edit screens (mobile + web) leave the stored condition alone where none applies
  assert.match(read('app/listing/edit/[id].tsx'), /conditionChoices\.length > 0 \? \{ condition \} : \{\}/);
  assert.match(read('web/src/app/listing/edit/[id]/page.tsx'), /conditionChoices\.length > 0 \? \{ condition \} : \{\}/);
  // detail pages do not show an invented "Used" for a house
  assert.match(read('app/listing/[id].tsx'), /conditionApplies\(listing\.category, listing\.subcategory\)/);
  assert.match(read('web/src/app/listing/[id]/page.tsx'), /conditionApplies\(listing\.category, listing\.subcategory\)/);
});

test('mobile and web both use the category-specific example and conditional condition field', () => {
  const web = read('web/src/app/sell/page.tsx');
  assert.ok(!/Samsung Galaxy A54/.test(web), 'the web title field must not hard-code a phone example');
  assert.match(web, /titlePlaceholderText\(t, /);
  assert.match(web, /conditionOptionsFor\(/);
  assert.match(web, /visibleFields\(/);
  assert.match(web, /validateAttributes\(allFields, attributes, new Date\(\), true\)/);
  const mobile = read('app/post/details.tsx');
  assert.match(mobile, /titlePlaceholderText\(t, category, subcategory\)/);
  assert.match(mobile, /conditionOptionsFor\(/);
  assert.match(mobile, /visibleFields\(/);
  assert.match(mobile, /validateAttributes\(allFields, attributes, new Date\(\), true\)/);
  // both publish gates run the same rules
  assert.match(read('app/post/preview.tsx'), /validateListingDraft\(/);
  assert.match(web, /validateListingDraft\(/);
  // the numeric 0-100 "quality" style input does not exist in any Sell step; battery health is an optional phone spec
  const battery = getCategoryFields('phones', 'iPhone').find((f) => f.key === 'battery')!;
  assert.ok(battery && !battery.required);
  for (const f of ['app/post/details.tsx', 'web/src/app/sell/page.tsx', 'components/DynamicField.tsx']) assert.ok(!/quality/i.test(read(f)), `${f} mentions a quality score`);
});

// Brand names, model codes, technical abbreviations and plain numbers are written the same in every language.
const NEUTRAL = new Set(['RAM', 'SIM', 'Processor', 'Graphics', 'Smart TV', 'Resolution (MP)', 'FWD', 'RWD', '4WD', 'AWD', 'CNG', '3G', '4G', '5G', 'eSIM', 'HD', 'Full HD', '4K', '8K', 'DSLR', 'Mirrorless', 'Point & Shoot', 'Action Camera', 'PlayStation', 'Xbox', 'Nintendo Switch', 'PC', 'Bluetooth', 'Wi-Fi + Cellular', 'Inkjet', 'Laser', 'Dot Matrix', 'USB', 'Wi-Fi', 'Quartz', 'Smartwatch', 'Queen', 'King', 'kg', 'PVC', 'BMX', 'UPS']);
const isNumberLike = (s: string) => /^[\d.+"]/.test(s);

test('every label and every choice shown on the Sell form has a Somali and an Amharic translation', () => {
  const labels = new Set<string>();
  const options = new Set<string>();
  for (const { category, subcategory } of allScopes) {
    for (const f of getCategoryFields(category, subcategory)) {
      labels.add(f.label);
      for (const o of f.options ?? []) options.add(o);
    }
  }
  assert.ok(labels.size > 100 && options.size > 200);
  for (const lang of ['so', 'am']) {
    const post = locale(lang).post;
    const en = locale('en').post;
    for (const l of labels) if (!NEUTRAL.has(l)) assert.ok(post.fieldLabels[textKey(l)], `${lang}: no translation for the label "${l}"`);
    for (const o of options) if (!NEUTRAL.has(o) && !isNumberLike(o)) assert.ok(post.fieldOptions[textKey(o)], `${lang}: no translation for the choice "${o}"`);
    // a translation that merely repeats the English is only acceptable for loanwords written the same way
    const same = Object.entries(post.fieldLabels).filter(([k, v]) => v === en.fieldLabels[k]).map(([k]) => k);
    assert.ok(same.length <= 6, `${lang}: labels left in English: ${same.join(', ')}`);
  }
});

test('numeric range hints and validation hints are translated', () => {
  const rule = { kind: 'integer' as const, min: 0, max: 2000000 };
  assert.equal(numericHintText(makeT('en'), rule), 'Whole number from 0 to 2,000,000.');
  assert.equal(numericHintText(makeT('so'), rule), 'Tiro dhan oo u dhexaysa 0 iyo 2,000,000.');
  assert.equal(numericHintText(makeT('am'), rule), 'ከ0 እስከ 2,000,000 ያለ ሙሉ ቁጥር።');
  assert.match(numericHintText(makeT('so'), { kind: 'decimal', min: 1, max: 20, decimals: 2 }), /2 meel tobanle/);
  assert.match(numericHintText(makeT('am'), { kind: 'percent', min: 0, max: 100 }), /መቶኛ/);
});

test('job and listing wording uses the phrasing sellers actually write', () => {
  const so = locale('so').post.titleExamples as Record<string, string>;
  const am = locale('am').post.titleExamples as Record<string, string>;
  for (const k of Object.keys(so).filter((x) => x.startsWith('jobs/') && !/NGO/.test(x))) assert.ok(so[k].startsWith('Waxaa loo baahan yahay'), k);
  for (const k of Object.keys(am).filter((x) => x.startsWith('jobs/') && !/NGO/.test(x))) assert.ok(am[k].endsWith('ያስፈልጋል'), k);
  assert.ok(am['property/Apartment for Rent'].includes('አፓርታማ'));
  assert.ok(am['property/House for Rent'].includes('ቀበሌ 01'));
  assert.equal(locale('am').post.fieldLabels.Electricity, 'መብራት');
});

// ─────────────────────── Publish does not invent a condition ───────────────────────

test('mobile publish only carries a condition where the category has one, with no "used" fallback', () => {
  const preview = read('app/post/preview.tsx');
  assert.ok(!/draft\.condition \?\? 'used'/.test(preview), 'the publish payload must not default the condition to "used"');
  assert.match(preview, /conditionApplies\(draft\.category, draft\.subcategory\) \? draft\.condition : undefined/);
  // the stored row is nulled by the same rule, so the screen and the database agree
  assert.match(read('store/myListings.ts'), /conditionApplies\(listing\.category, listing\.subcategory\) \? listing\.condition : null/);
  // no condition for a rental; a condition for a product; a valid chosen condition is accepted, a missing one is not
  const carried = (category: string, subcategory: string | undefined, condition?: string) => (conditionApplies(category, subcategory) ? condition : undefined);
  assert.equal(carried('property', 'House for Rent', 'used'), undefined);
  assert.equal(carried('property', 'House for Rent'), undefined);
  assert.equal(carried('phones', 'Samsung', 'like-new'), 'like-new');
  assert.equal(carried('fashion', 'Shoes', 'new'), 'new');
});
