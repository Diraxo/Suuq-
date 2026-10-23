# Removing the full-listings startup cache (+ two-way block enforcement)

Status: built and tested locally on 2026-10-16. **Nothing is committed, deployed or applied to a real database.**
Migration `0043` and its rollback exist only in the repo; `supabase/proposed/0044_block_enforcement.sql` (+ `_ROLLBACK.sql`) is a proposal, not a migration — see "Blocking — second pass" at the end.

## Before / after (mobile app launch)

| | Before | After |
|---|---|---|
| `app/_layout.tsx` on mount | `useListingsStore.load()` → `listings.select('*')` for **every** non-removed listing, then `profiles.in(all seller ids)` and a batched seller-stats read over all those sellers (3+ unbounded requests, before any screen is open) | **No listings request at all.** Nothing is fetched until a screen asks for what it shows |
| Detail / Favorites / Compare / Offers / Recently Viewed / Edit / Insights / Gallery | read an in-memory copy of the whole catalogue | ask for their ids: cache first, the rest in **batched** requests (≤ 100 ids each, never one per listing) |
| Seller / Dealer screen | filtered the whole catalogue by seller | one `seller_listings()` request |
| Compare, market-price estimate, price suggestion | ranked/averaged over every listing | one same-category sample of ≤ 100 (`comparable_listings()`), same-subcategory first |
| Saved-search "N matches" | counted titles over every listing | one `saved_search_counts()` request for all badges |
| Memory | grows with the catalogue | ≤ 300 listings (newest-touched first), screens' ids pinned |

## What was built

| Piece | Where |
|---|---|
| Server reads + two-way block helper | `supabase/migrations/0043_targeted_listing_reads.sql`, rollback `supabase/rollback/0043_targeted_listing_reads_ROLLBACK.sql` |
| Cache core (tickets, dedupe, stale-response drop, timeout, cap/pin, reset) — pure, unit-tested | `lib/listingsCore.ts` |
| "Newest request wins" loader for the non-id reads | `lib/latestResource.ts`, `hooks/useResource.ts` |
| Supabase calls (`listings_by_ids`, `seller_listings`, `comparable_listings`, `saved_search_counts`) | `lib/listingsApi.ts` |
| Store (plugs the fetcher in; resets on sign-in/out and on block-list change) | `store/listings.ts` |
| Hooks | `hooks/useListings.ts` (`useListings`, `useListing`), `hooks/useSellerListings.ts` |
| Screens | `app/_layout.tsx`, `favorites`, `compare`, `offers`, `recently-viewed`, `saved-searches`, `post/price`, `listing/[id]`, `listing/{insights,gallery,edit}/[id]`, `seller/[id]`, `dealer/[id]`, `business/bulk-upload`; `store/myListings.ts` (no more refetch-all after publish) |
| Tests | `tests/listingsCore.test.ts`, `tests/latestResource.test.ts`, `tests/listingsStartup.test.ts`, `supabase/tests/listings_reads.test.mjs` |

### Rules every screen now follows
- **loading ≠ missing.** A real id that has not been answered yet is *loading* (skeleton). "Not found" appears only when the server did not return the listing
  (removed, deactivated, blocked either way, or it never existed — indistinguishable on purpose). A failed request is its own **error** state with Retry.
- **sold / expired / reserved** listings are returned and shown with their badge (same as before). **removed / deactivated** never are (same as the old startup query), even for the owner and staff.
- A failed *refresh* of a cached listing keeps showing the cached one. Re-checks happen once per screen mount (`revalidate`), pull-to-refresh, and when staff restore a listing.
- **Stale responses are dropped per id**: every request and every local change (publish, edit, sold, removal, sign-out) takes a newer ticket; an older answer never overwrites newer data or resurrects a removed listing.
- Overlapping requests for the same id share one fetch. The edit form is mounted only once its listing is in hand. The offer composer is not shown while ownership of the listing is unknown.
- Realtime: `onHidden` → `removeLocal` (open detail/gallery screens flip to not-found/close); `onShown` → one targeted re-fetch; the paged feeds are told through `lib/feedEvents.ts` as before.

## Blocking — findings

**Existing policy** (`0017`): `blocked_users` has ONE policy, `for all using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id)`.
So a user can read, create and delete only the rows **they created**. Nobody else — not the blocked user, not a bystander — can read a block row; `anon` has no access.

**The bug (confirmed, reproduced in the DB suite before 0043):** `search_listings()` (0038) and `home_feed()` (0042) are SECURITY INVOKER and checked
`(blocker = me and blocked = owner) or (blocked = me and blocker = owner)`. The second half runs under the caller's RLS, so it can never see "X blocked me":
the blocker's listings stayed visible to the blocked user in Home, search and (before this work) the global cache. The client's `blockedByIds`
(a second `blocked_users` query) was always empty for the same reason, so the client-side "either way" filters only ever applied the viewer's own blocks.

**What 0043 does** (no new policy on `blocked_users`, no read access to it):
- `private.blocked_either_way()` — SECURITY DEFINER, **no arguments**, returns only *the caller's own* counterparties (both directions) as one `uuid[]`, evaluated once per query.
  It is in schema `private`, which PostgREST does not expose, so a client cannot call it as an RPC and cannot use it to probe anyone else's relationships.
