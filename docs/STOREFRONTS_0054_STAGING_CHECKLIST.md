# Storefronts 0054/0055: isolated staging checklist (S0–S9, S2b, S7b)

Written 2026-10-18, restructured 2026-10-19. **Status: checklist only. Nothing has been run, applied or deployed.** Gate definitions come from `STOREFRONTS_0054_HARDENING.md` §5 and the staging-gates table in `STOREFRONTS_0054_OWNER_DECISIONS.md`. Local PGlite, mock and static tests are **not** staging evidence.

## Rules

1. **Staging only, never production.** A project is staging only when the owner has confirmed its exact ref (not its name). The configured app/production ref is `waksddinkjbrggxkfofk` (from the local `.env`); the staging ref **must differ** from it. Before every command that connects to a project, re-read the ref in the URL/CLI link and compare.
2. **Wrangler/R2:** staging bucket and token only. The existing wrangler config has a production-bucket risk (`staging-docs-phase`); use a staging config with placeholder names until P3 is answered.
3. Production flags stay off: `EXPO_PUBLIC_STOREFRONTS_ENABLED` and `NEXT_PUBLIC_STOREFRONTS_ENABLED` are unset in every checked-in env/config file (verified 2026-10-19). Only staging builds set them `true`. Flags hide UI; they are not a security control.
4. Secrets (service-role key, JWTs, `DRAIN_SECRET`) are held and used locally by the owner (P2). They never go in chat, reports, evidence files or commits. Redact tokens from captured output.
5. Capture raw output, expected vs actual, and failures for every gate. A failure is recorded, not retried until it passes.
6. A gate result is valid only if the relevant owner answers (B1–B3) are recorded; otherwise staging proves the wrong thing.
7. Mutating gates create disposable data on staging only. Use clearly named test accounts (`sf-test-*`) and record what to delete afterwards.

## Confirm before anything runs (owner)

| # | Item | Answer |
|---|---|---|
| P1 | Staging Supabase project exists? Exact **ref** (not name, no keys) | **OPEN.** Ref not yet provided. **S0 cannot start.** |
| P2 | Who holds its service-role key and runs the commands? | Project lead, locally (answered 2026-10-19). Key never goes in chat |
| P3 | Staging R2 bucket + token (S6 only)? | **OPEN.** Bucket name not yet provided; must differ from production |
| P4 | Test accounts: owner ×2, moderator, support, admin, banned owner | Stated as existing (2026-10-19); **not verified**, role-to-account mapping not recorded. Record as `role → user id` (ids only) before S2/S3/S5 |
| P5 | Spend ceiling for staging (if any paid service is enabled) | **OPEN.** Earlier US$0 proposal stands until confirmed. Anything that bills (Vision, Worker, extra Supabase compute) is out until answered |

## Gates

Legend: **RO** = read-only, **MUT** = mutates staging. "Blocks" = what stays blocked if the gate fails or is not run.

### S0 — Migration history (RO)
- **Prerequisites:** P1 confirmed by the owner, P2.
- **Action:** in the **staging** project's dashboard SQL editor (confirm the browser URL is `…/project/<staging-ref>`), run exactly:
  `select version, name from supabase_migrations.schema_migrations order by version;`
  Then diff against `ls supabase/migrations/`. (CLI alternative: `supabase migration list --linked` after the owner links to the staging ref; linking only writes local `.supabase/`.)
- **Proves:** which migrations staging has. It does **not** prove schema correctness, RLS or data shape.
- **Expected:** history known; anything from 0038–0053 that is missing is listed (rehearse `supabase/APPLY_0043_to_0053.sql` on staging only; do not rely on old notes).
- **Evidence:** the raw result set and the diff, with the ref visible in the screenshot/URL.
- **Cleanup:** none.
- **Blocks:** every later gate.

### S1 — Bucket columns, then apply 0054/0055 (RO check, then MUT)
- **Prerequisites:** S0.
- **Action:** `select column_name from information_schema.columns where table_schema='storage' and table_name='buckets' and column_name in ('file_size_limit','allowed_mime_types');` (RO). Then apply 0054, then 0055, on staging only.
- **Expected:** both columns exist; neither migration aborts; `select id, public, file_size_limit, allowed_mime_types from storage.buckets where id='storefront-verification'` → private, 10485760, the four MIME types.
- **Evidence:** column query output, migration output, bucket row.
- **Cleanup:** rollback per `supabase/rollback/0054_rollback_restore.sql` only if the owner asks; do not run it by default.
- **Blocks:** S2–S9.

