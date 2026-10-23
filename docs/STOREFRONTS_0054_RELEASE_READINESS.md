# Storefronts 0054/0055: release-readiness pass (2026-10-19)

**Status: local only. Nothing was applied, deployed, committed or pushed.** Every proposal below is a proposal; the approval record in `STOREFRONTS_0054_OWNER_DECISIONS.md` is still blank. Local results (npm test, PGlite) are not staging evidence.

**Verdict: Not ready.** Two security blockers remain (logo/banner media is unscanned; private-bucket R2 cleanup is undecided) and every staging gate is unrun (P1 unresolved, so S0 cannot start).

## 1. Baseline (verified against the code, not earlier summaries)

| Area | State |
|---|---|
| Implemented and locally tested | 0054 schema/RLS/RPCs (PGlite suite `storefronts`), 0055 ledger (PGlite `account_deletion`, 17 checks), `verification-document` handler (11 unit checks), owner/public/admin clients (type-checked + static/unit tests), flags off by default |
| Implemented, not tested anywhere real | The Edge Functions as deployed code, real Storage policies and limits, signed-URL expiry, concurrency cap, Security Advisor, Realtime behaviour, all client screens on a device/browser |
| Missing or incomplete | Logo/banner scanning (§A); staff storefront lookup (§B); private-bucket R2 cleanup and a durable R2 ledger (§C); web hours editor (deferred); mobile PDF picker (not planned); retention cleaner (B3, by design) |
| Blocked on owner approval | B1.1–B1.5, B2.1–B2.4, B3 (all of the approval record); the five first-launch proposals; existing-seller plan; the contracts in §A and §B |
| Blocked on staging prerequisites | P1 ref, P3 R2 bucket, P5 spend ceiling; P4 role mapping unverified |

## 2. Findings and what changed locally

### A. Business logo/banner safety — **blocker, not fixed (needs a contract change)**

Trace (mobile `app/business/storefront.tsx`, web `web/src/app/business/storefront/page.tsx`, `supabase/functions/r2-presign`):
client re-encodes to JPEG → `r2-presign` hands out a presigned PUT for `business/<uid>/(logo|banner)/<uuid>.jpg` **in the public bucket** → client PUTs → client saves `logo_url`/`logo_public_id` on `storefronts`. At no step is the image scanned, watermarked, or held. `r2-presign` only closes the public path for `listings/` (`listingPresignGate`); `business/` is explicitly never affected.

What already protects it (verified in 0054 and its PGlite suite): the database accepts a logo/banner only if the URL is https, its host is in `storefront_media_hosts` (**empty by default**, so nothing is accepted), and its path is exactly the owner's own `business/<uid>/<kind>/<uuid>.jpg`. Arbitrary URLs cannot be attached. The bytes, however, are public the moment the PUT succeeds, whether or not the row is ever saved, and the allow-list is a shape control, not a content scan. The only thing standing between an unscanned image and the public is therefore an empty allow-list plus the off flags.

Why I did not wire the scanner: the existing pipeline (`workers/image-scan`) is listing-shaped end to end: `/v1/scans` requires `listingId` and `categoryId`/`title` (category policy), it writes `listing_scans`/`listing_scan_images` keyed by listing, publishes to `wm/listings/<uid>/<listingId>/…` and stamps the marketplace watermark. It is also undeployed with enforcement off. Reusing it for logos would mean inventing a pseudo-listing id, a category policy and a result table, i.e. a new security contract. Not done.

