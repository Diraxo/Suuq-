> **Update 2026-10-21 (0062/0063):** steps below that deploy the presign refusal, set `enforce = true` or rely on 'ON by default' are the *scanned path* and are not wired. For the shipped direct-upload policy add, after 0059: insert the host row, apply 0062 (needs the row), then 0063; and on rollback remove 0063 and 0062 before 0059. Staging proof for those two is in `MEDIA_STAGING_RUNBOOK.md` section 1.5 and 1.6.
>
> **Current facts (2026-10-21), authoritative text in `MEDIA_LAUNCH_POLICY.md`; nothing below was applied, deployed or committed.**
> - Shipped policy is **direct upload with scan enforcement explicitly OFF** (0057 seeds `business_media_config.enforce=false`; missing/NULL still reads ON). Avatars, logos and banners are **NOT scanned**: this is an accepted, time-limited risk, never a control. `r2-presign` does not refuse `avatars/` or `business/`, and neither client has a Worker path.
> - **0062** (local, unapplied): host pin for any CHANGED avatar/logo/banner that carries a key: the URL must be exactly `https://<host in storefront_media_hosts>/<key>`. **Apply order (hard):** insert the `R2_PUBLIC_URL` host into `storefront_media_hosts` first (0062 seeds none; empty list = every avatar/logo/banner save fails, fail closed), needs 0054 and 0056. Works in both enforcement modes.
> - **0063** (local, unapplied): refuses a NEW URL-only (no key) avatar/logo/banner on update; on first-login INSERT only an avatar on `lh3.googleusercontent.com` is tolerated. Unchanged legacy URLs keep passing. Needs 0038 and 0056 only (no host list). Cost: a hypothetical pre-R2 (Cloudinary-era) build could not CHANGE its photo; the repository holds **no evidence** of the deployed or minimum supported app version, so none is assumed. Owner decision still open.
> - **Apply order:** 0054 -> 0055 -> 0056 -> 0057 -> 0058 -> 0059 -> insert host row -> 0062 -> 0063. **Rollback strictly reverse** (0063, 0062, 0059, 0058, 0057, 0056); the 0062 and 0063 rollbacks drop only their own trigger/functions and change no data; the 0056/0057/0059 rollbacks install the media freeze.
> - **Still open:** unscanned bytes in our own bucket (no content check), a Google photo kept on first-login INSERT while OFF, existing rows never rewritten (no backfill), owner decisions P1/P2/B1 and the URL-only decision, no staging run.

> **Superseded in part, 2026-10-21:** the shipped policy is direct upload with enforcement explicitly OFF (`MEDIA_LAUNCH_POLICY.md`). The fail-closed text below (r2-presign refusing `avatars/` / `business/`, `enforce` must read true, clients Worker-only) describes the **scanned path**, which is not wired into the code today; use it for that rehearsal only. A missing/NULL `enforce` still reads as ON; the seeded row is `false`.

> **Policy update 2026-10-19:** fail closed. r2-presign refuses avatars/ and business/ unconditionally and enforcement defaults ON; where this file says enforcement ships OFF or step 9 flips it, read `MEDIA_LAUNCH_POLICY.md`.

# Business media: rollout sequence, rollback and staging checklist

Written 2026-10-19. **Nothing here has been run against real Cloudflare, R2, Vision or Supabase.** Local evidence is unit tests with fakes and PGlite (in-memory Postgres compiled to WASM), which is *not* Supabase. Every gate below is therefore `BLOCKED` until someone with staging credentials runs it and attaches the evidence.

Use disposable accounts and generated test images only. Never use a real user's photos. Redact tokens, keys, user ids and private URLs in anything you save.

## 1. Rollout sequence (reviewed against the code, and changed)

The earlier plan said "1. Apply 0057". That is not possible on its own, and two other gaps showed up in review.

