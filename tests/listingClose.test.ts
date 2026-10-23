// Sold / rented / filled / closed wording per category, the "For sale or for rent" question for things people also rent out,
// and the three kinds of home rental (furnished home, empty home, one room only). Mobile and web share data/sellRules.ts and
// data/categoryFields.ts byte for byte; the screens use closeKind() so the words always match what the listing is.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { categories } from '../data/categories';
import { RENTABLE, getCategoryFields, visibleFields } from '../data/categoryFields';
import { closeKind, isRentalListing, sanitizeAttributes, validateAttributes } from '../data/sellRules';

const root = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const locale = (l: string) => JSON.parse(read(`locales/${l}/translation.json`));

test('every category has a closing word: rentals are rented, jobs are filled, services are closed, everything else is sold', () => {
  assert.equal(closeKind({ category: 'property', subcategory: 'House for Rent' }), 'rented');
  assert.equal(closeKind({ category: 'property', subcategory: 'Apartment for Rent' }), 'rented');
  assert.equal(closeKind({ category: 'property', subcategory: 'Single Room for Rent' }), 'rented');
  assert.equal(closeKind({ category: 'property', subcategory: 'House for Sale' }), 'sold');
  assert.equal(closeKind({ category: 'property', subcategory: 'Shop', attributes: { offer: 'For rent' } }), 'rented');
  assert.equal(closeKind({ category: 'property', subcategory: 'Shop', attributes: { offer: 'For sale' } }), 'sold');
  assert.equal(closeKind({ category: 'vehicles', subcategory: 'Cars', attributes: { offer: 'For rent' } }), 'rented');
  assert.equal(closeKind({ category: 'vehicles', subcategory: 'Cars' }), 'sold');
  assert.equal(closeKind({ category: 'vehicles', subcategory: 'Cars', attributes: {} }), 'sold');
  assert.equal(closeKind({ category: 'jobs', subcategory: 'Full-time' }), 'filled');
  assert.equal(closeKind({ category: 'services' }), 'closed');
  for (const c of categories) {
    const kind = closeKind({ category: c.id });
    assert.ok(['sold', 'filled', 'closed'].includes(kind), `${c.id} (no rental answer) must never read as rented`);
  }
  assert.equal(isRentalListing('phones', 'iPhone', { offer: 'For rent' }), false, 'phones have no rent question');
  assert.equal(isRentalListing('vehicles', 'Cars', { offer: 'For rent' }), true);
  assert.equal(isRentalListing('vehicles', 'Spare Parts', { offer: 'For rent' }), false);
  assert.equal(isRentalListing('phones', 'iPhone', undefined), false);
});

test('things people also rent out ask "For sale or for rent" first, and the rent period only for rent', () => {
  assert.ok(RENTABLE.size >= 15);
  for (const scope of RENTABLE) {
    const [category, subcategory] = scope.split('/');
    const fields = getCategoryFields(category, subcategory);
    assert.equal(fields[0].key, 'offer', scope);
    assert.deepEqual(fields[0].options, ['For sale', 'For rent'], scope);
    assert.ok(fields[0].requiredForNew, scope);
    assert.equal(fields[1].key, 'rentPeriod', scope);
    const forSale = visibleFields(fields, { offer: 'For sale' }).map((f) => f.key);
    const forRent = visibleFields(fields, { offer: 'For rent' }).map((f) => f.key);
    assert.ok(!forSale.includes('rentPeriod'), scope);
    assert.ok(forRent.includes('rentPeriod'), scope);
  }
  // a car with no answer (saved before the question existed) is still a sale and still edits without the new question blocking it
  const cars = getCategoryFields('vehicles', 'Cars');
  const old = validateAttributes(cars, { brand: 'Toyota', model: 'Vitz', year: '2012' }, new Date(), false);
  assert.deepEqual(old, {});
  assert.ok(Object.keys(validateAttributes(cars, { brand: 'Toyota', model: 'Vitz', year: '2012' }, new Date(), true)).includes('offer'));
});

test('a home for rent asks what is rented: furnished home, empty home or one room only', () => {
  for (const sub of ['House for Rent', 'Apartment for Rent']) {
    const fields = getCategoryFields('property', sub);
    assert.equal(fields[0].key, 'rentalKind');
    assert.deepEqual(fields[0].options, ['Furnished home', 'Empty home', 'One room only']);
    assert.ok(fields[0].requiredForNew);
    const keys = (kind: string) => visibleFields(fields, { rentalKind: kind }).map((f) => f.key);

    // one room: no bedrooms, bathrooms, size, floor, parking, lease, no furnished question; the room questions appear
    const room = keys('One room only');
    for (const gone of ['bedrooms', 'bathrooms', 'size', 'floor', 'parking', 'leaseTerm', 'furnished']) assert.ok(!room.includes(gone), `${sub}: ${gone} must be hidden for one room`);
    for (const stay of ['rentalKind', 'rentPeriod', 'bathroomType', 'electricity', 'water', 'utilitiesIncluded', 'availability', 'address']) assert.ok(room.includes(stay), `${sub}: ${stay}`);

    // whole place: the usual home questions, no room-only question; furnished is answered by the choice itself
    for (const kind of ['Furnished home', 'Empty home']) {
      const whole = keys(kind);
      assert.ok(whole.includes('bedrooms') && whole.includes('bathrooms') && whole.includes('parking'), `${sub} ${kind}`);
      assert.ok(!whole.includes('bathroomType') && !whole.includes('furnished'), `${sub} ${kind}`);
    }

    // a listing saved before this question: still shows the old questions (nothing is dropped when it is edited)
    const legacy = keys('');
    assert.ok(legacy.includes('bedrooms') && legacy.includes('furnished'));
  }
});

