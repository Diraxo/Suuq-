import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CATALOGS, CATALOG_SCOPES, catalogBrands, catalogModels, canonicalBrand, searchCatalog, dependentKeysToClear } from '../data/brandCatalog';
import { categoryFields, getCategoryFields, visibleFields } from '../data/categoryFields';
import { validateAttributes, sanitizeAttributes } from '../data/sellRules';

const root = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

test('web copies of the brand catalog and category fields match the originals', () => {
  assert.equal(read('data/brandCatalog.ts'), read('web/src/lib/brandCatalog.ts'));
  assert.equal(read('data/categoryFields.ts'), read('web/src/lib/categoryFields.ts'));
});

test('every catalog scope points at a real field set and a real catalog', () => {
  for (const [scope, set] of Object.entries(CATALOG_SCOPES)) {
    assert.ok(CATALOGS[set], `${scope} → unknown catalog ${set}`);
    const fields = categoryFields[scope];
    assert.ok(fields, `${scope} has no field set`);
    assert.equal(fields.find((f) => f.key === 'brand')?.catalog?.role, 'brand', `${scope} brand`);
    // brand-only sets (accessories, parts, printers...) have no model field at all
    const model = fields.find((f) => f.key === 'model');
    if (model) assert.equal(model.catalog?.role, 'model', `${scope} model`);
  }
});

test('catalog data is clean: popular brands exist, no duplicates, no blank names', () => {
  for (const [set, c] of Object.entries(CATALOGS)) {
    for (const b of c.popular) assert.ok(b in c.models, `${set}: popular brand ${b} missing from models`);
    assert.equal(new Set(c.popular).size, c.popular.length, `${set}: duplicate popular brand`);
    for (const [brand, models] of Object.entries(c.models)) {
      assert.ok(brand.trim() && brand === brand.trim(), `${set}: bad brand "${brand}"`);
      assert.equal(new Set(models.map((m) => m.toLowerCase())).size, models.length, `${set}/${brand}: duplicate model`);
      for (const m of models) assert.ok(m.trim() && m === m.trim(), `${set}/${brand}: bad model "${m}"`);
    }
  }
});

test('selecting a brand lists only that brand\'s models', () => {
  const toyota = catalogModels('cars', 'Toyota')!;
  assert.ok(toyota.all.includes('Corolla'));
  assert.ok(!toyota.all.includes('Swift'), 'Suzuki model leaked into Toyota');
  assert.ok(catalogModels('cars', 'Suzuki')!.all.includes('Swift'));
  assert.ok(catalogModels('phones', 'Apple')!.all.every((m) => m.startsWith('iPhone')));
  assert.ok(catalogModels('phones', 'Samsung')!.all.every((m) => m.startsWith('Galaxy')));
});

test('Bajaj and TVS are easy to find for motorcycles and three-wheelers', () => {
  assert.deepEqual(catalogBrands('motorcycles').common.slice(0, 2), ['Bajaj', 'TVS']);
  assert.deepEqual(catalogBrands('threeWheelers').common.slice(0, 2), ['Bajaj', 'TVS']);
});

test('brand lookup ignores case and spacing; unknown brands have no model list', () => {
  assert.equal(canonicalBrand('cars', ' toyota '), 'Toyota');
  assert.ok(catalogModels('cars', 'TOYOTA'));
  assert.equal(catalogModels('cars', 'Unknown Motors'), undefined);
  assert.equal(catalogModels('cars', ''), undefined);
  assert.equal(catalogModels('tvs', 'Samsung'), undefined, 'TV models are free text');
});

test('A–Z list is sorted and search ranks prefix matches first', () => {
  const { all } = catalogBrands('cars');
  assert.deepEqual(all, [...all].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
  assert.deepEqual(searchCatalog(['Land Cruiser', 'Cruze', 'Cruiser X'], 'cru'), ['Cruze', 'Cruiser X', 'Land Cruiser']);
  assert.deepEqual(searchCatalog(['A', 'B'], '  '), ['A', 'B']);
  assert.deepEqual(searchCatalog(['A', 'B'], 'zzz'), []);
});

test('changing the brand clears the model, re-picking the same brand does not', () => {
  const fields = getCategoryFields('vehicles', 'Cars');
  const brand = fields.find((f) => f.key === 'brand')!;
  assert.deepEqual(dependentKeysToClear(fields, brand, 'Toyota', 'Nissan'), ['model']);
  assert.deepEqual(dependentKeysToClear(fields, brand, 'Toyota', 'toyota'), []);
  assert.deepEqual(dependentKeysToClear(fields, brand, undefined, 'Toyota'), ['model']);
  assert.deepEqual(dependentKeysToClear(fields, fields.find((f) => f.key === 'model')!, 'Corolla', 'Camry'), []);
});

test('picker fields stay plain text for validation: typed brands/models and old listings still publish', () => {
  const fields = getCategoryFields('vehicles', 'Cars');
  const attrs = { offer: 'For sale', brand: 'Some Local Brand', model: 'Custom 1', year: '2015' };
  assert.deepEqual(validateAttributes(visibleFields(fields, attrs), attrs, new Date(), true), {});
  assert.equal(sanitizeAttributes(fields, attrs).brand, 'Some Local Brand');
  assert.ok(validateAttributes(fields, { offer: 'For sale', year: '2015' }, new Date(), true).brand, 'brand is still required');
});

test('mobile and web both wire the picker, the dependent clear and the locale keys', () => {
  assert.ok(/catalogBrands/.test(read('components/DynamicField.tsx')) && /CatalogPicker/.test(read('components/DynamicField.tsx')));
  assert.ok(/catalogBrands/.test(read('web/src/components/SellField.tsx')) && /CatalogPicker/.test(read('web/src/components/SellField.tsx')));
  assert.ok(/dependentKeysToClear/.test(read('app/post/details.tsx')));
  assert.ok(/dependentKeysToClear/.test(read('app/listing/edit/[id].tsx')));
  assert.ok(/dependentKeysToClear/.test(read('web/src/app/sell/page.tsx')));
  const keys = ['choose', 'search', 'common', 'all', 'noMatch', 'useTyped', 'typeHint', 'brandFirst'];
  for (const lang of ['en', 'so', 'am']) {
    const cat = JSON.parse(read(`locales/${lang}/translation.json`)).post.catalog;
    for (const k of keys) assert.ok(typeof cat?.[k] === 'string' && cat[k].length, `${lang} post.catalog.${k}`);
  }
  assert.match(JSON.parse(read('locales/en/translation.json')).post.catalog.useTyped, /\{\{value\}\}/);
});
