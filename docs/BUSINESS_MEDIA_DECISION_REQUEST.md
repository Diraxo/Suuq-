> **STILL UNANSWERED (nothing approved).** Written 2026-10-19 against the fail-closed design. Added 2026-10-21: one more owner decision is open, **U: URL-only avatar/logo/banner** (approve 0063 as built = refuse new URL-only values, tolerate only a first-login avatar on `lh3.googleusercontent.com`; or keep the carve-out; or add a minimum-supported-version fact first). It is independent of P1/P2/B1 below. The shipped policy is direct upload, OFF (unscanned), see `MEDIA_LAUNCH_POLICY.md`.
>
> **Current facts (2026-10-21), authoritative text in `MEDIA_LAUNCH_POLICY.md`; nothing below was applied, deployed or committed.**
> - Shipped policy is **direct upload with scan enforcement explicitly OFF** (0057 seeds `business_media_config.enforce=false`; missing/NULL still reads ON). Avatars, logos and banners are **NOT scanned**: this is an accepted, time-limited risk, never a control. `r2-presign` does not refuse `avatars/` or `business/`, and neither client has a Worker path.
> - **0062** (local, unapplied): host pin for any CHANGED avatar/logo/banner that carries a key: the URL must be exactly `https://<host in storefront_media_hosts>/<key>`. **Apply order (hard):** insert the `R2_PUBLIC_URL` host into `storefront_media_hosts` first (0062 seeds none; empty list = every avatar/logo/banner save fails, fail closed), needs 0054 and 0056. Works in both enforcement modes.
> - **0063** (local, unapplied): refuses a NEW URL-only (no key) avatar/logo/banner on update; on first-login INSERT only an avatar on `lh3.googleusercontent.com` is tolerated. Unchanged legacy URLs keep passing. Needs 0038 and 0056 only (no host list). Cost: a hypothetical pre-R2 (Cloudinary-era) build could not CHANGE its photo; the repository holds **no evidence** of the deployed or minimum supported app version, so none is assumed. Owner decision still open.
> - **Apply order:** 0054 -> 0055 -> 0056 -> 0057 -> 0058 -> 0059 -> insert host row -> 0062 -> 0063. **Rollback strictly reverse** (0063, 0062, 0059, 0058, 0057, 0056); the 0062 and 0063 rollbacks drop only their own trigger/functions and change no data; the 0056/0057/0059 rollbacks install the media freeze.
> - **Still open:** unscanned bytes in our own bucket (no content check), a Google photo kept on first-login INSERT while OFF, existing rows never rewritten (no backfill), owner decisions P1/P2/B1 and the URL-only decision, no staging run.

# Business media: decisions needed from the owner

Written 2026-10-19. **Nothing in this file is approved.** Every period, role and rule below is blank on purpose: the project must not invent a retention period, and an empty approval table is not consent. Answer in the "Owner answer" column (legal items: with qualified counsel), then tell the engineer; the engineer records it in the approval tables of `STOREFRONTS_0054_OWNER_DECISIONS.md` and builds the deletion lifecycle against it.

This is a technical brief, not legal advice.

## Why this blocks work

The R2 deletion lifecycle (Step 5) has to know three things the project cannot decide for you: how long private originals may be kept, what survives in the audit trail after an account is deleted, and when something must not be deleted at all (legal hold). Until those are answered the lifecycle is **not built**, and the system reports it as not built. Everything that does not depend on them is already done (see `BUSINESS_MEDIA_ACCEPTANCE_REPORT.md`).

## What is private today (so you know what these decisions cover)

