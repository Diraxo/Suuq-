# Storefronts 0054: owner decisions B1–B3 (decide before staging)

Written 2026-10-18. **Status: decision record, all answers blank.** Nothing here is approved policy. Periods quoted from `STOREFRONTS_0054_HARDENING.md` are proposals. Staging validates behaviour only after these are answered, otherwise it proves the wrong thing. 0054 stays unapplied until each blocker has evidence-backed closure.

Order of work: **1) owner (and local counsel for B3) answers below → 2) implement B1 and finish B2 against the answers → 3) run the staging gates → 4) only then consider applying 0054.**

## B1 — Account deletion

**Question:** what must happen to verification documents when an account is deleted?

**Recommendation: a durable deletion ledger with retryable cleanup.**

1. Write the deletion job row *before* touching any file, outside the cascade path (no FK to `auth.users`; holds only what cleanup needs, e.g. uid and object paths).
2. List and remove everything under `storefront-verification/<uid>/` with the service role, before deleting the user.
3. Record a result per object; failures stay `pending` and are retried; after N failures, escalate to a human.
4. Never report deletion complete while any object remains. The user-facing state is "deletion in progress" until the ledger is clean.
5. Keep only the minimum audit record the retention policy (B3) permits.

Design constraint: `storefront_verification_requests` cascades on user delete, so the object list must be captured into the ledger first. Consistent with the ledger-first plan in `ACCOUNT_DELETION_AUDIT.md`.

Owner answers needed:

| # | Question | Answer |
|---|---|---|
| B1.1 | Is the ledger-first approach approved? | |
| B1.2 | Retry cadence and the failure count that escalates | |
| B1.3 | Who is notified on a stuck deletion? | |
| B1.4 | What the user is told while cleanup is incomplete | |
| B1.5 | Which fields may remain in the audit trail after deletion (proposal: no document paths; NOT true as built, the audit RPC still writes the path today, see B2.4) | |

## B2 — Staff access and auditing

**Question:** how may staff view verification documents?

**Recommendation: keep direct staff Storage access off; require the audited Edge Function.** This is what the code already does (`supabase/functions/verification-document/index.ts`): staff JWT → `admin_authorize_verification_document(request, path)` under the caller (checks `business_review`, path belongs to that request, writes one audit row per document) → only then a service-role signed URL, 120 s. Because the audit write is inside the RPC that precedes signing, an audit failure returns an error and no URL is issued (the function returns 403/404 and never reaches `createSignedUrl`). Staging must prove this, not assume it.

Owner answers needed:

| # | Question | Answer |
|---|---|---|
| B2.1 | Keep 120 s expiry? (propose yes unless staging shows a usability problem) | |
| B2.2 | Which roles may view? (today: admin only; moderator/support denied) | |
| B2.3 | Is a reason/case reference required per view? | |
| B2.4 | Audit row contents (staff id, request, document, time; no document contents) and how long audit rows are kept | |

## B3 — Retention and legal holds

**Question:** how long are documents kept, and what happens under a hold?

**Recommendation: agree a written policy with the owner and qualified local counsel before any cleanup job exists. Do not activate a cleaner until it is approved.**

Policy must define:

| Item | Proposal in hardening doc (NOT approved) | Decision |
|---|---|---|
| Unattached files | delete after 7 days, after dry-run review | |
| Rejected | keep through appeal window (suggest 30 days), then delete | |
| Approved | keep while verified + tail (suggest 90 days after revocation/deletion) | |
| Account deleted | delete files, keep minimal audit | |
| When each clock starts and resets (upload, submit, decision, re-apply, revocation) | not defined | |
| Who may place / release a hold; how audited | not defined | |
| Hold vs scheduled deletion conflict | hold wins (proposal) | |
| Minimal audit metadata kept after deletion | not defined | |
| Failed deletion retry and escalation | see B1.2–B1.3 | |

Mechanism needed once decided: a hold flag honoured by every cleaner (including the B1 account-deletion path; a hold on a deleting account is a counsel question).