**Smallest contract change to approve (proposal):**
1. Worker: add `POST /v1/business-media` (same JWT auth, same `checkImageBytes`/normalise/Vision/decide code), inputs `kind ∈ {logo, banner}` and one image. Pass → derivative written to public `business/<uid>/<kind>/<uuid>.jpg`; review/uncertain → private `pending/…`, nothing public; reject or any failure/timeout → nothing public, retryable error to the user. Whether logos get the marketplace watermark is a product decision (suggest: no).
2. `r2-presign`: stop issuing a public-bucket PUT for `business/…`; the client sends the image to the Worker instead (as listings do).
3. New table `storefront_media_scans(owner_id, kind, key, verdict, review_status, created_at)`, service-role write only; a new migration at the next free number (**not** an edit of 0054; 0056 is already taken by the separate, uncommitted `0056_profile_content_guard.sql`) makes `_sf_image_ok` also require a passing/approved row for that exact key, so a rejected or never-scanned key cannot be attached and a stale derivative is unreachable from the row.
4. Reject/replace deletes the old public object (the client already does best-effort; the Worker should do it authoritatively).
5. Tests: pass, review-held, reject, Vision timeout/error (fail closed), unauthenticated, other user's key, unscanned key refused by the DB, rejected key stays unpublished.
Interim rule: keep `storefront_media_hosts` empty in production. Inserting the host (needed for S6 on staging only) is what would let unscanned images become public. Separate in-progress work (uncommitted `web/src/services/profileMedia.ts`, `0056_profile_content_guard.sql`) adds a web logo/banner upload into the legacy `profiles.business_*` columns using the same unscanned presign path; it was not part of this pass and was left untouched, but it widens the same gap and its images flow into storefronts through the legacy-sync trigger. Existing sellers already use the legacy `app/settings/business-profile` upload path, which is equally unscanned today; that is pre-existing risk and part of the rollout decision (§F).

### B. Staff suspension without a verification request — **blocked on owner approval**

The action already exists: `admin_set_storefront_status(p_storefront uuid, 'suspend'|'reinstate', p_reason, p_message)` suspends **any** storefront by id (admin-only via `staff_can('business_review')`, reason ≥ 10 chars, audited, owner notified, `status_before_suspension` remembered, reinstate restores it, refuses double-suspend). What is missing is **discovery**: `admin_list_storefront_reviews` lists verification requests only, so staff cannot find the id of a storefront that never applied. (Staff can `select` `storefronts` under the existing RLS policy, but that is an unaudited, all-columns read and its use as the lookup was not approved, so the UI does not rely on it.)

**Proposed contract (not built):** `admin_find_storefront(p_owner uuid default null, p_name text default null, p_limit int default 20) returns jsonb`: `security definer`, `search_path` pinned, `staff_can('business_review')` first (admin only today), at least one filter required, `p_limit` capped at 50, returns only `id, owner_id, name, status, verification_status, published_at, suspended_at` (no documents, no addresses), writes one `_sf_audit` row (`find_storefront`, filter used, count) per call, `revoke` from public/anon. No new suspend semantics: suspend/reinstate stay as they are (effects: hidden from `public_storefronts`, `profiles.business_*` mirror cleared, owner cannot edit/publish/unpublish/request verification, owner notified; reinstate returns to the remembered status and never auto-publishes beyond it). Failure behaviour: 42501 not staff, 22023 no filter, empty result is `[]` (no existence oracle beyond what staff may see). Needs: owner approval, a PGlite test, then a small admin UI search box.

### C. Account deletion and storage cleanup

**Supabase verification-document ledger (0055) — audited, no defect found:**
- Paths are written (Storage listing UNION request rows, own-folder only, no traversal) before the Apple revoke, R2 delete, rate-limit delete or user delete; if `account_deletion_begin` fails the request returns 500 and nothing is touched.
- A failed `deleteUser` cancels the job (and `cancel` refuses if the user is already gone); one open job per user (partial unique index) so repeats converge; late uploads are re-collected after the user delete; a lease plus `SKIP LOCKED` prevents double processing; a crash between begin and mark is reconciled after 15 min.
- `finish` completes only when no object is left undeleted, otherwise backoff (2^n min, cap 6 h) and `escalated` after 5; `requeue` is operator-only. No grant to anon/authenticated; every function is revoked from them and granted to `service_role`.
- Residual risks (not fixed, documented): (1) completion trusts `Storage.remove()` not erroring; it does not re-list to confirm absence (B1.5 wants "confirmed absent"; S7 before/after listings covers it on staging). (2) A still-valid JWT could upload after the final re-collect; the file is then orphaned (the 0054 report `ownerAccountDeleted` counts these; a sweeper is B3-dependent). (3) Escalated jobs notify nobody (B1.3 open). (4) Audit rows for document views store the path (contains the uploader id) in `admin_audit_log.metadata` and survive deletion, which conflicts with the decisions-doc line "no document paths proposed" for the post-deletion audit trail; decide under B1.5/B2.4. (5) Job rows keep `user_id` indefinitely until B1.5/B3.

