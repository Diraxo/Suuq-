# Fursad Website — Phase 3 Report

Two threads this phase: (1) built the My Listings / seller-dashboard surface that Phase 1/2 had explicitly stubbed out, and (2) a fresh, skeptical code-level parity review of favorites/chat/offers/sell/reporting — areas Phase 2 already built but hadn't been re-audited since. No mobile files were touched (verified at the end — see §6).

---

## 1. My Listings dashboard, listing edit, listing insights, price drop, gallery viewer

### Feature: My Listings dashboard

**Mobile behavior** (`app/my-listings.tsx`, `store/myListings.ts`): a dedicated screen reachable from Profile's "My Listings" menu item and from tapping the Listings/Sold stat on Profile. Shows a stats card (listings, sold, followers, following, rating, reviews, views, favorites — all derived live from reactive stores, no refetch needed), four status tabs (Active/Reserved/Sold/Expired), and a row per listing with a photo, title, price, views/saves badges, and three action icons: drop price, insights, edit.

**Website before**: did not exist. `web/src/app/profile/page.tsx`'s menu had a `{ label: 'My Listings', href: '/profile', auth: true }` entry — it routed back to the Profile page itself. The code comment above the menu said outright: *"Screens not yet built in Phase 1 (My Listings, Seller/Business Dashboard, Price Drops, Saved Searches, Offers, Followers, Verification) route back here for now."*

**Problem**: a seller signing into the website had no way to see their own listing list broken out by status, no way to view stats beyond the four shown on the Profile stat row, and no way to edit, delete, or drop the price on a listing at all.

**Website changes**: new `web/src/app/my-listings/page.tsx`. Reads `listMyListings(userId)` (new function in `web/src/services/listings.ts`, same `listings` table filtered to `user_id = auth.uid()`, all statuses) plus `getSellerStats(userId)` (already existed, reused as-is). Same four tabs, same stat grid content mobile shows (see gap noted below on `followers` vs `following`), same three per-row actions. Profile's "My Listings" menu entry and the Listings/Sold stat-row cells now link to `/my-listings` and `/my-listings?tab=sold` respectively, matching mobile's `router.push('/my-listings')` / `router.push('/my-listings?tab=sold')`.

**Backend**: `listings` table (`select * eq user_id`), `followers`/`reviews` tables via the existing `getSellerStats()` query. No RLS, RPC, or migration changes.

**Verification**: code verified against `app/my-listings.tsx` line-by-line. Build verified (`npm run build`: 0 TS errors, route compiles). Server-smoke-verified: `npm run start` against the real Supabase project, `curl http://localhost:3000/my-listings` → 200, no error strings in the response body, no server-log exceptions. **Not authenticated-E2E-verified** — no browser or signed-in session is available in this environment, so the actual tab-switching, price-drop click flow, and live stat values were never seen rendered by a real logged-in user.

