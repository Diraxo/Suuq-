import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CONTACT_PRICE_ENABLED, PRICE_MODE_CONTACT, PRICE_MODE_SET, hasComparablePrice, isContactPriceListing } from '../data/serviceConfig';
import { listingPriceText, type Translate } from '../data/sellText';
import { PRODUCTION_PROJECT_REF, contactPriceLocalOverride } from '../data/contactPriceFlag';
import { getMarketPriceStats, similarityScore } from '../data/similarListings';
import { isPriceReduced } from '../lib/searchFilters';
import type { Listing } from '../types';

const root = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const tEn: Translate = (key, options = {}) => String(options.defaultValue ?? key);
const fmt = (amount: number, currency?: string | null) => `${amount} ${currency ?? 'ETB'}`;

const CONTACT = { priceMode: PRICE_MODE_CONTACT };

test('the client-side switch stays off in this phase', () => {
  assert.equal(CONTACT_PRICE_ENABLED, false);
});

test('a contact-price listing is services + price exactly 0 + the exact mode; nothing else is', () => {
  assert.equal(isContactPriceListing({ category: 'services', price: 0, attributes: CONTACT }), true);
  assert.equal(isContactPriceListing({ category: 'services', price: '0', attributes: CONTACT }), true, 'a string 0 from a raw row');
  // a stale or forged mode on a listing with a real price is ignored — this is the "switch is off" case
  assert.equal(isContactPriceListing({ category: 'services', price: 1500, attributes: CONTACT }), false);
  assert.equal(isContactPriceListing({ category: 'services', price: '1500', attributes: CONTACT }), false);
  assert.equal(isContactPriceListing({ category: 'services', price: 1500, attributes: { priceMode: PRICE_MODE_SET } }), false);
  // a zero without the mode is not a contact price either (it would be a bad row, not a "free" or "contact" one)
  assert.equal(isContactPriceListing({ category: 'services', price: 0, attributes: {} }), false);
  assert.equal(isContactPriceListing({ category: 'services', price: 0, attributes: { priceMode: 'contact for price' } }), false);
  assert.equal(isContactPriceListing({ category: 'phones', price: 0, attributes: CONTACT }), false);
  // missing / malformed values never count
  for (const price of [undefined, null, '', '  ', NaN, 'abc']) {
    assert.equal(isContactPriceListing({ category: 'services', price: price as never, attributes: CONTACT }), false, `price ${String(price)}`);
  }
  assert.equal(isContactPriceListing({ category: 'services', price: 0, attributes: null }), false);
  assert.equal(isContactPriceListing({ category: null, price: 0, attributes: CONTACT }), false);
  assert.equal(isContactPriceListing(null), false);
  assert.equal(isContactPriceListing(undefined), false);
});

test('comparable price: positive, finite, and never a contact-price listing', () => {
  assert.equal(hasComparablePrice({ category: 'electronics', price: 10 }), true);
  assert.equal(hasComparablePrice({ category: 'services', price: 10, attributes: CONTACT }), true, 'a forged mode on a priced service still compares by its real price');
  assert.equal(hasComparablePrice({ category: 'services', price: 0, attributes: CONTACT }), false);
  for (const price of [0, -5, NaN, Infinity, null, undefined, '']) assert.equal(hasComparablePrice({ category: 'electronics', price: price as never }), false, `price ${String(price)}`);
  assert.equal(hasComparablePrice(null), false);
});

