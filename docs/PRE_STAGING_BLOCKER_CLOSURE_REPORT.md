> **HISTORICAL SNAPSHOT (2026-10-19).** Counts, file lists and 'migrations 0054-0059' predate 0060-0063 and the 2026-10-21 direct-upload decision. Its fail-closed rows ('avatar/logo/banner fail closed if scanner unavailable', 'enforcement defaults ON') describe the scanned path; the shipped state is OFF. The rollback-freeze section (media_rollback) is still accurate and unchanged by 0062/0063.
>
> **Current facts (2026-10-21), authoritative text in `MEDIA_LAUNCH_POLICY.md`; nothing below was applied, deployed or committed.**
> - Shipped policy is **direct upload with scan enforcement explicitly OFF** (0057 seeds `business_media_config.enforce=false`; missing/NULL still reads ON). Avatars, logos and banners are **NOT scanned**: this is an accepted, time-limited risk, never a control. `r2-presign` does not refuse `avatars/` or `business/`, and neither client has a Worker path.
> - **0062** (local, unapplied): host pin for any CHANGED avatar/logo/banner that carries a key: the URL must be exactly `https://<host in storefront_media_hosts>/<key>`. **Apply order (hard):** insert the `R2_PUBLIC_URL` host into `storefront_media_hosts` first (0062 seeds none; empty list = every avatar/logo/banner save fails, fail closed), needs 0054 and 0056. Works in both enforcement modes.
> - **0063** (local, unapplied): refuses a NEW URL-only (no key) avatar/logo/banner on update; on first-login INSERT only an avatar on `lh3.googleusercontent.com` is tolerated. Unchanged legacy URLs keep passing. Needs 0038 and 0056 only (no host list). Cost: a hypothetical pre-R2 (Cloudinary-era) build could not CHANGE its photo; the repository holds **no evidence** of the deployed or minimum supported app version, so none is assumed. Owner decision still open.
> - **Apply order:** 0054 -> 0055 -> 0056 -> 0057 -> 0058 -> 0059 -> insert host row -> 0062 -> 0063. **Rollback strictly reverse** (0063, 0062, 0059, 0058, 0057, 0056); the 0062 and 0063 rollbacks drop only their own trigger/functions and change no data; the 0056/0057/0059 rollbacks install the media freeze.
> - **Still open:** unscanned bytes in our own bucket (no content check), a Google photo kept on first-login INSERT while OFF, existing rows never rewritten (no backfill), owner decisions P1/P2/B1 and the URL-only decision, no staging run.

# Pre-staging release blocker closure report

Date: 2026-10-19. Branch `ios-app-store-readiness` (HEAD `7d7fac8`). **Nothing was committed, pushed, migrated or deployed; no external service or database was contacted** (the only network use was `npm install`/`npm audit` for the web dependency fix and Deno type downloads).

## STATUS: RELEASE BLOCKED — EXTERNAL GATES REMAIN

## 1. Working tree (what belongs to what)
117 changed paths now (112 at start + this pass). Everything is uncommitted. Grouped:
- **Media security release (this release):** migrations `0054`–`0059` (all untracked, never committed), `supabase/rollback/005[4-9]*`, `supabase/functions/{r2-presign,delete-account,account-deletion-drain,verification-document,_shared/*}`, `workers/image-scan/*`, `lib|web/src/lib/{businessMedia,profileRules,saveOutcome,storefront*}.ts`, `lib/r2.ts` + `web/src/services/{r2,profileMedia,imagePrep}.ts`, `hooks/useAvatarActions.ts`, `hooks/useImageUpload.ts`, `store/auth.ts`, `web/src/services/auth.ts`, profile/business/storefront screens, locales, tests (`tests/*`, `supabase/tests/*`), docs `MEDIA_*`, `BUSINESS_MEDIA_*`, `STOREFRONTS_0054_*`.
- **Earlier unrelated work still uncommitted:** storefront screens/flows (0054 is held by owner decisions B1–B3), bulk upload web (`web/src/app/business/bulk-upload`, `BulkQueuePanel`), admin businesses pages, `ZoomableImage`, `lib/push.ts`, `web/src/lib/{adminGate,notificationRoute}.ts`, `.env.example`.
- **Stray file:** `tatus --short` in the repo root (7.5 KB of `git diff` output dated Sep 3, an accidental redirect). Not part of the release, contains no secrets; left in place — delete it when convenient.
- Nothing was discarded or overwritten. Files I edited in this pass are listed in §2.

