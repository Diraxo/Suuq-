# Fursad Website — Phase 2 Report

Phase 2 connects the Phase 1 website (`web/`) to the **same production Supabase project** the mobile app uses. Every `src/services/*` stub is now a real query/RPC against that project, mirroring the exact table/column/RPC/RLS shapes the mobile app (`store/*.ts`, `lib/*.ts`) already relies on. **No mobile app file was touched, no migration/RLS/Edge Function was changed, and no new backend was created.**

## Backend connection

- Same Supabase project as mobile: `web/.env.local` (gitignored) holds `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the identical `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` values from the root `.env`, just re-prefixed for Next.js. Same anon (publishable) key, same RLS, same tables.
- One Supabase client (`src/lib/supabase.ts`), plain `@supabase/supabase-js` (not `@supabase/ssr`) — the whole Phase 1 app is client-rendered (every page is `'use client'`, same as the mobile app's architecture), so there's no server-rendered protected route that needs cookie-based SSR auth. Session persists to `localStorage` (the browser analog of the mobile app's `AsyncStorage`), auto-refreshes, and `detectSessionInUrl` completes the Google OAuth PKCE exchange automatically — no custom callback route needed.
- `src/services/` — one real file per domain (`auth`, `listings`, `search`, `favorites`, `chat`, `notifications`, `profile`, `offers`, `reviews`, `r2`, `accountDeletion`), each calling Supabase directly with the same table/column names, the same foreign-key embed names (e.g. `profiles!offers_buyer_id_fkey`), and the same SECURITY DEFINER RPCs the mobile store files use (`find_or_create_conversation`, `mark_conversation_read`, `get_conversation_unread_counts`, `create_offer`, `respond_to_offer`, `cancel_offer`, `expire_stale_offers`, `increment_listing_views`). Components never call Supabase directly — same seam Phase 1 already established.

## Authentication

Google OAuth via `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })`. Unlike mobile (in-app browser sheet + manual PKCE code exchange via `expo-auth-session`), the web flow is simpler: the browser navigates to Google and back to `redirectTo` on its own, and `detectSessionInUrl` finishes the code exchange automatically when the app reloads there — no server callback route required. Same Supabase project, same `profiles` table, same `on_auth_user_created` trigger + upsert fallback (`loadOrCreateProfile`, mirrored from `store/auth.ts`) — **a user who signs in on web is the same account, with the same profile row, as on mobile.**

**Guest → protected action → return flow:** `redirectTo` is set to the destination page itself (e.g. clicking "Sell" sets `redirectTo = origin + '/sell'`), so after Google sign-in the browser lands directly back on the page the guest wanted — no bounce through Home. The one action that can't be expressed as "redirect to a page" — favoriting a listing from a card while browsing — is carried across the full-page OAuth redirect via a `sessionStorage` flag (`PendingActionRunner`, since in-memory closures don't survive a page reload) and applied automatically once the session exists.

## Data domains

| Domain | Status | Notes |
|---|---|---|
| Listings | ✅ | Real `listings` table, joined with `profiles` + batched seller stats (same 3-query batch pattern as `lib/sellerStats.ts`). No mock catalogue fallback — empty result renders the real empty state. |
| Search | ✅ | Same `listings` table/RLS, `ilike` title match + category/city filters. |
| Categories/Location | ✅ | Static taxonomy (no DB table on mobile either) — copied `cityCurrency`/`cityRegion` mappings from mobile for the Sell flow. |
| Favorites | ✅ | Real `favorites` table, optimistic toggle, synced both ways with mobile. |
| Chat | ✅ | Real `conversations`/`messages`/`conversation_participants`, RPCs for create/mark-read, Supabase Realtime (`postgres_changes`) for new messages and inbox updates — not polling. |
| Notifications | ✅ | Real `notifications` table (read/mark-read/delete only — no insert policy exists client-side, matching RLS), Realtime updates, Header unread badge. |
| Profile | ✅ | Real `profiles` row + live seller stats (listings/sold/followers/rating). |
| Offers | ✅ | Real RPCs (`create_offer`/`respond_to_offer`/`cancel_offer`/`expire_stale_offers`) wired to the listing detail page's "Make an offer" button via a lightweight amount prompt (no dedicated offer-form UI exists in Phase 1 — building one was out of scope per "don't rebuild the UI"). |
| Reviews | ✅ | Real `reviews` table reads feed the Profile page's rating/review-count stat; write path (`createReview`) is implemented and ready but has no UI entry point yet (none existed in Phase 1). |
| Language | ✅ | `profiles.language` sync, mirroring mobile's exact "account overrides device, device pushes up if account has never set one" policy. Note: only the *selector* and its persistence are connected — Phase 1 never wired runtime UI-string translation (i18next) for the web app, so switching language does not yet retranslate page copy. That gap pre-dates Phase 2 and rebuilding it was out of scope. |
| Account deletion | ✅ | Reuses the exact same `delete-account` Edge Function mobile calls — no second deletion path. |
| Sell (publish) | ✅ | Wired to real R2 upload (browser `fetch` PUT to a presigned URL from the same `r2-presign` Edge Function) + real `listings` insert. **Flagged below as the one mutation path I could not exercise end-to-end.** |

## Security

- **No service-role key anywhere in `web/`** — verified by grep across `web/src` for `service_role`, `SUPABASE_SERVICE_ROLE`, `R2_SECRET_ACCESS_KEY`, `R2_ACCESS_KEY_ID`, `CLOUDINARY_API_SECRET`: zero matches.
- **RLS untouched** — no migration files were created or edited; every write in the new code goes through the existing RLS policies or SECURITY DEFINER RPCs exactly as mobile does (offers/conversations/messages mutations are RPC-only because direct inserts are rejected by RLS by design — replicated that, not bypassed it).
- **Migrations/Edge Functions untouched** — `supabase/migrations/` and `supabase/functions/` have zero changes; `delete-account`, `r2-presign`, `r2-delete` are called as-is.
- `web/.env.local` holds only the public URL + publishable anon key, is gitignored (`web/.gitignore`: `.env*.local`), and is not present in `git status`.

## Mobile protection

`git status` at the end of Phase 2 is **byte-identical** to `git status` at the start of the session for everything outside `web/` — same 7 pre-existing modified files under `app/`/`data/`, same untracked `assets/`/`marketing/` entries. Nothing under `app/`, `store/`, `lib/`, `supabase/`, `types/`, `.env`, or any other mobile-side path was read for write, let alone changed.

## Build

- **TypeScript**: `next build`'s type-check pass — **0 errors**.
- **Next.js production build**: `npm run build` — succeeds, all 17 routes compiled (`✓ Generating static pages (17/17)`). `/category/[id]`, `/chat/[id]`, and `/listing/[id]` now build as server-rendered-on-demand (ƒ) rather than static (○) — expected, since they fetch real per-id Supabase data at request time instead of static mock data.
- **Lint**: not run, same as Phase 1 (`next lint` needs a one-time interactive setup step this environment can't complete non-interactively); the build's type-check is the verification gate.

## Production-data testing — what I could and couldn't verify

**I have no browser in this environment** (confirmed in Phase 1 too) — I cannot click through Google sign-in, watch a real OAuth redirect complete, or visually confirm a listing/avatar/chat image actually renders. Everything below is either (a) verified by reading the mobile app's source and replicating its exact query/RPC shapes, or (b) verified by a clean TypeScript build — **not by exercising the live app**. No production data was read or modified during this session; the only network calls I made were `npm install` and the Next.js build (which does not contact Supabase).

Before you use this, please do a manual pass and pay particular attention to:

1. **Google OAuth redirect allow-list** — your Supabase project's Auth settings (and the Google Cloud OAuth client's authorized redirect URIs) need `http://localhost:3000/*` (dev) and your production web origin added, alongside the existing mobile `suuqplus://auth-callback` / Expo entries. I can't add these — it's a dashboard change outside this repo.
2. **R2 image domain** — `web/next.config.mjs` allow-lists `*.r2.dev` (R2's default public dev URL pattern) plus `lh3.googleusercontent.com` (Google avatars), `picsum.photos`, and `res.cloudinary.com` (legacy rows). **If your bucket's `R2_PUBLIC_URL` is a custom domain instead of the default `pub-*.r2.dev`, add that exact hostname to `images.remotePatterns` in `next.config.mjs`** — I can't read that value, it's an Edge Function secret not present anywhere in this repo.
3. **R2 CORS** — `r2-presign` returns a presigned PUT URL that the Sell flow now PUTs to directly from the browser (`fetch`). If the R2 bucket's CORS policy doesn't already allow your web origin, browser uploads will fail (mobile doesn't hit this, since native `expo-file-system` isn't subject to browser CORS). Worth a quick manual Sell-flow test with a real account before relying on it.
4. **First real sign-in** — the profile upsert fallback and `on_auth_user_created` trigger should just work (same code path as mobile), but this hasn't been exercised against the live project from a browser.

## Stop point

Per the brief, Phase 2 stops here — connected the 10 domains listed, didn't redesign any UI, didn't touch the mobile app or backend. Recommend: do the manual browser pass above (sign-in, browse, favorite, chat, sell, and cross-check each against the mobile app) before treating this as production-ready.