| # | Step | Why this position | Gate |
|---|---|---|---|
| 0 | Staging first, always: a separate Supabase project, separate R2 buckets, separate Worker. Never point a staging command at production | `scripts/business-media-backfill.js` enforces this with a mandatory `--expect-host` | none |
| 1 | **Migration 0054 must already be applied.** 0057 creates triggers on `storefronts` and reads `storefront_media_hosts`; on a database without 0054 it fails with `relation "public.storefronts" does not exist` (verified on PGlite). 0054 is on hold until owner decisions B1–B3 are recorded | Hard dependency. **This is the main reason business-media security cannot ship until the 0054 blockers are closed** (or 0057 is split so the profile half stands alone, which is a decision for the owner) | B1–B3 |
| 2 | **Fill `storefront_media_hosts` with the real public R2 host** (gate S6) | 0057 now pins every client-written profile logo/banner URL to `https://<managed host>/<key>`. With an empty allow-list the check fails closed and **every logo/banner save is refused once enforcement is on** | S6 |
| 3 | Apply 0057 (**enforcement is ON by default since 2026-10-19 — see MEDIA_LAUNCH_POLICY.md; new logo/banner saves are refused until steps 2, 4, 5 are done**) | Safe to apply early; it only adds a table, a flag and triggers that do nothing while the flag is false | staging apply + tests |
| 4 | Deploy the Worker with `/v1/business-media` and the Vision key; set `PUBLIC_BASE_URL`, `ALLOWED_ORIGINS`; **leave `BACKFILL_SECRET` unset** | Nothing calls it yet | §3 gates A–F |
| 5 | Ship mobile and web builds with `EXPO_PUBLIC_IMAGE_SCAN_URL` / `NEXT_PUBLIC_IMAGE_SCAN_URL` set. **Wait until the new mobile build is live in both stores and adoption is acceptable** | Step 6 breaks logo/banner upload for any client that still talks to `r2-presign`. Store review can take days, so this is a calendar dependency, not a deploy order detail | build live |
| 6 | Deploy `r2-presign` with the business refusal (now case-insensitive) | Must come after 4 and 5 or uploads break for everyone. Old app versions get a clear "update the app" message and **fail closed**; they never publish | §3 gate G |
| 7 | Apply 0058 (backfill bookkeeping; inert until the script runs) | Needs 0057 | tests |
| 8 | Backfill on staging: `--inventory`, then `--scan --limit 5`, review, then `--apply --confirm-apply`. Production only with explicit written authorization | The Worker route exists only while `BACKFILL_SECRET` is set; set it for the run and remove it afterwards | §3 gates H–J |
| 9 | Set `business_media_config.enforce = true` | Last, after 4–8 are verified. Legacy values stay editable (grandfathered); only NEW client-written keys/URLs need an approved scan | §3 gate K |
| 10 | Deletion lifecycle and monitoring | **Not built.** Waits for P1/P2/B1 approval (`BUSINESS_MEDIA_DECISION_REQUEST.md`) | owner |

**Important limit of the backfill:** applying it changes what the app *displays*. The old unscanned object is **not deleted** and stays publicly reachable at its old URL until the deletion lifecycle exists. Do not describe the platform as free of unscanned business images until step 10 has run.

## 2. Rollback

| Step undone | How | What it does not undo |
|---|---|---|
| Enforcement | `update public.business_media_config set enforce = false;` (instant, no deploy) | Nothing; this is the preferred first response |
| `r2-presign` refusal | Redeploy the previous function. **Last resort**: it re-opens the unsafe direct-PUT path | |
| Worker | Redeploy the previous Worker. New clients then show "could not check" and publish nothing | Objects already published stay |
| 0058 | `supabase/rollback/0058_business_media_backfill_ROLLBACK.sql`. **Export first:** `select source, owner_id, kind, original_url, original_key, new_url, new_key from public.business_media_backfill where status='applied';` | Slots already swapped to a scanned copy stay swapped; that export is the only record of which legacy object each slot used to use |
| 0057 | `supabase/rollback/0057_business_media_scans_ROLLBACK.sql`, **after** 0059's and 0058's. The database refuses the other order (tested). **Since 2026-10-19 it installs a media freeze instead of dropping to the 0056 rules** (new avatar/logo/banner values are refused for clients until 0057+0059 are re-applied); see `MEDIA_LAUNCH_POLICY.md` | Private originals in R2; published objects; profile and storefront images (all untouched) |

Rollback of both was exercised on PGlite with representative rows (`supabase/tests/business_media.test.mjs`, `business_media_backfill.test.mjs`, and the rollback-security suite `media_rollback.test.mjs`). The full staging procedure is `MEDIA_STAGING_RUNBOOK.md`. That proves the SQL, not Supabase.

## 3. Staging gates

Record for each: date, environment (project ref, Worker name, bucket names), exact command, raw output, expected vs actual. `PASSED` needs evidence; otherwise leave `BLOCKED`.

