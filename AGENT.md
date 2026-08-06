# AGENT.md — Suuq+ Engineering Guide

**Read this file completely before making any change to this repository.**

This document exists so that any AI agent (or human developer) picking up this project can understand its architecture, conventions, and current state without re-deriving them from scratch — and, just as importantly, without accidentally undoing decisions that were made deliberately.

---

## 0. DO NOT CHANGE WITHOUT EXPLICIT REQUEST

This section overrides general instinct. Unless the person you're working with explicitly asks for one of these, **do not**:

- Redesign the UI (layouts, screen structure, visual hierarchy)
- Change colors, the color palette, or any design token
- Change typography (font sizes, weights, line heights, font families)
- Change the spacing, radius, or shadow scales
- Refactor working code "for cleanliness" — if it works and wasn't flagged as debt in §10, leave it
- Rename existing files or folders
- Change navigation structure or routing conventions
- Replace any library with an alternative (e.g. swapping Zustand for Redux/Jotai, or `expo-router` for React Navigation directly)
- Change the overall architecture described in this document
- "Fix" the Expo/React Native/dependency setup — it has already been fixed and the app runs correctly; do not touch `package.json` versions, `app.json`, or config files unless the task is explicitly about them

The app has a deliberately-built UI baseline (~50 screens, full navigation, dark/light mode, mock data) that the project owner has already stabilized. Treat that baseline as load-bearing. If you believe something in this list genuinely needs to change, say so and ask — don't just do it.

**Never replace a working implementation with a different one simply because it is "cleaner."** Prefer extending existing code over rewriting it. Preserve Git history, minimize diffs, and avoid architectural refactors unless explicitly requested.

---

## 1. Project summary

**Suuq+** is a trusted, Somali-first resale/classifieds marketplace app (comparable to OLX, Jiji, or Facebook Marketplace) targeting Somalia, Somaliland, Puntland, and the Somali Region of Ethiopia (Jigjiga, Dire Dawa, Harar, Addis Ababa). Launch strategy: available everywhere in all regions from day one, with marketing/outreach focus concentrated on 3 featured cities (**Jigjiga, Hargeisa, Addis Ababa** — see `featuredCities` in `data/categories.ts`) to build listing density before promoting other cities.

Core positioning: free in year one, no in-app payments (buyers/sellers negotiate via chat/call and meet in person — cash-based, matching existing local behavior), differentiated from Jiji/Facebook Marketplace by trust features (seller verification levels, ratings, safety center), regional coverage, and a more polished feel.

## 2. Current status

**UI-complete, pre-backend.** All ~50 screens are built against thin mock data (`data/mockListings.ts` currently has only 5 listings, 3 sellers, 2 conversations — enough to exercise every UI state, not a realistic content volume) with full navigation, dark/light mode, and developer QA tooling. There is **no backend, no auth library, no database client** wired in anywhere — every "Supabase" reference in the code is a forward-looking comment, not a real integration. The Expo project setup itself has already been fixed and verified working — do not re-touch dependency versions or config as part of unrelated tasks.

## 3. Tech stack (exact versions — from `package.json`)

