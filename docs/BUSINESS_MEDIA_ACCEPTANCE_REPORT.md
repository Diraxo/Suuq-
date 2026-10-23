> **HISTORICAL RECORD (2026-10-19) - conclusion unchanged: NOT PASSED.** Its criteria describe the fail-closed scanned path (presign refusal, `enforce` ON, Worker-only clients). That path is NOT what ships since the 2026-10-21 owner decision (direct upload, OFF); where it says 'fail closed across all identified clients and server paths' read it as *locally proven for the scanned path only*. Finding 2 below (URL-only Cloudinary/Google/picsum logo/banner) is addressed in code by **0063** and the any-host-with-own-key gap by **0062**, both local and unapplied. Its rollout order ('0054 -> 0057 -> 0058') omits 0059, 0062 and 0063 and the host-row prerequisite; use the order below.
>
> **Current facts (2026-10-21), authoritative text in `MEDIA_LAUNCH_POLICY.md`; nothing below was applied, deployed or committed.**
> - Shipped policy is **direct upload with scan enforcement explicitly OFF** (0057 seeds `business_media_config.enforce=false`; missing/NULL still reads ON). Avatars, logos and banners are **NOT scanned**: this is an accepted, time-limited risk, never a control. `r2-presign` does not refuse `avatars/` or `business/`, and neither client has a Worker path.
> - **0062** (local, unapplied): host pin for any CHANGED avatar/logo/banner that carries a key: the URL must be exactly `https://<host in storefront_media_hosts>/<key>`. **Apply order (hard):** insert the `R2_PUBLIC_URL` host into `storefront_media_hosts` first (0062 seeds none; empty list = every avatar/logo/banner save fails, fail closed), needs 0054 and 0056. Works in both enforcement modes.
> - **0063** (local, unapplied): refuses a NEW URL-only (no key) avatar/logo/banner on update; on first-login INSERT only an avatar on `lh3.googleusercontent.com` is tolerated. Unchanged legacy URLs keep passing. Needs 0038 and 0056 only (no host list). Cost: a hypothetical pre-R2 (Cloudinary-era) build could not CHANGE its photo; the repository holds **no evidence** of the deployed or minimum supported app version, so none is assumed. Owner decision still open.
> - **Apply order:** 0054 -> 0055 -> 0056 -> 0057 -> 0058 -> 0059 -> insert host row -> 0062 -> 0063. **Rollback strictly reverse** (0063, 0062, 0059, 0058, 0057, 0056); the 0062 and 0063 rollbacks drop only their own trigger/functions and change no data; the 0056/0057/0059 rollbacks install the media freeze.
> - **Still open:** unscanned bytes in our own bucket (no content check), a Google photo kept on first-login INSERT while OFF, existing rows never rewritten (no backfill), owner decisions P1/P2/B1 and the URL-only decision, no staging run.

# BUSINESS MEDIA SECURITY — FINAL ACCEPTANCE REPORT

Date: 2026-10-19. Branch `ios-app-store-readiness`. **Nothing is committed, applied or deployed.** Every result below is local.

## Overall status: `NOT PASSED`

Two things stop it, and neither can be closed by more code:

1. **Owner decisions P1, P2 and B1 are blank.** The R2 deletion lifecycle is therefore deliberately unbuilt (`BUSINESS_MEDIA_DECISION_REQUEST.md`).
2. **No staging access.** No real Cloudflare, R2, Vision or Supabase environment or credential was available, so every real-service criterion is `BLOCKED`, not passed (`BUSINESS_MEDIA_STAGING_CHECKLIST.md`).

A third, new finding limits rollout: **migration 0057 hard-depends on 0054**, which is on hold for owner decisions B1–B3. The earlier plan ("apply 0057 first") was wrong; it fails with `relation "public.storefronts" does not exist`.

## Second pass (2026-10-19): independent re-verification

Re-run by a fresh session against the current working tree (99 changed/untracked paths, nothing committed): `npm test` **573/573**, `supabase/tests/run-all.mjs` on PGlite **20/20**, `tsc` root, web and Worker **clean**. These confirm the numbers above; they are still local and PGlite evidence only. `next build`, lint and native build were not re-run in this pass.

Verified by reading the SQL: 0057 creates a trigger on `public.storefronts` and reads `storefront_media_hosts`, so it cannot apply before 0054; 0058 depends on 0057. Rollout order in `BUSINESS_MEDIA_STAGING_CHECKLIST.md` stands: 0054 → fill hosts → 0057 → Worker → clients live → presign refusal → 0058 → backfill (staging) → enforce.

