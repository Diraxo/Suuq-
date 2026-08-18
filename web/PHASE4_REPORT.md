# Fursad Website — Phase 4 Report

This phase was a scoped continuation of the mobile → web functional-parity audit. The full audit brief covered 23 areas; a research pass (three background audits, see §2) surveyed the areas Phase 3 hadn't already covered — profile-stats loading, seller dashboard, notifications, verification, and admin/report connectivity — and combined those findings with Phase 3's own already-documented gaps (follow system, chat reactions/reply-to, listing reporting, sell-flow category fields) to produce a full gap list. Given the list's size (several of the items are independent multi-hour builds on their own), the user was asked to scope this specific session rather than attempting all of it at once. They selected three items to build now:

1. Profile stats flash-of-zero on every `/profile` visit
2. Real listing reporting (was a fake `alert()` placeholder)
3. Chat reactions + reply-to-message UI

Everything else identified stays an explicit, documented gap — not silently dropped. See §8.

---

## 1. Executive summary

- **Profile stats flash-of-zero — fixed.** Root cause: `/profile` fetched seller stats from scratch in a `useEffect` on every mount, with no shared/pre-warmed store, so it always rendered zero listings/followers/rating for a moment before the real numbers arrived — on every navigation, not just first sign-in. Fixed by adding a module-level, app-wide prefetch store (`web/src/store/sellerStats.ts`) mirroring mobile's own pattern (`store/reviews.ts`, `store/follow.ts`, `store/myListings.ts` all use the same technique), wired to start loading the moment auth resolves, anywhere in the app — so the store is warm by the time a user actually lands on `/profile`. The page now renders a skeleton pulse instead of `0` while genuinely still loading.
- **Real listing reporting — built.** Replaced the `alert("Reporting isn't built in the web UI yet...")` placeholder with a real report modal backed by an actual insert into the `reports` table — same shape, same reason vocabulary, same duplicate-prevention as mobile's `app/report/index.tsx` / `store/reports.ts`. Zero backend changes were needed; the table, RLS, and the admin dashboard's reading code already supported this exactly.
- **Chat reactions + reply-to — built.** The realtime data layer for this (`toggleReaction`, `replyToId`, `reactions`) already existed in `web/src/hooks/useConversationChannel.ts` from an earlier phase but nothing in the UI ever called it. Wired it into `MessageBubble`/`MessageComposer`/`MessageList`/the chat page: reaction pills, a compact reaction picker (web has no long-press gesture, so this uses the existing hover-reveal action pattern already used for edit/delete), a reply-preview bar in the composer, and a quoted-message preview inside the replying bubble — same 6-emoji set and interaction shape as mobile, adapted to a mouse/keyboard context.

---

## 2. Mobile → Web audit

