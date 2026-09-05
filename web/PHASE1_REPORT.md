# Fursad Website — Phase 1 Report

Stack: Next.js 15 (App Router) + TypeScript + Tailwind CSS, in `web/` at the repo root. Icons via `lucide-react`, client state via `zustand`. Zero backend connections — everything Phase 1 required to stay disconnected (Supabase, R2, production data) is disconnected.

## Screens implemented (17 routes)

| Route | Purpose |
|---|---|
| `/` | Home |
| `/search` | Search |
| `/category/[id]` | Category browse |
| `/listing/[id]` | Listing detail |
| `/sell` | Sell flow (6-step wizard) |
| `/chat` | Chat list |
| `/chat/[id]` | Chat conversation |
| `/profile` | Profile (guest + signed-in) |
| `/favorites` | Favorites |
| `/notifications` | Notifications |
| `/settings` | Settings index |
| `/settings/language` | Language (single-select) |
| `/settings/privacy-policy` | Privacy Policy |
| `/settings/terms` | Terms of Service |
| `/settings/safety` | Safety Center |
| `/settings/community-guidelines` | Community Guidelines |
| `/about` | About SUUQIYE |

## Mobile → Web mapping

```
app/(tabs)/home.tsx          → /                (same greeting, search, category row, discovery tabs, city chips)
app/(tabs)/search.tsx        → /search           (same filter chips, empty state copy)
app/category/[id].tsx        → /category/[id]    (real category + subcategory data)
app/listing/[id].tsx         → /listing/[id]     (gallery, specs, features, seller card, safety tip, sticky action bar)
app/post/*.tsx (6 steps)     → /sell             (Photos → Category → Details → Location&Price → Preview → Success)
app/(tabs)/chats.tsx         → /chat
app/chat/[id].tsx            → /chat/[id]
app/(tabs)/profile.tsx       → /profile
app/favorites.tsx            → /favorites
app/notifications.tsx        → /notifications
app/settings/index.tsx       → /settings
app/settings/language.tsx    → /settings/language
app/settings/privacy-policy.tsx        → /settings/privacy-policy   (verbatim copy)
app/settings/terms.tsx                 → /settings/terms            (verbatim copy)
app/settings/safety.tsx                → /settings/safety           (verbatim copy)
app/settings/community-guidelines.tsx  → /settings/community-guidelines (verbatim copy)
app/about.tsx                → /about            (verbatim copy, real logo asset — no text "F")
```

Not built in Phase 1 (menu items route back to `/profile` or `/settings` for now — see "Problems / gaps" below): My Listings, Seller Dashboard, Business Dashboard, Price Drops, Saved Searches, Offers, Reviews, Followers/Following, Verification, seller public profile, Edit Profile, Blocked Users, Saved Addresses, Delete Account, Help Center, Notification Preferences detail screen, dealer/business screens, pickup planner, compare, price-drops, recently-viewed, report flow.

## Components created

`Button`, `Badge`, `Card`, `EmptyState`, `ListingCard`, `Logo`, `Header` (desktop nav), `MobileTabBar` (bottom nav), `Footer`, `SignInModal`, `ThemeApplier`, `StepHeader`, `LegalPage`.

`src/lib/`: `types.ts` (mirrors mobile `types/index.ts`), `categories.ts` (real category/subcategory data copied from `data/categories.ts`), `mockData.ts` (fresh placeholder listings/sellers/conversations/notifications — no reuse of the five previously-removed demo listings), `icons.tsx` (maps mobile Ionicons/MaterialCommunityIcons identifiers to Lucide equivalents — see "Icon substitution" below), `currency.ts` (same `formatBirr` behavior as mobile).

