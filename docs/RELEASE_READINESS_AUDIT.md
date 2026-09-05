# SUUQIYE — FINAL RELEASE READINESS REPORT

**Date:** 2026-09-03
**Scope of this pass:** static repository audit + local build/type verification only.
No live Supabase access, no real-device testing, no AAB build (per instruction §19).
**No code was changed in this pass** — per your instruction to audit first and propose
fixes before making broad changes.

---

## RELEASE DECISION

# 🔴 NOT READY

Do **not** build the production AAB yet. Four independent blockers, none of which
can be closed from the repository alone:

1. **The web publish failure is still not proven** — but this audit found a
   concrete, previously-unnamed top suspect (missing CORS on the Edge Functions).
   Needs a 1-minute Network-tab check to confirm or eliminate.
2. **Phase 1 runtime verification was never completed.** The fixes for the publish
   failure (migration `0031`) and network-aware errors (Part 2) are implemented but
   have never been exercised against the real project. `docs/phase1-runtime-verification.md`
   is the procedure and it is still marked "NOT verified."
3. **Section 5 (dynamic city/location system) does not exist.** Still a hard-coded
   list in `data/categories.ts`. No `locations` table, no migration, no admin UI.
   This is a feature build, not an audit item.
4. **Section 10 (admin notification on every new listing) does not exist.** No
   trigger anywhere in `supabase/migrations/` fans a new-listing notification to
   the admins.

Sections 3, 4, 8, 9, 10 (push), 11, 12, 13, 18 additionally require live-database
and real-device verification that this environment cannot perform.

---

## 1. VERIFIED (static / local only)

| Item | Evidence |
|---|---|
| Web TypeScript compiles clean | `cd web && npx tsc --noEmit` → exit 0, 0 errors |
| Web production build succeeds | `cd web && npx next build` → exit 0, all 30 routes compiled/prerendered |
| Mobile app TypeScript clean | root `npx tsc --noEmit` → 0 errors under `app/ lib/ store/ components/ hooks/`. (297 total errors are all in `web/` — the known root-tsconfig path-alias phantom, documented in the moderation brief; not real.) |
| No secrets committed | Repo grep for `service_role` / `BEGIN PRIVATE KEY` / `GOOGLE_SERVICE_ACCOUNT_JSON` / `PUSH_WEBHOOK_SECRET` values → only variable *names* and `Deno.env.get(...)` server-side reads. `.env` (mobile) and `web/.env.local` exist locally and are **git-ignored / untracked**. |
| Production config identifiers intact | `app.json`: name `SUUQIYE`, slug `suuqplus-clean`, scheme `suuqplus`, `android.package` / `ios.bundleIdentifier` = `com.suuqplus.app`, EAS `projectId` `b102f930-1fe5-494c-80c1-1bccd8102576`. All unchanged. |
| No user-facing "Fursad" branding | `locales/{en,so,am}/translation.json` → 9× `SUUQIYE`, 0× `Fursad`, 0× `Suuq+`. `.tsx` matches for `fursad` are all asset filenames (`fursad-logo.png` etc.) and storage keys (`fursad-web-theme`, `fursad-pending-favorite`) — intentionally preserved per project memory. |
| Mobile About screen uses the real logo | `app/about.tsx` renders `require('@/assets/images/fursad-logo.png')` (SUUQIYE artwork), not the old "F" letter. The `PHASE1_REPORT.md` note about a text "F" is stale. |
| Migrations 0028–0031 are internally consistent | Reviewed each `create or replace function` body — see §6. |
| Web env points at production | `web/.env.local` → `NEXT_PUBLIC_SUPABASE_URL=https://waksddinkjbrggxkfofk.supabase.co`, publishable anon key only. No localhost/ngrok anywhere in shipped code (`localhost` matches are only in `docs/` and `PHASE*_REPORT.md`). |
| Admin authorization model is sound (by code) | `0027_admin_foundation.sql`: `admin_users` has RLS enabled with **zero** policies → unreachable via PostgREST; `is_admin()` is `security definer` checking `auth.uid()`; every `admin_*` RPC gates on `is_admin()` and writes `admin_audit_log` in the same transaction. A client cannot self-promote or spoof `user_id`. |
| Reviewer sign-in trigger is correctly hidden | `app/(tabs)/profile.tsx:214` — `onLongPress` (`delayLongPress={800}`) is on the **guest-only** avatar branch (`session ? … : <guest>`); an authenticated user never renders that Pressable. No reviewer credentials in the repo. |

