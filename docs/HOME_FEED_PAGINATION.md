# Home / category / city feed pagination

Status: built and tested locally on 2026-10-16. **Nothing is committed, deployed or applied to a real database.**

## What changed

Home, the category screen and the city screen used to download every listing (plus every price drop) and filter/sort
in memory. They now ask Postgres for one page (24 rows) at a time.

| Piece | Where |
|---|---|
| Server feed (`home_feed`, `home_feed_currencies`) + 2 partial indexes | `supabase/migrations/0042_home_feed.sql`, rollback `supabase/rollback/0042_home_feed_ROLLBACK.sql` |
| Request shaping, cursor, empty-state plan (pure, shared) | `lib/homeFeedPaging.ts` (identical copy `web/src/lib/`) |
| Paged-feed state machine (stale responses, dedupe, refresh, load more, timeout) | `lib/pagedFeed.ts` (identical copy in web), reducer in `lib/searchSession.ts` |
| Mobile fetch + stores + hooks | `lib/homeFeedApi.ts`, `store/homeFeed.ts`, `hooks/usePagedFeed.ts`, `hooks/usePriceOptions.ts`, `lib/feedEvents.ts` |
| Mobile screens | `app/(tabs)/home.tsx`, `app/category/[id].tsx`, `app/city/[name].tsx`, `components/FeedParts.tsx` |
| Web | `web/src/services/homeFeed.ts`, `web/src/store/homeFeed.ts`, `web/src/hooks/usePagedFeed.ts`, `web/src/components/FeedFooter.tsx`, `web/src/app/page.tsx`, `web/src/app/category/[id]/page.tsx` |
| Reference rules (unchanged semantics; now also the SQL's spec) | `lib/homeFeed.ts` |

`home_feed` orders every tab by `(sort_rank asc, created_at desc, id asc)` and pages with a keyset cursor
`(sort_rank, created_at, id)`, so a page never repeats or skips a row that existed when the feed started.

## Behaviour that is deliberately the same
Visibility (`status not in removed/deactivated`; sold/expired/reserved stay visible), blocked sellers, category (id,
plus display name for legacy rows on Home), place scope (approved places, descendants included), Nearby ranking and
"stops at home country", Price (one currency, unusable prices last), Trending score, empty-state alternatives.
`supabase/tests/homefeed.test.mjs` proves SQL == `buildHomeFeed` for 6 tabs × 4 places × 2 category settings.

## Behaviour that changed (confirm)
1. **Mobile no longer mixes the 5 static demo listings (`data/mockListings.ts`) into Home, category and city.** They
   cannot be paged by a server. The website never showed them. They still resolve on the listing screen by id.
2. **Price Drops tab** = listings with `last_price_drop_at` (genuine decreases recorded by the 0038 trigger), newest
   drop first. Before: any row in `price_drops`, which could include a non-decrease.
3. **Category match on Home is exact** on `[id, display name]`; the old client match also ignored case/accents.
4. **Trending is ranked at a fixed instant per feed session**, so scrolling never reshuffles; a pull-to-refresh renews it.

## Known limits (not fixed here)
- ~~`app/_layout.tsx` still calls `useListingsStore.load()` at startup.~~ **Done** — see `docs/LISTINGS_CACHE_REMOVAL.md`: Favorites, Compare, Offers,
  Dealer/Seller, Price and listing-detail screens now fetch by id / seller / sample and nothing downloads every listing at launch.
- Trending / Nearby / Price compute their rank per row, so each page scans the filtered set (top-N, no sort index).
  Fine to tens of thousands of listings; a materialised score would be the next step. Latest/category feeds are index-ordered.
- ~~"Someone blocked me" cannot be enforced by a SECURITY INVOKER function.~~ **Fixed for the app's read paths by 0043** (`private.blocked_either_way()`; both
  directions on Home, search, by-id, seller, comparable and saved-search reads, proven in `supabase/tests/listings_reads.test.mjs`). The base `listings` table policy is
  unchanged — see "Blocking — findings" in `docs/LISTINGS_CACHE_REMOVAL.md`. Note: `homefeed.test.mjs` now stops the chain at 0042 (it proves 0042 alone).
- Pull-to-refresh / Home double-tap refetch only page 1. After a double-tap that also changes the selection, one wasted
  request for the old selection can fire before the new one (the newest always wins).
- so/am translations for the three new `home.*` strings fall back to English.

## To verify externally (BLOCKED here)
1. Apply 0042 to a **staging** Supabase project (after 0038–0041). Confirm `select * from home_feed('latest')` as anon
   and as a signed-in user; PostgREST picks the function up (`notify pgrst, 'reload schema'` if it does not).
2. On a device/emulator: scroll Home to the end (spinner → more rows → "You've seen everything here"); switch tabs /
   categories / places mid-scroll; airplane mode during load-more (quiet Retry row); pull-to-refresh; double-tap Home.
3. In a browser: same on `/` and `/category/<id>`; the sentinel loads the next page, "Load more" works by keyboard.
4. Publish a listing, mark it sold, drop its price, have staff remove it: Home reflects each without a restart.
5. `EXPLAIN` the real queries on staging data volume before launch.
