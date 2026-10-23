import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { categories } from '../data/categories';
import { getCategoryFields, type CategoryField } from '../data/categoryFields';
import {
  SELL_ERROR_TEMPLATES,
  matchSellError,
  parseNumericInput,
  sellError,
  validateAttribute,
  validateAttributes,
  validateCondition,
  validateCurrency,
  validateDescription,
  validateListingDraft,
  validatePrice,
  validateSellerNotes,
  validateTitle,
  type SellErrorId,
} from '../data/sellRules';
import { validateCity, validatePhoneLocal } from '../data/validation';
import { fieldLabelText, localizeSellError, titlePlaceholderText, type Translate } from '../data/sellText';
import { makeSellT } from '../web/src/lib/webTranslate';

const root = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const locale = (lang: string) => JSON.parse(read(`locales/${lang}/translation.json`));

function makeT(lang: string): Translate {
  const json = locale(lang);
  return (key, options = {}) => {
    let node: unknown = json;
    for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
    const raw = typeof node === 'string' ? node : (options.defaultValue as string | undefined) ?? key;
    return raw.replace(/\{\{(\w+)\}\}/g, (_, name) => String(options[name] ?? ''));
  };
}

const ids = Object.keys(SELL_ERROR_TEMPLATES) as SellErrorId[];
const placeholders = (text: string) => [...text.matchAll(/\{\{?(\w+)\}?\}/g)].map((m) => m[1]).sort();

test('every validation message has a template, and sellError/matchSellError are exact inverses', () => {
  assert.ok(ids.length >= 35);
  for (const id of ids) {
    const keys = placeholders(SELL_ERROR_TEMPLATES[id]);
    const params = Object.fromEntries(keys.map((k, i) => [k, k === 'label' ? 'Brand' : String(i + 7)]));
    const text = sellError(id, params);
    assert.ok(!/[{}]/.test(text), `${id}: ${text}`);
    const found = matchSellError(text);
    assert.ok(found, `${id} is not recognised`);
    assert.equal(found!.id, id);
    assert.deepEqual(found!.params, params);
  }
  assert.equal(matchSellError('Something nobody wrote'), undefined);
});

test('every message the real validators produce is recognised (so none can slip through in English)', () => {
  const produced: (string | undefined)[] = [
    validateTitle(''), validateTitle('a\nb'), validateTitle('x'.repeat(201)),
    validateDescription(''), validateDescription('a\u0000b'), validateDescription('x'.repeat(5001)),
    validateSellerNotes('a\u0000b'), validateSellerNotes('x'.repeat(1001)),
    validatePrice(''), validatePrice('1,5'), validatePrice('0'), validatePrice('9'.repeat(14)),
    validateCurrency(''), validateCurrency('USD', ['ETB']),
    validateCondition(undefined), validateCondition('for-parts', ['new']),
    validateCity(undefined), validatePhoneLocal('ET', '12'),
  ];
  const brand: CategoryField = { key: 'brand', label: 'Brand', type: 'text', required: true };
  const sel: CategoryField = { key: 'fuel', label: 'Fuel Type', type: 'select', options: ['Petrol'] };
  const year: CategoryField = { key: 'year', label: 'Year', type: 'year' };
  produced.push(validateAttribute(brand, ''), validateAttribute(sel, 'Steam'), validateAttribute(year, '1800'), validateAttribute(brand, 'a\nb'), validateAttribute(brand, 'x'.repeat(101)));
  const rules = [{ kind: 'integer' as const, min: 1, max: 10 }, { kind: 'decimal' as const, min: 1, max: 10, decimals: 2 }, { kind: 'decimal' as const, min: 1, max: 10, decimals: 1 }, { kind: 'percent' as const, min: 0, max: 100 }];
  for (const rule of rules) for (const raw of ['', 'abc', '99999', '1.2345', '0']) {
    const r = parseNumericInput(raw, rule, 'Mileage (km)');
    if (!r.ok) produced.push(r.error);
  }
  const draft = validateListingDraft({ photoCount: 0, category: 'x', title: 't', description: 'd', price: '1', attributes: {}, fields: [], categories });
  produced.push(...Object.values(draft.errors));
  produced.push(...Object.values(validateListingDraft({ photoCount: 9, category: 'phones', subcategory: 'Nope', title: 't', description: 'd', price: '1', attributes: {}, fields: [], categories }).errors));
  produced.push(...Object.values(validateListingDraft({ photoCount: 1, category: 'phones', title: 't', description: 'd', price: '1', attributes: {}, fields: [], categories }).errors));
  produced.push(...Object.values(validateAttributes(getCategoryFields('vehicles', 'Cars'), {})));
  const real = produced.filter((m): m is string => !!m);
  assert.ok(real.length >= 30);
  for (const message of real) assert.ok(matchSellError(message), `not translatable: "${message}"`);
});

