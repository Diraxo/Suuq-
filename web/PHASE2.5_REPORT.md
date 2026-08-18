# Fursad Website — Phase 2.5 Verification Report

Verification pass only — no new features, no redesign, no mobile app files touched. Goal: confirm Phase 2 (`PHASE2_REPORT.md`) against the real backend and identify what blocks production use.

## 1. Configuration audit

- `web/.env.local` holds only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` — both **byte-identical** (checked programmatically, not printed) to the root `.env`'s `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`. **Confirmed: website and mobile app point at the same Supabase project.**
- `web/.env.local.example` only lists the two public keys, with a comment warning never to put a service-role or R2 secret key there.
- `src/lib/supabase.ts` — plain `@supabase/supabase-js` client, `flowType: 'pkce'`, `detectSessionInUrl: true`, `persistSession: true`. No server-side Supabase client, no service-role usage anywhere in `web/`.
- `next.config.mjs` — `images.remotePatterns` allow-lists `picsum.photos`, `lh3.googleusercontent.com`, `res.cloudinary.com`, and `*.r2.dev`.
- `web/` is currently **entirely untracked in git** (`git status` shows `?? web/`) — not a code defect, just noting it isn't committed yet.

## 2. OAuth

`src/services/auth.ts`: `signInWithGoogle(redirectPath)` calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + redirectPath } })`. `redirectTo` is **built dynamically from the current page's own origin** — there is no fixed `/auth/callback` route, and no hardcoded localhost or dev URL anywhere in `web/src` (grepped, zero matches). This means the code will automatically use whatever domain it's deployed to — nothing to change in code when you go from `localhost:3000` to production.

Practical effect: Supabase needs a **wildcard** entry covering every page path on your domain, not one fixed callback URL, because `redirectPath` varies (`/sell`, `/profile`, `/listing/[id]`, etc.).

Read the mobile side (`store/auth.ts`) for comparison only, not modified: mobile uses `AuthSession.makeRedirectUri({ scheme: 'suuqplus', path: 'auth-callback' })` → `suuqplus://auth-callback`, a completely separate custom-scheme entry. Adding the web entries below does not require touching or removing that.

## 3. R2 upload flow

`src/services/r2.ts` → `uploadToR2()`:
1. Calls the existing `r2-presign` Edge Function (unchanged, `supabase/functions/r2-presign/index.ts`) via `supabase.functions.invoke`, authenticated with the caller's own session JWT.
2. The Edge Function verifies the JWT, checks the requested folder contains the caller's own `user.id` as a path segment (ownership guard), and returns a presigned S3-style PUT URL pointing directly at `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com/{bucket}/{key}` — signed server-side with the real R2 credentials, which **never leave the Edge Function**.
3. The browser then does a plain `fetch(uploadUrl, { method: 'PUT', body: file })` **directly to that R2 endpoint** from `web/src/app/sell/page.tsx` (folder = `listings/{session.user.id}`, matching the ownership guard).

