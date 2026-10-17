// Source-level guards for "the app never downloads every listing at launch" and for the two-way block migration.
// (Behaviour is covered by listingsCore.test.ts / latestResource.test.ts and supabase/tests/listings_reads.test.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('app startup does not load the listings table', () => {
  const layout = strip(read('app', '_layout.tsx'));
  assert.doesNotMatch(layout, /useListingsStore\.getState\(\)\.load\(/);
  assert.doesNotMatch(layout, /\.from\('listings'\)/);
  // the one remaining call is the targeted re-check of a single restored listing
  assert.match(layout, /ensure\(\[id\], \{ force: true \}\)/);
});

test('the listings store has no load-everything action and never reads the table directly', () => {
  for (const f of [['store', 'listings.ts'], ['lib', 'listingsCore.ts'], ['lib', 'listingsApi.ts'], ['hooks', 'useListings.ts'], ['hooks', 'useSellerListings.ts']]) {
    const src = strip(read(...f));
    assert.doesNotMatch(src, /\.from\('listings'\)/, `${f.join('/')} must use the targeted RPCs, not select from listings`);
    assert.doesNotMatch(src, /\bload:\s*\(/, `${f.join('/')} must not define a load-all action`);
  }
});

test('nothing in the app calls a listings-store load()', () => {
  const dirs = ['app', 'components', 'hooks', 'lib', 'store'];
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(e.name) && /useListingsStore\.getState\(\)\.load\(|useListingsStore\(\(s\) => s\.load\)/.test(strip(read(rel)))) hits.push(rel);
    }
  };
  dirs.forEach(walk);
  assert.deepEqual(hits, []);
});

const SCREENS: Record<string, string[]> = {
  'favorites.tsx': ['app', 'favorites.tsx'],
  'compare.tsx': ['app', 'compare.tsx'],
  'offers.tsx': ['app', 'offers.tsx'],
  'recently-viewed.tsx': ['app', 'recently-viewed.tsx'],
  'listing/[id].tsx': ['app', 'listing', '[id].tsx'],
  'listing/insights/[id].tsx': ['app', 'listing', 'insights', '[id].tsx'],
  'listing/gallery/[id].tsx': ['app', 'listing', 'gallery', '[id].tsx'],
  'listing/edit/[id].tsx': ['app', 'listing', 'edit', '[id].tsx'],
  'seller/[id].tsx': ['app', 'seller', '[id].tsx'],
  'dealer/[id].tsx': ['app', 'dealer', '[id].tsx'],
  'saved-searches.tsx': ['app', 'saved-searches.tsx'],
  'post/price.tsx': ['app', 'post', 'price.tsx'],
};

test('migrated screens do not subscribe to, filter or reload an in-memory copy of every listing', () => {
  for (const [name, p] of Object.entries(SCREENS)) {
    const src = strip(read(...p));
    assert.doesNotMatch(src, /useListingsStore\(\(s\) => s\.listings\)/, `${name} subscribes to the whole cache`);
    assert.doesNotMatch(src, /resolveAllListings|globalListings|hasHydrated.*useListingsStore|useListingsStore\(\(s\) => s\.(hasHydrated|load)\)/, `${name} still depends on the load-all cache`);
  }
});

test('each migrated screen uses the targeted hook for what it shows', () => {
  const uses = (p: string[], re: RegExp) => assert.match(strip(read(...p)), re, p.join('/'));
  uses(SCREENS['favorites.tsx'], /useListings\(favoriteIds\)/);
  uses(SCREENS['recently-viewed.tsx'], /useListings\(viewedIds\)/);
  uses(SCREENS['compare.tsx'], /useListing\(id\)[\s\S]*fetchComparableListings/);
  uses(SCREENS['offers.tsx'], /useListing\(listingId\)/);
  uses(SCREENS['listing/[id].tsx'], /useListing\(id\)[\s\S]*fetchComparableListings/);
  uses(SCREENS['listing/insights/[id].tsx'], /useListing\(id\)/);
  uses(SCREENS['listing/gallery/[id].tsx'], /useListing\(id\)/);
  uses(SCREENS['listing/edit/[id].tsx'], /useListing\(mine \? undefined : id\)/);
  uses(SCREENS['seller/[id].tsx'], /useSellerListings\(id\)/);
  uses(SCREENS['dealer/[id].tsx'], /useSellerListings\(id\)/);
  uses(SCREENS['saved-searches.tsx'], /fetchSavedSearchCounts/);
  uses(SCREENS['post/price.tsx'], /fetchComparableListings/);
});