## Proposed defaults (for the owner to accept or change; NOT authorization to implement)

Added 2026-10-18. These do not fill the Answer columns above. Only the owner's recorded approval does.

| Item | Proposed default |
|---|---|
| B1 job creation | Before deleting the user or cascading verification-request rows |
| B1 what survives | Minimal ledger: object paths, job state, retry metadata, timestamps. No FK to the deleted user |
| B1 storage failure | Job stays pending, retry with backoff, escalate persistent failures |
| B1 complete when | All in-scope objects confirmed deleted, or a documented exception explicitly resolved |
| B1 escalation owner | A system operator/administrator, **to be named by the owner** |
| B1 implementation notes | Idempotent; capture paths for every relevant storage prefix, not one known pattern |
| B2 who may view | Only roles explicitly granted `business_review`; owner confirms exact role mapping |
| B2 signed URL expiry | 120 s unless the owner names an operational need |
| B2 audit contents | Staff identity, request ID, document/object id, action, timestamp, outcome; no document contents |
| B2 audit write fails | Fail closed: no signed URL (staging must verify; not yet proven) |
| B2 log reviewers | Designated authorized personnel; log access itself restricted |
| B3 | No proposal. Needs the owner's policy with counsel: categories, clock start dates, exceptions, legal holds, post-deletion audit. Do not enable automatic cleanup until then |

## Reviewer-recommended defaults (2026-10-18) — PROPOSED, NOT APPROVED

A reviewer's recommended positions to take to the owner. They are recorded here as proposals only; the Approval record below stays blank until the owner (and counsel for B3) explicitly approves. Wording differs slightly from the table above where noted.

| Decision | Proposed default |
|---|---|
| B1.2 Deletion records | Keep only the minimum operational information needed to finish deletion and demonstrate its outcome. No foreign key to the deleted user |
| B1.3 Retry and escalation | Start from the implemented five attempts with exponential backoff capped at six hours. Approve only after confirming who receives escalations and how failed jobs are resolved |
| B1.5 Completion | Report cleanup complete only when every in-scope verification document is confirmed absent; otherwise `in_progress`, retryable |
| B2 Document access | Only explicitly authorized `business_review` staff; audit each authorization before signing; fail closed on audit failure; keep the 120-second URL expiry unless the owner changes it |
| B3 Retention and legal holds | All policy fields open until owner and counsel approve a written policy. Automatic cleanup is not activated |

**Known limitation that must stay visible (also in the eventual staging report):** the B1 workflow covers **Supabase verification documents only**. It does **not** cover R2 image deletion (logos, banners, listing photos). R2 cleanup on account deletion is a separate, still-open item.

**Evidence caveat:** the local results (`npm test` and the PGlite database suites) do not prove real Storage authorization, concurrent upload limits, audit-failure behaviour, signed-URL access or public-view security. The account-deletion tests must be reported with the exact command and environment they ran in; "real Postgres" (PGlite, local) is not the staging configuration.

## First-launch scope decisions (2026-10-18) — PROPOSED, NOT APPROVED

Recommended by the reviewer and agreed in conversation with the project lead as the direction to take to the owner. These are proposals; the Approval record below stays blank until the owner confirms.

| Decision | Proposed first-launch choice |
|---|---|
| PDF verification uploads | **Revised proposal (2026-10-19, project lead):** keep PDF on web as the code and bucket allow-list already do; drop the "images only" wording. Mobile stays image-only (no PDF picker). No migration change. Still a proposal until the owner approves |
| Web opening-hours editor | Deferred. Sellers manage opening hours through the mobile app |
| Staff suspension without a verification request | Deferred until an audited RPC contract is approved (no staff RPC lists storefronts today) |
| Logo and banner scanning | The existing image-safety pipeline must be integrated and tested before these images are published. **Built locally 2026-10-19** (route `/v1/business-media`, migration 0057, `r2-presign` refusal); see "Business media" below; staging-unverified |
| Existing sellers | Prepare a controlled migration and communication plan before any change to public visibility (S8 rehearsal, hardening doc §4) |