## 2. Changes made in this pass
| Area | Change |
|---|---|
| Rollback security (blocker) | `supabase/rollback/0057_…`, `0059_…` rewritten; new `0056_profile_content_guard_ROLLBACK.sql`. Rollbacks now install an unconditional **media freeze** (see §4) instead of falling back to the weaker 0056 rules |
| Forward migration | `0057`: `alter column enforce set default true` (corrects an older draft whose table default was `false`; an existing `false` row is deliberately not overwritten — runbook preflight checks it) |
| Worker defect | `isBusinessImageKey` used `\.jpg` inside a template literal, which is a regex wildcard (`…Xjpg` matched). Fixed (`\\.`), test-first |
| Worker config safety | New `normalizePublicBase()`: empty / placeholder / non-https / path-carrying `PUBLIC_BASE_URL` makes every upload fail with 500 before anything is published. Used by `createStorage` |
| Deploy safety | `wrangler.toml` top level names the **production** public bucket (`fursad-media`), production Supabase project and public URL. Added a placeholder-only `[env.staging]` block (+ test that it contains no production identifier). Staging deploys must use `--env staging` |
| Web dependency (audit critical) | `web`: `next` 15.1.12 → **15.5.28** and `eslint-config-next` → 15.5.28 (`npm audit` critical 1→0; incl. auth-bypass, RCE advisories in the version in use). Build, tsc, lint re-run green |
| Tests | New `supabase/tests/media_rollback.test.mjs` (13 assertions, added to `run-all.mjs`); updated `avatar_media`/`business_media` rollback assertions (they previously asserted the weak behaviour as intended); +3 unit tests |
| Docs | `docs/MEDIA_STAGING_RUNBOOK.md` (new), this report, `MEDIA_LAUNCH_POLICY.md` + `BUSINESS_MEDIA_STAGING_CHECKLIST.md` rollback statements corrected |

## 3. Migration-history findings (B)
- **Established:** `0054`–`0059` exist only as untracked files in this working tree. No commit on any branch (`git log --all`, 20 commits) touches them; `origin/*` has none. File times: 0054 (Oct 18 21:02), 0055 (Oct 18 21:30), 0056 (Oct 19 16:20), 0058 (Oct 19 17:35), **0057 and 0059 last rewritten Oct 19 19:36 (before this pass; 0057 gets one more line now)**.
- `supabase/.temp/` holds only CLI link metadata (project ref `waksddinkjbrggxkfofk`, the production project; no migration list). The production probe recorded on 2026-10-17 (memory) found 0038–0042 applied and 0043+ absent — it predates 0054 and says nothing about 0054–0059 today.
- **Not established:** whether any shared development, staging or ad-hoc database ever received an earlier draft or the current file of 0057 or 0059. The only statements that they were "never applied" are developer notes in docs/memory; per the brief that is not evidence. No staging project is recorded anywhere in the repo.
- **Why it matters:** 0057/0059 were edited in place. An earlier 0057 draft defaulted enforcement OFF; re-applying the current file over it would keep `enforce=false` (fail open). 0059's earlier draft allowed a Google avatar URL.
- **Required before release:** migration-history inspection of every target database using `MEDIA_STAGING_RUNBOOK.md` §1.2 (tracker table + object fingerprints + `enforce` value + `handle_new_user` body). Unresolved uncertainty: **all external databases.**
- Missing rollback scripts: `0055` has none (documented as not re-runnable; deletion ledger) — still open; `0054_rollback_restore.sql` exists.