test('Favorites asks for all favourites in one batched call (no request per listing)', () => {
  const src = strip(read(...SCREENS['favorites.tsx']));
  assert.equal((src.match(/useListings\(/g) ?? []).length, 1);
  assert.doesNotMatch(src, /favoriteIds\.map\(|forEach\(.*ensure|for \(const .* of favorit/);
});

test('the edit form is only mounted once the listing is in hand (its fields start from the listing)', () => {
  const src = strip(read(...SCREENS['listing/edit/[id].tsx']));
  assert.match(src, /<EditListingForm key=\{original\.id\} original=\{original\} \/>/);
  assert.match(src, /status === 'loading'/);
  assert.match(src, /status === 'error'/);
});

test('the detail screen separates loading, failed and not-found', () => {
  const src = strip(read(...SCREENS['listing/[id].tsx']));
  assert.match(src, /lookupStatus === 'loading'/);
  assert.match(src, /lookupStatus === 'error'/);
  assert.match(src, /listing\.notFound\.title/);
  assert.match(src, /listing\.loadError\.retry/);
});

test('the offer composer is never shown while ownership of the listing is unknown', () => {
  const src = strip(read(...SCREENS['offers.tsx']));
  assert.match(src, /const canMakeNewOffer = ownershipKnown && !isOwner/);
});

test('the gallery only closes once the server says the listing is not visible', () => {
  const src = strip(read(...SCREENS['listing/gallery/[id].tsx']));
  assert.match(src, /!listing && status === 'missing'/);
});

test('the cache is cleared when the viewer or their block list changes', () => {
  const src = strip(read('store', 'listings.ts'));
  assert.match(src, /useAuthStore\.subscribe/);
  assert.match(src, /useBlockedUsersStore\.subscribe/);
  assert.match(src, /reset\(\)/);
});

test('new error strings exist in English', () => {
  const en = JSON.parse(read('locales', 'en', 'translation.json'));
  for (const k of ['title', 'message', 'retry']) assert.equal(typeof en.listing.loadError[k], 'string');
  assert.equal(typeof en.savedSearches.matchCountMany, 'string');
});

// ---------------------------------------------------------------- migration 0043 (static guards; behaviour in the DB suite)
const m43 = () => read('supabase', 'migrations', '0043_targeted_listing_reads.sql');
test('0043: the block helper is SECURITY DEFINER, argument-less, private (not in public) and not world-executable by default', () => {
  const sql = m43();
  assert.match(sql, /create or replace function private\.blocked_either_way\(\)\s+returns uuid\[\][\s\S]*?security definer/);
  assert.match(sql, /revoke all on function private\.blocked_either_way\(\) from public/);
  assert.doesNotMatch(sql, /function public\.blocked_either_way/);
});

test('0043: the read paths use the helper instead of reading blocked_users as the invoker', () => {
  const sql = m43();
  const afterHelper = sql.slice(sql.indexOf('-- Targeted reads'));
  assert.doesNotMatch(afterHelper, /b\.blocker_id = auth\.uid\(\) and b\.blocked_id = l\.user_id/, 'the one-directional predicate is gone');
  assert.doesNotMatch(afterHelper, /from public\.blocked_users/);
  for (const fn of ['listings_by_ids', 'seller_listings', 'comparable_listings', 'saved_search_counts', 'search_listings', 'home_feed', 'home_feed_currencies']) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}\\(`), fn);
  }
  assert.match(sql, /and l\.user_id <> all\(\$14\)/);
});

test('0043: it does not touch the blocked_users policy or the listings policy', () => {
  const sql = m43();
  assert.doesNotMatch(sql, /create policy|drop policy|alter table public\.(blocked_users|listings)/i);
});

test('0043 rollback restores the one-directional predicate and drops the new objects', () => {
  const rb = read('supabase', 'rollback', '0043_targeted_listing_reads_ROLLBACK.sql');
  assert.match(rb, /b\.blocker_id = auth\.uid\(\) and b\.blocked_id = l\.user_id/);
  for (const fn of ['saved_search_counts', 'comparable_listings', 'seller_listings', 'listings_by_ids']) assert.match(rb, new RegExp(`drop function if exists public\\.${fn}`));
  assert.match(rb, /drop function if exists private\.blocked_either_way\(\)/);
});

test('0044 block enforcement is a real migration with a rollback, and guards the base policy, conversations, offers and messages', () => {
  const sql = read('supabase', 'migrations', '0044_block_enforcement.sql');
  assert.ok(fs.existsSync(path.join(root, 'supabase', 'rollback', '0044_block_enforcement_ROLLBACK.sql')));
  assert.ok(!fs.existsSync(path.join(root, 'supabase', 'proposed', '0044_block_enforcement.sql')));
  assert.match(sql, /create policy "listings are publicly readable"/);
  for (const t of ['conversations_block_guard', 'offers_block_guard_insert', 'offers_block_guard_accept', 'messages_block_guard']) assert.match(sql, new RegExp(t), t);
  assert.match(sql, /revoke all on function private\.users_blocked/);
  assert.doesNotMatch(sql, /grant execute on function private\./);
});