- `search_listings`, `home_feed`, `home_feed_currencies` (bodies verbatim apart from the predicate) and the four new reads exclude `owner = any(helper)`.
- A blocked listing returns the same empty result as a non-existent id, so one response never says "blocked".
- Index `blocked_users_blocked_idx (blocked_id)` for the reverse lookup.

**Proven by `supabase/tests/listings_reads.test.mjs` (real Postgres/PGlite, real migration chain):** the gap before 0043; both directions (A blocks B ⇒ A doesn't see B *and* B doesn't see A)
on every Home tab, search, currency counts, by-id, seller, comparable and saved-search counts; bystanders unaffected; guests unaffected; unblock restores; a later block applies on the next read;
`blocked_users` stays unreadable to the blocked user and a blocked user cannot lift the block; the helper returns nothing about third parties and is not in `public`; idempotent apply; rollback restores the old behaviour.

**Not fixed / residual — do not read this as "blocking is fully enforced":**
1. The **base `listings` table policy is unchanged.** A blocked user who talks to PostgREST directly (`from('listings').select()`) still reads the blocker's rows. Every *app* read path is covered; the table is not.
   Option tested but **not applied**: `supabase/proposed/0044_block_enforcement.sql` (superseded design — see "second pass" below; also hides rows from direct reads; the owner and staff always see them). Trade-off: any query that joins `listings`
   for a viewer (existing chat/offer threads with a blocked person) loses that listing row. **Needs your decision.**
2. `profiles` are publicly readable, so a blocker's profile page still loads for the blocked user (their listings are empty). `followers`, `reviews`, chat and offers do not enforce the reverse block in the database (client-side checks only, and those only knew the viewer's own blocks).
3. The website's direct table reads (`web/src/services/listings.ts`: detail, favorites by id, similar) are not block-aware in either direction; the proposed policy would cover them.
4. `blockedByIds` in `store/blockedUsers.ts` is still a dead query (always empty under RLS). Left alone; it is harmless and the server now does the hiding.
5. A user can still *notice* that a listing that used to be visible has vanished — unavoidable for any hiding scheme.

## Behaviour changes — need your approval
1. **Blocked either way ⇒ the listing opens as "Listing not found"** (deep link, chat link, notification). Before, only the contact buttons were refused for the viewer's own blocks, and the reverse was never enforced.
2. **Compare / market-price estimate / price suggestion use a sample of up to 100 same-category listings** (same-subcategory first, then newest), not every listing. Averages and ranges on very large categories can differ slightly from before.
3. **Saved-search badges** count in the database, stop at 100 (shown "100+ matches") and now exclude blocked sellers in both directions. They still count any non-removed status (not only available), as before.
4. **Seller / dealer page** fetches up to 100 listings; a seller with more shows the server-side counts instead of counts derived from the list (and no more than 100 cards). Paging seller listings is a follow-up.
5. The static demo catalogue (`mockListings`, currently empty) is resolved locally only; it is never requested.
6. so/am translations for the new strings (`listing.loadError.*`, `savedSearches.matchCountMany`) fall back to English until translated.

## Remaining dependencies on the shared cache (all small, bounded)
- Home/category/city feeds, search and seller pages **add** what they received (`mergeFetched`) so tapped cards open without another request.
- `store/myListings.ts` pushes publish/edit/sold/price/removal into it (`upsertLocal/patchLocal/removeLocal`), which also notifies the paged feeds.
- `startVisibilitySync` reads the cached ids to reconcile hidden listings (`hidden_listing_ids`, ≤ 200 ids).
- Cache cap 300 entries; cleared on sign-in/out/switch and when the viewer's block list changes.
- Not touched (already scoped): `store/myListings.ts` (own listings), the paged feeds, search.

## To verify externally — BLOCKED here
| Check | Why blocked | Next action |
|---|---|---|
| Apply 0043 to a **staging** Supabase project (after 0038–0042) and call the four new RPCs as anon and as a signed-in user | no staging project/credentials in this environment | run the migration; `notify pgrst, 'reload schema'` if the RPCs 404 |
| `private` schema not reachable through the API (`POST /rest/v1/rpc/blocked_either_way` must 404; `private` must not be in "Exposed schemas") | needs the real PostgREST config | check Dashboard → API settings; call the URL |
| Real JWT/RLS path (`auth.uid()` from a real token, both directions with two real accounts) | PGlite simulates JWT claims with GUCs | repeat the A-blocks-B scenario in the app with two test accounts |
| Realtime: staff removes a listing while a detail screen is open → it flips to "not found"; staff restores it → it re-appears | needs real Realtime | staging, two sessions |
| Device/emulator: cold start shows no listings request (network inspector), Favorites with 100+ items, Compare, Offers deep link, airplane-mode errors + Retry, pull-to-refresh | no device/emulator here | run the manual list in the checklist below |
| `EXPLAIN` on production-volume data (`listings_by_ids` = PK lookup; `comparable_listings` = `listings_category_feed_idx`; `seller_listings` = `listings_user_created_idx`; `saved_search_counts` = trigram index) | no production-size data | `EXPLAIN (ANALYZE)` on staging |
| Decide on `0044` (base-table policy) | product/ops decision | see "Blocking — residual" |