---

## 2. FIXED AND VERIFIED

**Nothing.** No code was changed in this pass (audit-first, per your instruction).
The fixes below are proposed in §4 / §5 and await your go-ahead.

---

## 3. MANUAL / RUNTIME TESTS REQUIRED (cannot be done from here)

1. **Web publish end-to-end** — the whole of `docs/phase1-runtime-verification.md`
   Test 0 and matrix A–J. Specifically capture the failing request in the Network
   tab (see §4.1 below — this is the single highest-value 10 minutes you can spend).
2. **Part 2 network-aware errors** — P2-1…P2-8 in that same doc (offline, expired
   session, RLS, suspended, upload failure) on **both** web and mobile, in all
   three languages.
3. **Remote migration state** — `supabase migration list`: confirm 0027, 0028,
   0029, 0030, 0031 all show under **Remote**, and dump the live
   `trg_enforce_rate_limit` / `respond_to_offer` / `mark_conversation_read` bodies
   to confirm the deployed definitions match the repo.
4. **Push pipeline** — insert a `notifications` row, confirm the
   `on_notification_insert_push` trigger fires `send-push-notification`, a device
   with a registered token receives it, foreground + background, and an invalid
   `X-Push-Webhook-Secret` is rejected 401.
5. **Offers / sold status (0029)** — accept an offer, confirm the listing stays
   `available`; call `mark_listing_sold`, confirm competing pending offers flip to
   `sold`.
6. **Notifications (0030)** — open a conversation with an unread "message"
   notification, confirm the bell notification clears.
7. **Moderation loop** — report → admin sees it → dismiss/resolve → reporter
   notified → remove listing → seller notified → suspend seller → suspended seller
   blocked from posting/messaging and sees a clear suspended state.
8. **Full new-user E2E** (§18 steps 1–39) on a real device build.
9. **Store assets** — verify icon 512×512, feature graphic 1024×500, screenshot
   dimensions, no debug UI, against the actual generated files.
10. **Legal URLs** — load `https://diraxo.github.io/Suuq-/privacy-policy.html` and
    `.../terms.html` and confirm they say SUUQIYE and the deletion instructions work.
11. **Support mailbox** — confirm `suuqiyesupport@gmail.com` actually exists and is
    monitored (flagged in project memory as unverified).

---

## 4. BLOCKERS

### 4.1 Web image upload — CORS is missing on every Edge Function (TOP SUSPECT for the reported failure)

**None** of the Supabase Edge Functions handle CORS:

```
supabase/functions/r2-presign/index.ts      — no OPTIONS handler, no Access-Control-* headers
supabase/functions/r2-delete/index.ts       — same
supabase/functions/send-push-notification/  — same (server-to-server, OK)
supabase/functions/delete-account/          — same
```

`web/src/services/r2.ts` → `uploadToR2()` calls
`supabase.functions.invoke('r2-presign', …)` from the browser. That is a
cross-origin `POST` with `Authorization` + `Content-Type: application/json`
headers → the browser sends a **preflight `OPTIONS`** first. `r2-presign` has no
`OPTIONS` branch (it falls straight into `await req.json()` → throws → 500) and
its success response carries no `Access-Control-Allow-Origin`, so the browser
blocks the call before the app ever sees a useful error. `supabase-js` surfaces
that as a `FunctionsFetchError` / "Failed to fetch", which
`web/src/app/sell/page.tsx:131` re-labels as **`upload-failed`** →

> "We couldn't upload your image / Please check your connection and try again."

**This exactly matches the reported symptom, and explains why mobile is fine**
(React Native `fetch` does not enforce CORS) **while web is not.**

Second, related: the actual `PUT` to `https://<hash>.r2.cloudflarestorage.com/…`
is also cross-origin from the browser and needs a **CORS policy on the R2 bucket
itself** (Cloudflare dashboard → bucket → Settings → CORS) allowing `PUT` from the
web origin. Mobile never needs this.

**Confidence:** high, but **not proven** — I have no live environment. Confirm in
≈2 minutes: open the web `/sell` flow, DevTools → Network, attempt a publish, and
look at the `r2-presign` request. If you see a red `OPTIONS` / `(failed)` /
"CORS error" line, this is it.