test('listingPriceText never prints a zero for a contact-price listing and leaves every other price alone', () => {
  assert.equal(listingPriceText(tEn, { category: 'services', price: 0, currency: 'ETB', attributes: CONTACT }, fmt), 'Contact for price');
  assert.equal(listingPriceText(tEn, { category: 'services', price: 2500, currency: 'ETB', attributes: CONTACT }, fmt), '2500 ETB', 'forged mode: the real price shows');
  assert.equal(listingPriceText(tEn, { category: 'services', price: 2500, currency: 'USD', attributes: { priceMode: PRICE_MODE_SET, priceUnit: 'Per hour' } }, fmt), '2500 USD');
  assert.equal(listingPriceText(tEn, { category: 'phones', price: 300, currency: 'ETB' }, fmt), '300 ETB');
  const translated: Translate = (key, o = {}) => (key === 'post.serviceDisplay.contactForPrice' ? 'La xiriir qiimaha' : String(o.defaultValue ?? key));
  assert.equal(listingPriceText(translated, { category: 'services', price: 0, attributes: CONTACT }, fmt), 'La xiriir qiimaha', 'uses the active language');
});

// ───────────────────────────── Market comparison ─────────────────────────────

let n = 0;
function L(over: Partial<Listing> & { price: number }): Listing {
  return { id: `l${++n}`, title: 't', category: 'services', subcategory: 'Plumber', city: 'Hargeisa', status: 'available', condition: 'used', currency: 'ETB', attributes: {}, ...over } as unknown as Listing;
}

test('market average ignores contact-price candidates and gives a contact-price listing no verdict', () => {
  const me = L({ price: 800 });
  const priced = [1000, 1000, 1000, 1000, 1000].map((price) => L({ price }));
  const contacts = [1, 2, 3].map(() => L({ price: 0, attributes: CONTACT }));
  const stats = getMarketPriceStats(me, [...priced, ...contacts])!;
  assert.equal(stats.sampleSize, 5, 'the three contact-price rows are not part of the sample');
  assert.equal(stats.average, 1000, 'the zeros do not drag the average down');
  assert.equal(stats.savingsAmount, 200);
  assert.equal(stats.savingsPercent, 20);

  // only contact-price rows around: nothing to compare with
  assert.equal(getMarketPriceStats(me, contacts), null);
  // a contact-price listing is never called a "good deal" against priced ones
  assert.equal(getMarketPriceStats(L({ price: 0, attributes: CONTACT }), priced), null);
  // a zero-price listing that is NOT a valid contact listing (bad row) gets no verdict either
  assert.equal(getMarketPriceStats(L({ price: 0 }), priced), null);
});

test('without contact-price rows the market statistics are unchanged', () => {
  const me = L({ price: 1200 });
  const priced = [800, 900, 1000, 1100, 1200, 1300].map((price) => L({ price }));
  const stats = getMarketPriceStats(me, priced)!;
  assert.equal(stats.trusted, true);
  assert.equal(stats.average, 1050);
  assert.equal(stats.savingsAmount, undefined, 'above average → no saving');
});

test('similarity: price closeness only counts between two real prices', () => {
  const priced = L({ price: 1000 });
  const sameSub = L({ price: 1000 });
  const contact = L({ price: 0, attributes: CONTACT });
  assert.ok(similarityScore(priced, sameSub) > similarityScore(priced, contact), 'a real price near mine beats an unpriced one');
  assert.equal(similarityScore(contact, priced), similarityScore(contact, contact), 'an unpriced primary has no price signal at all');
  assert.ok(similarityScore(priced, contact) >= 40, 'the unpriced candidate still matches on subcategory/city');
});

test('a listing at price 0 is never "price reduced"', () => {
  const now = new Date();
  const base = { lastPriceDropAt: now.toISOString(), lastPriceDropFrom: 1000 };
  assert.equal(isPriceReduced({ ...base, price: 900 } as never, now), true);
  assert.equal(isPriceReduced({ ...base, price: 0 } as never, now), false);
});

// ───────────────────────────── Display audit (guards against a regression) ─────────────────────────────

const walk = (dir: string): string[] =>
  fs.existsSync(path.join(root, dir))
    ? fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(rel);
        return /\.(ts|tsx)$/.test(e.name) ? [rel] : [];
      })
    : [];

