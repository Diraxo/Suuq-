import test from 'node:test';
import assert from 'node:assert/strict';
import { categories } from '../data/categories';
import { getCategoryFields } from '../data/categoryFields';
import { catalogBrands, catalogModels } from '../data/brandCatalog';
import { validateAttributes, sanitizeAttributes } from '../data/sellRules';

const electronics = categories.find((c) => c.id === 'electronics')!;
const subs = electronics.subcategories!.map((s) => s.name);

test('electronics has the computer, audio and networking subcategories', () => {
  for (const name of ['Laptops', 'Desktop Computers', 'Computer Accessories', 'Computer Parts', 'Audio & Microphones', 'Networking & Security']) {
    assert.ok(subs.includes(name), `${name} missing`);
  }
});

test('every electronics spec is chosen from a list: only brand and model may be typed (and picked from a catalog)', () => {
  for (const name of subs) {
    for (const f of getCategoryFields('electronics', name)) {
      if (f.type !== 'text') continue;
      assert.ok(f.key === 'brand' || f.key === 'model', `electronics/${name}: "${f.label}" is free text`);
      assert.ok(f.catalog, `electronics/${name}: ${f.key} has no catalog picker`);
    }
  }
});

test('Mac laptops cover Apple silicon from M1 up to the newest chips, plus the Intel models', () => {
  const models = catalogModels('laptops', 'Apple')!.all;
  for (const m of ['MacBook Air 13" M1', 'MacBook Air 13" M4', 'MacBook Air 15" M5', 'MacBook Pro 14" M5', 'MacBook Pro 16" M5 Max', 'MacBook Pro 14" M6', 'MacBook Pro 13" (Intel)']) {
    assert.ok(models.includes(m), `${m} missing`);
  }
  const chips = getCategoryFields('electronics', 'Laptops').find((f) => f.key === 'processor')!.options!;
  for (const c of ['Apple M1', 'Apple M4 Pro', 'Apple M5', 'Apple M6']) assert.ok(chips.includes(c), c);
});

test('a keyboard listing can be published with choices only', () => {
  const fields = getCategoryFields('electronics', 'Computer Accessories');
  const attrs = { accessoryType: 'Keyboard', brand: 'Logitech', connection: 'Wireless + Bluetooth', keyboardType: 'Mechanical', keyboardLayout: 'Arabic + English' };
  assert.deepEqual(validateAttributes(fields, attrs, new Date(), true), {});
  assert.deepEqual(sanitizeAttributes(fields, attrs), attrs);
  // keyboard-only questions disappear for other accessories and are not published
  const mouse = { accessoryType: 'Mouse', brand: 'Logitech', keyboardType: 'Mechanical' };
  assert.equal(sanitizeAttributes(fields, mouse).keyboardType, undefined);
});

test('microphones, CCTV and Starlink have their own questions', () => {
  const audio = getCategoryFields('electronics', 'Audio & Microphones');
  assert.ok(audio.find((f) => f.key === 'audioType')!.options!.includes('Microphone'));
  const net = getCategoryFields('electronics', 'Networking & Security');
  assert.ok(net.find((f) => f.key === 'deviceType')!.options!.includes('Starlink Kit'));
  assert.ok(catalogBrands('networking').all.includes('Starlink'));
});

test('latest consoles and tablets are listed', () => {
  const platforms = getCategoryFields('electronics', 'Gaming').find((f) => f.key === 'platform')!.options!;
  for (const p of ['PlayStation 5 Pro', 'Nintendo Switch 2', 'Xbox Series X']) assert.ok(platforms.includes(p), p);
  const ipads = catalogModels('tablets', 'Apple')!.all;
  assert.ok(ipads.includes('iPad Pro 13" (M5)'));
});

test('old laptop listings keep working: previously offered RAM and storage values are still accepted', () => {
  const fields = getCategoryFields('electronics', 'Laptops');
  assert.deepEqual(sanitizeAttributes(fields, { brand: 'HP', model: 'ProBook', ram: '6GB', storage: '1TB+' }), { brand: 'HP', model: 'ProBook', ram: '6GB', storage: '1TB+' });
});
