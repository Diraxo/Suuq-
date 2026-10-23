# Storefronts 0054: hardening review, verification-file lifecycle, staging gates

Written 2026-10-18. **Status: local only.** Migration 0054 is unapplied and uncommitted. Nothing here touches a database, storage bucket or deployment. A passing local suite is necessary, not proof of production security.

## 1. Verification-file lifecycle (identity documents)

Bucket `storefront-verification` (private). Object key: `<uid>/<file>.<jpg|jpeg|png|webp|pdf>`.

| State | How a file gets there | Who can read | What 0054 does | What is **not** decided |
|---|---|---|---|---|
| Unattached upload | Owner uploads, never submits (or submits other files) | Owner only (staff: audited Edge Function) | Max 10 unattached per user (upload policy), 10 MiB, MIME allowlist, flat path/extension policy. **Never deleted.** | How long to keep it |
| Attached, request pending | `request_storefront_verification` (path shape, ownership and existence re-checked) | Owner, admin | Identity (name/address) frozen; request stores the submitted identity | none |
| Attached, approved | Admin approves | Owner, admin | Audit row with actor/reason/time; approval only valid for the submitted identity | How long to keep after approval; whether to keep while verified |
| Attached, rejected | Admin rejects | Owner, admin | Owner may re-apply with the same files | Appeal window, then deletion |
| Owner deleted | `delete-account` deletes `auth.users` | n/a | Request rows cascade; **audit rows are kept** (`admin_audit_log.target_id` is text, no FK) | See blocker B1 |
| Legal / open-case hold | n/a | n/a | **Nothing** | Mechanism (e.g. a `legal_hold` flag honoured by every cleaner) |

**Proposed defaults, NOT decided, need owner (and counsel where applicable) sign-off before any cleaner is written:**

1. Unattached older than 7 days: candidate for deletion, after a dry-run report review.
2. Rejected: retain through an appeal window (suggest 30 days), then delete unless held.
3. Approved: retain while the storefront stays verified, plus a fixed tail (suggest 90 days after revocation or deletion), unless held.
4. Account deletion: delete the files; keep only the minimum audit record (PROPOSAL: no document paths; NOT true as built, the audit RPC still writes the path today. See B1.5/B2.4 in `STOREFRONTS_0054_OWNER_DECISIONS.md`).
5. Any holds (reports, disputes, legal requests) take precedence over every rule above.

**Tooling shipped now (non-destructive):** `admin_verification_files_report(interval)` (admin only) returns counts: total, unattached, unattached older than the interval, attached by request outcome, and files whose uploader's account no longer exists. Use it in staging and production to size the problem before choosing the rules. No function in 0054 deletes a file.

### Launch blockers for the lifecycle

* **B1 (implementation written 2026-10-18, LOCAL ONLY, awaiting owner answers B1.2/B1.3/B1.5 and staging S7): see `supabase/migrations/0055_account_deletion_ledger.sql`, `functions/_shared/deletionLedger.ts`, `functions/delete-account` (edited, undeployed) and `functions/account-deletion-drain` (unscheduled, undeployed).** Ledger-first: every object under `storefront-verification/<uid>/` (Storage listing UNION request paths) is recorded in `account_deletion_jobs/objects` (no FK to the account) BEFORE any Apple revoke / R2 delete / user delete; if that write fails the request returns 500 and nothing is touched. The auth user is deleted next (failure cancels the job, nothing removed), late uploads are re-collected, then objects are removed with the service role and per-object results recorded. A job completes only when no object is left; otherwise it stays `pending` with exponential backoff (2^n min, cap 6 h) and escalates to `escalated` after 5 attempts (PROPOSED numbers, not approved). `delete-account` now answers `{ success: true, cleanup: 'complete' | 'in_progress' }`. Proven locally against real Postgres (`supabase/tests/account_deletion.test.mjs`, 17 checks) and statically (`tests/accountKeys.test.ts`). NOT proven: the edge function itself, real Storage `remove()` semantics, cross-connection concurrency, scheduling. Not covered: R2 objects are still best-effort and unrecorded (audit G3/G1/G2 in `ACCOUNT_DELETION_AUDIT.md`), job rows keep `user_id` indefinitely until B1.5/B3 say otherwise. Original finding, kept for context: **account deletion did not touch Supabase Storage.** `delete-account` removes only R2 keys. `storage.objects.owner` has no FK to the user, so a deleted user's identity documents stay in `storefront-verification` and the request rows that index them cascade away (the test "owner deletion cascades…" asserts exactly this). Before launch: `delete-account` must, ledger-first as in `ACCOUNT_DELETION_AUDIT.md`, list `storefront-verification/<uid>/` and remove it with the service role *before* deleting the user, and record failures. Not implemented here on purpose (a destructive change to be reviewed with the other deletion gaps).
* **B2: staff access to the bytes. FIXED locally, unproven on real Storage. Handler extracted 2026-10-18 to `functions/_shared/verificationDocumentHandler.ts` and unit-tested (`tests/verificationDocument.test.ts`, 11 checks: authorized, 403, expired/invalid JWT 401, missing doc, audit-write failure issues no URL, RPC throw fails closed, mismatched path never signed, signing failure 502, malformed input rejected before any RPC). The forced audit-failure test against the REAL RPC has NOT been run (staging S3/S9).** The Storage select policy is now owner-only (staff have no direct read). Staff get a 120 s signed URL only from the `verification-document` Edge Function (`supabase/functions/verification-document`), which first calls `admin_authorize_verification_document(request, path)` under the staff JWT (checks `business_review`, that the path belongs to that request, writes one audit row per document) and only then signs with the service role. Not deployed. Staging must prove a staff JWT cannot sign or download directly (S3); the service-role key must never reach a client.
* **B3: retention policy and hold mechanism undecided** (table above).