| Gate | What to do | Pass when | Status |
|---|---|---|---|
| A. Happy path | With a test account upload a clean test logo and a clean banner from the mobile app and from the web | Worker answers `approved`; the profile/storefront saves; the public URL serves a JPEG ≤1600 px | BLOCKED |
| B. Public object is the normalised copy | Download the public object; run `exiftool` on it; compare hash with the uploaded file | No EXIF/GPS/XMP/IPTC; orientation upright; **hash differs from the upload** | BLOCKED |
| C. Original stays private | Request `orig-media/…` through the public host and through the R2 S3 endpoint without credentials | 403/404 both; the object exists in the private bucket via the Worker binding | BLOCKED |
| D. Rejected, held, outage never public | Upload a test image that Vision rejects; one that is held (use a logo whose text is `Marketplace`); break the Vision key; set an impossible timeout | Each answers rejected/held/503; **no object appears under `business/` for that attempt**; scan row status matches | BLOCKED |
| E. Storage failure | Revoke the public-bucket binding for one request | 503/500; scan row not `approved`; nothing public | BLOCKED |
| F. Limits | Upload an SVG, an HTML file renamed `.jpg`, a 7 MiB file, a malformed multipart, no token, a token for another user; then 25 uploads in an hour; then 30 in parallel | 422/413/400/401; hourly limit trips at 20; the parallel burst never exceeds 20 Vision calls (check the Vision usage dashboard) | BLOCKED |
| G. Presign bypass | Call `r2-presign` with `business/<uid>/logo`, `Business/<uid>/logo`, `BUSINESS/<uid>/banner`, `Listings/<uid>` | 426 `media_scan_required` (or `update_required` for listings); no URL issued; no R2 credential read | BLOCKED |
| H. Backfill dry run | `node scripts/business-media-backfill.js --expect-host <staging host>` then `--inventory` | Counts match a manual `select` of unscanned slots; no profile/storefront changed | BLOCKED |
| I. Backfill scan | Seed staging with: a clean legacy logo, a flagged one, a missing object, a corrupt file, a renamed-HTML file; set `BACKFILL_SECRET`; run `--scan --limit 10` | outcomes `approved`, `rejected`, `missing`, `unreadable`, `unreadable`; wrong secret → 401; unset secret → 404; interrupt the run mid-way and re-run: leased rows resume after the lease expires | BLOCKED |
| J. Backfill apply | `--apply --confirm-apply` | Only the approved slot changes; the others are untouched; the old object still exists (confirm in R2) | BLOCKED |
| K. Enforcement | With `storefront_media_hosts` filled: set `enforce = true`; from a test account via PostgREST (a real JWT) save an unscanned key, an approved key, an approved key with `https://evil.example/…`, a Cloudinary URL-only value, and re-save a legacy value | refused, accepted, refused, refused, accepted | BLOCKED |
| L. CORS | Upload from the real web origin and from a non-allowed origin | allowed origin works; other origin has no `access-control-allow-origin` | BLOCKED |
| M. Slow network | Upload a 5 MiB image on throttled 3G from the mobile app | completes inside the 90 s client timeout, or fails with the "check your connection" message and publishes nothing | BLOCKED |
| N. Account deletion | Delete a test account that has a logo, a banner and a storefront | public derivatives are removed best-effort (existing behaviour); **private originals remain (known, awaiting P2)**; scan/backfill rows are removed | BLOCKED |
| O. Real-Postgres migration | Apply 0054–0058 to a fresh Supabase project and to a copy of staging data; run `supabase/tests/*.mjs` assertions manually or via `supabase db` equivalents | no error; the key behaviours match the PGlite suites | BLOCKED |
| P. Deletion lifecycle, retention, legal hold | not built | n/a | BLOCKED (owner decision) |

## 4. Local commands (what was actually run)

```
npm test                                                         # compiles with tsc, runs node:test
npx tsc --noEmit -p tsconfig.json                                # mobile/root type-check
(cd web && npx tsc --noEmit && npx next lint && npx next build)  # web
npx tsc --ignoreConfig --noEmit --skipLibCheck --strict --target ES2022 --module esnext --moduleResolution bundler --types node workers/image-scan/src/index.ts
PGLITE_DIR=<scratch>/node_modules/@electric-sql/pglite node supabase/tests/run-all.mjs
```