## 4. Rollback-security findings (C)
Before this pass (traced and now covered by a test that documents it — `media_rollback.test.mjs` #10):
- Forward: 0057 adds a scan trigger for logo/banner; 0059 extends it to avatars and removes the Google exception. Both pin the URL to a managed host.
- Old rollback: dropped the triggers, tables and config, leaving only **0056**. 0056 accepts an avatar/logo/banner whose URL is *any* https host if it ends with the caller's own key, and any Google/Cloudinary/picsum URL when no key is sent. So a legacy client or a direct PostgREST write could save an unscanned (and foreign-host) image URL after rollback. The old tests asserted this as intended.
- Clients and `r2-presign` stayed closed, but "direct database writes" were reopened. Rolling back only 0059 reopened avatars while 0057 was still live.

Fix (smallest consistent with the architecture): rollbacks keep a database control of the same name/shape. `profile_media_freeze()` / `storefront_media_freeze()` replace the scan triggers on `profiles` / `storefronts` (same trigger names, so re-applying 0057/0059 `create or replace`s them away). While active, a client write (`is_client_write()`) that sets any avatar, logo or banner to a **new non-null value is refused** (`image_not_verified`); clearing and re-saving the held value work; first-login insert nulls the avatar; non-client writers unaffected; it needs no table or config row and ignores `enforce`. 0059's rollback freezes avatars only (0057's logo/banner checks stay). 0056's rollback installs the freeze only if no media trigger exists.
Proof (real Postgres engine via PGlite, real SQL files, not mocks): 11 hostile write shapes × profile/storefront refused after each rollback step; held images unchanged; clearing/re-save/unrelated edits OK; signup still avatar-free; a refused 0057 rollback (0058 still applied) leaves the scan layer intact; re-apply restores real scanning with no freeze trigger left. Limits: PGlite is not Supabase; a rolled-back **`r2-presign` function** could still issue a PUT into the public bucket (object reachable by URL, but not attachable to a profile) — runbook §8 forbids that rollback without owner acceptance; remaining `0055` rollback absent.
No deployed environment was altered.

## 5. Media-security recheck (E)
| Property | Result | Evidence |
|---|---|---|
| Avatar/logo/banner fail closed if scanner unavailable | **Locally proven (code+unit)**: no scan URL → `notConfigured`; timeout/network → `offline`; 503/unknown → no save. Real outage **requires staging** (U-4) | `tests/businessMediaScan.test.ts`, `lib/r2.ts` |
| No direct-to-R2 fallback | Proven in code: both `uploadToR2` copies route `avatars/`+`business/` only to the Worker; `grep` shows no other writer of these folders | code inspection |
| Server rejects direct endpoint bypass | Proven in unit tests (426 for any case of `avatars/`, `business/`, no flag can reopen). Deployed behaviour **requires staging** (U-6) | `scanPolicy`, `deno check r2-presign` |
| Pending/rejected not publishable/fetchable | Proven: public object written only after DB `approved`; downgrade on failure; DB constraint approved⇔key. Actual bucket exposure **requires staging** (U-8) | worker tests, PGlite |
| Signup cannot plant an avatar | Proven (trigger + client fallbacks, all rollbacks) | `avatar_media`, `media_rollback` |
| Failed scan/save keeps existing image | Proven in code order (`useAvatarActions`: write first, delete old only after success); device behaviour **requires staging** (U-9) | code, tests |
| Listing-photo scanning still enforced | Code unchanged and tests green; **NOTE: enforcement is the database flag `legacy_presign_closed`, open by default until the mode ladder is closed** — requires staging evidence of the flag value (L-1…L-6) | `scanPolicy.ts` |
| DB checks ownership, host, key, kind, approval | Proven on PGlite (cross-user key, foreign host, wrong kind, unscanned, rejected/held) | `business_media`, `avatar_media` |
| Empty host config fails safely | DB: proven (empty `storefront_media_hosts` refuses). Worker: **new** `normalizePublicBase` refuses an empty/placeholder base | tests |
| Success is trusted server-side | Proven: key/url chosen by the Worker after Vision; clients cannot write scan rows (42501); client-sent status ignored. Real service-role flow **requires staging** (U-12) | tests |
| Account deletion/cleanup vs policy | Public avatar/logo/banner keys covered by ledger/`accountKeys`; scan rows cascade. **Gap (known): private `orig-media/` originals are not removed** — owner retention periods P1/P2/B1 are blank, deliberately unbuilt | `accountKeys.ts`, policy gate 7 |