### S2 — Storage refusals (MUT)
- **Prerequisites:** S1, P4 (owner account).
- **Action:** as an owner account via the real Storage API, upload to `storefront-verification/<uid>/…`: an 11 MiB file, a `.html`, a `.svg`, a renamed `.exe`, then an 11th unattached file; then try to update and delete an uploaded object.
- **Expected:** each refused by Storage (size / MIME / policy); the 11th refused; update/delete refused; a valid small JPEG/PDF accepted.
- **Evidence:** HTTP status and body per attempt.
- **Cleanup:** remove the uploaded test objects with the service role (staging).
- **Blocks:** launch of verification uploads.

### S2b — Upload concurrency (MUT)
- **Prerequisites:** S2.
- **Action:** with a user holding 9 unattached files, fire 20 parallel uploads.
- **Expected:** at most one succeeds (advisory lock in `verification_upload_slots_used`).
- **Evidence:** per-request status list and final object count (≤ 10).
- **Cleanup:** delete the test objects.
- **Blocks:** reliance on the 10-file cap.

### S3 — Staff document access (B2) (MUT: writes audit rows)
- **Prerequisites:** S1, P4, `verification-document` deployed to staging, a pending request with one uploaded document.
- **Action:** call the Edge Function (POST `{requestId, path}`) with: admin JWT; moderator; support; anon key; an expired JWT; a valid admin JWT with a path from a **different** request. Then, as admin, fetch the signed URL immediately and again after >120 s. Separately, as admin/moderator, try `storage.from('storefront-verification').createSignedUrl` / `download` directly with the user JWT.
- **Expected:** admin 200 with `expiresInSeconds: 120`; moderator/support 403; anon/expired 401; cross-request 404; URL works once inside 120 s and fails after; direct Storage calls by staff fail; exactly one `view_storefront_verification_document` audit row per successful call.
- **Evidence:** status/body per call, the 120 s before/after fetch, `select action, admin_id, target_id, created_at from admin_audit_log where action like 'view_storefront_verification%' order by created_at desc limit 10`.
- **Cleanup:** none for the audit rows (they are the evidence; do not delete); remove the test request/objects if desired.
- **Blocks:** B2 sign-off.

### S4 — Public view (RO)
- **Prerequisites:** S1.
- **Action:** run `supabase db lint` / the Security Advisor; as **anon** via PostgREST `GET /rest/v1/storefronts`, `/storefront_verification_requests`, `/storefront_legacy_snapshot`, `/storefront_media_hosts`, and `/public_storefronts?select=*`.
- **Expected:** the four tables deny anon; `public_storefronts` returns only the pinned columns (no `status`, `verification_status`, `*_public_id`, timestamps other than `published_at`); a `security_definer_view` finding for `public_storefronts` is expected and recorded.
- **Evidence:** responses, advisor output.
- **Cleanup:** none.
- **Blocks:** public storefront pages.

### S5 — Profile visibility (RO after seeding, MUT for seeding)
- **Prerequisites:** S4, owner test accounts with a draft, a suspended and a published storefront (seeding is MUT).
- **Action:** anon `GET /rest/v1/profiles?select=business_name,business_logo_url&id=eq.<uid>` for each; subscribe to Realtime on `profiles` while publishing/unpublishing.
- **Expected:** draft and suspended expose nothing; published exposes only the mirrored values; clearing arrives as an UPDATE with nulls (hardening doc §3).
- **Evidence:** responses and the Realtime event log.
- **Cleanup:** delete the seeded storefronts via the service role.
- **Blocks:** legacy-client privacy claim.

### S6 — R2 host (MUT; billing-free only if P5 allows)
- **Prerequisites:** S1, **P3**, `r2-presign` deployed to staging with the staging bucket.
- **Action:** insert the staging R2 host into `storefront_media_hosts`; upload a logo via `r2-presign`; set it via the old (`profiles.business_*`) and new (`storefronts`) paths; try a foreign host and another user's key.
- **Expected:** staging host accepted; foreign host and other-user key rejected.
- **Evidence:** statements and errors. **Note:** this gate proves URL shape/ownership only. It does not prove the image was scanned (it was not; see release-readiness doc §A).
- **Cleanup:** delete the test object; **delete the `storefront_media_hosts` row** unless staging keeps it on purpose.
- **Blocks:** any logo/banner acceptance.

