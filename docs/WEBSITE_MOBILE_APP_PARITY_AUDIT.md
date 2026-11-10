# SUUQIYE — Mobile App vs Website Parity Audit

**Date:** 2026-11-09 · **Mode:** read-only investigation · **Reference platform:** mobile app (Expo / React Native)
**Audited commit:** `720013b` ("Rebuild web with corrected Supabase anon key") plus the uncommitted working tree.

> **How to read this report.** Evidence labels are used throughout:
> **[CODE]** read in source · **[DIFF]** byte/line comparison run · **[DB]** read-only SELECT against production (no secrets or personal data recorded) · **[GREP]** presence/count check only — this proves a feature is referenced, **not** that it behaves identically · **[NOT VERIFIED]** could not be tested.
> Where only [GREP] evidence exists, the status is capped at PARTIAL or NOT VERIFIED. Nothing was marked MATCH on the basis of a file existing.

---

## 1. Executive summary

1. **There are three "websites", not one.** (a) the **deployed** site (built from commit `720013b`), (b) the **working tree** `web/` (uncommitted), and (c) the mobile app. The working-tree website has **2,397 added / 620 removed lines across 43 tracked files plus ~25 new untracked files** (ListingDetails, ServiceDetails, DiscountModal, brandCatalog, serviceConfig, listingDetail, discount, photoList, …). **None of that is in the commit the deployed site was built from.** Everything below is split into "deployed (HEAD)" and "working tree" where it matters.
2. **The working-tree website is much closer to the app than the deployed one.** The business-rule files are *copies* of the mobile files and are byte-identical for categoryFields, sellRules, sellText, brandCatalog, listingDetail, serviceConfig, serviceDetail, photoList, searchFilters, searchSession, homeBrowse, pagedFeed, profileSearch (0 differing lines [DIFF]). categories.ts, discount.ts, greeting.ts and contactPriceFlag.ts differ only in comments / the env-variable name.
3. **The deployed site is missing nearly all recent mobile work**: no discount display or management (0 references in the HEAD listing page [CODE]), no grouped listing details (raw `attributes` entries instead), the old category list (9 service subcategories missing), the old sell-text/rules, no service details component, no brand/model catalog pickers.
4. **Even the working-tree site still lacks** (see §8): listing-detail *Compare similar* + *market-price estimate*, Near-me on Home, recently-viewed/search-history parity in Search, sell-draft persistence, the compare screen, pickup planner, city/dealer pages, onboarding, offline screen and mobile-style notification preferences. The Sell flow is also structurally different (6 steps, but Location+Price are merged and a Success step replaces mobile's separate Price step).
5. **Both platforms share one Supabase project and the same RPCs** (`search_listings`, `home_feed`, `home_feed_currencies`) [CODE]. The bigger risk is **database state, not code**: discount migrations through 0081 are live, but **0082–0084, 0072 (private phone) and 0090 (app releases) were not found in production** [DB]. Any client — web or mobile — that depends on them will misbehave until they are applied (§7).
6. **Responsive behaviour could not be tested in a browser** (no deployed URL supplied, no safe browser session). Static review found one concrete defect: no `viewport-fit=cover` is declared, so the tab bar's `env(safe-area-inset-bottom)` padding is inert on notched iPhones (§9).

**Direct answers to the questions in the brief**

| Question | Answer |
|---|---|
| Does the website offer the same features as the app? | **No.** Deployed: far from it. Working tree: most core features, with the gaps in §8. |
| Same listing-creation steps? | **Partly.** Same rules, fields and publish gate; step layout differs (Location+Price merged), no draft persistence. |
| Property/house/room/rental/land attributes equivalent? | **Yes in the working tree** (identical field definitions [DIFF]); **deployed: mostly yes** for fields (rentalKind present at HEAD) but without the new detail rendering. Filtering identical (shared searchFilters). |
| Discounts fully supported? | **Working tree: yes in code; deployed: no.** Server side live through 0081 only. |
| Listing details consistent? | **Working tree: mostly** (facts tiles, grouped sections, service details, discount block). Missing: Compare similar, market-price estimate. **Deployed: no.** |
| Chat / profile / business dashboard equivalent? | **PARTIAL / NOT VERIFIED** — present and wired to the same tables; behaviour not proven identical (§5–§7). |
| Mobile website comparable to the app? | **Not verified**; structure is encouraging (bottom tab bar mirrors the app) but one real defect found. |
| Same backend/database rules? | **Yes by construction** (same project, same RPCs, copied rules) — **but production lags the migrations** the newest code expects. |

---

## 2. Project structure

| Item | Location | Notes |
|---|---|---|
| Mobile app | repo root (`app/`, `components/`, `data/`, `lib/`, `store/`, `hooks/`) | Expo Router, 13.5k lines across `app/` |
| Website | `web/` (`web/src/app`, `components`, `lib`, `services`, `store`, `hooks`) | Next.js 15.5.29, React 19, Tailwind, deployed with OpenNext → Cloudflare Worker `suuqiye` (`web/wrangler.jsonc`) |
| Backend | `supabase/migrations`, `supabase/functions`, `workers/` | One project, `waksddinkjbrggxkfofk` |
| Shared logic | **duplicated, not imported**: `data/*` & `lib/*` ↔ `web/src/lib/*` | Kept in step by hand ("Mirrored in … keep the two in step" comments). Drift risk (§7). |

Cloudflare: `wrangler.jsonc` declares no R2/KV bindings. Image upload from the web goes through the shared `r2-presign` Edge Function [CODE].

## 3. Mobile architecture (reference)
Expo Router tabs `Home / Search / Sell / Chats / Profile`; zustand stores (`store/*`); business rules in `data/*` and `lib/*`; Supabase client + RPCs; sell flow as a modal stack `app/post/*` (photos → category → details → location → price → preview → success) with a persisted draft (`store/postDraft.ts`, `lib/postDraftPhotos.ts`).

## 4. Website architecture
Next App Router (`web/src/app/**`, 52 pages), `MobileTabBar` (md:hidden) mirrors the app's five tabs, desktop `Header` for md+. Services in `web/src/services/*` call the same tables/RPCs. Sell is a **single client page** (`web/src/app/sell/page.tsx`, 881 lines) using an in-page step counter rather than routes. Max content width `max-w-content`.

## 5. Backend and database
Production reads (SELECT only) on 2026-11-09 [DB]:

| Object | Production | Needed by |
|---|---|---|
| `set_listing_discount`, `end_listing_discount`, `settle_expired_discounts`, `listing_discount_live`, `trg_listings_sold_ends_discount` | **present** (0080/0081) | discounts, both clients |
| `listings.discount_original_price / discount_ends_at / discount_permanent / discount_note` | present | discounts |
| 0082 (new-listing no hold), 0083 (discount edit), 0084 (end no hold) | **no verification possible from object names — treat as NOT VERIFIED** | discount editing UI in both clients |
| `listings.seller_presentation`, `image_hashes`, `home_feed`, `search_listings`, `set_active_mode`, `start_business_conversation` | present | identity / publish |
| `my_phone`, `get_contact_phone` (0072) | **absent** | mobile reads phone through these; web `contactPhone.ts` also references them |
| `app_update_policy` (0078) | present | mandatory updates (mobile only) |
| `app_releases` (0090) | **absent** | release-management UI (mobile) |
| `storefronts` (0054) | absent (intentionally parked) | storefront feature flag OFF |
| Listings in production | 6 rows (phones 2, electronics 1, fashion 1, furniture 1, vehicles 1) | — |

Implication: **Property, Services, Jobs etc. have no production listings**, so the deployed site cannot show those workflows with real data at all.
`supabase/MIGRATION_STATUS.md` (not edited) was last verified 2026-10-23 and does not mention 0079–0090.

## 6. Feature inventories

### 6.1 Mobile routes (non-admin) and web equivalents
| Mobile route | Web route (working tree) | Present |
|---|---|---|
| `(tabs)/home` | `/` | yes |
| `(tabs)/search` | `/search` | yes |
| `(tabs)/post-tab`, `post/*` | `/sell` | yes (different step shape) |
| `(tabs)/chats`, `chat/[id]` | `/chat`, `/chat/[id]` | yes |
| `(tabs)/profile` | `/profile` | yes |
| `listing/[id]`, `listing/edit/[id]`, `listing/insights/[id]` | same | yes |
| `listing/gallery/[id]` | in-page viewer in listing page | yes (different) |
| `category/[id]` | `/category/[id]` | yes |
| `seller/[id]`, `storefront/[id]` | same | yes |
| `favorites`, `followers`, `reviews`, `recently-viewed`, `saved-searches`, `notifications`, `offers`, `price-drops` | same names | yes |
| `my-listings`, `seller-dashboard`, `business/{dashboard,analytics,bulk-upload,storefront}` | same | yes |
| `support/*`, `help`, `about`, `verification` | same | yes |
| `settings/*` (appearance, language, blocked-users, safety, saved-addresses, edit-profile, business-profile, terms, privacy, guidelines) | same | yes |
| `settings/notification-preferences` | `settings/push-notifications` | different feature (see §8) |
| `settings/delete-account` | link/flow inside `settings/page.tsx` (`accountDeletion.ts`) | PARTIAL / not verified |
| `compare`, `pickup-planner`, `city/[name]`, `dealer/[id]`, `offline`, `(onboarding)/*` | — | **MISSING** |
| `dev-qa` | — | intentionally not shipped |
| Mandatory update gate / announcements | — | N/A on web (app-store concept) |

### 6.2 Website-only
Full admin console (`/admin/*`: listings, reports, support, users, businesses, locations, history) — mobile has none.

## 7. Master feature parity matrix

Status key: MATCH · PARTIAL · MISSING · BROKEN · INCONSISTENT · RESPONSIVE ISSUE · NOT VERIFIED.
"Deployed" = commit `720013b`; "WT" = working tree.

| # | Feature | Mobile | Website | Backend/Data | Status | Evidence | Required work |
|---|---|---|---|---|---|---|---|
| 1 | Category taxonomy (18 categories, 142 subcategories) | `data/categories.ts` | WT: identical but comments [DIFF]; **Deployed: lacks 9 service subcategories** (Appliance Repair, Construction & Maintenance, Graphic Design, Video Production, Delivery & Courier, Moving & Logistics, Events & Catering, Business Services, Other Services) | static | WT **MATCH** · Deployed **PARTIAL** | diff of HEAD `web/src/lib/categories.ts` | Deploy WT |
| 2 | Category-specific fields (incl. property) | `data/categoryFields.ts` | WT identical (0/1192 lines differ); Deployed 63 lines behind | `listings.attributes` jsonb | WT **MATCH** · Deployed **PARTIAL** | [DIFF] | Deploy WT |
| 3 | Sell validation / publish gate | `data/sellRules.ts` | WT identical; Deployed 24 lines behind | — | WT **MATCH** · Deployed **INCONSISTENT** | [DIFF] | Deploy WT |
| 4 | Sell flow steps | 6 steps: Photos, Category, Details, Location, Price, Preview (+Success) | 6 steps: Photos, Category, Details, **Location & Price**, Preview, Success | same `listings` insert | **INCONSISTENT** | `sell/page.tsx:67-92` | Decide whether to split step 4 |
| 5 | Sell draft persistence / resume | `store/postDraft.ts` persisted, photos persisted to disk | none (no postDraft, no storage) | — | **MISSING** | grep: no draft store in `web/src` | Add draft store (localStorage/IndexedDB) |
| 6 | Photo limit / reorder / cover | `data/photoList.ts` (MAX_PHOTOS) | WT identical file | R2 via `r2-presign` | WT **MATCH** (logic); UI not verified | [DIFF] | — |
| 7 | Photo safety scan | Worker scan not built; enforcement OFF | web has scan dialogs (`ImageScanDialog`) | scan Worker absent | **NOT VERIFIED** | MIGRATION_STATUS "parked" | Confirm intended web behaviour |
| 8 | Brand/model catalog pickers | `CatalogPicker`, `brandCatalog` | WT present & identical data; absent at HEAD | — | WT **MATCH** · Deployed **MISSING** | [DIFF] | Deploy WT |
| 9 | Services: trades, price units, contact-for-price | `serviceConfig` | WT identical; Contact-for-price OFF via flag on both | 0085 un-applied | WT **MATCH**, feature inactive | [DIFF] | Decision on 0085 |
| 10 | Listing details: key-fact tiles + grouped sections + show-more | `components/ListingDetails.tsx` | WT `web/src/components/ListingDetails.tsx` same structure; **Deployed: flat attribute list** | `listings.attributes` | WT **MATCH** (structure) · Deployed **PARTIAL** | code read of both | Deploy WT; visual check |
| 11 | Service details block | `ServiceDetails.tsx` | WT present; Deployed absent | — | WT **MATCH** (structure) | grep + file | Deploy WT |
| 12 | Discount display (original price, % badge, save amount, end text, note) | `lib/discount.ts` | WT identical logic and rendered in listing page; **Deployed: none** | 0080/0081 live | WT **MATCH** · Deployed **MISSING** | `listing/[id]/page.tsx:218-286` | Deploy WT |
| 13 | Seller manages discount (start/edit/end) | `DiscountModal`, `useSellerDiscount` | WT present; Deployed absent | start/end live; **edit (0083) not verified** | WT **NOT VERIFIED** end-to-end | `page.tsx:370-394` | Apply/verify 0082–0084, then test |
| 14 | Discount on cards / feed / search | mobile `ListingCard` | WT ListingCard modified; not compared visually | `home_feed`/`search_listings` carry discount fields | **NOT VERIFIED** | — | Visual + data check |
| 15 | Compare similar listings | `app/compare.tsx`, listing page button | **absent** | — | **MISSING** | grep: `compare` 0 hits in web listing page | Build |
| 16 | Market-price estimate | `getMarketPriceStats` in `data/similarListings.ts` | **absent** | — | **MISSING** | grep 0 hits | Build |
| 17 | Share listing | RN `Share.share` | web page has share (navigator/clipboard) | — | **PARTIAL** (not verified) | grep 4 hits | Check fallback |
| 18 | Report listing/user | `report/index.tsx` | `ReportModal` + `reports.ts` (Phase 4) | same `reports` table | **PARTIAL** (modal vs screen) | web/PHASE4_REPORT.md | Verify reasons list parity |
| 19 | Fullscreen photo viewer | `listing/gallery/[id].tsx` (zoom, retry, windowed) | in-page viewer | R2 | **NOT VERIFIED** | — | Browser test |
| 20 | Home feed (RPC `home_feed`, paging) | `lib/homeFeedApi.ts` | `web/src/services/homeFeed.ts` same RPCs, shared paged modules | same | **MATCH** (data path) | [CODE] | — |
| 21 | Home: Near-me card / Nearby tab | `NearMeCard`, `geoMatch` | **no NearMe on web home** (0 hits) | `locations` | **MISSING** | grep | Build or decide web equivalent |
| 22 | Search RPC + filters | `search_listings`, `searchFilters` identical | same | same | **MATCH** (query path) | [DIFF] | — |
| 23 | Search: history / recently viewed | 10 history refs, recents shown | 4 refs, no recents | `recently_viewed` store (client) | **PARTIAL** | grep | Bring parity |
| 24 | Saved searches | `saved-searches` | `/saved-searches` | `saved_searches` | **PARTIAL** (not compared) | — | — |
| 25 | Chat: realtime, reactions, reply, edit, delete, block, images | `app/chat/[id]` + `components/chat/*` | `/chat/[id]` + hook `useConversationChannel` | same `messages`, `message_reactions` | **PARTIAL / NOT VERIFIED** — only counts compared; web lacks mobile's unread/unseen separators, date separators, system notices components as separate pieces | grep; `ls components/chat` vs `web/src/components/chat` | Deep behavioural test |
| 26 | Chat opened from listing / seller | yes | yes | `start_business_conversation` live | **NOT VERIFIED** | — | — |
| 27 | Profile (stats, modes, edit, avatar) | `(tabs)/profile` 352 lines | `/profile` 241 lines; shared profileRules | same | **PARTIAL** | line counts [GREP] | Side-by-side |
| 28 | Active identity switch (personal ↔ business) | `ActiveIdentitySwitch`, `ProfileModeSwitch` | present in web | `set_active_mode` live | **PARTIAL / NOT VERIFIED** | — | — |
| 29 | Business dashboard | 64-line menu → bulk, analytics, storefront | `/business/dashboard` 63 lines, same four entries; storefront link goes to `/settings` instead of `/settings/business-profile` when flag off | — | **INCONSISTENT** (minor) | both files | Align link |
| 30 | Bulk upload | `business/bulk-upload.tsx` 346 | web 332 + `BulkQueuePanel` | R2 | **PARTIAL / NOT VERIFIED** | — | — |
| 31 | Analytics / insights | yes | yes | — | **PARTIAL** | — | — |
| 32 | Edit listing | 897 lines | 626 lines | `update` | **PARTIAL** (smaller; discount/photo handling not verified) | line counts | Walk through each field |
| 33 | Offers / price drops | yes | yes | `offers`, `price_drops` | **PARTIAL** (price-drop modal removed in WT both sides) | git status shows `PriceDropModal` deleted in both | Confirm intentional |
| 34 | Notifications | realtime | realtime (Phase 4 confirms) | same | **MATCH** (per prior report; not re-tested) | web/PHASE4_REPORT.md | — |
| 35 | Notification preferences | `settings/notification-preferences` | `settings/push-notifications` (web push) | — | **INCONSISTENT** (different concept) | route lists | Define web scope |
| 36 | Language (en/so/am) | i18n | `webText` en/so/am | — | **PARTIAL**: web en file is 3,404 lines, committed 3,033; Somali/Amharic drafts pending review | line counts; `locales/pending-review.json` | Translation review |
| 37 | Auth (Google, Apple) | Google + Apple | Google (`GoogleSignInButton`); **no Apple button** | Supabase auth | **MISSING** (Apple) | `components/AppleSignInButton.tsx` only in mobile | Decide |
| 38 | Account deletion | dedicated screen + edge function (needs deploy) | settings flow | edge fn undeployed per status doc | **NOT VERIFIED** | MIGRATION_STATUS | — |
| 39 | Pickup planner, city pages, dealer page, onboarding, offline screen, compare screen | present | absent | — | **MISSING** | route list | Prioritise (§12) |
| 40 | Private phone (0072) | reads `my_phone()/get_contact_phone()` | same helper in `web/src/lib/contactPhone.ts` | **0072 absent in prod** | **NOT VERIFIED / risk** | [DB] | Resolve with owner |
| 41 | Mandatory update gate | `UpdateRequiredGate` | N/A | 0078 live, 0090 absent | N/A | — | — |

## 8. Gap list with priority

**P0 — none confirmed.** No evidence found of the website writing corrupted listing data or exposing data mobile protects. Caveat: web writes to the same `listings` table with copied validation, so risk is low but a real publish test (forbidden here) would be needed to prove it. One item *could* qualify as P0/P1 depending on intent: **phone privacy** — 0072 is not live, so `profiles.phone` may still be readable by the web (and app) through the public profile SELECT policy (an earlier verified fact in project notes: anon REST returned phones). This is a backend state, not a web-vs-app difference; flagged for the owner.

**P1 — High**
- G1 Deployed site is a pre-discount, pre-details build (no discount, flat details, old services list). *Impact:* customers using the shared URL see a different product from the app.
- G2 Discount management cannot be called "supported" on web until 0082–0084 are verified live and a manual test passes.
- G3 No sell-draft persistence on web: a refresh or navigation loses the photos and answers.
- G4 Listing page lacks Compare similar and market-price estimate.

**P2 — Medium**
- G5 Sell step structure differs (Location+Price merged).
- G6 No Near-me on web Home; search lacks recents; no pickup planner / city / dealer / compare / onboarding / offline pages.
- G7 Apple sign-in absent on web.
- G8 Viewport lacks `viewport-fit=cover` (safe-area defect on notched phones).
- G9 Edit-listing screen is 30% smaller than mobile's; each capability needs a walkthrough.
- G10 Business dashboard storefront link target differs when the flag is off.

**P3 — Low**
- G11 Copied-file comment drift; env-var names differ intentionally.
- G12 `.preview.log`, a stray file literally named `tatus --short` in the repo root, and a nested `web/` build artefact set exist — housekeeping.

## 9. Mobile responsive audit (static only)

Not run in a browser at 320–430px / tablet / desktop: no website URL was provided and I did not start a dev server (it writes build output). **All viewport findings are therefore [CODE]-based and unverified visually.**

- **Good:** `MobileTabBar` mirrors the five app tabs, `md:hidden`, uses `pb-[env(safe-area-inset-bottom)]`; `main` has `pb-20` to clear it; `ListingDetails` fact tiles use `grid-cols-[repeat(auto-fit,minmax(140px,1fr))]`, wrapping text (`break-words`); `DiscountModal` is `max-w-[380px] max-h-[90vh]` with scrolling.
- **Defect (G8):** `app/layout.tsx` exports no `viewport` with `viewportFit: 'cover'`. Without it, `env(safe-area-inset-*)` evaluates to 0 on iOS Safari standalone/notched devices, so the tab bar's safe-area padding does nothing. Responsive/safe-area issue, P2.
- **Risk to test:** several pages fix widths (`max-w-[720px]` seller/storefront pages are fine at small widths); `min-w-[14rem]` in `AdminBusinessDirectory` may overflow at 320px (admin only).
- **Not assessed:** keyboard behaviour in sell forms, sticky actions, 320px overflow, touch-target sizes, image galleries.

## 10. Workflow comparison (sample; steps from code)

| Workflow | Mobile | Website (WT) | Difference | Result |
|---|---|---|---|---|
| Open Home | Tabs → Home; greeting, near-me, category chips, `home_feed` | `/`; greeting, category chips, `home_feed` | No Near-me | PARTIAL |
| Search | Search tab, history, filters → `search_listings` | `/search`, same RPC and filters | History/recents thinner | PARTIAL |
| Open listing | `listing/[id]` | `/listing/[id]` | Compare similar, market estimate missing (WT); discounts/details missing (Deployed) | PARTIAL |
| View images | gallery screen | in-page viewer | not verified | NOT VERIFIED |
| Contact seller / chat | chat from listing | chat from listing | not tested | NOT VERIFIED |
| Favourite | store/favorites | store/favorites | same table | PARTIAL |
| Create normal listing | 6 route steps, draft | 6 in-page steps, no draft | Step 4/5 merged; no resume | INCONSISTENT |
| Create property listing | same flow + property fields | same fields (identical definitions) | as above | INCONSISTENT (flow) / MATCH (fields) |
| Create rental listing | `rentalKind`, `rentPeriod`, `leaseTerm` | same | as above | MATCH (fields) |
| Create service listing | service fields, price units | same files | contact-for-price OFF both | MATCH (WT) |
| Add discount | listing → DiscountModal | listing → DiscountModal (WT) | Deployed: none; server 0083/0084 unverified | NOT VERIFIED |
| Edit listing | 897-line screen | 626-line page | scope to be walked | PARTIAL |
| Update images | edit screen | edit page | not verified | NOT VERIFIED |
| Business dashboard | 4-entry menu | 4-entry menu | link target on storefront | INCONSISTENT (minor) |
| Update profile | edit-profile | edit-profile (+ images) | not verified | PARTIAL |
| Notifications | realtime list | realtime list | per Phase 4 report | MATCH (not re-tested) |

## 11. Property, house, room, land parity

Subcategories (identical to web WT): House for Sale, House for Rent, Apartment for Sale, Apartment for Rent, Single Room for Rent, Land, Shop, Office, Commercial Property, Warehouse, Guest House / Villa. [DIFF: categories.ts]
Fields (from `categoryFields.ts`, identical in WT): bedrooms, bathrooms, bathroomType, size, yearBuilt, titleDeed, utilitiesIncluded, leaseTerm, rentalKind; land: size, unit, landType, titleDeed, roadAccess, water, electricity; common: address, landmark, neighborhood, electricity, water, parking, furnished, availability, rentPeriod. Saved into `listings.attributes` (jsonb) on both platforms. Displayed through `listingDetail.ts` (identical). Filters through shared `searchFilters.ts`.
**Status:** WT MATCH on definitions/display logic; Deployed PARTIAL (older rendering). **Not verified on real data** — production contains zero property listings [DB].
Note: mobile has a "rooms" concept expressed as bedrooms; no separate "number of rooms" field exists in either app — I did not invent one.

## 12. Recommended implementation order (for later approval)

1. **Decide the deploy baseline.** Review and commit the working-tree `web/` changes (they are what most of this audit's "MATCH" depends on), then rebuild and redeploy. Highest value, lowest effort.
2. **Backend readiness:** verify/apply 0082–0084 (discounts) and decide 0072 (phone privacy) before shipping the discount editor and contact buttons widely.
3. Viewport / safe-area fix (G8).
4. Sell draft persistence (G3), then decide on splitting Location/Price (G5).
5. Listing page: Compare similar + market-price estimate (G4).
6. Home Near-me, search recents (G6).
7. Walk-through parity tests for edit listing, chat, profile, bulk upload (the PARTIAL / NOT VERIFIED rows).
8. Lower priority: Apple sign-in, onboarding, pickup planner, city/dealer pages.

**Dependencies/risks:** duplicated rule files will drift again — a shared package or a parity test comparing the pairs would prevent it. Many web files are modified together; committing selectively needs care. Translation drafts (so/am) await review.

## 13. Not verified (transparent list)
- The deployed website itself (URL not provided; no browser session).
- All viewport sizes; visual comparison of any screen.
- Authenticated flows (no test account), real publishing, real chat messages, discount start/end behaviour.
- 0082/0083/0084 live state; Edge Function deployment state; R2.
- Chat, profile, edit-listing, bulk-upload, offers behavioural equivalence (only structural / count checks).
- Whether Cloudflare was built from `720013b` exactly (inferred from git log, no deployment record seen).

## 14. Final readiness assessment
- **Deployed website:** not at parity. Treat it as an earlier product version.
- **Working-tree website:** close on listing/search/sell logic, missing a handful of mobile screens, unverified visually and against the database for the newest discount features.
- **Recommendation:** do not market the web link as equivalent to the app until step 1–2 of §12 are done and a visual pass at phone widths is completed.

## 15. Safety confirmation
- No source code was modified (the only new file is this report).
- No schema change, no migration created or applied; database access was SELECT-only against catalog tables and one `GROUP BY` count on `listings.category`.
- No production records changed; no test listings, messages or accounts created.
- No Cloudflare settings changed; no deployment; no commit or push.
- Existing modified/untracked files preserved; the git status before and after the audit was identical (verified by diff) apart from this report. The initial status was saved outside the repo (233 entries: 125 modified, 2 deleted, 106 untracked).
- `supabase/MIGRATION_STATUS.md` was read, not edited.