**Proposed fix (small, isolated):**
- Add a shared `supabase/functions/_shared/cors.ts` (`Access-Control-Allow-Origin`,
  `-Headers: authorization, x-client-info, apikey, content-type`,
  `-Methods: POST, OPTIONS`).
- In `r2-presign` and `r2-delete`: `if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })`
  and spread `cors` into every `Response`'s headers (success **and** error).
- Redeploy both functions (`supabase functions deploy r2-presign r2-delete`).
- Add the CORS policy to the R2 bucket for the web origin(s).
- Does **not** touch mobile, RLS, identifiers, or the presign logic itself.

### 4.2 Phase 1 runtime verification never completed

`0031_rate_limit_listing_idempotent.sql` and the Part 2 error layer are
implemented and look correct on review (§6), but:
- It is unknown whether `0031` is applied to the **remote** database.
- The "first failure that starts the retry chain" (Test 0) was never captured.
- Matrix A–J and P2-1…P2-8 were never run.

Until `docs/phase1-runtime-verification.md` is executed and its evidence pasted
back, the publish path cannot be called fixed.

### 4.3 Section 5 — dynamic city / location system: not built

- Cities are still the hard-coded array in `data/categories.ts` ("The full list
  of cities Suuq+ supports…").
- No `locations` table, no migration, no A–Z / search / "add your own" flow, no
  admin locations screen, no usage counts, no dedupe / merge / deactivate.
- The specific requirement — *a new location becomes public only after the
  listing successfully publishes* — needs a two-phase design (staging a
  `pending` location on the draft, promoting it in the same transaction as the
  listing insert, concurrency-safe via a unique index on the normalized name).

This is multi-day feature work across a migration + mobile + web + admin. It
should be its own phase with its own plan, not folded into a release audit.

### 4.4 Section 10 — admin notification on every new listing: not built

No trigger inserts an admin-directed `notifications` row on `listings` insert.
Section 10's requirements (all three admins notified, payload carries seller +
title + timestamp + listing id, click opens admin detail) need a new
`after insert on public.listings` trigger that fans out to
`select user_id from public.admin_users`.

### 4.5 `google-services.json` is committed to the repo

`.gitignore` deliberately un-ignores it (`# google-services.json`). It contains
the Firebase Android API key + project config. This is **client configuration,
not a private key** — Google's own guidance is that it is safe to commit, and it
is restricted by package name + SHA fingerprint — so this is **low severity**.
Flagging it so it is a conscious decision, not an accident. (No
`google-services.json` for iOS / `GoogleService-Info.plist` is tracked; verify
the iOS one is provided at build time.)

---

## 5. NON-BLOCKING WARNINGS / SMALL FIXES