**Open discrepancy to resolve:** "images only" is not what the code does today. The web verification upload accepts PDF, and the `storefront-verification` bucket allows `application/pdf`. Either accept PDF on web as-is (and drop "images only" from the decision), or remove PDF from the web picker and the bucket allow-list in a later migration revision. Not changed here.

**Feature flags are not a security control.** Keeping `EXPO_PUBLIC_STOREFRONTS_ENABLED` / `NEXT_PUBLIC_STOREFRONTS_ENABLED` off only hides the intended UI. It does not prove the database, RLS, Storage policies or Edge Functions are secure, which is what the staging gates in `STOREFRONTS_0054_STAGING_CHECKLIST.md` are for. Migration 0054 (and 0055) stay unapplied to production, and flags stay off, until those gates pass.

## Approval record

| Blocker | Approver (name/role) | Decision date | Changes from proposed defaults |
|---|---|---|---|
| B1 | | | |
| B2 | | | |
| B3 (with counsel) | | | |

Status: **0054 on hold; B3 cleanup unbuilt** until this record is filled in.

Implementation status (2026-10-18, local only, nothing applied or deployed): B1 ledger written as migration `0055_account_deletion_ledger.sql` + `delete-account` change + unscheduled `account-deletion-drain` function, using the PROPOSED defaults above (5 attempts, backoff 2^n minutes capped at 6 h, no notification recipient wired, ledger job rows kept). If the owner answers differently, the numbers are parameters (`account_deletion_finish(p_max_attempts)`) and the rest is unaffected. B2 handler hardened and unit-tested; role mapping is whatever `staff_can('business_review')` returns (admin only today). B3: nothing built, by design. Approval fields above remain blank.

## Storefront client build (2026-10-18, local only, owner authorized UI work)

Order agreed: Phase 1 business-owner flow → Phase 2 public storefront → Phase 3 admin review. **Phase 1 is built; Phases 2 and 3 are not.**

Phase 1 files: `app/business/storefront.tsx` (mobile), `web/src/app/business/storefront/page.tsx` (web), shared rules `lib/storefront.ts` (+ byte-identical `web/src/lib/storefront.ts`), `tests/storefront.test.ts`, `storefront.*` strings in en/so/am (so/am are first-pass and need native review). Built only against existing contracts: table `storefronts` (owner select/insert/update policies), RPCs `storefront_publish`, `storefront_unpublish`, `request_storefront_verification`, `my_storefront_verification`, bucket `storefront-verification`, and `r2-presign` folders `business/<uid>/(logo|banner)`. Status and verification are never written by the client; `profiles.business_*` is never written (it is a derived mirror).

**Dark by default:** every entry point is behind `EXPO_PUBLIC_STOREFRONTS_ENABLED` / `NEXT_PUBLIC_STOREFRONTS_ENABLED` (off unless `true`); with the flag off the screens redirect/404 and the dashboard still links to the old settings page. A build with the flag on only works against a database where 0054 has been applied (otherwise the screen says "Storefronts aren't available yet").

Not proven: nothing in this client has run against a database or device. It is type-checked and the pure rules are unit-tested; mobile document upload sends images only (no PDF picker is installed; web accepts PDF); business logo/banner images are still not scanned (see hardening doc); hours are edited on mobile only.

## Storefront client build, Phases 2 and 3 (2026-10-18, local only)

**Phase 2, public storefront:** `app/storefront/[id].tsx` and `web/src/app/storefront/[id]/page.tsx`. They read only the `public_storefronts` view (columns pinned by a test against the migration text), validate the id, open only http(s) website links, and show hours from a locale-independent formatter. Draft, suspended, banned-owner, unknown and malformed ids all render the same "unavailable" page. Listings use the existing block-aware `seller_listings()` path; a blocked pair sees "unavailable". Entry points: "Visit storefront" on seller profiles (mobile `hooks/usePublicStorefrontId.ts`, web inline) and "View public page" on the owner screens.