**R2 — gaps found and status:**

| R2 object category | Key shape | Removed on account deletion? |
|---|---|---|
| Avatar | `avatars/<uid>/<uuid>.jpg` | Yes (best effort, from `profiles.avatar_public_id`) |
| Legacy listing photos | `listings/<uid>[/<draft>]/<uuid>.jpg` | Yes (best effort) |
| Legacy chat photos | `chat/<conv>/<uid>/<uuid>.jpg` | Yes (best effort) |
| **Scanned listing photos (public)** | `wm/listings/<uid>/<listingId>/<uuid>.jpg` | **Was NOT** (validator rejected the shape, though `r2-delete` accepts it). **Fixed locally** in `_shared/accountKeys.ts`, also via the URL fallback |
| **Storefront logo/banner (public)** | `business/<uid>/(logo\|banner)/<uuid>.jpg` | **Was NOT for drafts/unpublished/suspended**: only the cleared `profiles.business_*` mirror was read. **Fixed locally**: `delete-account` now also reads `storefronts.logo_public_id/banner_public_id` before the cascade |
| Private originals | `orig/<uid>/<listingId>/<sha>.bin` (private bucket) | **No.** No code or credentials for the private bucket exist in `delete-account`. Not changed |
| Private held derivatives | `pending/wm/listings/<uid>/…` (private bucket) | **No.** Same |

Why the private bucket was not touched: the Worker keeps originals of prohibited/weapon rejects on purpose (`REJECTED_ORIGINAL_POLICY=retain`, `docs/IMAGE_SAFETY.md` §3), and whether account deletion may remove them is a legal-retention decision for the owner and counsel. Deleting them would pre-empt it. Minimal implementation once decided: select the user's `listing_scan_images.source_key/public_key` before the cascade (they cascade away with the user), validate shapes like `accountKeys`, and delete with a credential scoped to the private bucket (new secret, owner's call).

Even the fixed R2 deletes remain **best effort and unledgered**: failures are logged as counts and not retried. **R2 cleanup is not complete and the 0055 workflow does not clean R2.** Proven locally only by the static/unit tests added to `tests/accountKeys.test.ts` (3 new); no R2 call was made.

### D. Verification-document access — **no defect found**

Chain read end to end: web admin route (admin-only, `business_review` mirrored in `adminGate.ts`) → Edge Function → `admin_authorize_verification_document` under the **caller's** JWT (staff check; path must be `= any(document_paths)` of that exact request; audit insert inside the same function, so an audit failure aborts it) → only then a service-role `createSignedUrl(path, 120)`. Handler order is unit-tested (authorized, 403, 401, missing, audit failure, RPC throw, mismatched path, signing failure, bad input). Storage `select` policy is owner-only, so staff have no direct read. Expiry constant is 120 s and asserted. Limits: `createSignedUrl` may sign a path whose object is missing (the link would simply fail); expiry, the audit-failure path against the real RPC, and direct-read denial are staging gates S3/S9.

### E. Owner and public storefronts — **no defect found in code reading; unproven at runtime**