New this pass: the exact decision index with safe defaults and the counsel questions (`BUSINESS_MEDIA_DECISION_REQUEST.md`, "Decision index"), and the avatar audit and mitigation options (`BUSINESS_MEDIA_AVATAR_MITIGATION.md`). The avatar gap was re-confirmed in code and is **still open**.

Not done, and why: the R2 deletion lifecycle (P1/P2/B1 blank, no periods may be invented); held-logo review queue (decision H); avatar fix (scope decision AV); all real-service gates (no staging). Status stays **NOT PASSED**.

## Evidence classes (kept separate on purpose)

| Class | What it proves | Used here |
|---|---|---|
| Local unit tests (fake storage, imaging, Vision, database) | Control flow: what is published, what stays private, that every failure publishes nothing | 573 tests |
| PGlite (in-memory Postgres compiled to WASM) | SQL logic on a real engine. **Not Supabase**: no PostgREST, Auth, Storage, RLS-over-HTTP | 20 suites |
| Real staging (Cloudflare, R2, Vision, Supabase) | Everything else | **none run** |
| Production | n/a | **no production action was taken** |

## Findings from this pass (all fixed locally, each with a test that failed first)

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | **High** | 0057 checked the scan only against the *key*. 0056 only requires the URL to *end with* the key, not to be on our host. After one legitimate approval a client could save `https://evil.example/<approved key>` and publish attacker-controlled content as a business logo | 0057 now pins the URL to `https://<managed host>/<key>` (the 0054 allow-list) for client writes |
| 2 | **High** | 0056 accepts a *URL-only* logo/banner (no key) from `res.cloudinary.com`, `lh3.googleusercontent.com`, `picsum.photos`. Anyone can host an image on the first two, so an unscanned image could be published without touching the scanner | New URL-only values from clients are refused while enforced; an unchanged legacy value is grandfathered |
| 3 | **High** | `r2-presign` matched allowed folders case-insensitively but its scan gates case-sensitively. `BUSINESS/<uid>/logo` and `Listings/<uid>` got a presigned PUT into the public bucket | Both gates are case-insensitive |
| 4 | Medium | The hourly limit was check-then-insert: N parallel requests all passed the check and each bought a Vision call | Re-checked after our own row exists; a burst never exceeds the allowance (fails safe: a burst larger than the limit loses entirely) |
| 5 | Medium | Rollback order: 0058 references 0057's table, so 0057 cannot be rolled back first | Enforced by the database, tested, documented in both scripts |
| 6 | Info | A legitimate logo containing `marketplace`, `amazon`, `jiji`, `fursad` is held and, with no staff queue, cannot be published | **Not changed** (no authorization to weaken a safety rule). Pinned by a test; owner decision H |

Unrelated to business media but the same flaw, **not fixed (out of scope)**: avatars. `profiles.avatar_*` has the same unpinned-host guard (0056) and the same direct presign (`avatars/{uid}`) into the public bucket, so **avatar uploads are unscanned and an avatar URL can point at any host**. Do not describe platform-wide user-media security as complete.

## Scope completed

| Area | Status | Evidence |
|---|---|---|
| A. Retention approval workflow | **Prepared, not approved.** Decision request written; no period invented | `BUSINESS_MEDIA_DECISION_REQUEST.md` |
| B. R2 deletion lifecycle | **Not built (blocked by P1/P2/B1).** Design, executor, reconciliation, hold and status model are specified in the decision request | n/a |
| C. Upload-path audit | Done (below) | tests + searches |
| D. Migration/enforcement safety | Done on PGlite; real Supabase `BLOCKED` | `business_media.test.mjs` 23 assertions |
| E. Backfill | Built and tested locally (0058, Worker route, operator script). **No backfill has run anywhere.** Rejected/held/missing legacy images are report-only; deleting old objects is not part of it | `business_media_backfill.test.mjs` 27 assertions, 7 script tests, 6 Worker-step tests |
| F. Localization | English, Somali, Amharic for the 8 messages on mobile. Somali/Amharic are first-pass and need a native reviewer. **The web app has no i18n, so web shows English** | `tests/businessMediaScan.test.ts` (parity, no leaked internals) |
| G. Deployment/rollback | Sequence reviewed and corrected; rollback documented and tested on PGlite | `BUSINESS_MEDIA_STAGING_CHECKLIST.md` |

### Upload-path audit