test('one-room rentals do not publish stale whole-home answers and do not require bedrooms', () => {
  const fields = getCategoryFields('property', 'House for Rent');
  const answers = { rentalKind: 'One room only', bedrooms: '3', bathrooms: '2', size: '90', rentPeriod: 'Per month', address: 'House 4' };
  assert.deepEqual(sanitizeAttributes(fields, answers), { rentalKind: 'One room only', rentPeriod: 'Per month', address: 'House 4' });
  const errors = validateAttributes(fields, answers, new Date(), true);
  assert.ok(!('bedrooms' in errors));
  const whole = validateAttributes(fields, { rentalKind: 'Empty home', rentPeriod: 'Per month', address: 'House 4' }, new Date(), true);
  assert.ok('bedrooms' in whole, 'a whole home still needs its bedrooms');
  const none = validateAttributes(fields, { rentPeriod: 'Per month', address: 'House 4', bedrooms: '2' }, new Date(), true);
  assert.ok('rentalKind' in none, 'a new rental must say what is rented');
});

test('every new label, option, hint and closing word exists in English, Somali and Amharic, none copied from English', () => {
  const en = locale('en');
  const kinds = ['sold', 'rented', 'filled', 'closed'];
  const parts = ['status', 'short', 'mark', 'confirmTitle', 'confirmMessage', 'confirmYes', 'success', 'message', 'errorTitle'];
  for (const lang of ['en', 'so', 'am']) {
    const l = locale(lang);
    for (const k of kinds) for (const p of parts) assert.ok(l.listing.close[k][p], `${lang} listing.close.${k}.${p}`);
    assert.ok(l.listing.forRent && l.post.fieldLabels['What are you renting out?']);
    for (const o of ['Furnished home', 'Empty home', 'One room only']) assert.ok(l.post.fieldOptions[o], `${lang} ${o}`);
    const hintKey = Object.keys(en.post.fieldHints).find((h) => h.startsWith('Furnished includes beds'));
    assert.ok(hintKey && l.post.fieldHints[hintKey], `${lang} rental hint`);
    if (lang !== 'en') {
      for (const k of ['rented', 'filled', 'closed']) for (const p of parts) assert.notEqual(l.listing.close[k][p], en.listing.close[k][p], `${lang} ${k}.${p} is still English`);
      for (const o of ['Furnished home', 'Empty home', 'One room only']) assert.notEqual(l.post.fieldOptions[o], o, `${lang} ${o}`);
    }
  }
  // the rental hint key must be what the app derives from the field's hint (dots and colons are dropped from keys)
  const hint = getCategoryFields('property', 'House for Rent')[0].hint as string;
  assert.ok(Object.keys(en.post.fieldHints).includes(hint.replace(/[.:]/g, '')));
});

test('mobile and web screens word the closing action from closeKind and never hard-code "sold" for a rental', () => {
  const screens = [
    'app/listing/[id].tsx', 'app/offers.tsx', 'components/ListingCard.tsx', 'components/CompareListingCard.tsx',
    'web/src/app/listing/[id]/page.tsx', 'web/src/app/my-listings/page.tsx', 'web/src/app/offers/page.tsx', 'web/src/components/ListingCard.tsx',
  ];
  for (const f of screens) {
    const src = read(f);
    assert.match(src, /closeKind\(/, f);
    assert.match(src, /listing\.close\./, f);
  }
  for (const f of ['app/listing/[id].tsx', 'web/src/app/listing/[id]/page.tsx', 'components/ListingCard.tsx']) assert.match(read(f), /listing\.forRent/, `${f}: an open rental says "For rent"`);
  assert.doesNotMatch(read('app/listing/[id].tsx'), /t\('listing\.status\.sold'\)|t\('listing\.soldShort'\)|t\('listing\.markSoldConfirm/);
});

test('the website reads the same rules and strings as the app', () => {
  for (const f of ['categoryFields', 'sellRules', 'fieldOptions']) assert.equal(read(`web/src/lib/${f}.ts`), read(`data/${f}.ts`), `${f} drifted`);
});