- Public pages and the seller link read only `public_storefronts` (grep: no other public read of `storefronts`; a test pins the selected columns to the view). View filters `status='published'` and excludes banned/suspended owners; unknown/malformed ids render the same "unavailable".
- Owner screens read/write only the owner-grantable columns; status, verification, `published_at` etc. change only through RPCs; the guard trigger rejects client writes to them and enforces the state machines for every writer. Publish refuses suspended storefronts and suspended/banned accounts.
- The legacy mirror copies only while published **and** the owner is in good standing and clears otherwise (PGlite-tested for draft, unpublish, suspend, ban, expiry, old-app writes).
- Block-aware listing visibility is untouched (`seller_listings()`); a blocked pair sees "unavailable".
- Flags: `EXPO_PUBLIC_STOREFRONTS_ENABLED` / `NEXT_PUBLIC_STOREFRONTS_ENABLED` appear in no `.env*`, `eas.json`, `app.json` or Next config (checked), so both default OFF; two tests assert it.

### Product proposals (unchanged, unapproved)
PDF on web / images-only on mobile: consistent with code (web picker and bucket accept PDF; mobile has no PDF picker). Hours: mobile only. Suspension without request: §B. Logo/banner scanning: §A. Existing sellers: §F.

### TypeScript
Root `tsc` failed with 668 errors, **all inside `web/`** (14 in `web/src/app/business/storefront/page.tsx`, the rest in other web files). Cause: the root `tsconfig.json` includes `**/*.tsx` and maps `@/*` to the repo root, while web maps `@/*` to `web/src`, so every web alias import failed to resolve. Not a type problem in the code: web's own `tsc -p web/tsconfig.json` passed before and after. A second 156 root errors were `tests/*.ts` (need Node types; they are compiled by `tsconfig.test.json` inside `npm test`). Fix: add `"web"` and `"tests"` to the root `exclude` (no app code changed). The mobile ESLint result is separate: the storefront files are clean; `app/seller/[id].tsx` has 2 pre-existing errors (also present at HEAD), left alone.

## 3. Local verification (all local; none touches Supabase/R2)