### Review response (external review, 2026-10-18)

| # | Finding | Status |
|---|---|---|
| 1 | Staff bypass audit via Storage | Fixed locally (B2); tests: no staff/admin read of others' files, per-document audit, wrong-path/moderator/support/anon refused |
| 2 | Account deletion leaves documents | **Open (B1).** Needs a ledger-first design in `delete-account`; deliberately not in 0054 |
| 3 | Retention / legal hold | **Open (B3).** Needs owner and counsel decision first |
| 4 | Owner-privilege view | Staging gate S4/S5, not an accepted advisor warning; alternatives: projection table or definer function |
| 5 | Upload cap race | Mitigated: `verification_upload_slots_used()` takes a per-user `pg_advisory_xact_lock` before counting. **Not proven**: PGlite is single-connection, so parallel uploads need staging (S2b). Storage-API size/MIME enforcement is still S2 |
| 6 | Rollback | `supabase/rollback/0054_rollback_restore.sql` + test. Exports all storefronts first; restores originals only for never-published owners; published owners keep post-migration values; published-then-unpublished and post-0054 storefronts stay cleared (data is in the export; re-publicising is a human decision). Bucket and files untouched. The drop block stays manual. **Export integrity check:** before modifying profiles, the script compares the export with the live `storefronts` table (row counts, then row-by-row owner, status, published timestamp, name, description, hours); a mismatch raises an exception and rolls back the transaction. **Per-owner report:** creates `storefront_rollback_report` (closed to clients) with one outcome per owner: `restored_original_legacy`, `preserved_current_values`, `left_cleared_published_then_unpublished`, `left_cleared_created_after_0054`. It prints outcome counts; per-owner detail stays in the report table. **Manual recovery verification (operator, before the drop block):** dump `storefront_rollback_export` and `storefront_rollback_report` with `pg_dump -t`, store the dump securely outside the database, and restore it into a scratch database to prove it is recoverable. **Limitations:** the script does not prove the export is recoverable or securely stored; the comparison covers only the listed fields, not everything that may be needed for recovery; bucket and files are untouched; the drop block is manual; owners left cleared are not republished automatically. Locally tested only (PGlite), not production-verified. This does not close the account-deletion, retention/legal-hold, public-view or Storage staging findings |

## 2. Controls added in this revision

| Area | Control | Proven locally? |
|---|---|---|
| Bucket | `file_size_limit` 10 MiB, `allowed_mime_types` JPEG/PNG/WebP/PDF; migration aborts if Storage lacks those columns | Setting recorded + abort path: yes. **Enforcement by the Storage API: no (staging S2)** |
| Upload policy | own folder, flat, extension allowlist, ≤100-char name, ≤10 unattached files, no update/delete | yes (policy layer on the stub) |
| Logo/banner | https + host in `storefront_media_hosts` + path is exactly the owner's own key `business/<uid>/(logo\|banner)/<uuid>.jpg`; invalid is rejected (direct writes) or ignored (old-app writes, backfill); **nothing is truncated**; allowlist empty by default | yes |
| Account suspension | `profiles.account_status/suspended_until` writes re-run the mirror; mirror copies only while published **and** owner in good standing | yes (suspend, ban, open-ended, expired, reinstate, old-app write while banned) |
| Draft privacy | mirror clears `profiles.business_*` for anything not published; backfill snapshots then clears; old-app drafts stay private | yes |
| Public view | owner-privilege + `security_barrier`; no `*_public_id`; SELECT-only; caller-supplied functions only see public rows | yes |
| Identity freeze | name + address locked while pending for **every** writer; old-app saves accepted but identity unchanged; verified + name/address change voids; approval refused if the submitted identity differs | yes |
| `reviewed_by` | explicit `ON DELETE RESTRICT`; same as `admin_audit_log.admin_id` (staff who decided anything cannot be hard-deleted; deactivate instead) | yes |
| Admin-only | `business_review` stays admin only; moderator/support denied for RPCs, requests table and bucket | yes |

### Public view security model (decision for the owner)