| Feature | Mobile | Website Before | Website After | Status |
|---|---|---|---|---|
| Profile stats loading | Module-level store subscribers pre-warm stats the moment `profile.id` resolves, anywhere in the app | Fetched fresh on every `/profile` mount; flashed zeros every visit | Pre-warmed via new `sellerStats.ts` store, same pattern; shows a loading skeleton instead of zeros while genuinely cold | ✅ MATCHED |
| Listing reporting | Dedicated report screen, real insert into `reports`, per-type reason list, duplicate check | Fake `alert()`, no backend call at all | Real `ReportModal` + `reports.ts` service, same insert shape, same reason list, same duplicate check | ✅ MATCHED |
| User/review reporting | Same report screen reused via `type=user`/`type=review`, called from seller-profile and reviews screens | Not present (no seller-profile page on web at all) | Still not present — see §8 | 🚧 NOT IMPLEMENTED (scope decision, see §8) |
| Chat reactions | Long-press → action sheet → 6-emoji picker; aggregated pill row under the bubble | Data layer (`toggleReaction`) existed but zero UI call sites | Hover-reveal reaction picker + aggregated pill row, same 6 emoji | ✅ MATCHED |
| Chat reply-to | Long-press → Reply → composer preview bar → quoted block in the replying bubble | Data layer (`replyToId`) existed but zero UI call sites | Hover-reveal reply trigger, composer preview bar, quoted block in the bubble | ✅ MATCHED |
| Seller Dashboard (aggregate, weekly/monthly) | `app/seller-dashboard.tsx` + `lib/sellerStats.ts`, range-scoped view/follower counts | Menu item routes back to `/profile`, "not yet built" | Unchanged this pass | 🚧 NOT IMPLEMENTED (deferred, see §8) |
| Follow / Following | `store/follow.ts`, follow button, followers/following lists | Doesn't exist anywhere on web | Unchanged this pass | 🚧 NOT IMPLEMENTED (deferred, see §8) |
| Sell-flow category fields/draft persistence | `data/categoryFields.ts`/`categoryFeatures.ts`, `store/postDraft.ts` | Never collected; no draft persistence | Unchanged this pass | 🚧 NOT IMPLEMENTED (deferred, see §8) |
| Notifications | Realtime `postgres_changes`, unread badge, mark-read | Full parity already (confirmed by this session's research pass, not newly built) | Unchanged — already correct | ✅ MATCHED |
| Admin report visibility | Reports inserted by mobile show up in admin dashboard | Admin dashboard already reads the exact schema mobile writes | Website reports now flow into the same path, confirmed by schema match | ✅ MATCHED |
| Verification | Purely local mock on mobile (`app/verification.tsx`), no DB backing at all | No route on web | Unchanged — mobile itself has nothing real to port | 🔒 BLOCKED (mobile is a non-functional mock; building real infra was explicitly out of scope) |

---

## 3. Root causes

**Profile stats flash-of-zero.** `web/src/app/profile/page.tsx` (before this pass) held `stats` in local `useState` initialized to `{ listingsCount: 0, soldCount: 0, followers: 0, rating: 0, reviewCount: 0 }`, then called `getSellerStats(session.user.id)` inside a `useEffect` keyed on `session`. Every mount of `/profile` — including a plain client-side navigation from another page where the user's data had already loaded elsewhere — restarted this fetch from zero. Mobile avoids this because several of its stores (`store/reviews.ts`, `store/follow.ts`, `store/myListings.ts`) register a module-level `useAuthStore.subscribe()` listener at import time, independent of which screen is mounted; by the time the Profile tab is actually opened, the data has usually already been loading in the background since sign-in. Web already had exactly one store using this pattern (`web/src/store/favorites.ts`), but nothing analogous existed for seller stats. `web/src/store/sellerStats.ts` (new) replicates it, keyed on `profile?.id` to match mobile's more-correct version of the pattern (mobile's own code comments explain that `session` resolves one tick before `profile` in `auth.ts`'s `init()`, so keying on session risks firing with `profile` still null — not a live bug for this particular query, since `getSellerStats` only needs the id value, but kept consistent with mobile for any future store that does depend on `profile` fields). The module is force-loaded on every route via a side-effect import in `AuthInit.tsx` (already globally mounted in `layout.tsx`), guaranteeing the subscription is registered before `init()` runs — without that, a hard-navigation directly to `/profile` could import the store for the first time only after auth had already resolved, missing the state transition entirely.

**Listing reporting.** This wasn't a bug so much as an honest, explicitly-labeled stub from an earlier phase (`alert("Reporting isn't built in the web UI yet...")`). The backend was already fully built and unused: `reports` table with reporter-scoped RLS and an admin select policy existed since `supabase/migrations/0003_reports.sql` (widened by `0021`/`0022`/`0027`), and `web/src/app/admin/reports/page.tsx` already read/rendered the exact row shape a client insert would produce. The only missing piece was the client-side UI and service call.

**Chat reactions/reply-to.** A prior phase built the full realtime data layer for this (`toggleReaction()`, `replyToId`/`reactions` fields, upsert/delete-on-toggle logic, realtime `message_reactions` subscription) inside `web/src/hooks/useConversationChannel.ts`, apparently as groundwork, but never connected it to any UI component — `MessageComposer` had no `replyTo` prop at all, and `MessageBubble` never rendered a reaction pill or quoted-reply block. This was a pure UI gap, not a data or realtime problem — confirmed by reading the hook in full before starting: the reaction/reply state was already correct and tested-looking (proper optimistic merge, proper realtime broadcast handling), it just had zero callers.

---

## 4. Files changed

**New files:**
- `web/src/store/sellerStats.ts` — app-wide seller-stats prefetch store
- `web/src/services/reports.ts` — report submission + duplicate-check service
- `web/src/lib/reportReasons.ts` — per-target-type reason lists (ported from mobile's `REASON_EN`)
- `web/src/components/ReportModal.tsx` — report submission modal
- `web/src/lib/chatReactions.ts` — reaction emoji map (ported from mobile's `components/chat/reactions.ts`)

**Modified files:**
- `web/src/components/AuthInit.tsx` — side-effect import to force-load the new stats store early
- `web/src/app/profile/page.tsx` — reads stats from the new store instead of local state; skeleton loading instead of zero flash
- `web/src/app/listing/[id]/page.tsx` — real report flow wired in place of the `alert()` placeholder
- `web/src/components/chat/MessageBubble.tsx` — reaction pills, reaction picker, reply-preview block, reply/react hover actions
- `web/src/components/chat/MessageComposer.tsx` — reply-preview bar, `replyToId` included in send payload
- `web/src/components/chat/MessageList.tsx` — builds per-message reply previews, threads reply/react callbacks down
- `web/src/app/chat/[id]/page.tsx` — `replyTo` state, wired into send/composer/list

No files outside `web/` were touched.

---

## 5. Mobile safety

`git status` outside `web/`, checked both before this session started and again after all changes, is **byte-identical**: the same pre-existing modified set (`app.json`, several `app/*` files, `store/*` files, `locales/*`, `assets/images/fursad-adaptive-foreground.png`, `components/ZoomableImage.tsx`, `data/mockListings.ts`) and the same pre-existing untracked set (`assets/images/*`, `assets/screen shots/`, `marketing/`, `scripts/*`, `supabase/migrations/0027_admin_foundation.sql`, `components/PriceDropModal.tsx`). **No mobile file was created, modified, or deleted this session.**

---

## 6. Database/backend changes

**None.** All three features reuse existing tables, existing RLS policies, and existing admin-dashboard read logic without modification:
- Profile stats fix: client-side only, reads `listings`/`followers`/`reviews` via the pre-existing `getSellerStats()` query.
- Listing reporting: plain insert into the pre-existing `reports` table, matching the exact shape `store/reports.ts` already writes on mobile.
- Chat reactions/reply: uses the pre-existing `message_reactions` table and `messages.reply_to_id` column, both already read/written by the hook built in an earlier phase.

No migrations, RPCs, or RLS policies were added or changed.

---

## 7. Functional verification

- **Code verified**: all three changes were built by reading the corresponding mobile source (`store/auth.ts` and its dependent stores' subscribe patterns; `app/report/index.tsx` + `store/reports.ts`; `components/chat/reactions.ts`, `MessageBubble.tsx`, `MessageComposer.tsx`, `MessageList.tsx`) line-by-line before writing the web equivalent, matching data shapes, reason vocabularies, and interaction structure.
- **Build verified**: `npm run build` — 0 TypeScript errors, all 28 routes compile (including the three touched: `/profile`, `/listing/[id]`, `/chat/[id]`).
- **Server-smoke-verified**: `npm run start` against the real, live Supabase project (on an alternate port to avoid an unrelated process already holding :3000 — that process was left untouched rather than killed, since its origin wasn't confirmed). Curled `/profile`, `/chat/<uuid>`, `/listing/<uuid>` — all 200, no server-log exceptions, no genuine error strings in any response body (only Next.js's own boilerplate `"error":"$undefined"` RSC payload markers and `.next-error-h1` CSS class names, which are present on every page and are not runtime errors).
- **Not authenticated-E2E-verified**: no browser or signed-in session is available in this environment, so the actual click-through flows — stats rendering with real warm data on a genuine navigation, submitting a report and seeing it land in the admin dashboard, reacting to a message and seeing the pill appear for the other party in realtime, sending a reply and seeing the quoted preview render — were never exercised end-to-end by a real signed-in user. This is consistent with every prior phase's own verification limits (see PHASE1–3 reports) and is stated plainly rather than claimed as working.

---

## 8. Remaining gaps

Everything below was identified during this session's audit but explicitly deferred — either by direct user choice (large builds not selected for this pass) or by a scope decision made mid-implementation once a hidden dependency surfaced. None of it was silently dropped.

- **Follow / Following system** — does not exist anywhere on web (no store, no button, no followers/following list). Deferred by user choice; this is also why My Listings' stats grid (Phase 3) still shows 7 of mobile's 8 seller stats.
- **Aggregate Seller Dashboard** (weekly/monthly view/follower counts, `app/seller-dashboard.tsx` + `lib/sellerStats.ts`) and the wider **Business suite** (`app/business/{analytics,dashboard,bulk-upload}.tsx`) — not implemented on web at all; the Profile menu item still routes back to `/profile`. Deferred by user choice.
- **Sell-flow category attributes/features/seller notes, and draft persistence** — every web-created listing still lacks this data at creation (hardcoded empty), and the Sell flow still has no equivalent of mobile's `store/postDraft.ts`. Deferred by user choice.
- **User and review reporting** — `ReportModal`/`reports.ts` were built generically (the `targetType` param already supports `'user'`/`'review'`, and the reason lists for both are already ported into `reportReasons.ts`), so wiring up these two entry points later is just adding a button once the corresponding pages exist. But those pages don't exist yet: **there is no seller/user-profile page on web at all** (confirmed by checking — no `web/src/app/seller/` route, and the listing detail page doesn't even link to seller identity), and no dedicated reviews page either. Building a seller-profile page is the same class of work as the follow system above, so it was correctly out of scope for this pass rather than pulled in unplanned — flagged here rather than silently built around.
- **Identity verification** — mobile's own `app/verification.tsx` is a local-only mock (`useState`, `Alert.alert("marked as submitted")`, no database read or write, no `is_verified` column anywhere in the schema). There is nothing real to port. Building actual verification infrastructure (new schema, private document storage, admin review workflow) was explicitly out of scope per the original brief's instruction not to invent identity-verification infrastructure — this stays a documented gap on both platforms, not a web-specific one.
- **Account suspension UX** — `profiles.account_status` and its enforcement are fully server-side (RLS/trigger raises on a suspended account); neither mobile nor web has any client-side "you're suspended" UI state. This is consistent between platforms, not a new web gap, but worth noting since nobody currently gets a clear message — they'd just see writes silently fail.