- **Expo SDK 54** (`expo ~54.0.35`), **React Native 0.81.5**, **React 19.1.0** / **react-dom 19.1.0**
- **Expo Router** (`expo-router ~6.0.24`) — file-based routing, `typedRoutes` and `reactCompiler` experiments enabled in `app.json`, `newArchEnabled: true`
- **Zustand** (`zustand ^5.0.14`) — lightweight global state, used only where state must survive navigation/remounting (see §5)
- **TypeScript** (`~5.9.2`) throughout
- Navigation primitives: `@react-navigation/native ^7.1.8`, `@react-navigation/bottom-tabs ^7.4.0`, `@react-navigation/elements ^2.6.3`
- `react-native-reanimated ~4.1.1` + `react-native-worklets 0.5.1`, `react-native-gesture-handler ~2.28.0`, `react-native-screens ~4.16.0`, `react-native-safe-area-context ~5.6.0`
- `@expo/vector-icons ^15.0.3` (Ionicons used throughout), `expo-image ~3.0.11`, `expo-haptics`, `expo-network` (used by `OfflineBanner`), `expo-constants` (used by Dev QA device info)
- Path alias: `@/*` → repo root (e.g. `import { useTheme } from '@/theme/ThemeContext'`)
- **Not installed yet**: any Supabase/Firebase/Auth0/Clerk package, `@expo-google-fonts/inter` (see §10 — `tokens.ts` references Inter family names on Android/web that aren't actually registered anywhere yet). `expo-image-picker` **is** installed — `post/index.tsx`'s photo step is a real picker flow (permissions, multi-select, size/duplicate/mime validation), not a mock; only the upload-to-Storage step is still pending (see §13)
- No backend. Planned: **Supabase** (Auth, Postgres, Storage, Realtime) — see §9

If `npm install` ever complains about peer dependency conflicts, the fix is almost always to align the conflicting package's version with what Expo actually requires (`npx expo install --fix`), not to force-install with `--legacy-peer-deps`.

## 4. Folder structure

There is **no `src/` directory in active use** (an empty `src/` exists on disk but is untracked and holds nothing — don't put new code there; it's stray, not a convention). All app code lives at the **repo root**:

```
app/                          Expo Router screens (file-based routing — see §7)
  index.tsx                    Splash screen (~900ms), then redirects to onboarding or (tabs)/home
  (onboarding)/                welcome (Google sign-in stub) → select-region → select-interests
  (tabs)/                      home, search, chats, profile + post-tab (stub, intercepted — see §7)
  post/                        Guided listing-creation flow: index(photos) → category → details → location → price → preview → success
                                (location precedes price so currency can be derived from the chosen city — see data/categories.ts `cityCurrency`; there is no manual currency picker, and no video step)
  listing/[id], listing/edit/[id], listing/insights/[id], listing/gallery/[id]
  seller/[id], dealer/[id]
  chat/[id]
  settings/ (index, appearance, language, safety), business/ (dashboard, analytics, bulk-upload), city/[name], category/[id], report/
  dev-qa.tsx                   Developer-only QA navigator (see §11)
  ~18 other top-level screens: about, compare, favorites, followers, help, my-listings,
                                notifications, offers, offline, pickup-planner, price-drops,
                                recently-viewed, reviews, saved-searches, seller-dashboard, verification
components/                   Reusable UI primitives (see §6)
  dev/                          Dev QA's own building blocks (DevChip, DevSection)
theme/                         colors.ts, tokens.ts, ThemeContext.tsx (see §6.1)
store/                         Zustand stores (see §5)
data/                          Mock data: mockListings.ts, categories.ts, categoryFields.ts, validation.ts, time.ts — see §8.
                                  listingsRepository.ts is the one non-mock file here: the AsyncStorage read/write seam `myListings.ts` persists through
types/                         types/index.ts — single file, all shared types (see below)
assets/images/                 App icon, adaptive icon, splash icon, favicon
```

`components/ui/` and the default Expo template files (`app/(tabs)/explore.tsx`, `app/(tabs)/index.tsx`, `app/modal.tsx`, `themed-text.tsx`, `themed-view.tsx`, `haptic-tab.tsx`, `hello-wave.tsx`, `parallax-scroll-view.tsx`, `icon-symbol*.tsx`, `collapsible.tsx`) have already been fully removed and replaced by custom Suuq+ code — if you see references to them anywhere, they're stale; don't recreate them.

## 5. State management — Zustand stores

Zustand is used **only** for state that must survive component unmount/remount (i.e. persists across navigation within an app session). Everything else is local `useState` in the component that owns it — don't lift state to a store unless it genuinely needs to be shared across screens. Most stores don't use `persist` middleware and reset on app reload; `myListings.ts` is the exception — it hand-rolls persistence to `AsyncStorage` via `data/listingsRepository.ts` (see below) rather than using the `persist` middleware.

Current stores in `store/`:

| Store | Purpose |
|---|---|
| `postDraft.ts` | `usePostDraft` — the in-progress listing being created across the multi-step post flow. Flat draft object (`photos`, `category`, `subcategory`, `title`, `description`, `price`, `negotiable`, `condition`, `city`) with a generic `setField(key, value)` and `reset()` |
| `notifications.ts` | `useNotifStore` — `{ notifs: Notif[] }`, seeded with 5 mock items. `unreadCount()` getter feeds Home's bell badge; `markAllRead()` is called when the Notifications screen mounts; `restoreDefaults()` used by Dev QA |
| `follow.ts` | `useFollowStore` — `{ followingIds: Set<string> }`, seeded `['s1','s2']`. `isFollowing(id)`, `toggle(id)`, `reset()`. **This was originally local `useState` per-screen, which reset Follow/Following state on navigating away and back — a real bug caught in QA. It's a shared store for exactly that reason; don't regress it back to local state.** |
| `offers.ts` | `useOfferStore` — mock offer/counter-offer negotiation state for the Offers screen. `Offer = { id, amount, fromMe, status: 'pending'\|'accepted'\|'rejected'\|'countered' }`. `accept()`, `decline()`, `counter()`, `reset()` |
| `favorites.ts` | `useFavoritesStore` — `{ favoritedIds: Set<string> }`, seeded `['l1','l2','l3']`. `isFavorited(id)`, `toggle(id)`, `reset()`. Read by `ListingCard`, `listing/[id].tsx`, and `favorites.tsx` |
| `collections.ts` | `useCollectionsStore` — `{ collections: string[] }`, named collections shown as filter chips on the Favorites screen. `addCollection`, `renameCollection`, `deleteCollection`, `reset()`. Collections are organizational tags only — assigning individual favorites into a specific collection isn't modeled yet |
| `savedSearches.ts` | `useSavedSearchStore` — `{ searches: SavedSearch[] }` for the Saved Searches screen. `add(query, filter)`, `remove(id)`, `reset()` |
| `myListings.ts` | `useMyListingsStore` — the current user's own listings plus `priceDrops` history. `addListing`, `updateListing`, `dropPrice`, `removeListing`, `reset()`. **Persisted to `AsyncStorage`** via `data/listingsRepository.ts` — hydrates once on startup (`hasHydrated`) and writes on every change, so this one *does* survive app restarts, unlike the others |
| `devMock.ts` | `useDevMockStore` — dev-only. `{ networkState: 'normal'\|'loading'\|'error'\|'offline'\|'empty'\|'slow' }`, forces a mock network state on screens that opt in, for QA testing. **Only Home currently reads this** — other screens don't yet. Never read outside `__DEV__`-guarded code |

When you add a new piece of state, ask: "does this need to survive the user navigating away from this screen and back?" If no, keep it local.

## 6. Reusable components (`components/`)

Every screen should be built from these rather than raw React Native primitives:

- **`Screen`** — `{ children, edges?, style?, noPadding? }`. Wraps every screen: safe-area insets (see §6.2), status bar style, standard padding. Always use this instead of a raw `View`/`SafeAreaView`.
- **`Text`** — `{ variant?, color?, align? }`. Variants: `display`/`h1`/`h2`/`h3`/`bodyLg`/`body`/`bodyMedium`/`caption`/`tiny`. Colors: theme-token-driven. Never hardcode a font size or color inline.
- **`Button`** — `{ label, onPress, variant?, size?, disabled?, loading?, fullWidth?, icon?, style? }`. Variants `primary`/`secondary`/`outline`/`ghost`/`danger`; sizes `sm`/`md`/`lg`; built-in haptic feedback on press.
- **`Card`** — `{ children, style?, elevated?=true, padded?=true }` — surface container, optional shadow or flat bordered variant.
- **`Input`** — `TextInputProps & { label?, error?, leftIcon?, rightIcon? }` — themed field with focus border and error text.
- **`Badge`** — `{ label, tone?, icon? }` — tones: brand/success/warning/neutral/accent.
- **`Stat`** — `{ label, value }` — stacked stat number + caption. (A duplicated `Stat` component was found and consolidated during a code-quality pass — don't reintroduce that pattern.)
- **`EmptyState`** — `{ icon?, title, message?, actionLabel?, onAction? }`.
- **`ErrorState`** — `{ title?, message?, onRetry? }` — also announces via `AccessibilityInfo`.
- **`Skeleton`** — `{ width?, height?, radius?, style? }` — animated loading placeholder.
- **`ListingCard`** — `{ listing: Listing, width? }` — grid/list card with animated heart-favorite toggle (local state + haptics), reserved/sold badge.
- **`BackButton`** — `{ onPress, color?, style? }` — 44×44 touch target, accessibility-labeled.
- **`StepHeader`** — `{ step, totalSteps, title }` — used by the `/post/*` flow: close button + progress bar + title.
- **`OfflineBanner`** — no props; polls `expo-network` every 5s, animates a banner in/out. Rendered once, above the tab navigator in `app/(tabs)/_layout.tsx`.

Check this list before building a new one-off version of something similar.

### 6.1 Theme system

`theme/colors.ts` (light/dark palettes), `theme/tokens.ts` (typography scale, spacing, radius, shadow, motion durations), `theme/ThemeContext.tsx` (`ThemeProvider` + `useTheme()` hook).

**Palette / brand colors**:
- Primary (indigo): `#4F46E5` light / `#7C82F0` dark
- Accent (coral): `#FF6B6B` light / `#FF8585` dark
- Success `#10B981`, warning `#F59E0B`, error `#EF4444` (same in both modes)

**Light theme**: background `#F8FAFC`, surface/surfaceElevated `#FFFFFF`, border `#E2E8F0`, textPrimary `#0F172A`, textSecondary `#475569`, textMuted `#64748B`, primaryText `#FFFFFF`, accentText `#0F172A` (dark text on coral — deliberate, see below), overlay `rgba(15,23,42,0.5)`, tabBarBackground `#FFFFFF`, inputBackground `#F1F5F9`, skeleton `#E2E8F0`.

**Dark theme**: background `#020617`, surface `#0F172A`, surfaceElevated `#1E293B`, border `#334155`, textPrimary `#F8FAFC`, textSecondary `#CBD5E1`, textMuted `#94A3B8`, primaryText `#020617`, accentText `#020617`, overlay `rgba(2,6,23,0.65)`, tabBarBackground `#0F172A`, inputBackground `#1E293B`, skeleton `#334155`.

All color pairs were built to meet **WCAG AA contrast** (4.5:1 minimum for text). The `accentText` choice (dark text on the coral accent in both modes, rather than white) is intentional — a contrast fix, not an oversight. If you ever change a color, re-verify contrast; don't eyeball it.

- Spacing scale: `xxs`(4) `xs`(8) `sm`(12) `md`(16) `lg`(20) `xl`(24) `xxl`(32) `xxxl`(48)
- Radius scale: `sm`(10) `md`(16) `lg`(20) `xl`(28) `pill`(999)
- Shadow: `sm` (offset 0/2, opacity .06, radius 6, elevation 2), `md` (offset 0/6, opacity .08, radius 16, elevation 5)
- Type scale (`type`): `display` 32/38/700, `h1` 26/32/700, `h2` 22/28/600, `h3` 18/24/600, `bodyLg` 16/24/400, `body` 15/22/400, `bodyMedium` 15/22/500, `caption` 13/18/400, `tiny` 11/14/500
- Motion durations: fast 150ms, base 250ms, slow 400ms
- `useTheme()` returns `{ colors, isDark, mode, setMode, spacing, radius, shadow, type, motion }` — always pull values from here, never hardcode. `mode` (`'light'|'dark'|'system'`, default `'system'`) is **not persisted** across app restarts yet (see §10).

### 6.2 Safe-area strategy

`Screen`'s `edges` prop defaults to `['top', 'left', 'right']` — correct for the 4 tab screens (Home/Search/Chats/Profile), because the bottom tab bar itself already sits in the safe area. **Every other screen** (anything reached via `router.push`, not a tab) must explicitly pass `edges={['top', 'left', 'right', 'bottom']}`, because those screens often have a bottom-pinned action button that needs to clear the home indicator / Android gesture bar. When adding a new non-tab screen, include the bottom edge from the start.

## 7. Routing conventions (Expo Router)

- File-based routing under `app/`. A folder with multiple screens (e.g. `settings/`, `post/`) **must** have its own `_layout.tsx` (a `<Stack>`). There are 5 layouts total: `app/_layout.tsx`, `app/(onboarding)/_layout.tsx`, `app/(tabs)/_layout.tsx`, `app/post/_layout.tsx`, `app/settings/_layout.tsx`.
- **`app/_layout.tsx`** (root): `Stack` with `headerShown: false`, wrapped in `GestureHandlerRootView` → `SafeAreaProvider` → `ThemeProvider`. Only explicitly declares `Stack.Screen` for routes needing custom presentation options: `(onboarding)`, `(tabs)`, `listing/[id]` and `seller/[id]` (`presentation: 'card'`), `post` (`presentation: 'modal'`), `settings`. Everything else (`chat/[id]`, `city/[name]`, `category/[id]`, `dealer/[id]`, `business/*`, and all top-level screens) is auto-registered by the file system — don't add explicit declarations unless you're setting a non-default option.
- **`app/index.tsx`** is the splash/entry screen: a short fake delay, then `<Redirect>` to `(tabs)/home` or `(onboarding)/welcome` based on a hardcoded `IS_SIGNED_IN` mock flag (to be replaced by a real Supabase session check — see §9).
- **`app/(tabs)/_layout.tsx`**: `Tabs` navigator with `OfflineBanner` rendered above it. Tabs in order: `home`, `search`, `post-tab` (see below), `chats`, `profile`. The **`post-tab`** entry is a stub screen that renders `null` and is intercepted via a `tabPress` listener (`e.preventDefault()` + `navigation.navigate('post')`) so tapping "Sell" opens the modal `post` flow instead of an actual tab screen — don't "fix" this by making `post-tab.tsx` render real content, it's working as designed.
- Dynamic routes use the `[param]` convention (`listing/[id].tsx`, `seller/[id].tsx`, etc.), read via `useLocalSearchParams<{ id: string }>()`.
- Query params are used for optional filters (e.g. `report/index.tsx` reads `?type=&id=`).

## 8. Mock data vs. persistent data

`data/mockListings.ts` (`mockListings`, `mockSellers`, `mockConversations`) and `data/categories.ts` (`categories`, `regions`, `featuredCities`) are the **entire current data layer** — there is no backend. Every screen reads from these static arrays or from a Zustand store seeded from them. Data volume is intentionally thin right now (5 listings, 3 sellers, 2 conversations, 18 categories, 8 regions) — enough to exercise every UI state, not representative of real launch content.

Images use a `placeholderImg(seed, w, h)` helper pointing at `picsum.photos` — all remote placeholder URLs, no bundled real photos.

There is currently **no separate `User` type** — `Seller` doubles as the "current user" shape in mock data. This will need to be revisited when real auth/profiles land (see §9).

When backend work begins, the migration path is: replace direct imports of `mockListings`/`mockSellers`/`categories` with data-fetching hooks (e.g. `useListings()`, `useSellerProfile(id)`) that internally call Supabase — the component code and props shouldn't need to change much if the mock data's shape matches the eventual Supabase row shape (see `types/index.ts`, written to look like a real schema: `Listing` deliberately nests a full `seller: Seller` object the way a real schema would instead do via join).

## 9. Backend migration plan (not yet started)

Agreed build order — **do not reorder or start chat/social features before auth + listings exist**:

1. **Authentication** — Google Sign-In via Supabase Auth, session persistence, logout, protected routes. The "Continue with Google" button in `(onboarding)/welcome.tsx` and the `IS_SIGNED_IN` flag in `app/index.tsx` are both mocks that need real OAuth wiring.
2. **User profiles** — auto-created on first login (not on every login). Suggested fields, informed by the current `Seller` shape: `id`, `display_name`, `avatar_url`, `city`, `region`, `language`, `created_at`, `last_seen`.
3. **Listings** — create/edit/delete, photo upload (Supabase Storage), fetch with pagination. This is the foundation almost everything else depends on.
4. **Search** — categories, cities, filters, saved searches.
5. **Favorites** — add/remove, synced across devices.
6. **Chat** — built last, once users and listings both exist so conversations can reference real rows.

Before writing backend code, freeze the backend design first: write out the database schema, Row Level Security policies, storage bucket layout, realtime channel design, notification flow, and permission model as documents — then implement against that, rather than improvising the schema as you go.

Once dependencies allow network access, run `npx tsc --noEmit`, `npm run lint`, and `npx expo-doctor` before starting backend work.

## 10. Current technical debt (known, intentionally deferred)

- Google Sign-In is a mock button; `IS_SIGNED_IN` in `app/index.tsx` is a hardcoded `false` (see §9)
- `expo-image-picker` **is** installed and wired into `post/index.tsx`'s photo step (permissions, multi-select, validation) — only the actual upload-to-Supabase-Storage step is still pending
- `picsum.photos` placeholder images are used everywhere real listing photos would go
- `theme/tokens.ts` references Inter font family names (`Inter_400Regular` etc.) for Android/web, but `@expo-google-fonts/inter` is **not installed** — those font names aren't actually registered/loaded anywhere. This is a latent gap, not a deliberate design; don't "fix" it silently since it may be intentionally staged for later — flag it if you touch typography.
- Theme `mode` (light/dark/system) is **not persisted** — resets to `system` on every app restart; persistence would come from storage or a Supabase profile field once backend exists
- Most Zustand stores don't use `persist` middleware and are in-memory only, reset on reload — `myListings.ts` is the exception (see §5, hand-rolled `AsyncStorage` persistence)
- Favorites, Collections, and Saved Searches **are** backed by shared Zustand stores now (`favorites.ts`, `collections.ts`, `savedSearches.ts`) but not yet persisted to storage — state resets on reload same as the other non-`myListings` stores. Recently Viewed and onboarding-seen still use local component state or static mock slices, not a shared store at all. Dev QA's reset panel covers every store that's actually global
- Mock network-state forcing (`devMock.ts`) is only wired into the Home screen's render branches — not yet extended to every screen
- No separate `User` type — `Seller` is reused for "current user" in mock data (see §8)
- Shared element transition between a listing card and its detail screen has not been added (would need an extra library — treat as a deferred polish item, not a bug)
- There's a stray empty `src/` directory and (on some checkouts) a `~$AGENT.md` Office lock file at the repo root — both harmless leftovers, safe to ignore or remove as housekeeping, not part of the architecture
- **Expo Go shows a generic permission-dialog name (e.g. `anonymous/suuqplus-clean/...`), not "Suuq+"** — this is an unavoidable Expo Go limitation, not a config bug. The photo-library permission prompt is issued by the shared Expo Go binary itself (it wasn't built with this app's `Info.plist`/`AndroidManifest.xml`), so it can only ever show Expo Go's own identity plus the experience URL (`@owner/slug`, `anonymous` when the project isn't linked to an Expo account). `app.json`'s `expo.name` (set to `"Suuq+"`) and the `expo-image-picker` plugin's custom `photosPermission` message *do* take effect — but only in a custom dev client or standalone/EAS build, never inside Expo Go. Don't attempt to "fix" this further inside Expo Go; it resolves itself automatically once the app moves to a dev client or production build.

## 11. Developer QA tools

`app/dev-qa.tsx` is a developer-only screen, reachable via a dashed "Developer QA" entry point that only renders when `__DEV__` is true — **and** the screen itself does `if (!__DEV__) return <Redirect href="/(tabs)/home" />` (defense in depth beyond just hiding the entry point). **Never remove either guard, and never let this screen or its entry point ship visibly in a production build.**

It provides, in one place:
- Theme shortcuts (Light/Dark/System) via `useTheme().setMode`
- Reset buttons for every global store (notifications, follow, offers, post draft) — see §10 for what's *not* covered, and the screen's own in-UI caveats about it
- Mock network state toggles (Normal/Loading/Slow/Error/Offline/Empty) — in-UI caveat that only Home currently respects these
- Animation previews (heart pop, success checkmark, a hand-rolled confetti burst, inline Skeleton/EmptyState/ErrorState previews)
- Accessibility checks (live font-scale preview via `PixelRatio`, an `AccessibilityInfo.announceForAccessibility` trigger, RTL status) — touch-target visualization is explicitly *not* implemented, checked manually instead
- Device diagnostics (platform, OS version, Expo SDK/app version via `expo-constants`, color scheme, font scale, RTL)
- A generated navigation checklist (`SECTIONS`) linking to every screen in the app (~50 links) with a per-item visited checkbox, for systematic manual regression testing — this is a manual QA aid, not automated testing; there is no test runner or CI in this repo currently

If you build a new screen, add it to the relevant section in `dev-qa.tsx`'s `SECTIONS` list.

## 12. Coding standards

- TypeScript everywhere; keep zero unused imports and zero duplicated components (a duplicated `Stat` component was found and consolidated during a past audit — don't reintroduce that pattern).
- Every icon-only button needs `accessibilityRole="button"` and a real, non-decorative `accessibilityLabel`.
- Every `<Image>` needs a meaningful `accessibilityLabel`.
- Minimum touch target: 44×44 for primary actions (use `hitSlop` if the visual element is smaller), 24×24 minimum for secondary chip-style controls (WCAG AA floor).
- No `console.log` / debug statements committed.
- No placeholder/lorem-ipsum copy — write real (even if temporary) text.
- Naming: screens are named for what they show (`seller-dashboard.tsx`, not `dashboard2.tsx`); components are named for what they are, not what screen first used them.
- Use the `@/*` path alias for root-relative imports rather than long relative paths.

## 13. Architecture notes for specific features

**Image upload**: photo *picking* is implemented (`post/index.tsx` uses `expo-image-picker` with permissions, multi-select, and size/duplicate/mime validation) — the picked URIs are local device URIs stored directly in the draft. What's not implemented yet is the *upload* half: Supabase Storage + client-side compression before upload, and swapping the local URIs for hosted URLs once a listing is published.

**Listing architecture**: `Listing` in `types/index.ts` is deliberately shaped close to a real Supabase row (including a nested `seller: Seller` object, which in the real schema would be a join, not embedded data) — use this as the reference shape when designing the actual `listings` table.

**Chat architecture**: currently a single mock conversation (`mockConversations`) with client-side-only messages and a simulated sending→sent→read progression in `chat/[id].tsx`. Real implementation should use Supabase Realtime channels keyed by conversation ID; the UI (bubble layout, status text, quick replies, composer) shouldn't need to change, only the data layer underneath it.

**Notification architecture**: currently a local Zustand store (`store/notifications.ts`) with 5 hardcoded mock notifications, no persistence. Real implementation needs a `notifications` table (or Supabase Realtime + Expo push tokens) — the unread-count/mark-read UX pattern (badge on Home's bell, cleared on opening the Notifications screen) should be preserved as-is; only the data source changes.

---

*Last updated: post UI-build, pre-backend, after the Expo/dependency setup was fixed and verified running. No physical-device QA pass or backend work has started yet.*