`public_storefronts` is an **owner-privilege** view on purpose: `anon`/`authenticated` hold no privilege on `storefronts`. A `security_invoker` view was considered and rejected: `authenticated` already needs table-wide SELECT (owners read `status`, `verification_status`), so a public-read RLS policy would let every signed-in user read `verification_status` (`pending`/`rejected`), timestamps and suspension fields of everyone's published rows directly from the table. The alternative that avoids both is moving the private state into its own table, a larger redesign. **Supabase's Security Advisor will flag this view as `security_definer_view`; that finding is expected.** If an advisor-clean path is mandatory, the replacement is a `security definer` function returning the same columns (or the table split above).

### SSRF

No database code fetches a URL. Rules for later phases: never fetch `logo_url`/`banner_url`/`website`; derive any fetch from `*_public_id` against the configured base, follow no redirects, and block non-public IP ranges. The allowlist is a **shape and ownership** control only, not a content scan.

## 3. Audit: every public path that can show business data

| Path | Exposure before | Now |
|---|---|---|
| `profiles` direct (`select=*` in `app/seller/[id]`, `app/dealer/[id]`, `lib/listingsApi`, `lib/homeFeedApi`, `lib/searchApi`) | Always public (policy `using (true)`), every status | Only for published storefronts of owners in good standing |
| `profiles` embedded in listing queries | Same | Same fix (same columns) |
| Realtime `postgres_changes` on `profiles` (in `supabase_realtime`) | Same rows, same RLS | Same fix; clearing is itself an UPDATE event with null values |
| `public_storefronts` | n/a | Filtered view |
| `home_feed()` / search RPCs | Do not return `business_*` (grep) | unchanged |
| Public R2 image URLs already issued | Fetchable by anyone holding the URL | **Not revocable by the database.** Unguessable keys, but a logo URL already seen stays fetchable until the object is deleted. Residual |
| Cached copies (CDN, devices, search index) | n/a | Residual |

Not covered: a TIMED suspension that simply expires writes nothing to `profiles`; the legacy columns stay cleared until the next storefront or account write (fails closed). Adding a scheduled re-mirror is optional.

## 4. Rollout consequences (read before applying anywhere)

1. **Existing business sellers lose their public business section in currently deployed clients** until they publish a storefront, because the backfill creates drafts and drafts are private. The original values are preserved in `storefront_legacy_snapshot`. Therefore: **do not apply 0054 to production until a client that can publish ships**, or decide to publish eligible backfilled storefronts after review (a product decision, not made here).
2. `storefront_media_hosts` is empty after apply: no logo/banner is accepted until the operator inserts the host of `R2_PUBLIC_URL` (lower-case, no scheme or path; a base URL with a path prefix will not match and fails closed). Then run `select public._sf_reattach_legacy_images();` (service role / SQL editor only) to bring valid legacy images back into their drafts. Legacy Cloudinary images never validate and are not carried over.
3. Business images are **not** run through the image-safety Worker today (`workers/image-scan` handles listings). Before publishing storefronts publicly, either route business images through it or accept unscanned owner images knowingly. Launch gate.
4. Test-harness changes: `storage.buckets` stub gained `file_size_limit`/`allowed_mime_types`, `storage.objects` gained `created_at`, and `storage.foldername()` now matches Supabase (folders only, excluding the file name). All 16 suites pass with it.

## 5. Staging gates (isolated project, before production)

* **S0 migration history:** authorized operator runs the read-only `supabase_migrations.schema_migrations` listing against the intended project and compares it with `supabase/migrations/`. Do not apply 0038–0053 on the strength of old notes.
* **S1** `\d storage.buckets` has `file_size_limit` and `allowed_mime_types` (the migration aborts otherwise).
* **S2** Upload an 11 MiB file, a `.html`, a `.svg` and a renamed `.exe`; confirm the Storage API refuses each. Upload an 11th unattached file; confirm refusal. Confirm no update/delete by the owner.
* **S2b** Fire 20 parallel uploads for a user holding 9 unattached files; confirm at most one succeeds (advisory-lock cap).
* **S3** Real `storage.foldername()` semantics against the upload/select policies; signed-URL access as owner, admin, moderator (denied), support (denied), anon (denied).
* **S4** Security Advisor / `supabase db lint`: record the `security_definer_view` finding for `public_storefronts` and any other finding; confirm `anon` cannot read `storefronts`, `storefront_verification_requests`, `storefront_legacy_snapshot`, `storefront_media_hosts` through PostgREST.
* **S5** PostgREST: `GET /rest/v1/profiles?select=business_name` as anon for a draft owner, a suspended owner and a published owner; Realtime subscription behaviour on clearing.
* **S6** Insert the staging R2 host, upload a logo through `r2-presign`, set it via the old-app path and the new path; confirm acceptance, and rejection of a foreign host.
* **S7** Delete a staging account that has uploaded documents; confirm B1 reproduces (files remain) until the delete-account change exists.
* **S8** Backfill rehearsal on a copy of production-shaped data: counts of storefronts created, profiles cleared, snapshot rows.