test('every message exists in English, Somali and Amharic with the same {{values}}', () => {
  for (const lang of ['en', 'so', 'am']) {
    const errors = locale(lang).post.errors as Record<string, string>;
    assert.deepEqual(Object.keys(errors).sort(), [...ids].sort(), `${lang} post.errors`);
    for (const id of ids) {
      assert.deepEqual(placeholders(errors[id]), placeholders(SELL_ERROR_TEMPLATES[id]), `${lang} ${id} uses different values`);
      if (lang === 'en') assert.equal(errors[id].replace(/\{\{(\w+)\}\}/g, '{$1}'), SELL_ERROR_TEMPLATES[id], `en ${id} differs from the rule's wording`);
      else assert.notEqual(errors[id], locale('en').post.errors[id], `${lang} ${id} was not translated`);
    }
  }
});

test('mobile shows the shared rules’ messages in Somali and Amharic', () => {
  const so = makeT('so');
  const am = makeT('am');
  assert.equal(localizeSellError(so, validateTitle('')), 'Cinwaanka waa qasab.');
  assert.equal(localizeSellError(am, validateTitle('')), 'ርዕስ ያስፈልጋል።');
  assert.equal(localizeSellError(so, validateTitle('x'.repeat(201))), 'Cinwaanku waa inuusan ka badnaan 200 xaraf (hadda waa 201).');
  assert.equal(localizeSellError(so, validatePrice('0')), 'Geli qiime ka weyn 0.');
  assert.equal(localizeSellError(am, validatePrice('')), 'ዋጋ ያስፈልጋል።');
  assert.equal(localizeSellError(makeT('en'), validatePrice('')), 'Price is required.');
  // the field's own name is translated inside the sentence
  const brand = getCategoryFields('vehicles', 'Cars').find((f) => f.key === 'brand')!;
  assert.equal(fieldLabelText(so, brand), 'Summadda');
  assert.equal(localizeSellError(so, validateAttribute(brand, '')), 'Summadda waa qasab.');
  assert.equal(localizeSellError(am, validateAttribute(brand, '')), 'ብራንድ ያስፈልጋል።');
  const mileage = getCategoryFields('vehicles', 'Cars').find((f) => f.key === 'mileage')!;
  assert.equal(localizeSellError(so, validateAttribute(mileage, '3000000')), 'Kiilomitirada uu socday (km) waa inuu u dhexeeyaa 0 iyo 2,000,000.');
  assert.equal(localizeSellError(am, validatePhoneLocal('ET', '1')), 'ትክክለኛ ስልክ ቁጥር ያስገቡ።');
  // unknown text and missing messages pass through unchanged
  assert.equal(localizeSellError(so, 'Network down'), 'Network down');
  assert.equal(localizeSellError(so, undefined), undefined);
  // already-translated text is left alone (idempotent)
  assert.equal(localizeSellError(so, 'Cinwaanka waa qasab.'), 'Cinwaanka waa qasab.');
});

// ───────────────────────────── The website ─────────────────────────────