| Where | What | Created by | Deleted today |
|---|---|---|---|
| Private bucket `orig-media/{uid}/{logo\|banner}/{sha}.bin` | The exact file the user uploaded, including its EXIF/GPS | every business logo/banner scan, approved or not (and every backfill rescan) | **never** |
| Private bucket `orig/…`, `pending/…` | Listing originals and held listing derivatives | listing photo scans | never (listing cleanup is separate) |
| Public bucket `business/{uid}/{kind}/{uuid}.jpg` | The scanned, metadata-free copy that is shown | approved scans | by the owner on replace/remove via `r2-delete`; best effort on account deletion |
| `admin_audit_log.metadata` | When staff open a verification document, the document path (it contains the uploader's user id) | `admin_authorize_verification_document` | never; survives account deletion |
| `business_media_scans`, `business_media_backfill` | Per-attempt scan record, including `source_key` of the private original | scans / backfill | with the user (cascade) |

A rejected upload leaves a private original behind and no public object. An approved upload leaves both.

## P1: audit trail after account deletion

| # | Question | Draft default (a proposal, not approved) | Owner answer |
|---|---|---|---|
| P1.1 | When an account is deleted, should the document path and uploader id be removed from existing audit rows? | Yes: keep the event (that access happened, action, time, outcome, acting staff id); null the path and uploader id | |
| P1.2 | When does that redaction run? | At account deletion | |
| P1.3 | How long are the remaining audit rows kept? | **blank: owner + counsel** | |
| P1.4 | Going forward, should `admin_authorize_verification_document` still write the path? | Write a salted pseudonym or nothing, not the raw path | |
| P1.5 | Existing rows already containing paths: keep, hash, or drop? | Redact through an explicit logged job with before/after counts, never a silent edit | |
| P1.6 | Any legal, contractual or incident-response duty that would block redaction? | **to be confirmed by counsel** | |

**If you approve the defaults:** a new migration changes the audit RPC to stop writing the raw path, and a redaction job (service-role, logged, dry-run first) nulls path/uploader id for deleted users. **If you choose "keep":** nothing is built and the audit trail keeps user ids and paths after deletion, which the privacy policy text should then say. **If you set a retention period (P1.3):** a scheduled purge job is added; it will not exist before the period does.

## P2: private originals, rejected images, legal holds

| # | Question | Draft default (a proposal, not approved) | Owner answer |
|---|---|---|---|
| P2.1 | How long is the private original of an **approved** image kept? | Delete once no longer needed for moderation or disputes. **Period blank** | |
| P2.2 | How long is the private original of a **rejected or held** image kept? | Shorter than approved. **Period blank** | |
| P2.3 | Suspected-illegal material: may it ever be auto-deleted? | **Counsel question** (preservation/reporting duties can forbid deletion; see `IMAGE_SAFETY.md` §3). Until answered, `REJECTED_ORIGINAL_POLICY` stays `retain` | |
| P2.4 | Legal hold: who may place and release one, per user or per object, how is it audited? | Hold wins over any scheduled deletion; set/released only by a named role, every change audited. **Roles undefined** | |
| P2.5 | On account deletion, are private originals deleted too? | Yes, unless a hold applies. Whether a hold may apply to a deleting account is a **counsel question** | |
| P2.6 | What may the deletion record keep once the job completes? | Job id, object count, timestamps, outcome. **No** user id, keys or file names | |
| P2.7 | Failed deletion: retry cadence and who is told when it gives up? | Reuse the account-deletion ledger: 5 attempts, backoff `2^n` minutes capped at 6 h, then `escalated`. **Escalation recipient not named** | |

**What gets built once P2 is approved** (reusing the existing ledger from migration `0055`, not a second system):

1. **Deletion intent first.** A durable row per object, written before anything is touched. Extend the ledger's object record with a `store` (Supabase Storage, R2 public, R2 private); it has no foreign key to the user, so it survives the account.
2. **Server-side executor.** An authenticated service path (the Worker holds the R2 bindings; the Edge Functions hold R2 credentials today) that deletes only keys of the exact shapes `business/{uid}/…`, `orig-media/{uid}/…`, `wm/listings/{uid}/…` for the job's own user. A key outside that user's prefix is refused, which is the "no cross-user deletion" guarantee.
3. **Idempotent, bounded, honest.** R2 delete of a missing object counts as done. Failures stay `pending` with backoff, then `escalated`. A job is `completed` only when every object is confirmed gone; "queued" is never reported as done.
4. **Crash recovery.** Lease on every claimed job; an expired lease is reclaimed, as in `account_deletion_claim`.
5. **Reconciliation, report-only first.** A job lists R2 prefixes and compares with database references: objects with no row (R2-only) and rows with no object (database-only). It reports both. It deletes an R2-only object only after the P2 period for that class has elapsed and no hold applies.
6. **Legal hold** is a flag every cleaner checks before deleting (per user and per object).
7. **Status API** that distinguishes `pending`, `in_progress`, `completed`, `retryable failure`, `terminal failure/escalated`.

If any answer above changes (for example a hold on deleting accounts), items 3, 5 and 6 change with it; items 1, 2 and 4 do not.

## Also needed before the lifecycle is final

| # | Item | Why | Owner answer |
|---|---|---|---|
| B1 | Approve (or change) the account-deletion ledger in `0055` | The R2 lifecycle extends it, and today its approval record is blank too. It currently covers Supabase verification documents only; R2 logos/banners/listing derivatives on account deletion are best effort and unledgered | |
| W | Business media: **no watermark** on logos/banners; **"held" means not published** | Built that way as a proposal | |
| H | **Held business images**: add a staff review queue, or keep "held = try another image"? | Today a legitimate logo containing a listed marketplace word (`marketplace`, `amazon`, `jiji`, `fursad`, …) is held and cannot be published at all (pinned by a test). Options: (a) staff queue for held business media, (b) a narrower business-specific word list. Neither is built; the safety rule has not been weakened | |
| L | Backfill of legacy images that are **rejected/held/missing** | The backfill only ever swaps in an **approved** scanned copy. For everything else it reports. Choose: leave as is, ask the owner to re-upload, or hide the image. No default is built | |
| T | Somali and Amharic wording | First-pass translations added for the eight upload messages; need a native speaker's review | |

## Consequence summary

| If you decide… | Engineering result |
|---|---|
| Nothing yet | Lifecycle stays unbuilt; private originals and legacy public objects are kept indefinitely; the final acceptance status stays **NOT PASSED** |
| P1 + P2 + B1 approved with periods and roles | Lifecycle, reconciliation and redaction are built and tested; staging checklist `BUSINESS_MEDIA_STAGING_CHECKLIST.md` gains the deletion gates |
| A hold applies to deleting accounts | Account deletion must pause for held users; the user-facing "deletion in progress" state then needs wording |

## Decision index (added 2026-10-19, second pass)

Every row is **UNRESOLVED**. "Safe default" is what the system does today while the row stays blank; nothing below is an approval. Option labels are those used above.

| ID | Question | Options (as documented) | Evidence-backed recommendation | Counsel? | Blocks | Safe default now |
|---|---|---|---|---|---|---|
| P1.1/P1.2/P1.5 | Redact path + uploader id from audit rows at account deletion? | keep / redact (draft: redact at deletion, via logged dry-run-first job) | Redact: the path embeds the uploader id, so keeping it defeats account deletion | No (owner) | audit-redaction migration + job | Keep everything; privacy text must say so |
| P1.3 | Retention of remaining audit rows | blank | None: no period may be invented | **Yes** | scheduled purge job | Keep indefinitely |
| P1.4 | Stop writing the raw path in the audit RPC? | pseudonym / nothing / keep | Pseudonym or nothing | No | RPC migration | Raw path still written |
| P1.6 | Any legal duty blocking redaction? | n/a | n/a | **Yes** | P1.1/P1.5 | No redaction |
| P2.1 | Retention of private original, approved image | period blank | None | No (owner), counsel if tied to disputes | deletion executor schedule | Keep indefinitely |
| P2.2 | Retention of private original, rejected/held | period blank, shorter than P2.1 | None | No | same | Keep indefinitely (`REJECTED_ORIGINAL_POLICY=retain`) |
| P2.3 | May suspected-illegal material ever be auto-deleted? | n/a | Do not auto-delete until answered | **Yes** | rejected-original deletion | Retain |
| P2.4 | Legal hold: who sets/releases, scope, audit | roles undefined | Hold overrides all deletion; named roles only | **Yes** (roles may be owner) | hold flag, every cleaner | No hold concept exists; nothing is deleted anyway |
| P2.5 | Private originals deleted on account deletion? May a hold apply to a deleting account? | draft: yes unless hold | n/a | **Yes** | account-deletion R2 step | Originals kept after deletion (known gap) |
| P2.6 | What the completed deletion record may keep | draft: job id, count, times, outcome | Accept draft | No | ledger schema | n/a |
| P2.7 | Retry cadence and escalation recipient | draft: 5 attempts, 2^n min cap 6 h, then `escalated`; recipient unnamed | Accept cadence; owner must name recipient | No | executor | n/a |
| B1 | Approve 0055 ledger and extend it to R2 | approve / change | Approve (needed by everything above) | No | whole lifecycle, 0054 | Ledger covers Supabase verification docs only |
| B2/B3 (0054) | Staff access and retention for storefront docs | see `STOREFRONTS_0054_OWNER_DECISIONS.md` | n/a | B3 **yes** | 0054, therefore 0057, 0058 | 0054 not applied, so 0057/0058 cannot be applied |
| W | No watermark on logos/banners; held = not published | approve / change | Approve | No | none (already built) | As built |
| H | Held legitimate logos | (a) staff review queue, (b) narrower business word list, or neither | (a): it keeps the safety rule intact; (b) weakens it | No | review-queue build | Held images are never published |
| L | Legacy images that are rejected/held/missing | leave / ask owner to re-upload / hide | Leave + report until H exists | No | backfill follow-up | Report only, original record untouched |
| T | Native review of so/am wording | n/a | Needed before claiming review | No | localization sign-off | First-pass text, unreviewed |
| AV | Bring avatars into the scan pipeline (scope expansion) | see `BUSINESS_MEDIA_AVATAR_MITIGATION.md` | Yes, as a follow-on release | No | avatar fix | Avatars unscanned, unpinned host |

**Counsel questions, exactly:** (1) P1.3: what is the minimum and maximum period for retaining staff-access audit rows that no longer identify a user? (2) P1.6: is there any statutory, contractual or incident-response duty requiring those rows to keep the uploader id? (3) P2.3: when Vision flags suspected-illegal material, are we required to preserve and/or report it, and for how long? (4) P2.4: who may lawfully place a hold? (5) P2.5: may a hold prevent deleting a user's data after a deletion request?

Independent work that does not wait for any row above: scanner hardening, host pinning, backfill safeguards, avatar mitigation plan, staging runbook.