| # | File | Issue | Proposed fix |
|---|---|---|---|
| W1 | `app/(tabs)/profile.tsx:62` | Mojibake in a comment: `them â€” no refresh` (UTF-8 em-dash decoded as CP-1252). Cosmetic, source-only. | Replace `â€"` with `—`. §6 of your brief asks for this. |
| W2 | `components/ReviewerSignInModal.tsx:50-52` | `catch { error = t('…incomplete') }` — any unexpected exception (network drop, 500) is mislabeled to the reviewer as "incomplete email/password". | Run the caught value through the existing `toAppError()` (`lib/errors.ts`) and show `.message`; also classify `store/auth.ts` `signInWithPassword`'s returned `error.message` instead of passing the raw Supabase string. |
| W3 | `supabase/functions/send-push-notification/index.ts:302-351` | `PUSH_QA_LOGGING` temp block still present. Logs token **ids** (not tokens) and types — no secret leak, but it's explicitly marked "delete once QA is done". | Remove the block or confirm the `PUSH_QA_LOGGING` secret is unset in production. |
| W4 | `supabase/migrations/0027_admin_foundation.sql:117-121` | Reporter notification body is hard-coded `"Thanks for helping keep Suuq+ safe."` — a user-facing "Suuq+" string. | Change to "SUUQIYE" in a follow-up migration (don't edit an applied migration in place). |
| W5 | `web/src/services/listings.ts:205` (`createListing`) | `hydrateSellers([data])` runs after the row is written with no try/catch. If the profiles/stats read throws, a **committed** publish surfaces as a thrown error → generic error notice, and the retry path re-enters. This is the documented, still-open "first-failure transient." | Wrap the post-write hydration; on hydration failure return a minimal `Listing` from `data` alone (row is already saved) rather than throwing. |
| W6 | `app/(tabs)/profile.tsx:68`, `:296` | Guest/fallback avatar uses `https://picsum.photos/seed/…` — an external placeholder service in production UI. Fine as a dev fallback; looks unprofessional if it ever shows to a real user and adds a third-party dependency. | Use a local initials/monogram avatar fallback. |
| W7 | `CLAUDE.md` | Contains only `@AGENTS.md`, but there is **no `AGENTS.md`** at the repo root (only in `node_modules`). The referenced project rules file is missing. | Restore `AGENTS.md` (project memory refers to "AGENT.md §0" constraints). |
| W8 | `app.json` splash | `expo-splash-screen` `backgroundColor` is `#4F46E5`, adaptive icon background is `#3F46BB`. Intentional per brand memory (splash = primary, adaptive = deep) — just confirm on an Android 12+ device that the transition doesn't flash. |

---

## 6. DATABASE / MIGRATION STATUS

| Migration | Purpose | Local | Remote | Review notes |
|---|---|---|---|---|
| 0027_admin_foundation | admin_users, is_admin(), audit log, warn/suspend/remove RPCs, suspension enforcement | ✅ in repo | ❔ unverified | Sound. `admin_users` unreachable via API; all RPCs gate on `is_admin()`; audit rows written in-txn. **Note:** this version of `trg_enforce_rate_limit` dropped `create_message` + `skip_rate_limit` — fixed by 0028. |
| 0028_fix_rate_limit_create_message | restores `create_message` branch + `suuqplus.skip_rate_limit` bypass that 0027 dropped | ✅ | ❔ | Correct. Re-adds both. Keeps 0027's admin bypass + suspension check. |
| 0029_offer_accept_no_auto_sold | accepting an offer no longer auto-marks sold; adds `mark_listing_sold()` | ✅ | ❔ | Correct per §9 of your brief. Accept → offer only flips to `accepted` + buyer notified. `mark_listing_sold()` checks `user_id = auth.uid()`, flips competing pending offers to `sold`. **Note:** your brief §9 says "buyer accepting offer auto-marks sold as intended" — the installed function does **not** distinguish buyer-accept from seller-accept; neither path marks sold. Confirm which behavior you actually want. |
| 0030_mark_conversation_read_clears_notification | `mark_conversation_read()` also marks matching `type='message'` notifications read | ✅ | ❔ | Correct. Participant check preserved; `UPDATE notifications … where type='message' and (data->>'conversationId')::uuid = p_conversation_id`. |
| 0031_rate_limit_listing_idempotent | `create_listing` rate-limit counts genuine new rows only (skips idempotent upsert retries) | ✅ | ❔ | Logic correct: `if not exists (select 1 from public.listings where id = new.id)` gates the count. `security definer` so the check bypasses RLS and is exact. Genuine new listing (fresh uuid) still counted; 11th still `P0001`. All 0028 behavior reproduced verbatim. **Over-counts by at most 1 under a true concurrent double-submit of the same new id — acceptable.** |

**Everything from 0027 on is "unverified remote."** `supabase migration list` + a
dump of the three live function bodies is required before release.

---

## 7. SECURITY STATUS

- **No exposed secrets in the repository.** Service-role key, R2 keys, FCM service
  account, webhook secrets are all referenced by name only and read server-side
  via `Deno.env.get()` in Edge Functions.
- `.env` / `web/.env.local` are untracked and git-ignored. Only the publishable
  anon key + project URL appear in tracked files (client-safe by design).
- `google-services.json` **is** tracked — low severity (client config, not a
  key), flagged in §4.5 for a conscious decision.
- Edge Function auth model is correct: `r2-presign` / `r2-delete` verify the
  caller JWT then do the privileged step server-side; per-key folder-ownership
  check (`key.split('/').includes(user.id)` as a whole segment); `r2-delete` and
  `send-push-notification` use constant-time secret comparison for their trusted
  Postgres webhook paths.
- Admin model: no admin credentials in frontend code; `is_admin()` is the single
  authorization primitive; RLS on `admin_users` denies all API access.
- **Not checked (needs live):** whether RLS is actually enabled on every table in
  the remote DB, whether the anon role can read `reports` / `admin_audit_log` /
  `moderation_warnings` (policies say no — verify), whether Edge Function secrets
  are actually set in the production project.

---

## 8. BUILD STATUS

```
# Web TypeScript
$ cd web && npx tsc --noEmit
  → exit 0   (0 errors)

# Web production build
$ cd web && npx next build
  → exit 0   ✓ Compiled successfully
  → 30 routes generated (static + dynamic), First Load JS ~105 kB shared

# Mobile TypeScript (root)
$ npx tsc --noEmit
  → 297 errors total, ALL under web/ (root tsconfig compiles web/ with the
    wrong path alias — known/documented phantom, not real)
  → 0 errors under app/ lib/ store/ components/ hooks/  ✓

# ESLint / expo lint
  → not run. `npx expo lint` is broken in this repo (looks for a missing src/).
    Documented in project memory. Recommend `cd web && npx next lint` manually.

# Expo config validation
  → not run (would require `npx expo config` / EAS credentials).
```

---

## 9. PRODUCTION CONFIG STATUS

| Setting | Value | OK? |
|---|---|---|
| App name | `SUUQIYE` | ✅ |
| Android package | `com.suuqplus.app` | ✅ unchanged |
| iOS bundle id | `com.suuqplus.app` | ✅ unchanged |
| Expo slug | `suuqplus-clean` | ✅ unchanged |
| Scheme | `suuqplus` | ✅ unchanged |
| EAS projectId | `b102f930-1fe5-494c-80c1-1bccd8102576` | ✅ unchanged |
| Version | `1.0.0` | ✅ (verify this is the intended first-release version) |
| Android versionCode | not in `app.json` — `eas.json` uses `appVersionSource: "remote"` + `production.autoIncrement: true` | ⚠️ managed by EAS; confirm the remote counter is where you expect before submitting |
| Icons / splash / adaptive / favicon | `./assets/images/fursad-*.png` (SUUQIYE artwork, filenames kept on purpose) | ✅ filenames intentional; **image dimensions/quality not verified in this pass** |
| Supabase | `waksddinkjbrggxkfofk` (prod, shared web+mobile) | ✅ |
| Firebase | `google-services.json` present; `@react-native-firebase/*` plugins configured; iOS `GoogleService-Info.plist` referenced | ⚠️ confirm iOS plist is provided at build time |
| R2 | client holds no credential; via `r2-presign` / `r2-delete` Edge Function secrets | ✅ design; ⚠️ confirm secrets set in prod + bucket CORS (§4.1) |
| Localhost / ngrok / debug endpoints in shipped code | none | ✅ |
| `newArchEnabled` | `true` | ⚠️ verify a production build actually boots with New Architecture on this dependency set |

---

## 10. FINAL RECOMMENDATION

**Do not build the AAB now.** In priority order:

1. **Confirm or kill the CORS hypothesis (§4.1) — 5 minutes.** Open web `/sell`,
   DevTools Network, attempt a publish, read the `r2-presign` request outcome.
   Paste it back. This is very likely *the* bug.
2. If confirmed: apply the small CORS fix to `r2-presign` + `r2-delete`, add the
   R2 bucket CORS policy, redeploy the two functions.
3. **Run `docs/phase1-runtime-verification.md`** end to end (Test 0 + A–J + P2-*)
   and paste the evidence. This closes blocker §4.2.
4. **Run `supabase migration list`** and dump the three live function bodies —
   closes the "remote unverified" column in §6.
5. Decide whether §4.3 (dynamic cities) and §4.4 (admin new-listing notification)
   are **in scope for this release** or a fast-follow. If in scope, they each need
   their own plan + implementation phase — they are not audit fixes.
6. Apply the small W1–W7 fixes (all low-risk, none touch identifiers/RLS).
7. Verify store assets, legal URLs, and the support mailbox.
8. Re-run this checklist. Only when 1–7 are green do you build the AAB.

**What is genuinely in good shape:** the config/identifier hygiene, the branding
sweep, the error-classification architecture (web + mobile), the admin
authorization model on paper, and migrations 0028–0031 by inspection. The problem
is not that the code looks wrong — it's that the parts that matter for a
first-time production release have never been run against the real backend or a
real device.