// Every place that prints a stored listing price as a bare formatBirr(x.price). Each one is safe for the reason given; a NEW one fails this
// test so it gets looked at (use listingPriceText instead).
const BARE_PRICE_ALLOWED: Record<string, string> = {
  'app/offers.tsx': 'only after the contact-price check; reached only when price > 0',
  'web/src/app/offers/page.tsx': 'only after the contact-price check; reached only when price > 0',
  'app/price-drops.tsx': 'running discounts (a contact-price listing cannot have one) and earlier drops (contact-price filtered out)',
  'web/src/app/price-drops/page.tsx': 'running discounts and earlier drops (contact-price filtered out in load())',
  'components/DiscountModal.tsx': 'only opened for a discountable listing (the hook refuses contact-price)',
  'web/src/components/DiscountModal.tsx': 'only opened for a discountable listing (the hook refuses contact-price)',
  'app/post/preview.tsx': 'the draft preview, right after the contactPrice branch',
};

test('no screen prints a stored listing price as a bare amount unless it is on the audited list', () => {
  const files = ['app', 'components', 'hooks', 'web/src'].flatMap(walk);
  const bare = /formatBirr\((?:Number\()?[A-Za-z_.?]*\.price\b/;
  const found = new Map<string, number>();
  for (const f of files) {
    const hits = read(f).split('\n').filter((line) => bare.test(line)).length;
    if (hits) found.set(f, hits);
  }
  assert.deepEqual([...found.keys()].sort(), Object.keys(BARE_PRICE_ALLOWED).sort(), 'a screen formats listing.price directly — use listingPriceText(t, listing, formatBirr)');
});

test('the listing price shown in cards, detail, My Listings, chat, compare and share goes through listingPriceText on mobile and web', () => {
  for (const f of [
    'components/ListingCard.tsx', 'web/src/components/ListingCard.tsx', 'app/listing/[id].tsx', 'web/src/app/listing/[id]/page.tsx',
    'app/my-listings.tsx', 'web/src/app/my-listings/page.tsx', 'app/chat/[id].tsx', 'web/src/app/chat/[id]/page.tsx',
    'app/compare.tsx', 'components/CompareListingCard.tsx', 'app/offers.tsx', 'web/src/app/offers/page.tsx',
  ]) {
    assert.ok(/listingPriceText\(/.test(read(f)), `${f} formats the price through listingPriceText`);
  }
  assert.ok(/listing\.shareMessage[\s\S]*listingPriceText\(/.test(read('app/listing/[id].tsx')), 'the share message cannot say "0 Birr"');
});

test('offers and discounts are hidden for a contact-price listing on every entry point', () => {
  assert.ok(/!listingIsContactPrice/.test(read('app/chat/[id].tsx')), 'mobile chat: no Make offer');
  assert.ok(/!isContactPriceListing\(conversation\.listing\)/.test(read('web/src/app/chat/[id]/page.tsx')), 'web chat: no Make offer');
  for (const f of ['app/offers.tsx', 'web/src/app/offers/page.tsx']) assert.ok(/canMakeNewOffer = [^\n]*!contactPrice/.test(read(f)), `${f}: no new offer form`);
  for (const f of ['hooks/useSellerDiscount.ts', 'web/src/hooks/useSellerDiscount.ts']) assert.ok(/isContactPriceListing\(listing\) \? null/.test(read(f)), `${f}: the discount dialog refuses to open`);
  for (const f of ['app/my-listings.tsx', 'app/listing/[id].tsx', 'web/src/app/my-listings/page.tsx', 'web/src/app/listing/[id]/page.tsx']) {
    assert.ok(/!(contactPrice|isContactPriceListing\(item\)|isContactPriceListing\(listing\))/.test(read(f)), `${f}: no discount button`);
  }
});

test('the web and app copies of the shared pricing modules are identical', () => {
  for (const [a, b] of [['data/serviceConfig.ts', 'web/src/lib/serviceConfig.ts'], ['data/sellText.ts', 'web/src/lib/sellText.ts'], ['lib/searchFilters.ts', 'web/src/lib/searchFilters.ts']]) {
    assert.equal(read(a), read(b), `${a} and ${b} must match`);
  }
});

test('the proposed migration covers offers, discounts, price drops and the price-zero hole, and 0085 is untouched', () => {
  const sql = read('supabase/proposed/0086_contact_price_safeguards.sql');
  for (const needle of ['offers_contact_price_guard', 'listings_y_contact_price_guard', 'listings_price_zero_needs_mode', 'new.price > 0 and new.price < old.price', 'is_contact_price_listing']) {
    assert.ok(sql.includes(needle), needle);
  }
  assert.ok(/not valid/i.test(sql));
  assert.ok(read('supabase/proposed/0085_service_contact_price.sql').includes("add constraint listings_price_range check ("), '0085 is as it was');
});

test('a pending offer on a listing that turned contact-price can be declined but not accepted or countered, on app and website', () => {
  for (const f of ['app/offers.tsx', 'web/src/app/offers/page.tsx']) {
    const src = read(f);
    assert.ok(/!contactPrice && [\s\S]{0,120}respond\('accept'\)/.test(src), `${f}: no Accept button`);
    assert.ok(/!contactPrice && [\s\S]{0,160}setCounteringId\(latest\.id\)/.test(src), `${f}: no Counter button`);
    assert.ok(/respond\('decline'\)/.test(src), `${f}: Decline stays`);
  }
  const sql = read('supabase/proposed/0087_contact_price_pending_offers.sql');
  for (const needle of ['offers_contact_price_guard_accept', "new.status = 'accepted'", 'before update of status on public.offers']) assert.ok(sql.includes(needle), needle);
});

test('the seven contact-price strings are translated into Somali and Amharic, no longer listed as pending, and the review checklist names them', () => {
  const dig = (json: unknown, dotted: string): unknown => dotted.split('.').reduce<unknown>((n, p) => (n as Record<string, unknown> | undefined)?.[p], json);
  const keys = ['post.fieldLabels.How do you charge?', 'post.fieldLabels.Price is charged', 'post.fieldOptions.Set a price', 'post.fieldOptions.Contact for price', 'post.serviceDisplay.contactForPrice', 'post.sections.pricing', 'post.price.contactHint'];
  const loc = (l: string) => JSON.parse(read(`locales/${l}/translation.json`));
  const pendingFile = JSON.parse(read('locales/pending-review.json')) as Record<'so' | 'am', string[]> & { unreviewedDrafts: Record<'so' | 'am', string[]> };
  const pending = pendingFile;
  const checklist = read('docs/TRANSLATION_REVIEW_CHECKLIST.md');
  for (const lang of ['so', 'am'] as const) {
    const json = loc(lang);
    for (const k of keys) {
      assert.notEqual(dig(json, k), dig(loc('en'), k), `${lang} ${k} is translated`);
      assert.ok(!pending[lang].includes(k), `${lang} ${k} left the pending list`);
      assert.ok(checklist.includes('`' + k + '`'), `${k} is on the unverified-review checklist`);
      assert.ok(pendingFile.unreviewedDrafts[lang].includes(k), `${lang} ${k} is recorded as an unreviewed draft`);
    }
  }
  assert.equal(dig(loc('so'), 'post.serviceDisplay.contactForPrice'), dig(loc('so'), 'post.fieldOptions.Contact for price'), 'card text and form option agree');
  assert.equal(dig(loc('am'), 'post.serviceDisplay.contactForPrice'), dig(loc('am'), 'post.fieldOptions.Contact for price'));
  // every key the price step looks up with an inline default exists in all three locales (post.price.contactHint was the missing one)
  for (const f of ['app/post/price.tsx', 'web/src/app/sell/page.tsx']) {
    const m = [...read(f).matchAll(/t\(\s*'(post\.price\.contactHint)'/g)];
    assert.ok(m.length > 0, `${f} uses post.price.contactHint`);
  }
  for (const l of ['en', 'so', 'am']) assert.equal(typeof dig(loc(l), 'post.price.contactHint'), 'string', `${l} has post.price.contactHint`);
  assert.ok(/NOT yet verified/.test(checklist), 'the checklist says the wording is unverified');
});

test('the local-only Contact-for-price override cannot switch the feature on in production or against the production database', () => {
  const local = 'http://127.0.0.1:54321';
  const prod = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
  for (const ok of [local, 'http://localhost:54321', 'http://10.0.2.2:54321', 'http://192.168.1.20:54321', 'http://172.16.0.5:54321', 'http://172.31.9.9:54321', 'http://10.1.2.3', 'http://[::1]:54321', 'http://my-pc.local:54321', 'HTTP://LOCALHOST:54321/'])
    assert.equal(contactPriceLocalOverride({ dev: true, flag: 'true', supabaseUrl: ok }), true, `local database ${ok}`);
  assert.equal(contactPriceLocalOverride({ dev: false, flag: 'true', supabaseUrl: local }), false, 'a production bundle ignores it');
  // production and every other hosted/remote address are refused, whatever the spelling
  for (const bad of [prod, prod + '/', prod.toUpperCase(), `https://${PRODUCTION_PROJECT_REF.toUpperCase()}.supabase.co`, `http://localhost@${PRODUCTION_PROJECT_REF}.supabase.co`, `http://localhost.${PRODUCTION_PROJECT_REF}.supabase.co`,
    'https://abcdefghijklmnop.supabase.co', 'https://api.suuqplus.example', 'http://172.32.0.1:54321', 'http://11.0.0.1', 'http://192.169.1.1', 'http://127.0.0.1.evil.com', 'http://10.0.0.1@evil.com', 'ftp://127.0.0.1', '127.0.0.1:54321', ''])
    assert.equal(contactPriceLocalOverride({ dev: true, flag: 'true', supabaseUrl: bad }), false, `refused ${bad}`);
  assert.equal(contactPriceLocalOverride({ dev: true, flag: 'true' }), false, 'no database configured');
  assert.equal(contactPriceLocalOverride({ dev: true, flag: 'true', supabaseUrl: '  ' }), false);
  for (const flag of [undefined, '', '1', 'TRUE', 'false']) assert.equal(contactPriceLocalOverride({ dev: true, flag, supabaseUrl: local }), false, `flag ${String(flag)}`);
  // wiring: the app and the website read their own variable, both copies of the shared config import it, and neither sets true by hand
  assert.ok(/process\.env\.EXPO_PUBLIC_CONTACT_PRICE_LOCAL/.test(read('data/contactPriceFlag.ts')) && /__DEV__/.test(read('data/contactPriceFlag.ts')));
  assert.ok(/process\.env\.NEXT_PUBLIC_CONTACT_PRICE_LOCAL/.test(read('web/src/lib/contactPriceFlag.ts')) && /NODE_ENV !== 'production'/.test(read('web/src/lib/contactPriceFlag.ts')));
  for (const f of ['data/serviceConfig.ts', 'web/src/lib/serviceConfig.ts']) {
    assert.ok(/CONTACT_PRICE_ENABLED: boolean = CONTACT_PRICE_LOCAL_OVERRIDE;/.test(read(f)), `${f}: the shipped value is only the guarded override`);
    assert.ok(!/CONTACT_PRICE_ENABLED.*= true/.test(read(f)));
  }
  for (const f of ['eas.json', '.env.example', 'web/.env.example', 'web/.env.local.example']) assert.ok(!/CONTACT_PRICE/.test(read(f)), `${f}: no shared or deployment config mentions the flag`);
});