**Phase 3, admin review (web only; the app has no admin console):** `/admin/businesses` (`web/src/app/admin/businesses/page.tsx`, `web/src/services/storefrontAdmin.ts`, `web/src/lib/storefrontAdmin.ts`). Uses only `admin_list_storefront_reviews`, `admin_get_storefront_review` (this writes an audit row on every open, so it is called once per open and never refreshed on a timer), `admin_decide_storefront_verification`, `admin_revoke_storefront_verification`, `admin_set_storefront_status`, and the `verification-document` Edge Function (120 s signed URL, opened in a new tab; the page never touches Storage). Added `business_review` to the admin permission set in `web/src/lib/adminGate.ts` (mirrors `staff_can`: admin only), route `/admin/businesses`, a nav entry hidden while the flag is off, and a `storefront` notification route on web and mobile.

**Contract limits found (not worked around):** there is no staff RPC that lists storefronts, only verification requests, so staff cannot suspend a storefront that never asked for verification from this UI. The staff view shows `submittedName/Address` against the current values and disables Approve when they differ (the RPC refuses it anyway). Reinstating returns to the list because the pre-suspension state is not known to the client.

**Not verified:** no device, browser or staging run of any of this. The Edge Function call path, signed-URL expiry, audit-failure behaviour (S3, S9), public-view security (S4, S5) and Storage enforcement (S1, S2) remain staging gates.

## Staging gates (run after the answers above)

Existing gate numbers from `STOREFRONTS_0054_HARDENING.md` §5 in brackets. Capture raw output, expected vs actual, and failures for each. PGlite results do not count here.

| Gate | Evidence required |
|---|---|
| B1 deletion [S7] | Delete a test account with uploaded documents: all objects gone; forced storage failure leaves a retryable ledger row; completion never reported while objects remain; capture before/after object listings |
| B2 authorization [S3] | Admin allowed; moderator, support, anon denied; cross-request path denied; expired/invalid JWT denied; forced audit-write failure issues no URL; staff JWT cannot sign or download directly from Storage; URL stops working after expiry; one audit row per view |
| B3 retention | Each approved category using disposable files; hold blocks deletion; release resumes it; failed deletion retries and escalates |
| Public view [S4, S5] | anon and authenticated against draft, suspended, banned, published storefronts via real PostgREST and Realtime; record actual grants, view owner, exposed columns, Security Advisor findings |
| Storage controls [S1, S2, S2b] | 11 MiB, `.html`, `.svg`, renamed `.exe` refused by the real Storage API; 11th unattached refused; 20 parallel uploads at 9 held → at most one succeeds; owner cannot update/delete; owner isolation |

| Ledger drain [S7b, new] | Run `account-deletion-drain` with a wrong/absent `x-drain-secret` (401), then the right one. Force a Storage failure (revoke the service key or point at a wrong bucket) on a job: it stays `pending` with `last_error` and a later `next_attempt_at`, `completed_at` null; after 5 failures it is `escalated` and `account_deletion_report()` shows it; fix cause, `account_deletion_requeue`, drain: `completed`, objects gone, names scrubbed. Run two drains at once: no object is processed twice |
| Audit failure [S9, new] | In staging make the audit insert fail (e.g. temporarily revoke insert on `admin_audit_log` from the function owner, or a check constraint) and call `verification-document` as an admin: no signed URL, no body leak; restore, call again: URL works for 120 s and then returns 400/403 from Storage; exactly one audit row per successful call |

Also still required before any apply: S0 (migration history check), S6 (R2 host), S8 (backfill rehearsal), and the rollout consequences in §4 of the hardening doc (existing sellers lose their public business section until a publishing client ships; business images are not yet scanned).

## Release-readiness pass (2026-10-19, local only) — see `STOREFRONTS_0054_RELEASE_READINESS.md`

Nothing in the Approval record changed. Items for the owner to decide, found in this pass:

- **Logo/banner scanning contract** (release-readiness §A) and **`admin_find_storefront` lookup RPC** (§B) are proposals only; neither is built.
- **R2 on account deletion:** `wm/listings/…` derivatives and storefront logo/banner (including drafts) are now covered by `delete-account` locally (best effort, unledgered, undeployed). Private-bucket `orig/` and `pending/` objects are deliberately not deleted pending a counsel decision on retaining originals.
- **B1.5 / B2.4 discrepancy:** `admin_authorize_verification_document` writes the document path (which contains the uploader's user id) into `admin_audit_log.metadata`; those rows survive account deletion. The "no document paths" line above is a proposal and does not hold for the audit trail as built; nothing has been redacted and no redaction job has run. Decide whether to keep, hash or drop the path (a new migration, not an edit of 0054).
- **Drain deployment:** `account-deletion-drain` uses `x-drain-secret`, but Supabase verifies a JWT first unless the function is deployed with `--no-verify-jwt`; there is no `supabase/config.toml` pinning it.

## Business media: logo/banner scanning (2026-10-19, local only, nothing applied or deployed)

**Why:** before this change the old business-profile screen and the storefront screens uploaded logos and banners with a presigned PUT straight into the PUBLIC bucket (`r2-presign` folder `business/{uid}/(logo|banner)`): no content check, no metadata strip, instantly world-readable. Decision taken: integrate with the existing scan Worker (option b), flags stay off, no unscanned business image is published.

### Paths traced

| Caller | Before | Now |
|---|---|---|
| `app/settings/business-profile.tsx` (legacy) via `useImageUpload` | `lib/r2.ts` `uploadToR2` → `r2-presign` → public PUT | `uploadToR2` diverts `business/{uid}/(logo\|banner)` to the Worker; no presign |
| `app/business/storefront.tsx` (mobile) | same | same diversion (folder from `lib/storefront.ts`) |
| `web/src/services/profileMedia.ts` (web legacy profile) | `services/r2.ts` `uploadToR2` → presign | same diversion |
| `web/src/app/business/storefront/page.tsx` | same | same diversion |
| Anything calling `r2-presign` directly | n/a | `r2-presign` refuses every `business…` folder with HTTP 426 `media_scan_required`, before R2 credentials are read. A test fails if any other client file invokes `r2-presign` |

The legacy screen can be moved safely: all four callers go through the two `uploadToR2` helpers and keep the same `{url, publicId/key}` result shape and the same key shape (`business/{uid}/{kind}/{uuid}.jpg`), so profile guard 0056, storefront validation 0054, `r2-delete` ownership checks and `delete-account` key handling are untouched. Existing images are untouched (no rescan, see "Not covered").

### What was built

- `workers/image-scan/src/businessMedia.ts` + route `POST /v1/business-media` (multipart `kind`, `photo`; Bearer JWT, behind the same `authenticate`). `runBusinessMediaScan`: kind allow-list → real file signature (jpeg/png/webp; not svg/html) → size ≤ 6 MiB → hourly limit (20, failures count) → private original `orig-media/{uid}/{kind}/{sha}.bin` → normalise (≤1600 px JPEG) → orientation check **before** metadata strip → strip EXIF/GPS/XMP/IPTC and re-verify → Vision (8 s timeout, one retry) → shared `decideImage` with the lenient `business` category → only `pass` publishes. `review`, `reject`, provider outage, timeout, and any storage/imaging error publish nothing. The scan row is set `approved` **before** the public object is written; if the public write then fails, the row is downgraded.
- Migration `0057_business_media_scans.sql` (+ `rollback/0057_business_media_scans_ROLLBACK.sql`): `business_media_scans` (service-role write, staff read), `business_media_config.enforce` (**default false**), and invoker triggers on `profiles` and `storefronts`. While enforced, a **client** write that sets a NEW logo/banner key needs an `approved` scan row for that user, kind and key. A key the owner already holds on profile or storefront (legacy) can be re-saved or copied; non-client writers (0054 mirror RPCs, backfills, operator SQL) are unchecked. Clients cannot read or write the table or flip the flag.
- Clients: `lib/businessMedia.ts` (+ byte-identical `web/src/lib/businessMedia.ts`, parity-tested): folder parsing and a fail-closed response interpreter (key and URL must belong to this user and slot, https, URL ends with the key).
- Tests: `tests/businessMediaScan.test.ts` (approved, rejected, held, provider outage/timeout/empty answer, recovery, approval-row failure, public-write failure, sideways and metadata-leaking derivatives, invalid kind, html/svg/text/empty bytes, oversize, rate limit, presign refusal and ordering, no other direct presign caller, response interpretation) and `supabase/tests/business_media.test.mjs` (15 PGlite assertions: off by default, unscanned refused, scanned accepted, wrong slot/user/status refused, legacy grandfathering, storefront path, non-client writers, table closed to clients, cascade on deletion). Listing-photo tests are unchanged and pass.

### Worker contract differences (listing scan vs business media)

| | `/v1/scans` (listings) | `/v1/business-media` (new) |
|---|---|---|
| Input | listingId, categoryId, title, 1–8 photos | `kind` logo\|banner, exactly 1 `photo` |
| Policy | `decideBatch` incl. category relevance, duplicates | `decideImage` with lenient `business`; no duplicate lookup |
| Watermark | yes (anti-theft) | **no** (proposed: it would deface a brand logo). Needs owner confirmation |
| Review | `review` → derivative held privately, staff approve → `/v1/promote` | `review` → **not published, no queue** (the user is told to pick another image). A staff queue is a possible later addition |
| Output | `wm/listings/…` | `business/{uid}/{kind}/{uuid}.jpg` (same shape as before, so no DB key change) |
| Persistence | `listing_scans`, `listing_scan_images`, `image_hashes` | `business_media_scans` (0057) |
| New error | none | `unavailable` (HTTP 503, retryable) when the provider check fails |

### Deploy order (the wrong order breaks logo/banner upload for everyone; it fails closed, it never publishes)

1. Apply 0057 (enforcement stays off). 2. Deploy the Worker with `/v1/business-media` and the Vision key; verify in staging (below). 3. Ship builds/web with `EXPO_PUBLIC_IMAGE_SCAN_URL` / `NEXT_PUBLIC_IMAGE_SCAN_URL` set. 4. Deploy `r2-presign` (the refusal). 5. Only then set `business_media_config.enforce = true`. Deploying step 4 before 2–3 makes logo/banner upload fail with "not available in this version yet": intentional, because refusing is preferable to the unsafe path. Rolling step 4 back re-opens the unsafe path and should be a last resort.

### Not proven (all of it needs staging)

The Worker route against real Cloudflare (Images binding, R2 bindings); Vision on real logos/banners (text-heavy logos may trip the marketplace-name OCR rule and come back "held"); CORS from the real web origin; PostgREST insert/patch of `business_media_scans` with the service key; the 90 s client timeout on slow mobile networks; the 6 MiB cap against real client output (clients send ≤ 1600 px JPEG). No Vision call has ever run (see `docs/IMAGE_SAFETY.md`).

### Not covered (open, not hidden)

- **Avatars** use the same direct presign (`avatars/{uid}`) into the public bucket and have the same gap. Out of scope here; recommended as the next closure using the same route with `kind=avatar`.
- **Existing logos/banners** already in the public bucket were never scanned. A one-off rescan/backfill plan is a separate decision.
- **Orphans:** a rejected or abandoned upload leaves only a private original (`orig-media/…`); no public object exists to orphan. Cleanup of those originals depends on P2 below.
- The new error strings are English constants (`BUSINESS_MEDIA_MESSAGES`), like the existing presign errors; not yet in so/am locales.

## DRAFT policies awaiting owner (and counsel) approval: NOT approved, nothing implemented

These drafts exist so retention behaviour can be decided before any deletion code is finalised. **They are technical proposals, not legal advice.** No period below has been invented: every period cell is deliberately blank. Do not change database audit behaviour or R2 cleanup until the approval record is filled in.

### P1: Audit-trail retention after account deletion

Recommended default: **retain the audit event, strip direct identifiers and document paths when no longer required.** Never silently rewrite historical audit data: any redaction runs as an explicit, logged migration/job with before/after counts, not an in-place edit.

| Item | Proposal | Owner / counsel decision |
|---|---|---|
| Kept | the fact of access, the action, timestamp, outcome, acting staff id, and a pseudonymous reference only if an approved need to correlate events exists | |
| Redacted | document path (it contains the uploader's user id) and uploader id: null, or a salted pseudonym | |
| When redaction happens | at account deletion, or after the incident-response window | |
| Retention period for the remaining audit rows | **blank: needs owner + counsel** | |
| Who may read audit rows; is reading itself logged | admins holding the audit permission; yes | |
| Legal / contractual / incident-response requirements that would block redaction | **to be confirmed before any change** | |
| Existing rows | `admin_authorize_verification_document` currently writes the path into `admin_audit_log.metadata`; decide keep / hash / drop going forward and, separately, for history | |

### P2: Private-original retention (`orig/`, `orig-media/`, `pending/`)

Recommended default: **delete private originals once no longer needed for moderation, dispute resolution or a documented legal hold; do not keep them indefinitely.**

| Item | Proposal | Owner / counsel decision |
|---|---|---|
| Retention period | **blank: needs owner + counsel** | |
| Categories covered | listing originals `orig/…`; business-media originals `orig-media/…`; held derivatives `pending/…`; rejected-image originals | |
| Rejected images kept temporarily for moderation? | proposed yes, shorter than approved ones; period blank. **Suspected-illegal material is a counsel question** (preservation/reporting duties may forbid automatic deletion; see `IMAGE_SAFETY.md` §3) | |
| Legal hold | a per-user and per-object hold flag honoured by every cleaner; who may set/release it and how that is audited: undefined | |
| Deletion failure | stays pending, retried with backoff, escalated after N attempts, reported as incomplete and never as done (same ledger shape as B1) | |
| Completion record | job id, object count, timestamps, outcome; **no** user id, keys or file names after completion | |
| Account deletion | originals follow the same rule; a hold on a deleting account is a counsel question | |

Approval record (fill in before the R2 deletion build):

| Policy | Approver (name/role) | Decision date | Changes from draft |
|---|---|---|---|
| P1 audit retention | | | |
| P2 private-original retention | | | |
| Business media: no watermark; "review" = not published | | | |

Status: **R2 deletion with retry, reconciliation and status reporting is NOT built**; it waits for the approvals above.

## Business media: completion pass (2026-10-19, local only): READ THIS BEFORE THE "Deploy order" ABOVE

The "Deploy order" in the Business media section above is **superseded** by `BUSINESS_MEDIA_STAGING_CHECKLIST.md` §1. Corrections found in review: 0057 hard-depends on 0054 (it fails without it), `storefront_media_hosts` must be filled before enforcement, and `r2-presign` must wait until the new mobile build is live in the stores.

Security fixes made in this pass (each test-first): client URLs are now pinned to a managed host and new URL-only logos/banners are refused while enforced (0057); `r2-presign` business and listing gates are case-insensitive; the hourly limit is re-checked after the scan row exists. New: migration `0058_business_media_backfill.sql` (+ rollback), Worker route `/v1/business-media/backfill` (off unless `BACKFILL_SECRET` is set), operator script `scripts/business-media-backfill.js` (read-only by default). Somali/Amharic strings added for the upload errors. Details: `BUSINESS_MEDIA_ACCEPTANCE_REPORT.md`.

The Approval record in this file is **still blank** for P1, P2 and the "no watermark / held = not published" row. Questions to answer are in `BUSINESS_MEDIA_DECISION_REQUEST.md`. The R2 deletion lifecycle remains unbuilt.