| Path | Result |
|---|---|
| Mobile business-profile, mobile storefront, web business-profile (`profileMedia.ts`), web storefront | All call `uploadToR2`, which diverts `business/{uid}/(logo\|banner)` to the Worker; no presign. Test fails if any other client file calls `r2-presign` |
| `r2-presign` (direct) | Refuses every `business…` folder in any letter case with 426, before any R2 credential is read |
| Other writers to the public bucket | Only the Worker (`PUBLIC` binding: `wm/…` and `business/…`), `r2-presign` (listings/avatars only now) and `r2-delete` (deletes only). `scripts/cleanup-r2-images.mjs` is delete-only and operator-run |
| Database references | Triggers on `profiles` and `storefronts` (client writes only, once enforced) require an approved scan for the key **and** a managed-host URL |
| Supabase Storage uploads | Only `storefront-verification` (private bucket, identity documents). Different control, not publicly served, not part of this scope |
| Avatars | **Unprotected, out of scope, documented above** |
| Residual | Non-client writers (the 0054 mirror RPCs, backfill, operator SQL) are intentionally unchecked, so the database cannot prove a *service-role* writer never writes an unscanned key. That is why the operator script is dry-run by default and `--apply` needs `--confirm-apply` |

## Files changed in this pass

Modified: `supabase/migrations/0057_business_media_scans.sql`, `supabase/rollback/0057_business_media_scans_ROLLBACK.sql`, `supabase/tests/business_media.test.mjs`, `supabase/tests/run-all.mjs`, `supabase/functions/_shared/scanPolicy.ts`, `workers/image-scan/src/{businessMedia,cloudflare,index}.ts`, `workers/image-scan/wrangler.toml` (comment), `lib/businessMedia.ts` + byte-identical `web/src/lib/businessMedia.ts`, `lib/r2.ts`, `web/src/services/r2.ts`, `hooks/useImageUpload.ts`, `locales/{en,so,am}/translation.json`, `tests/businessMediaScan.test.ts`.
New: `supabase/migrations/0058_business_media_backfill.sql`, `supabase/rollback/0058_business_media_backfill_ROLLBACK.sql`, `supabase/tests/business_media_backfill.test.mjs`, `scripts/business-media-backfill.js`, `tests/businessMediaBackfillScript.test.ts`, three docs under `docs/BUSINESS_MEDIA_*`.
Many other files in `git status` were already modified before this pass (earlier phases); this pass did not touch them. No secrets in the new or changed files (pattern scan run).

## Quality gates (run at the end, all after the last edit)

| Gate | Result |
|---|---|
| `npm test` | **573 pass, 0 fail** (was 550 at the start; +23) |
| Database suites (`supabase/tests/run-all.mjs`, PGlite) | **20 of 20 pass** (was 19; adds `business_media_backfill`) |
| `tsc --noEmit` mobile/root | clean |
| `tsc --noEmit` web | clean |
| Worker type-check (no tsconfig exists; ad-hoc strict `tsc`) | clean |
| ESLint, files changed this pass | clean. **`npm run lint` (`expo lint`) is broken independent of this work** ("No files matching … /src"), so repo-wide mobile lint was not run |
| `next lint` | no errors; warnings only, in files not touched here |
| `next build` (web) | succeeds |
| Mobile native/production build (EAS) | **not run** |
| Browser / device verification | **not run** |

## Criteria checklist

| Criterion | Status |
|---|---|
| All approved implementation tasks complete | **No**: lifecycle (B) unbuilt, awaiting approval |
| Logo/banner uploads fail closed across all identified clients and server paths | Yes locally (4 callers + presign + DB + Worker); **not verified on real services** |
| No unapproved image can be published through an alternative path | Locally yes for business media after findings 1–3; avatars excluded; service-role writers unchecked by design |
| Migration and enforcement verified at the appropriate database level | **No**: PGlite only; real Supabase `BLOCKED` |
| Existing media handled under approved policy | **No**: no policy approved for rejected/held; no backfill run |
| Deletion, retries, reconciliation, status reporting implemented and verified | **No** |
| P1 and P2 explicitly approved and enforced | **No**: blank |
| Required localization complete | Mobile yes (needs native review); web English only |
| Automated tests, type checks, lint, builds pass | Yes, with the lint and native-build exceptions above |
| Regression tests pass | Yes (573 + 20 suites) |
| Real staging verification (Cloudflare, R2, Vision, Supabase) | **BLOCKED**: no environment or credentials |
| Deployment and rollback documented and validated | Documented; rollback validated on PGlite only |
| No critical/high issue open | **No**: three high findings are fixed locally but unproven on real services; avatar gap remains open (out of scope) |
| No accidental secrets / unrelated destructive changes | Yes |
| Evidence supports every PASS | Yes, because nothing real-service is claimed |