**Remaining gap**: the stats grid shows **Listings / Sold / Followers / Rating / Reviews / Views / Favorites** — seven of mobile's eight. Mobile's eighth stat is **Following** (`store/follow.ts`'s `following` count). The website has **no follow feature at all** — no `web/src/store/follow.ts`, no follow/unfollow button anywhere in `web/src`. This is a pre-existing, separate gap from earlier phases, not something this pass introduced or fixed; it's called out here because it's the direct reason My Listings can't show all eight mobile stats.

### Feature: Listing edit

**Mobile behavior** (`app/listing/edit/[id].tsx`, 719 lines): photo grid with add/replace/remove/reorder (via explicit earlier/later buttons, not drag), status selector (Active/Reserved/Sold/Expired), title, category+subcategory picker (bottom-sheet modal), price, currency, negotiable toggle, description, condition, **per-category dynamic attribute fields** (`data/categoryFields.ts`), **per-category feature checkboxes** (`data/categoryFeatures.ts`), free-text seller notes, city picker, a read-only phone display with a link to change it in settings, Save, and Delete (with confirmation).

**Website before**: no edit page existed at all — no `web/src/app/listing/edit/` directory.

**Problem**: a seller could not correct a typo, change a price, change status to Sold/Reserved, add/remove photos, or delete a listing from the website under any circumstances.

**Website changes**: new `web/src/app/listing/edit/[id]/page.tsx`. Covers photos (add/remove/reorder), status, title, category+subcategory (inline expandable panel instead of a bottom sheet — same category data, same picker logic, different container since a bottom sheet isn't a web-native pattern), price, currency, negotiable, description, condition, and city. Save routes price *decreases* through the same `dropListingPrice()` path mobile's `save()` uses (so a decrease shows up in Listing Insights' price-drop count), and increases/same-price writes go through a normal `updateListing()` call — this exactly mirrors the branch in `app/listing/edit/[id].tsx`'s `save()`. Delete removes the row and best-effort cleans up R2 objects for every removed/replaced photo (see backend note below). New service functions: `updateListing()`, `deleteListingRow()`, `dropListingPrice()`, `listPriceDrops()` in `web/src/services/listings.ts`; `deleteFromR2()` and `r2KeyFromUrl()` in `web/src/services/r2.ts`.

**Backend**: `listings` table update/delete (`auth.uid() = user_id` RLS, unchanged), `price_drops` insert, `r2-delete` Edge Function (already existed, used by mobile — unchanged). One implementation detail worth flagging: mobile stores the R2 object key explicitly in `listings.image_public_ids` at upload time, so it always knows exactly which key to delete. **The website's `createListing()` (built in Phase 2, `web/src/services/listings.ts`) never wrote to `image_public_ids` — it only stores the public URL.** So this pass's delete/edit cleanup path derives the R2 key back out of the stored URL (`r2KeyFromUrl()`: strip the URL down to its path, which is exactly what `r2-presign`'s `publicUrl = R2_PUBLIC_URL + '/' + key` construction guarantees). Verified this is a correct inverse of `r2-presign`'s key construction by reading `supabase/functions/r2-presign/index.ts` directly. This works for every photo uploaded through the website; it silently no-ops (skips) for legacy Cloudinary URLs or picsum placeholder URLs, the same way mobile's own delete path already skips rows with no stored public id.

**Verification**: code verified against `app/listing/edit/[id].tsx`. Build verified. Server-smoke-verified (200, no error strings, no server-log exceptions on a nonexistent listing id — the not-found branch). **Not authenticated-E2E-verified.**

**Remaining gap — scope decision, not an accident**: mobile's dynamic category attributes, feature checkboxes, and seller notes are **not editable on the website**, because that whole data layer (`data/categoryFields.ts`, `data/categoryFeatures.ts`, the `DynamicField` component) has never been ported to `web/` at all — not in this pass, and not in the Sell flow either (see §2 below, finding 2). Building that is a separate, sizeable task. The phone-number display/change shortcut was also left out for the same reason (no web equivalent of the settings edit-profile phone flow was in scope here).

### Feature: Listing insights

**Mobile behavior** (`app/listing/insights/[id].tsx`): owner-only screen showing views, favorites, and price-drop count as three stat cards, plus a Created/Last-updated timeline.

**Website before**: did not exist.

**Website changes**: new `web/src/app/listing/insights/[id]/page.tsx`. Same three metrics, same timeline. One data-layer fix needed to support this: **the website's `Listing` type and `rowToListing()` mapper never carried `created_at`/`updated_at` at all** — only a pre-formatted relative-time string (`postedLabel`) was kept, with the raw timestamps discarded. Added `createdAt`/`updatedAt` (epoch ms, matching mobile's `Listing` type) to `web/src/lib/types.ts` and populated them in `web/src/services/listings.ts`'s `rowToListing()`. This is a small, low-risk type addition (existing callers only read fields they already used).

**Backend**: `listings` table (already-fetched columns, now also mapped), `price_drops` table (`select * eq listing_id`, already used by My Listings). No new tables/RPCs.

**Verification**: code verified against `app/listing/insights/[id].tsx`. Build verified. Server-smoke-verified. **Not authenticated-E2E-verified.**

**Remaining gap**: none beyond what mobile itself shows.

### Feature: Price drop

**Mobile behavior** (`components/PriceDropModal.tsx`, used from `app/my-listings.tsx` and `app/listing/edit/[id].tsx`'s save flow): tapping the price-drop icon opens a modal pre-filled with a *suggested* price (90% of current, rounded, never auto-applied), requires explicit confirmation, validates the new price is numeric, positive, and strictly lower than the current price, and only writes to the database on Confirm.

**Website before**: no price-change UI existed at all outside the (nonexistent) edit page.

**Problem**: CLAUDE.md explicitly warns against a single accidental click silently changing a price. There was no price-change path on web to have this problem in the first place — but there was also no way to drop a price at all.

**Website changes**: new `web/src/components/PriceDropModal.tsx`, a direct port — same 90%-suggested/never-auto-applied behavior, same three validation rules, same explicit-confirm gate. Wired from `/my-listings` (price-drop icon on each Active listing row) and reachable indirectly through `/listing/edit/[id]` (typing a lower price and saving routes through the same `dropListingPrice()` backend call, per mobile's own save-flow behavior — see the edit-listing writeup above). Old price is available via `formatBirr(currentPrice)` in the modal header; the listing detail page already crosses out old/shows new price correctly where that UI exists (unchanged this pass).

**Backend**: `listings.price` update + `price_drops` insert — identical statements to `store/myListings.ts`'s `dropPrice()`.

**Verification**: code verified against `components/PriceDropModal.tsx`. Build verified. **Not authenticated-E2E-verified** — the actual confirm-writes-price-and-updates-everywhere-immediately behavior was never exercised against a real signed-in click.

**Remaining gap**: none identified against the mobile reference.

### Feature: Listing image gallery / full-screen viewer

**Mobile behavior** (`app/listing/gallery/[id].tsx`): tapping a listing photo navigates to a dedicated full-screen route — swipeable, pinch-zoomable (`ZoomableImage`), dot-indicator pagination, a close button, dark background.

**Website before**: the listing detail page (`web/src/app/listing/[id]/page.tsx`) already showed the hero image with tappable thumbnails to switch `activeImage`, but tapping the *hero image itself* did nothing — no full-screen view existed.

**Website changes**: added an in-page lightbox overlay to `web/src/app/listing/[id]/page.tsx` — click the hero image to open it full-screen (dark background, `object-contain` so nothing is cropped), prev/next arrow buttons, a close button, and the same dot-indicator pagination mobile shows. Implemented as a modal overlay rather than a separate route/page, since that's the idiomatic web pattern for this (no full navigation round-trip needed) — everything else (what it shows, how pagination works) matches mobile. Pinch-zoom was not ported (no direct browser equivalent to `ZoomableImage`'s gesture handling; standard browser pinch-to-zoom on a fixed-position overlay is unreliable across browsers) — flagging this per §21 of the brief rather than silently deciding it doesn't matter: **mobile supports pinch-zoom in the full-screen viewer; the website's lightbox does not.** If that's wanted, it would need a dedicated web gesture library.

**Backend**: none — client-only.

**Verification**: code-verified against `app/listing/gallery/[id].tsx`. Build verified. **Not authenticated-E2E/browser-verified** (no interactive browser available).

---

## 2. Deep code-level review of favorites, chat, offers, sell, and listing reporting

This was a fresh review, not a re-statement of the Phase 2/2.5 reports — it re-read the actual mobile and web source side-by-side and looked specifically for behavioral divergence, race conditions, and UI-only fakes. **No code changes were made in this section** — findings only, most severe first.

### Finding 1 (moderate-high): Chat reactions and reply-to-message are wired in the data layer but completely unreachable in the web UI

`web/src/hooks/useConversationChannel.ts` exports a working `toggleReaction()` (same `message_reactions` upsert/delete Supabase calls as mobile) and the message type carries `replyToId`/`reactions` fields — but nothing in `web/src` ever calls `toggleReaction`, and `web/src/components/chat/MessageComposer.tsx` has no `replyTo`/`onCancelReply` props at all (mobile's does). `web/src/components/chat/MessageBubble.tsx` never renders a reply-preview block or reaction pills (mobile's does both). **Verified directly**: grepped `web/src` for `toggleReaction` — the only two hits are the function's own definition and its export from the hook; zero call sites. Grepped for `replyTo` in `web/src/components/chat` and `web/src/app/chat` — zero hits.

Net effect: if a mobile user reacts to a message or replies to a specific message, that's real data in Postgres, but a web user viewing the same conversation never sees it — and a web user has no way to react or reply at all. This is a real cross-platform behavioral gap, not a cosmetic one.

### Finding 2 (moderate): Sell flow never collects category attributes/features/seller notes — every web-created listing permanently lacks them

`web/src/app/sell/page.tsx` has no step for category-specific fields (mobile's `app/post/details.tsx` + `data/categoryFields.ts`), and `web/src/services/listings.ts`'s `createListing()` hardcodes `attributes: {}, features: [], seller_notes: []` on every insert — confirmed by direct reading of the insert call. This is the same missing data layer noted as an edit-page scope gap above (§1), but it's more severe here because it means **every listing published through the website is missing this data from creation**, not just uneditable afterward.

Related: the Sell flow also never asks for a phone number, unlike mobile's `app/post/preview.tsx` (which saves `profiles.phone` on first listing if it's missing). A seller who lists via web before ever setting a phone number will show no working Call button to buyers on either platform until they set one some other way.

### Finding 3 (low-moderate): No Sell-flow draft persistence on web

Mobile's `store/postDraft.ts` persists the in-progress listing to device storage so the multi-step flow survives being backgrounded. The website's Sell flow keeps all 6 steps in plain component state — a page refresh or accidental navigation away loses everything typed so far. Not a correctness bug, but a real parity gap for what's often a multi-minute flow (especially photo selection).

### Finding 4 (confirmed, scope only): Listing reporting is a pure UI placeholder, and it's the only reporting gap

`web/src/app/listing/[id]/page.tsx`'s "Report this listing" button is the **only** report-related affordance anywhere in `web/src` (grepped case-insensitively for "report" — no other hits), and it does exactly what it says: shows `alert("Reporting isn't built in the web UI yet — use the mobile app to report a listing.")`, no Supabase call. This is an honest placeholder, not a fake-success button — it doesn't violate the "never fake a working write" rule, but it is a real functional gap against CLAUDE.md §13's requirement.

Good news for scoping a fix later: the backend is already fully ready for this. The `reports` table exists (`supabase/migrations/0003_reports.sql`, extended by `0021_report_status_notify.sql` / `0022_review_reports.sql`), and admin-side moderation RPCs for it already exist in `supabase/migrations/0027_admin_foundation.sql`. Mobile's `store/reports.ts` shows the client write itself is a plain `insert` (reporter_id, target_type, target_id, reason, details) — no RPC needed. A web report-submission feature could reuse this schema and RLS with zero backend changes. **Not built this pass** — flagged as a gap, not fixed, since it wasn't part of the approved scope for this session.

### Finding 5: Offers — clean, faithful port; no bugs found

`web/src/store/offers.ts` is essentially a line-for-line port of `store/offers.ts` — same RPCs (`create_offer`/`respond_to_offer`/`cancel_offer`/`expire_stale_offers`), same thread/inbox logic, same realtime subscribe/cleanup shape. `web/src/app/offers/page.tsx` turned out to be a complete real negotiation-thread UI (this updates/corrects Phase 2's own report, which described it as "a lightweight amount prompt" — it no longer is). It even exposes a "Cancel offer" action mobile's screen doesn't surface despite the store supporting it.

### Finding 6: Favorites — clean, faithful port; no bugs found

`web/src/store/favorites.ts` matches `store/favorites.ts`'s optimistic-toggle-with-rollback exactly, same table/columns. One structural inconsistency worth knowing (not a bug): mobile keys its auth-subscription trigger off `profile?.id` specifically to dodge a documented race condition (session resolves before the profile row does); web's favorites/blockedUsers stores key off `session.user.id` directly instead. This doesn't currently cause a bug in these two stores (their `load()` only needs the user id, not the profile), but it's a different pattern from mobile's, worth checking first if a similar race condition ever surfaces on web.

### What was checked and found clean

No `window.alert`/`window.prompt` standing in for a real database write anywhere in favorites, chat, or offers (the only `alert()` calls found follow a real Supabase call and are reporting a real failure — `settings/page.tsx`, `my-listings/page.tsx`, `listing/[id]/page.tsx` — plus the Report button above, which is an honest "not built" message, not a fake success). No race conditions, stale-closure bugs, subscription-cleanup leaks, or message-composer focus-loss issues found in chat's realtime hook — `useConversationChannel.ts` was compared against the mobile hook nearly line-for-line and is a faithful, correct port of the realtime engine itself (the gap is purely in what the UI layer built on top of it exposes — see Finding 1).

---

## 3. Dead code removed

`web/src/lib/mockData.ts` — flagged as unused, unimported dead code in `PHASE2.5_REPORT.md` §4. Adding `createdAt`/`updatedAt` to the `Listing` type (needed for Listing Insights, §1 above) broke its mock objects at the type level, which was the trigger to actually delete it this pass rather than patch dead code. Re-confirmed zero imports (`grep -rn "from '@/lib/mockData'" web/src` → no matches) immediately before deleting.

---

## 4. Build & smoke test

- `npm run build`: 0 TypeScript errors, all routes compile (28 routes now, up from 25 — the three new ones: `/my-listings`, `/listing/edit/[id]`, `/listing/insights/[id]`).
- `npm run start` against the real, live Supabase project; `curl`'d `/my-listings`, `/listing/edit/<uuid>`, `/listing/insights/<uuid>`, `/profile` → all 200, no error strings in any response body, no exceptions in the server log.
- This confirms the read paths render correctly against live data with no crash. It does **not** confirm the interactive flows (tab switching, price-drop confirm, edit-save, delete-confirm) actually work end-to-end for a real signed-in user — no browser or authenticated session is available in this environment. Say this plainly rather than claiming "it works": **code verified, build verified, server-smoke-verified; not authenticated-E2E-verified**, for every feature built this phase.

---

## 5. Still blocked from Phase 2.5 (unchanged this session)

Per your instruction this session, the three dashboard-configuration blockers from `PHASE2.5_REPORT.md` §"BLOCKED" were **not** addressed, since the website isn't deployed to a production domain yet:

1. Supabase Auth → URL Configuration (needs the production domain).
2. Google Cloud OAuth client → Authorized JavaScript origins (needs the production domain).
3. Cloudflare R2 bucket CORS policy (needs the production domain).

These remain exactly as described in Phase 2.5 — nothing changed about them this pass. When a production domain exists, revisit that report's §"EXACT CONFIGURATION" for what to enter.

---

## 6. Final safety check

`git status` after all changes: every file outside `web/` matches the exact pre-existing modified/untracked set present before this session started (`app.json`, various `app/*`, `store/*`, `locales/*`, `assets/images/fursad-adaptive-foreground.png`, `components/ZoomableImage.tsx`, `data/mockListings.ts`, plus the untracked `assets/`, `marketing/`, `scripts/`, `supabase/migrations/0027_admin_foundation.sql`, `components/PriceDropModal.tsx` entries). **No mobile file was modified, added, or removed by this session.** All changes are inside `web/` plus this report file.

---

## Summary

| Feature | Status |
|---|---|
| My Listings dashboard | Built, code/build/smoke verified, not E2E verified |
| Listing edit | Built (core fields), code/build/smoke verified, not E2E verified. Category attributes/features/seller-notes/phone editing out of scope (no web data layer for them yet) |
| Listing insights | Built, code/build/smoke verified, not E2E verified |
| Price drop | Built, code/build/smoke verified, not E2E verified |
| Gallery/full-screen viewer | Built as an in-page lightbox (not a separate route), pinch-zoom not ported |
| Favorites | Reviewed, clean, no changes needed |
| Offers | Reviewed, clean, no changes needed (more complete than Phase 2 believed) |
| Chat realtime engine | Reviewed, clean, no changes needed |
| Chat reactions/reply-to | **Gap found**: data layer works, UI never surfaces it — not fixed this pass |
| Sell — category fields | **Gap found**: never collected, hardcoded empty on every insert — not fixed this pass |
| Sell — draft persistence | **Gap found**: no equivalent of mobile's draft store — not fixed this pass |
| Listing/user reporting | **Gap confirmed**: honest placeholder, not fake-success; backend already ready for a real implementation — not fixed this pass |
| Follow/following | **Gap confirmed** (pre-existing): no web equivalent exists at all |
| Production domain config | Still blocked — no production domain to configure against yet |
