import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBulkRow, bulkUploadTemplate } from '../web/src/lib/bulkUpload';
import { parseCsv, csvRowsToObjects } from '../web/src/lib/csv';
import { buildIndex, rowToNode, LocRow } from '../web/src/lib/locationTree';

const mk = (over: Partial<LocRow> & { id: string; name: string; kind: string }) =>
  ({ name_so: null, name_am: null, parent_id: null, iso2: null, currency_codes: null, default_currency: null, aliases: [], is_featured: false, is_app_region: false, status: 'approved', ...over }) as unknown as LocRow;
const index = buildIndex([
  rowToNode(mk({ id: 'c1', kind: 'country', name: 'Somalia', iso2: 'SO', currency_codes: ['USD', 'SOS'], default_currency: 'USD' })),
  rowToNode(mk({ id: 'city1', kind: 'city', name: 'Hargeisa', parent_id: 'c1' })),
]);

test('template round-trips through the parser and is valid for a known city', () => {
  const rows = csvRowsToObjects(parseCsv(bulkUploadTemplate()));
  assert.equal(rows.length, 1);
  const r = parseBulkRow(rows[0], index);
  assert.deepEqual(r.errors, []);
  assert.equal(r.city, 'Hargeisa');
  assert.equal(r.currency, 'USD');
  assert.equal(r.images.length, 2);
});

test('bad rows report every problem; photo links must be http(s)', () => {
  const r = parseBulkRow({ title: '', description: '', price: 'abc', category: 'Nope', condition: 'meh', city: 'Atlantis', image_urls: 'javascript:alert(1)|ftp://x' }, index);
  assert.equal(r.errors.length, 7);
  assert.equal(r.images.length, 0);
});

// ─────────────────────── Condition is only asked where it applies ───────────────────────

const base = { title: 'Two bedroom flat', description: 'Bright flat near the market, water included.', price: '300', city: 'Hargeisa', image_urls: 'https://example.com/a.jpg' };

test('a blank condition is accepted for a condition-free category (rental) and rejected for a product', () => {
  const rental = parseBulkRow({ ...base, category: 'property', condition: '' }, index);
  assert.deepEqual(rental.errors, []);
  const food = parseBulkRow({ ...base, category: 'food', condition: '' }, index);
  assert.deepEqual(food.errors, []);
  const phone = parseBulkRow({ ...base, category: 'phones', condition: '' }, index);
  assert.equal(phone.errors.length, 1);
  assert.match(phone.errors[0], /Unknown condition/);
});

test('invalid conditions are still rejected where a condition applies, valid ones kept', () => {
  assert.equal(parseBulkRow({ ...base, category: 'phones', condition: 'meh' }, index).errors.length, 1);
  const ok = parseBulkRow({ ...base, category: 'phones', condition: 'like new' }, index);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.condition, 'like-new');
});

// ─────────────── Every category: parser verdict matches the shared rule; every publish path normalizes ───────────────

import fs from 'node:fs';
import path from 'node:path';
import { categories } from '../web/src/lib/categories';
import { conditionApplies } from '../web/src/lib/sellRules';

const readSrc = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8').replace(/\r\n/g, '\n');

test('for every category a blank condition is an error exactly when conditionApplies says so', () => {
  for (const c of categories) {
    const r = parseBulkRow({ ...base, category: c.id, condition: '' }, index);
    const rejected = r.errors.some((e) => /Unknown condition/.test(e));
    assert.equal(rejected, conditionApplies(c.id), c.id);
  }
});

test('mobile and web share the same condition rule source and the same CSV check', () => {
  const mobile = readSrc('lib/bulkUpload.ts');
  const web = readSrc('web/src/lib/bulkUpload.ts');
  for (const src of [mobile, web]) assert.match(src, /!condition && conditionApplies\(matchedCategory\?\.id \?\? categoryInput\)/);
  assert.match(mobile, /condition: condition \?\? 'used'/); // placeholder — must never reach the database as-is
});

test('every bulk publish path writes through a writer that nulls the condition where none applies', () => {
  // mobile direct path + queue publish both use listingToRow; web uses createListing
  assert.match(readSrc('store/myListings.ts'), /condition: conditionApplies\(listing\.category, listing\.subcategory\) \? listing\.condition : null/);
  assert.match(readSrc('app/business/bulk-upload.tsx'), /listingToRow\(listing, session\.user\.id\)/);
  assert.match(readSrc('components/BulkQueuePanel.tsx'), /listingToRow\(listing, userId\)/);
  assert.match(readSrc('web/src/services/listings.ts'), /conditionApplies\(input\.category, input\.subcategory\) \? input\.condition \?\? null : null/);
  assert.match(readSrc('web/src/components/BulkQueuePanel.tsx'), /createListing\(/);
  assert.match(readSrc('web/src/app/business/bulk-upload/page.tsx'), /createListing\(/);
});