| Command | Result |
|---|---|
| `npm test` (before edits) | exit 0, 513 pass / 0 fail |
| `npm test` (after edits) | exit 0, 516 pass / 0 fail (+3 new in `tests/accountKeys.test.ts`) |
| `PGLITE_DIR=<pglite package dir> node supabase/tests/run-all.mjs` | exit 0, "ALL 17 DATABASE SUITES PASSED" (includes `storefronts`, `account_deletion`; PGlite is not Supabase) |
| Final rerun on the current tree (which by then also contained another session's profile-guard work) | `npm test` exit 0, 523 pass / 0 fail; `run-all.mjs` exit 0, "ALL 18 DATABASE SUITES PASSED"; root and web `tsc` both exit 0 |
| `npx tsc --noEmit -p tsconfig.json` (root) | before: exit 2, 668 errors (all `web/`); after exclude: exit 0 |
| `npx tsc --noEmit -p web/tsconfig.json` | exit 0 |
| `npx eslint` on the storefront and edited mobile files | storefront files: no errors; exit 1 only from the 2 pre-existing errors in `app/seller/[id].tsx` (verified present at HEAD) |

Tip: `run-all.mjs`'s header says `PGLITE_DIR` is the folder containing `node_modules`; `harness/db.mjs` actually imports `$PGLITE_DIR/dist/index.js`, so it must be the `@electric-sql/pglite` package folder itself.

## 4. Remaining blockers

| Blocker | Class |
|---|---|
| Logo/banner scanning contract (§A) | external integration/security proof + owner approval |
| Private-bucket R2 deletion / original retention (§C) | launch/rollout decision (counsel) |
| R2 deletion is best effort, unledgered | missing implementation (small) once B1 is approved |
| B1, B2, B3 approvals; first-launch proposals | owner approval |
| `admin_find_storefront` (§B) | owner approval, then implementation |
| P1, P3, P5; P4 mapping | staging prerequisite |
| S0–S9, S2b, S7b, B3 gate | staging prerequisite / external proof |
| Existing-seller notice and timing (§F) | launch/rollout decision |
| `account-deletion-drain` JWT verification setting, escalation recipient, scheduling | owner approval / deploy decision |

## F. Existing-seller rollout and rollback plan (proposal; nothing run)

**What happens to existing sellers if 0054 is applied:** the backfill creates a **draft** storefront for each profile with any business data and clears `profiles.business_*`, so deployed clients stop showing their business section until they publish. Images are not carried over (allow-list empty; Cloudinary URLs never validate). Originals sit in `storefront_legacy_snapshot`.

1. **Identify (read-only, run on staging copy first, then production only with the owner's go-ahead).** Count sellers with business data using the backfill predicate (any non-empty `business_name/description/address/website/logo_url/banner_url/*_public_id` or non-empty `business_hours`), split by: has name; has an R2-shaped logo/banner (`business/<uid>/…`) vs Cloudinary/other vs none; account status; number of active listings. Record the row counts as the expected S8 numbers.
2. **Images.** Do not assume legacy images pass validation or scanning. Keep `storefront_media_hosts` empty in production until §A ships. Then re-attach (`_sf_reattach_legacy_images()`) only after legacy logos/banners have been run through the scanner (a batch version of `/v1/business-media`); anything that fails or cannot be scanned stays detached and the seller re-uploads.
3. **Rehearse (S8)** on an anonymised copy: confirm created/cleared/snapshot counts, zero published, and review the consequences list in hardening doc §4.
4. **Notice.** Before applying: tell affected sellers (Somali/English/Amharic, in-app notification + email if available) that their business page moves to the new storefront, what they must do (open Business → Storefront, review, publish), and the date. The notice wording and timing are the owner's call; not drafted here.
5. **Flag sequencing.** (a) apply 0054/0055 and deploy functions to staging, run all gates; (b) production: migrations first with all flags off; (c) ship the client build with the flag code but **off**; (d) enable for a small allow-list/internal accounts only if the owner approves a mechanism (there is no per-user gate today; the flag is per build); (e) enable broadly only after the notice period. Never enable the flags before the migrations are applied (screens then show "not available yet").
6. **Publication.** Nothing auto-republishes. Existing sellers regain visibility only by publishing (or by an owner-approved bulk publish, which this plan does not assume). Newly created owners start as draft; unpublished or suspended storefronts stay hidden; suspended storefronts cannot be republished by the owner.
7. **Monitor** (first 72 h): count of published vs draft storefronts, `account_deletion_report()` (stuck/escalated), audit-log volume for document views, Edge Function error rates, owner support tickets about the missing business section, any `storefront_*` notification failures.
8. **Rollback criteria** (decide before applying): a data-integrity problem in the backfill counts; public exposure of draft data (S4/S5 failure in production); verification document readable outside the audited path; account-deletion jobs escalating faster than they complete; a client crash loop on the new screens. Disable the flags first (instant, no data change), then consider the DB rollback.
9. **Safe export and recovery.** Run `supabase/rollback/0054_rollback_restore.sql` only with the owner's go-ahead: it exports first, verifies the export against live rows, restores originals only for never-published owners, and never auto-republishes. Before the manual drop block, dump `storefront_rollback_export` and `storefront_rollback_report` with `pg_dump -t`, store the dump outside the database, and restore it into a scratch database to prove recoverability. Rollback does not restore publication unless the owner explicitly changes that policy.

## G. Shortest ordered next actions

**Owner:** (1) give the staging project **ref** (P1), the R2 staging bucket (P3) and confirm the US$0 ceiling (P5); (2) record the role→account mapping (P4); (3) approve or change B1/B2/B3 and the five proposals (including §A and §B contracts); (4) decide the original-retention question for private R2 objects with counsel; (5) run S0 yourself with the read-only SQL in the checklist and paste the output (no keys).
**Coding agent (after the above):** build the §A contract and tests; add the R2 deletion retry/ledger once B1 is approved; build `admin_find_storefront` if approved; run S1–S9 with the owner executing and supplying evidence; fill the sign-off table.