### S7 — Account deletion (B1) (MUT, destructive on a staging test account)
- **Prerequisites:** 0055 applied, `delete-account` deployed to staging, a test account with uploaded verification documents, a listing photo and a storefront logo.
- **Action:** list `storefront-verification/<uid>/` (and the R2 prefixes `listings/<uid>/`, `wm/listings/<uid>/`, `business/<uid>/`) before; call `delete-account` as that user; list again.
- **Expected:** Supabase objects gone, response `cleanup:'complete'`; R2 public-bucket objects under those prefixes gone (new this pass); **private-bucket `orig/` and `pending/` objects remain by design** until the owner/counsel decision (release-readiness doc §C).
- **Evidence:** before/after listings, the response body, `select * from account_deletion_report()`.
- **Cleanup:** none (account is gone); purge leftover R2 test objects.
- **Blocks:** B1 sign-off.

### S7b — Ledger drain (MUT)
- **Prerequisites:** S7, `account-deletion-drain` deployed to staging with `DRAIN_SECRET`. **Deploy decision needed:** the function authenticates with `x-drain-secret`, but Supabase verifies a JWT first by default; either deploy with `--no-verify-jwt` or have the scheduler send the anon key as Bearer. There is no `supabase/config.toml` in the repo to pin this.
- **Action:** POST with no/wrong secret, then the right one. Force a Storage failure on a job (point at a wrong bucket or revoke the key on staging). Run two drains at once.
- **Expected:** 401 without the secret; failed job stays `pending` with `last_error` and a later `next_attempt_at`, `completed_at` null; `escalated` after 5; `account_deletion_requeue` then drain → `completed`, objects gone, names scrubbed; no object processed twice under concurrency.
- **Evidence:** responses, `account_deletion_jobs/objects` rows (counts and statuses only; names are scrubbed on completion).
- **Cleanup:** leave rows (they are the ledger) or delete the test jobs with the service role.
- **Blocks:** B1 sign-off.

### S8 — Backfill rehearsal (RO on a copy, MUT on the copy)
- **Prerequisites:** a **copy** of production-shaped data on staging (never production itself); the owner decides how the copy is produced (anonymised export is preferred).
- **Action:** before applying 0054 to the copy run the identification counts in the rollout plan (release-readiness doc §F); apply; re-run counts.
- **Expected:** storefronts created, profiles cleared and snapshot rows equal the pre-computed numbers; zero rows published; zero images carried over while `storefront_media_hosts` is empty.
- **Evidence:** count tables before/after.
- **Cleanup:** drop the copy.
- **Blocks:** production apply; the seller notice.

### S9 — Audit failure (MUT, temporarily weakens staging)
- **Prerequisites:** S3.
- **Action:** make the audit insert fail on staging (e.g. a temporary `check` constraint on `admin_audit_log`), call `verification-document` as admin; remove the constraint; call again.
- **Expected:** failure: no URL and no body leak (404 `Document not found`); after restore: URL works for 120 s; exactly one audit row per successful call.
- **Evidence:** both responses and the audit row count.
- **Cleanup:** **remove the temporary constraint**; verify with `\d admin_audit_log`.
- **Blocks:** B2 fail-closed claim.

Retention (B3) gate: not runnable until the owner and counsel approve a policy; no cleaner exists.

## Known gaps staging will not close

- **Logo/banner images are not scanned or watermarked.** They are written by a presigned PUT straight into the public bucket. They must not be published to real users until the contract in the release-readiness doc §A is approved, built and tested.
- **Private-bucket R2 objects** (`orig/<uid>/…`, `pending/wm/listings/<uid>/…`) are not removed on account deletion; retention of originals is an open legal decision.
- Mobile has no PDF picker; web accepts PDF (proposal, see the decisions doc).
- Hours are editable on mobile only (web editor deferred).
- No staff RPC to find a storefront that never requested verification (the suspend RPC itself already works for any storefront id).
- Admin audit rows for document views include the document path, which contains the uploader's user id.

## Sign-off

| Gate | Result | Evidence location | Date | Reviewer |
|---|---|---|---|---|
| S0–S9, S2b, S7b | | | | |

0054 and 0055 remain unapplied to production until every row above is filled and the Approval record in the owner-decisions doc is signed by the owner.