## Acceptance checklist

| # | Criterion | Result |
|---|---|---|
| 1 | No startup call that downloads every listing | **PASS** (source guard `tests/listingsStartup.test.ts`; `_layout.tsx` has no `load()`; the store has no load-all action) |
| 2 | Favorites, Compare, Offers, seller/dealer, detail, recently viewed, edit/insights/gallery, price, saved searches migrated | **PASS** (source guards + typecheck + lint) |
| 3 | No per-item request where a batch serves the screen | **PASS** (250 ids → 3 requests; `useListings` once on Favorites) |
| 4 | Deep link: loading is not "not found"; unknown/blocked/removed → not found; failure → error + retry | **PASS** (unit) |
| 5 | Sold / expired / reserved shown; removed / deactivated / inaccessible handled safely | **PASS** (unit + DB) |
| 6 | Multiple favourites / comparisons incl. partial misses and partial batch failure | **PASS** (unit) |
| 7 | Stale responses, refreshes, local edits/removals racing a fetch, reset on sign-out | **PASS** (unit) |
| 8 | Errors: first load, refresh over cached data, timeout, retry | **PASS** (unit) |
| 9 | Authorization / RLS assumptions preserved (invoker functions, hidden statuses) | **PASS** locally (DB suite); real RLS/JWT **BLOCKED** |
| 10 | Block enforced in both directions on every app read path | **PASS** locally (DB suite, 19 checks) |
| 11 | Block enforced on the base table / direct API / web / chat / offers | **PASS locally only if `0044` is applied** (13 DB checks); **FAIL on any database that has only 0043**; real PostgREST/RLS/JWT **BLOCKED** |
| 12 | Existing tests, DB suites, mobile + web TypeScript, lint on changed files, production web build | **PASS** — `npm test` 326/326 · 7 DB suites / 173 checks · `tsc` mobile and web · `next build` · eslint on all changed/new files: 0 errors in new or rewritten code; 8 pre-existing errors remain in code I did not change (`(tabs)/search.tsx` ×3, `dealer/[id].tsx` effect setState, `seller/[id].tsx` ×2 effect/ordering) plus pre-existing warnings |
| 13 | Real Supabase / RLS-JWT / Realtime / device / production-volume checks | **BLOCKED** (table above) |

## Blocking — second pass (proposed `0044_block_enforcement.sql`, NOT applied)

**Audit of every chat / offers / listing workflow.** The `listing:listings(...)` embeds (mobile chat list, chat screen, offers inbox; web chat, offers) are PostgREST *left* joins and the mobile code reads `row.listing?.x`, so a hidden
listing never dropped a thread — except **web `rowToConversation`, which returned `null` and removed the conversation** (fixed). The bigger finding: `find_or_create_conversation`, `create_offer`, `respond_to_offer` and the
`messages` insert policy **never checked blocks at all**, and the first 0044 proposal (RLS policy only) would not have changed that, because the RPCs are SECURITY DEFINER. So a blocked user could still open a chat, send offers and message.

**Narrower design (replaces `0044_listings_block_policy.sql`, now deleted):**
1. Base `listings` SELECT policy is block-aware (owner/staff always see the row) — closes direct PostgREST reads and the web/direct count queries.
2. BEFORE-INSERT triggers on `conversations`, `offers`, `messages` and a BEFORE-UPDATE-of-status trigger on `offers` (→ `accepted`) refuse the action when the pair is blocked either way. Error text is `Listing not found`, the same as a missing listing.
   Reject / cancel / expire stay allowed, so nobody is stuck on a pending offer. History (messages, offers, conversation rows) stays readable.
3. `private.users_blocked(a,b)` is SECURITY DEFINER, in schema `private`, with no EXECUTE for API roles: not callable from PostgREST, so it is not an oracle. `blocked_users` keeps its single "own rows" policy; users still manage/unblock their own list.

**Impact on existing workflows (checked in `block_enforcement.test.mjs`):** non-blocked conversations/offers: unchanged. A thread with a blocked person: still listed, still readable, listing embed becomes null → mobile and web now show
"Listing unavailable" (new key `chat.listingUnavailable`, en/so/am) and hide the Make-offer button instead of showing an empty title and a 0 price.

**Client changes:** web `getListing` / `listListingsByIds` / `listSimilarListings` use `listings_by_ids` / `comparable_listings` (an owner can still open their own removed listing); the unused web load-all `listListings` is gone;
mobile edit screen refuses a listing that is not the signed-in user's.

**Still open / BLOCKED:** real Supabase grants/RLS/JWT/PostgREST behaviour (PGlite only proves the SQL); `profiles`, `followers`, `reviews` still do not enforce a block in the database; message `edit/delete/reactions` and typing/presence on an
*existing* blocked thread are not separately guarded (sending is); web error states still collapse "load failed" into "not found" (mobile distinguishes them); the blocked user's push notifications for an old thread are not suppressed.