test('the website’s text is the app’s locale text, generated and in sync', () => {
  for (const lang of ['en', 'so', 'am']) {
    const src = read(`web/src/lib/webText/${lang}.ts`);
    const json = JSON.parse(src.slice(src.indexOf('= {') + 2, src.lastIndexOf(';\n\nexport default')));
    assert.deepEqual(json, locale(lang), `${lang}: run node scripts/sync-web-text.js`);
  }
});

test('the website translates the Sell flow in the chosen language', () => {
  const en = makeSellT('en');
  const so = makeSellT('so');
  const am = makeSellT('am');
  assert.equal(en('post.webSell.photosTitle'), 'Add photos');
  assert.equal(so('post.webSell.photosTitle'), 'Ku dar sawirro');
  assert.equal(am('post.webSell.photosTitle'), 'ፎቶዎችን ጨምር');
  assert.equal(so('components.stepHeader.stepOf', { step: 2, total: 6 }), 'Tallaabada 2 ee 6');
  assert.equal(am('components.stepHeader.stepOf', { step: 2, total: 6 }), 'ደረጃ 2 ከ6');
  assert.equal(so('post.details.condition.needsRepair'), 'U Baahan Dayactir');
  // examples, errors and field text on the website come out in the language too
  assert.equal(titlePlaceholderText(so, 'property', 'Single Room for Rent'), 'tusaale: Qol keliya oo kiro ah, Degmada 01');
  assert.equal(titlePlaceholderText(am, 'food', 'Groceries'), 'ለምሳሌ፦ ባስማቲ ሩዝ፣ 25 ኪሎ ከረጢት');
  assert.equal(localizeSellError(so, validateDescription('')), 'Sharaxaadda waa qasab.');
  assert.equal(localizeSellError(am, validateTitle('')), 'ርዕስ ያስፈልጋል።');
  // an unknown key falls back to the English default, never to the raw key
  assert.equal(so('post.nothing.here', { defaultValue: 'Fallback' }), 'Fallback');
  assert.equal(so('post.details.exampleWrap', { example: 'X' }), 'tusaale: X');
});

test('the website’s Sell page, step header and fields use the translator instead of hard-coded English', () => {
  const page = read('web/src/app/sell/page.tsx');
  assert.match(page, /use(Sell)?T\(\)/); // the page may use the site-wide translator; its fields and header use useSellT
  for (const english of ['title="Add photos"', 'title="Choose a category"', 'title="Describe your item"', 'title="Location & price"', 'title="Preview"', '>Publish listing<', 'Listing published</h1>', "'Please fix the highlighted fields to continue.'", 'Price is negotiable\n', 'placeholder="One per line']) {
    assert.ok(!page.includes(english), `still hard-coded: ${english}`);
  }
  assert.match(page, /L\(titleError\)/);
  assert.match(page, /L\(descriptionError\)/);
  assert.match(page, /L\(priceError \?\? currencyError\)/);
  assert.match(read('web/src/components/StepHeader.tsx'), /useSellT\(\)/);
  assert.ok(!/Step \{step\} of/.test(read('web/src/components/StepHeader.tsx')));
  const field = read('web/src/components/SellField.tsx');
  assert.match(field, /localizeSellError\(t, /);
  assert.match(field, /fieldLabelText\(t, field\)/);
  assert.match(field, /optionText\(t, opt\)/);
  assert.ok(!/\(required\)/.test(field));
  // the hook uses the website's existing language store, not a second selector
  assert.match(read('web/src/lib/i18n.ts'), /useLanguageStore/);
});

test('the shared files stay identical on the website', () => {
  for (const [a, b] of [['data/sellText.ts', 'web/src/lib/sellText.ts'], ['data/sellRules.ts', 'web/src/lib/sellRules.ts'], ['data/categoryFields.ts', 'web/src/lib/categoryFields.ts']]) {
    assert.equal(read(a), read(b), `${a} and ${b} have drifted`);
  }
});