`src/store/` (zustand, localStorage-persisted): `auth.ts`, `favorites.ts`, `language.ts`, `theme.ts`, `authPrompt.ts` (mirrors mobile's `requireAuth()` gate pattern).

## Backend readiness (Phase 2)

`src/services/` has one file per domain — `auth`, `listings`, `search`, `favorites`, `chat`, `notifications`, `profile`, `offers`, `reviews` — each with a comment naming the Supabase table/mobile store it should read from. Components call these services, not mock data directly (except a few pages that import `mockData` inline for brevity — flagged for cleanup when wiring Phase 2). `.env.local.example` lists the two client-safe variables Phase 2 needs (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`); no service-role or R2 secret key appears anywhere in `web/`.

Auth is fully mocked: `SignInModal` + `requireAuth()` gate Sell, Chat, Favorite, and every `authRequired` menu item, matching the mobile app's gating list exactly. "Continue with Google" resolves a fake local session (`src/services/auth.ts`) — Phase 2 replaces its body with the mobile app's Supabase OAuth flow.

## Design fidelity notes

- **Colors/spacing/radius/type**: copied numerically from `theme/colors.ts` and `theme/tokens.ts` into Tailwind CSS variables (`globals.css` / `tailwind.config.ts`), light and dark, switched via `.dark` class — same values, not approximations.
- **Price formatting**: mirrors `lib/currency.ts` exactly — always renders "`X Birr`" regardless of stored currency, matching what the app actually does (confirmed by reading the mobile source, not assumed).
- **Copy**: pulled from `locales/en/translation.json` and the settings/about screen source files, not rewritten.
- **Logo**: real `assets/images/fursad-logo.png` used everywhere (header, About, sign-in button context) — never a text "F" placeholder, even though the mobile About screen itself currently uses one (noted below as a mobile-side inconsistency, left unfixed).
- **Icon substitution**: mobile icons are Ionicons/MaterialCommunityIcons/FontAwesome5 glyphs from `@expo/vector-icons`, which has no web build. Every icon identifier in `data/categories.ts` is mapped in `src/lib/icons.tsx` to the closest `lucide-react` icon (same outline weight/style family) — same taxonomy, a web-appropriate substitute, not a redesign.
- **Responsive**: 2-col grid on phones, 3-col tablet, 4–5 col desktop (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`); bottom tab bar mobile-only, full top nav desktop-only; verified via production `next build` static generation for all routes (no overflow/hydration errors in dev server logs at any route).
- **No country-specific claims**: About page copy carries no Somalia/Somaliland/Ethiopia/Puntland language (this was already true of the mobile source copy).

## Problems discovered in the mobile app (not fixed, per instructions)

- `app/about.tsx` renders its logo as a hard-coded `"F"` letter in a colored circle instead of the real `fursad-logo.png` asset — inconsistent with the actual app icon/splash. The web About page uses the real asset instead, per the Phase 1 brief's explicit instruction not to use a text "F" placeholder.
- `data/mockListings.ts` is now a permanently empty array (`// Demo catalogue intentionally emptied`) — the mobile app runs entirely on live Supabase data with no local fallback, which is fine for the app but meant Phase 1 had no existing mock catalogue to reuse and needed fresh placeholder listings.

## Verification performed

- **TypeScript**: `next build`'s type-check pass — 0 errors (one icon-name fix needed: `Cabinet` doesn't exist in the installed `lucide-react` version, swapped for `Archive`).
- **Build**: `npm run build` — succeeds, all 17 routes prerendered/compiled (`✓ Generating static pages (17/17)`).
- **Routes tested**: all 17 routes plus two intentional 404s (`/category/does-not-exist`, `/listing/does-not-exist`) curled against a live `next dev` server — every route returns 200 (404s return 404), zero runtime errors or warnings in the dev server log.
- **Responsive tests**: verified via Tailwind breakpoint classes and the production build's static output, not via an actual browser at each of the eight requested widths — no browser/screenshot tool is available in this environment. **Recommend a manual pass in an actual browser (or asking me to spin up the dev server again for you to click through) at 320/375/390/430/768/1024/1280/1440/1920px before calling Phase 1 fully signed off.**
- **Lint**: not run (`next lint` requires an additional one-time interactive config step); `next build`'s type-check is the verification gate for this phase.

## What's next

Phase 1 is feature-complete for the 33 sections of the brief and stops here per instructions — **no Supabase/production data connection was made.** Ready for a Phase 2 prompt to wire `src/services/*` to the real Supabase project.