Step 3 is a **cross-origin browser request** (web origin → `*.r2.cloudflarestorage.com`), which the mobile app never does (native `fetch` isn't subject to CORS). **This requires the R2 bucket's CORS policy to explicitly allow your production web origin for `PUT` with the `Content-Type` header**, or uploads will fail silently with a browser CORS error. No CORS configuration exists anywhere in this repo (grepped for `AllowedOrigins`/`CORSRule`/`cors` — zero matches) — this is Cloudflare-dashboard-only and out of reach from the code.

Verified no R2 secret (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`) appears anywhere in `web/src` — zero grep matches.

## 4. Production-domain / dev-leftover audit

- Grepped `web/src` for `localhost` / `127.0.0.1` — **zero matches**.
- Grepped for `mock`/`dummy`/`fake`/`TODO`/`FIXME` — the only hits are: a code comment in `services/listings.ts` explicitly stating there's *no* mock fallback, and `src/lib/mockData.ts` (265 lines), a **leftover Phase 1 file that is no longer imported anywhere** (`grep -rn "from '@/lib/mockData'"` → zero matches). It's dead code, not wired into any live page — safe to delete later, not a production risk today.
- No debug/QA-only routes exist in `web/src` (mobile's `app/dev-qa.tsx` has no web equivalent).
- No service-role key, R2 secret, or Cloudinary secret anywhere in `web/src`.

## 5. Real testing performed

**No interactive browser is available in this environment** (same limitation as Phase 1 and Phase 2 — confirmed again, not assumed). I could not click through actual Google sign-in or visually confirm rendering. What I *could* and did do, beyond Phase 2's read-the-source-only verification:

- Ran `npm run build` — production build, clean (`0` TypeScript errors, all 17 routes compile, identical shape to Phase 2's build).
- Ran `npm run start` (real production server) against the **real, live Supabase project** (using `.env.local`'s real credentials) and hit routes with `curl`:
  - `/` → 200, `/search` → 200, `/sell` → 200, `/profile` → 200, `/category/electronics` → 200, `/listing/<nonexistent-uuid>` → 200 (graceful not-found, no server crash).
  - No `Something went wrong` / runtime error strings in any response body.
  - Server log showed no errors or exceptions from Supabase calls during any of these requests.

This confirms the read paths (listings, category, search, profile, listing-detail) genuinely talk to the live database with no config or query errors. It does **not** confirm: Google OAuth completing end-to-end, an authenticated write (favorite/chat/offer/create-listing), or an actual R2 image upload — those all require a real signed-in browser session, which this environment cannot provide.

## 6. Cross-platform data consistency

Not independently re-verified beyond Phase 2's claim (same tables/columns/RPC names as `store/*.ts`) plus this pass's live read-path smoke test — an authenticated write-and-check-on-both-platforms test (favorite on web, confirm on mobile, etc.) needs a real signed-in session and wasn't possible here.

## 7. Production safety

- **No service-role key in browser code** — confirmed (grep, zero matches).
- **No R2 secret in browser code** — confirmed (grep, zero matches).
- **RLS untouched** — `git status --porcelain supabase/` is empty; no migration files changed.
- **No migrations changed, no Edge Functions changed** — same result.
- **No mobile application files changed** — `git status` for everything outside `web/` is identical to the session-start snapshot (same 7 pre-existing modified files under `app/`/`data/`, same untracked `assets/`/`marketing/` entries).
- **No fake listings injected** — nothing in this pass wrote to the database; the only network calls were `npm run build`, `npm run start`, and read-only `curl` requests.

## 8. Build

- TypeScript: 0 errors.
- Next.js production build: succeeds, all 17 routes.
- No new build errors vs. Phase 2.

---

## READY

- Codebase config is correct and points at the real Supabase project (same as mobile).
- No secrets are exposed to the browser.
- No dev/mock/localhost leftovers in any live code path.
- Read-path pages (home, search, category, listing detail, profile, sell form) render successfully against live production data.
- Build is clean.
- Mobile app and Supabase backend (migrations/Edge Functions/RLS) are completely untouched.

## BLOCKED (requires dashboard/deployment info I cannot obtain from this repo)

1. **Supabase Auth → URL Configuration**: needs your production web domain added — I don't know that domain yet (nothing in this repo names it; `web/` has no `vercel.json`, no deployment config, no domain string anywhere).
2. **Google Cloud OAuth client**: needs the same production origin added as an authorized JavaScript origin — same blocker, domain unknown.
3. **R2 bucket CORS**: needs the production web origin allowed for `PUT` — same blocker, and also can't confirm the bucket's actual `R2_PUBLIC_URL` (it's an Edge Function secret, not present in this repo) to know if `next.config.mjs`'s `*.r2.dev` pattern is sufficient or needs a custom domain added.
4. **End-to-end interactive testing** (Google sign-in completing, favorite/chat/offer/create-listing writes, real image upload, mobile↔web live sync) — needs a real browser with a signed-in session, unavailable in this environment.

## WARNINGS

- `web/` is entirely untracked in git — worth committing before you lose track of what's deployed.
- `src/lib/mockData.ts` is dead code (Phase 1 leftover, unused) — harmless but worth deleting in a later cleanup pass.
- Once you know the production domain, you must add it in **three separate places** (Supabase, Google Cloud Console, R2 CORS) — missing any one of the three will produce a different failure mode (OAuth redirect rejected, Google login screen error, or silent image-upload CORS failure), so test all three, not just one.

## EXACT CONFIGURATION

I can't fill in the domain-specific values below — they require you to tell me (or check) your actual production URL. Once you have it (call it `https://YOUR-DOMAIN`):

- **Supabase → Authentication → URL Configuration → Redirect URLs**: add `https://YOUR-DOMAIN/*` (wildcard needed — the code redirects to whatever page the user started from, not one fixed callback path). Keep the existing `suuqplus://auth-callback` / Expo entries as-is.
- **Google Cloud Console → OAuth client → Authorized JavaScript origins**: add `https://YOUR-DOMAIN` (origin only, no path). **Authorized redirect URIs** on the Google client itself should already list your Supabase project's `https://<project-ref>.supabase.co/auth/v1/callback` (standard Supabase Google-OAuth setup) — verify that's present; it's a one-time setup that shouldn't need to change per web domain.
- **Cloudflare R2 → bucket → Settings → CORS Policy**: add an `AllowedOrigins` entry for `https://YOUR-DOMAIN`, `AllowedMethods: PUT`, `AllowedHeaders: Content-Type` (or `*`), since the Sell flow's browser upload PUTs directly to R2.
- **Production environment variables** (Vercel/host of your choice): `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` — same two values as `web/.env.local` (already confirmed identical to the mobile app's), no others needed for the website to build or run.

**Do this before deploying further:** get the production domain locked in, add it to the three dashboards above, then run the browser test list from the original brief (guest → sign-in → sell → cross-check on mobile) once, for real, before calling this launched.