## 6. Validation (final tree; shell exit codes)
| Check | Command | Exit | Result |
|---|---|---|---|
| Unit tests | `npm test` | 0 | 590 pass, 0 fail (was 587; +3) |
| Database suites | `PGLITE_DIR=… node supabase/tests/run-all.mjs` | 0 | **22/22 suites**, 488 PASS lines (incl. new `media_rollback`) |
| Mobile TypeScript | `npx tsc --noEmit -p tsconfig.json` | 0 | clean |
| Web TypeScript | `cd web && npx tsc --noEmit -p tsconfig.json` | 0 | clean |
| Worker type-check | `npx tsc -p <scratch worker tsconfig> --noEmit` (strict, `workers/image-scan/src/**`) | 0 | clean (toolchain: plain tsc; `wrangler` is not installed locally) |
| Edge functions | `deno check --node-modules-dir=none` on r2-presign, delete-account, r2-delete, r2-verify-images, account-deletion-drain, verification-document | 0 each | clean |
| `send-push-notification` | same | 1 | 3 type errors in an **unmodified** file (supabase-js generic typing under `--node-modules-dir=none`); pre-existing, unrelated to this release |
| Web production build | `cd web && npx next build` (after the Next upgrade) | 0 | compiled; pre-existing workspace-root warning only |
| Mobile release build | `npx expo export --platform android` | 0 | bundle exported (closest local release validation; no EAS/native build run) |
| Web lint | `cd web && npx next lint` | **0** | 0 errors, 14 warnings: 4 `<img>` in the new storefront pages (new), 10 `exhaustive-deps`/`<img>` in admin/search/support pages (pre-existing) |
| Mobile lint | `npx expo lint` | 2 | **Cause found: an empty, untracked `src/` directory (dated Jul 29) on this machine; `expo lint` passes it to ESLint ("No files matching … src").** Not a repository defect (git cannot track empty dirs); deleting the empty dir fixes it — I left it alone. Equivalent real lint: `npx eslint app components hooks lib store constants theme types data scripts tests` → exit 1, **130 errors / 52 warnings, identical totals at `HEAD`** (extracted `git archive HEAD`), so **no new lint findings**; the errors are overwhelmingly new React-Compiler `react-hooks/*` rules and Node-global `no-undef` in `scripts/` |
| Dependency audit (mobile) | `npm audit` | 1 | 42 (1 critical `shell-quote`, 28 high, 13 moderate). All transitive build/dev tooling (Expo CLI, Metro, braces/micromatch, firebase, node-forge, xmldom) except direct `expo`/`react-native`/firebase packages whose "fix" is a major (npm even proposes `expo@44`, a downgrade). **Not locally fixable without an Expo SDK change; not fixed, not hidden.** `npm audit --omit=dev` shows the same 42 |
| Dependency audit (web) | `cd web && npm audit` | 1 | before: 15 (1 critical `next`); **after Next 15.5.28: 14 (0 critical, 11 high, 3 moderate)**. Remaining are dev/build tooling (tailwind 3 → braces/micromatch/chokidar, eslint-config-next → glob chain, postcss) plus `next` moderate fixable only in Next 16 (major). Not applied |
| Secret scan | regex scan of 715 tracked+untracked files (private keys, AWS/Stripe/GitHub/Slack tokens, JWTs, long secret literals) | — | no secrets. Only hits: Firebase client API keys in `google-services.json` / `GoogleService-Info.plist` (public by design, restrict them by app in Google Cloud) and a PEM header regex string in `send-push-notification`. `.env`, `web/.env.local` are git-ignored; `*.example` files hold no values |
| Static analysis | tsc strict (above), eslint (above), targeted grep of every avatar/logo/banner/listing writer and every `RegExp(\`…\\.…\`)` template escape | — | one real defect found and fixed (§2); production-identifier check on wrangler added as a test |

## 7. Remaining gates (all external)
1. Staging Supabase project + two R2 buckets + Worker + Vision key — **do not exist** (runbook §1–§4).
2. Migration-history inspection of every target DB (§3 above, runbook §1.2) — **not done**.
3. Real upload/rejection/timeout/unavailable-scanner/cross-user/bypass/public-exposure tests (runbook §6.1) — **not run**.
4. Listing-photo regression incl. the `legacy_presign_closed` flag value (§6.2) — **not run**.
5. Real iPhone, Android and browsers (§6.3) — **not run**.
6. Rollback rehearsal on staging incl. re-apply (§8) — **not run**.
7. Owner decisions: 0054 B1–B3; P1/P2/B1 retention (private originals, rejected objects, deletion lifecycle); legacy avatar remediation; moderation staffing/counsel items; explicit authorisation to apply 0054–0059 and deploy.
8. Open engineering items: `0055` rollback script; `send-push-notification` deno typing; mobile dependency vulnerabilities (Expo SDK upgrade decision); web Next 16 / Tailwind 4 upgrades (majors).

## 8. Exact next action to begin staging
Create the staging Supabase project and the two staging R2 buckets (runbook §1.1, §2), then run the read-only SQL in `docs/MEDIA_STAGING_RUNBOOK.md` §1.2 against the staging project and save the output as evidence E-1.
