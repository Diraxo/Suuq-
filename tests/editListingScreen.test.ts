// Guards for the listing edit screen (rebuilt after an accidental deletion), the localization of the strings it and the
// load-error states use, and the client side of the block policy. These are source-level checks: the repo has no React
// Native renderer in its test setup, so what is asserted here is "the behaviour the review found is still wired in".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');
const edit = read('app', 'listing', 'edit', '[id].tsx');

type Json = { [k: string]: Json | string };
const locale = (l: string): Json => JSON.parse(read('locales', l, 'translation.json'));
const flat = (o: Json, prefix = '', out: Record<string, string> = {}): Record<string, string> => {
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else flat(v, key, out);
  }
  return out;
};
const en = flat(locale('en'));
const so = flat(locale('so'));
const am = flat(locale('am'));

test('edit screen keeps every original field in its form and its save patch', () => {
  for (const state of ['images', 'title', 'description', 'price', 'currency', 'condition', 'category', 'subcategory', 'negotiable', 'city', 'attributes', 'features', 'sellerNotes', 'status']) {
    assert.match(edit, new RegExp(`\\[${state}, set${state[0].toUpperCase()}${state.slice(1)}\\] = useState`), `state: ${state}`);
  }
  const patch = edit.slice(edit.indexOf('const patch: Partial<Listing> = {'), edit.indexOf('const patch: Partial<Listing> = {') + 1500);
  for (const field of ['title', 'description', 'category', 'subcategory', 'condition', 'currency', 'negotiable', 'city', 'region', 'status', 'images', 'imagePublicIds', 'attributes', 'features', 'sellerNotes']) {
    assert.match(patch, new RegExp(`\\b${field}\\b`), `patch field: ${field}`);
  }
  assert.match(edit, /price: priceNum/, 'price is part of the same single write');
});

test('edit screen validation uses the shared sell rules (same as the post flow)', () => {
  assert.match(edit, /from '@\/data\/sellRules'/);
  for (const fn of ['validateTitle', 'validateDescription', 'validatePrice', 'validateAttributes', 'sanitizeAttributes', 'sanitizeFeatures']) assert.match(edit, new RegExp(fn), fn);
  assert.match(edit, /images\.length === 0/, 'at least one photo is still required');
  assert.match(edit, /!city/, 'a city is still required');
});

test('edit screen loads one listing by id (never the whole catalogue) and only lets the owner edit it', () => {
  assert.doesNotMatch(edit, /useListingsStore|resolveListing|allListings/);
  assert.match(edit, /useListing\(mine \? undefined : id\)/);
  assert.match(edit, /fetched\.seller\.id === meId/, 'a listing fetched by id must belong to the signed-in user');
  assert.match(edit, /status === 'error'/, 'a failed load shows the retry state');
  assert.match(edit, /listing\.notFound\.title/, 'missing/blocked/not-yours shows the generic not-found state');
});

test('edit screen: price changes are one atomic write (the database records the drop), image cleanup only after the row saved', () => {
  assert.doesNotMatch(edit, /dropPrice/);
  const save = edit.indexOf('updateListing(original.id');
  const cleanup = edit.indexOf('deleteR2Assets(');
  assert.ok(save > 0 && cleanup > save, 'R2 cleanup runs after the row update');
  assert.match(edit, /uploadListingImagesStrict/, 'new photos are uploaded before the row is touched');
  assert.match(edit, /router\.back\(\)/);
  assert.match(edit, /router\.replace\('\/my-listings'\)/, 'delete returns to My Listings');
});

test('every literal t() key the edit screen uses exists in English, Somali and Amharic', () => {
  const keys = Array.from(edit.matchAll(/\bt\('([A-Za-z0-9_.]+)'/g)).map((m) => m[1]);
  assert.ok(keys.length > 30);
  for (const k of new Set(keys)) {
    for (const [name, table] of [['en', en], ['so', so], ['am', am]] as const) {
      const hit = k in table || `${k}_other` in table;
      assert.ok(hit, `${name}: missing ${k}`);
    }
  }
});

test('Somali and Amharic have every English key (no new English-only strings)', () => {
  const miss = (t: Record<string, string>) => Object.keys(en).filter((k) => !(k in t));
  assert.deepEqual(miss(so), [], 'Somali is missing keys');
  assert.deepEqual(miss(am), [], 'Amharic is missing keys');
});

test('new listing load-error / match-count / chat strings are really translated, not copied English', () => {
  for (const k of ['listing.loadError.title', 'listing.loadError.message', 'listing.loadError.retry', 'savedSearches.matchCountMany', 'chat.listingUnavailable', 'home.loadMoreFailed', 'home.refreshFailed']) {
    assert.notEqual(so[k], en[k], `so ${k}`);
    assert.notEqual(am[k], en[k], `am ${k}`);
  }
  for (const table of [en, so, am]) assert.match(table['savedSearches.matchCountMany'], /\{\{count\}\}\+/, 'keeps the count and the "+" cap marker');
  // placeholders must survive translation
  const ph = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join(',');
  for (const k of Object.keys(en)) {
    if (!(k in so) || !(k in am)) continue;
    assert.equal(ph(so[k]), ph(en[k]), `so placeholders differ: ${k}`);
    assert.equal(ph(am[k]), ph(en[k]), `am placeholders differ: ${k}`);
  }
});

test('mobile and web chat render a thread whose listing is hidden (removed or blocked) instead of dropping it or showing 0', () => {
  const mobile = read('app', 'chat', '[id].tsx');
  assert.match(mobile, /listingUnavailable/);
  assert.match(mobile, /chat\.listingUnavailable/);
  const web = read('web', 'src', 'services', 'chat.ts');
  assert.doesNotMatch(web, /if \(!row\.listing\) return null/);
  assert.match(web, /listingUnavailable: !row\.listing/);
});

test('web public listing reads go through the block-aware RPCs, never a load-all', () => {
  const svc = read('web', 'src', 'services', 'listings.ts');
  assert.match(svc, /rpc\('listings_by_ids'/);
  assert.match(svc, /rpc\('comparable_listings'/);
  assert.doesNotMatch(svc, /export async function listListings\(/);
  assert.doesNotMatch(svc, /from\('listings'\)\.select\('\*'\)\.not\('status', 'in'/);
});