## Remaining risks and blockers

1. Owner: answer P1, P2, B1 and items W, H, L, T (`BUSINESS_MEDIA_DECISION_REQUEST.md`). Counsel for P1.3, P2.3, P2.5, P2.4.
2. Owner/infra: a staging Supabase project, R2 buckets, Worker and a Vision key, then run `BUSINESS_MEDIA_STAGING_CHECKLIST.md` §3 and attach evidence.
3. Rollout depends on 0054 (hold B1–B3) and on filling `storefront_media_hosts` before enforcement.
4. The backfill leaves old unscanned objects public until a deletion lifecycle exists.
5. Vision has never been called on a real logo (`IMAGE_SAFETY.md`). Text-heavy logos may be held (decision H).
6. Avatars: same gap, separate decision.

---

## Addendum 2026-10-19 — Business Profile save + "update the app" fix

**Overall status: NOT PASSED (not 100%).** Two user-facing defects fixed in code and unit-tested; the upload path still cannot work end to end until the owner deploys the Worker and sets the scan URL.

### Cause 1 — false "update the app" message
`lib/r2.ts` / `web/src/services/r2.ts` throw `BusinessMediaError('notConfigured')` when `EXPO_PUBLIC_IMAGE_SCAN_URL` / `NEXT_PUBLIC_IMAGE_SCAN_URL` is empty. Neither variable is set in `.env`, `web/.env.local` or `eas.json`, and `workers/image-scan/wrangler.toml` states the Worker is NOT DEPLOYED. So the message was a missing-configuration state mislabelled as an outdated app. Now reads "The image service is temporarily unavailable. Your current image has been kept." (en/so/am). It still fails closed: nothing unscanned is published.

### Cause 2 — false "saved"
Every `supabase.from('profiles').update(...).eq('id', …)` checked only `error`. Under RLS a refused or missing-row update returns `error: null` with zero rows, so the UI said saved. Fix: new `lib/saveOutcome.ts` (web copy byte-identical, parity-tested) + `.select('id')` on the write; zero rows is a failure. Applied to: mobile business-profile (save, logo/banner set, remove), web business-profile, web edit-profile, web `profileMedia` (avatar/logo/banner set + remove), mobile `useAvatarActions`. Handlers now have try/catch/finally, a duplicate-submit guard, keep form state on failure, and show offline / session-expired / no-permission / service-problem messages (en/so/am on mobile; English on web, matching existing web convention). Storefront screens already used `.select().single()`.

### Evidence (this session)
| Check | Result |
|---|---|
| Unit tests | 578 pass, 0 fail (573 + 5 new in `tests/saveOutcome.test.ts`) |
| DB suites (PGlite, not real Supabase) | 20/20 pass |
| tsc mobile / web / Worker | clean / clean / clean |
| `next build` (web) | succeeds |
| eslint on changed mobile files | clean |
| Real browser, device/emulator, staging Cloudflare/R2/Vision/Supabase | NOT RUN — no deployed Worker, no staging; no PASS claimed |

### Not done (BLOCKED) and exact next action
- **Logo/banner end to end**: owner must deploy the Worker (`docs/BUSINESS_MEDIA_STAGING_CHECKLIST.md`, needs Cloudflare login + secrets), then set `NEXT_PUBLIC_IMAGE_SCAN_URL` (web host env) and `EXPO_PUBLIC_IMAGE_SCAN_URL` as an EAS env variable, then ship a new mobile build. Variable names added to `.env.example` / `web/.env.local.example`.
- **Avatar**: still a direct presign PUT to the public bucket, unscanned (unchanged, documented in `BUSINESS_MEDIA_AVATAR_MITIGATION.md`). Not reproduced as "broken" — no live environment here. Owner must choose Option 1 (full fix) or 2 (interim host pin). Platform-wide media security is NOT complete.
- **Migrations / presign**: order unchanged — 0054 (blocked on B1–B3) → 0057 → 0058; do not deploy the `r2-presign` business refusal before compatible clients are live. Nothing was applied or deployed.
- **P1/P2/B1–B3/held-media, R2 deletion, real backfill**: still need the owner/counsel decisions in `BUSINESS_MEDIA_DECISION_REQUEST.md`; untouched.
- Not committed or pushed. Changes sit in the working tree.
