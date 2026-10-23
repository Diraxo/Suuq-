# Decision-resolution packet (2026-10-19)

**Purpose:** put every open decision in one place so the owner can answer in one pass. **Docs only.** No code, configuration, infrastructure, database or production change was made. **Nothing here is approved.** Status 2026-10-19: no owner or counsel confirmation has been supplied in the conversation or in a written approval record, so no approval cell was filled. Every "Owner decision" and "Approver" cell is blank on purpose; a proposed default is not consent.

Sources (questions are quoted verbatim from them): `STOREFRONTS_0054_OWNER_DECISIONS.md` (OD), `STOREFRONTS_0054_DECISION_SHEET_2026-10-19.md` (DS), `BUSINESS_MEDIA_DECISION_REQUEST.md` (BM), `MOBILE_AUDIT_BUNDLE_TRACE_2026-10-19.md`, `OFFLINE_RELEASE_AUDIT_2026-10-19.md`, `MEDIA_STAGING_RUNBOOK.md`, and migration `0054_storefronts.sql` (read at lines 473-504). This is a technical brief, not legal advice.

## How to read this

Each decision is tagged with who can lawfully/practically decide it:

- **OWNER**: product owner decides alone.
- **OWNER + COUNSEL**: needs qualified local counsel before approval. The engineering side cannot supply the answer.
- **NAMED PERSON**: needs a real person or designated role with a real contact route. Do not invent one to complete a checklist.
- **STAGING**: not a decision; needs evidence from an environment that does not yet exist.

---

## Part 1: Owner can decide alone

### B1.1 Ledger-first account deletion (OWNER)
- **Question:** "Is the ledger-first approach approved?"
- **Options:** approve as built (migration 0055) / change.
- **Proposed default:** approve. Job row is written before any file is touched; no FK to the user.
- **Consequence:** approve: owners who delete an account see their verification documents removed first. Change: 0055 and `delete-account` need rework.
- **Owner decision:** ____________  **Approver / date:** ____________

### B1.2 Retry cadence (OWNER)
- **Question:** "Retry cadence and the failure count that escalates"
- **Proposed default:** 5 attempts, backoff 2^n minutes capped at 6 h (parameters, `account_deletion_finish(p_max_attempts)`).
- **Consequence:** a stuck deletion can take hours before a human is needed.
- **Owner decision:** ____________  **Approver / date:** ____________

### B1.4 Wording while deletion is incomplete (OWNER)
- **Question:** "What the user is told while cleanup is incomplete"
- **Proposed default:** the user is told deletion is underway and is not promised a completion time the system cannot guarantee. Exact wording is **not written**. The state must never read "deleted" while any object remains (OD, B1 step 4).
- **Needed from you:** final text, in English; Somali and Amharic need native review (see T).
- **Owner decision (text):** ____________  **Approver / date:** ____________

### B1.5 What may remain in the audit trail after deletion (OWNER, retention part goes to counsel, see P1.3)
- **Question:** "Which fields may remain in the audit trail after deletion (no document paths proposed)"
- **Proposed default:** job state, retry metadata, timestamps; no FK to the user (DS). Document paths are proposed not to remain (corrected from an earlier line that listed object paths for the ledger; the ledger and the audit log are different tables). BM P2.6 proposes the stricter "job id, object count, timestamps, outcome; no user id, keys or file names" once a job completes.
- **Conflict, now stated consistently across B1.5, B2.4, P1.1, P1.2, P1.4, P1.5, P1.6:** AS BUILT TODAY: `admin_authorize_verification_document` still writes the document path (it contains the uploader's user id) into `admin_audit_log.metadata`, and those rows survive account deletion. Nothing has been removed or redacted; no redaction job has run. Any 'no document paths' wording is a proposal only. Safe default while blank: raw path keeps being written, nothing is redacted.
- **Owner decision:** ____________  **Approver / date:** ____________

### B2.1 Signed-URL expiry (OWNER)
- **Question:** "Keep 120 s expiry?"
- **Proposed default:** yes unless staging shows a usability problem.
- **Consequence:** reviewers must open within 2 minutes or re-request (each re-request writes another audit row).
- **Owner decision:** ____________  **Approver / date:** ____________

### B2.2 Which roles may view documents (OWNER; the role mapping is the owner's, the principle is a recommendation)
- **Question:** "Which roles may view? (today: admin only; moderator/support denied)"
- **Proposed default:** only roles explicitly granted `business_review`. In migration 0054, `staff_can('business_review')` is reachable **only through admin**; moderator and support are excluded.
- **Consequence:** widening it means a new migration revising `staff_can`; narrowing below admin is not possible without the same.
- **Needed from you:** the exact roles, by name, that may open verification documents.
- **Owner decision:** ____________  **Approver / date:** ____________

### B2.3 Reason / case reference per view (OWNER, with an operational check)
- **Question:** "Is a reason/case reference required per view?"
- **Options:** (a) yes, required and stored in the audit row; (b) no.
- **Fact from the migration:** the audit reason is currently a fixed string, `'Opened one verification document'`. Option (a) therefore needs an RPC change (new parameter, minimum length, as decisions already require >= 10 chars) **and** a UI field in `/admin/businesses`.
- **Operational question for you:** will reviewers realistically type a reason on every view, and is that approved?
- **Owner decision:** ____________  **Approver / date:** ____________

### B2.4 Audit row contents and path handling (OWNER; retention period goes to counsel)
- **Question:** "Audit row contents (staff id, request, document, time; no document contents) and how long audit rows are kept"
- **Fact from the migration:** `admin_authorize_verification_document` writes `jsonb_build_object('request_id', r.id, 'path', p_path)`. The path contains the uploader's user id, and these rows survive account deletion. This contradicts the B1.5 line above.
- **Options (BM P1.4/P1.5):** going forward: raw path / salted pseudonym / nothing. History: keep / hash / drop. Any redaction must run as a logged, dry-run-first job with before/after counts, never a silent edit.
- **Proposed default:** keep the event (that access happened, action, time, outcome, acting staff id); do not retain the raw path or uploader id when not needed for accountability. The request id already identifies which request was viewed while it exists.
- **Design note for the accountability question:** a pseudonym keeps the ability to say "document X was opened N times" without naming the user; "nothing" loses per-document evidence. The owner chooses.
- **Owner decision (forward):** ____________  **(history):** ____________  **Approver / date:** ____________

### P1.1 / P1.2 / P1.5 Redact audit rows at account deletion (OWNER)
- **Question:** "When an account is deleted, should the document path and uploader id be removed from existing audit rows?" / "When does that redaction run?" / "Existing rows already containing paths: keep, hash, or drop?"
- **Proposed default:** yes; at account deletion; redact through a logged job.
- **If keep:** nothing is built and the privacy policy text must say user ids and paths remain in staff audit rows.
- **Owner decision:** ____________  **Approver / date:** ____________

### P1.4 Stop writing the raw path (OWNER)
- Same as B2.4 forward decision. Proposed: pseudonym or nothing. **Owner decision:** ____________

### P2.6 What a completed deletion record may keep (OWNER)
- **Proposed default:** job id, object count, timestamps, outcome; no user id, keys or file names.
- **Owner decision:** ____________  **Approver / date:** ____________

### B1 (ledger scope) Extend 0055 to R2 (OWNER)
- **Question:** "Approve (or change) the account-deletion ledger in 0055" (BM). Today 0055 covers Supabase verification documents **only**; R2 logos/banners/listing derivatives on account deletion are best effort and unledgered.
- **Proposed default:** approve, and extend it to R2 (needed by everything in P2).
- **Owner decision:** ____________  **Approver / date:** ____________

### W Watermark and "held" meaning (OWNER)
- **Question:** "Business media: no watermark on logos/banners; 'held' means not published"
- **Proposed default:** approve as built (a watermark would deface a brand logo).
- **Owner decision:** ____________  **Approver / date:** ____________

### H Held legitimate logos (OWNER)
- **Options:** (a) staff review queue for held business media; (b) narrower business-specific word list; (c) neither.
- **Evidence-backed recommendation (BM):** (a), it keeps the safety rule intact; (b) weakens it.
- **Safe default now:** held images are never published (a logo containing e.g. "marketplace", "amazon", "jiji" is held and cannot be published).
- **Owner decision:** ____________  **Approver / date:** ____________

### L Legacy images that are rejected / held / missing (OWNER)
- **Options:** leave as is / ask owner to re-upload / hide the image. Recommendation: leave and report until H exists.
- **Owner decision:** ____________  **Approver / date:** ____________

### AV Avatars into the scan pipeline (OWNER)
- Scope expansion, see `BUSINESS_MEDIA_AVATAR_MITIGATION.md`. Recommendation: yes, as a follow-on release. Today avatars are unscanned.
- **Owner decision:** ____________  **Approver / date:** ____________

### First-launch scope items still marked proposed (OWNER)
OD "First-launch scope decisions": PDF uploads on web (keep, mobile image-only); web opening-hours editor deferred; staff suspension without a verification request deferred; existing-seller migration and communication plan (S8) before any visibility change. **Rollout consequence the owner should see:** migration 0054 backfills draft storefronts and the mirror clears `profiles.business_*` for existing business owners, so deployed clients show no business section until the owner publishes.
- **Owner decision:** ____________  **Approver / date:** ____________

---

## Part 2: Needs a named person or role (do not invent)

### B1.3 / P2.7 Who is notified on a stuck (escalated) deletion
- **Question:** "Who is notified on a stuck deletion?" / "Failed deletion: retry cadence and who is told when it gives up?"
- **Fact:** **no recipient is wired.** Without one, stuck deletions are visible only by someone running `account_deletion_report()`.
- **What is needed:** a real person or designated role, plus the contact route (email, channel, pager) and the expected response time. This is an operational commitment, not a coding choice.
- **Also decide:** what the responder is expected to do (requeue via `account_deletion_requeue`, investigate, escalate to the owner).
- **Named person / role:** ____________  **Contact route:** ____________  **Approver / date:** ____________

### B2.2 (staff side) and "log reviewers"
- OD proposes "Designated authorized personnel; log access itself restricted" as reviewers of the audit log. Name the role(s): ____________

### P2.4 Who may place and release a legal hold
- Roles are undefined. The owner may name the role; whether that role may lawfully do so is a counsel question (see Part 3).
- **Named role:** ____________  **Approver / date:** ____________

---

## Part 3: Needs counsel (cannot be answered by engineering or by the owner alone)

Counsel's questions, exactly as written in BM:

1. **P1.3:** what is the minimum and maximum period for retaining staff-access audit rows that no longer identify a user?
2. **P1.6:** is there any statutory, contractual or incident-response duty requiring those rows to keep the uploader id?
3. **P2.3:** when Vision flags suspected-illegal material, are we required to preserve and/or report it, and for how long?
4. **P2.4:** who may lawfully place a hold?
5. **P2.5:** may a hold prevent deleting a user's data after a deletion request?

Decisions that wait on them:

| ID | Item | Proposal (NOT approved) | Safe default while blank |
|---|---|---|---|
| P1.3 | Retention of remaining audit rows | **no period may be invented** | keep indefinitely |
| P1.6 | Legal duty blocking redaction | n/a | no redaction |
| P2.3 | May suspected-illegal material ever be auto-deleted | do not auto-delete until answered | retain (`REJECTED_ORIGINAL_POLICY=retain`) |
| P2.4 / B3 | Hold: who sets/releases, per user or per object, audited how | hold wins over scheduled deletion | no hold concept exists |
| P2.5 | Private originals deleted on account deletion; hold on a deleting account | yes unless hold | originals kept after deletion (known gap) |

### B3 retention policy: every row is open (OWNER + COUNSEL)
Quoted from OD. Periods are proposals from `STOREFRONTS_0054_HARDENING.md`, not approvals.

| Item | Proposal (NOT approved) | Decision | Approver / date |
|---|---|---|---|
| Unattached files | delete after 7 days, after dry-run review | | |
| Rejected | keep through appeal window (suggest 30 days), then delete | | |
| Approved | keep while verified + tail (suggest 90 days after revocation/deletion) | | |
| Account deleted | delete files, keep minimal audit | | |
| When each clock starts and resets (upload, submit, decision, re-apply, revocation) | **not defined** | | |
| Who may place / release a hold; how audited | **not defined** | | |
| Hold vs scheduled deletion conflict | hold wins (proposal) | | |
| Minimal audit metadata kept after deletion | **not defined** (ties to B1.5, B2.4, P1) | | |
| Failed deletion retry and escalation | see B1.2, B1.3 | | |

Rule to keep: **no cleaner is activated until this table is approved.** Suspected-illegal material may carry preservation or reporting duties that forbid automatic deletion.

### P2 Retention of private originals (OWNER, counsel for the legal rows)

Covers `orig/`, `orig-media/`, `pending/`. **All periods blank; none invented.**

| ID | Question (verbatim) | Draft default | Owner / counsel decision |
|---|---|---|---|
| P2.1 | How long is the private original of an **approved** image kept? | delete once no longer needed for moderation or disputes; period blank | |
| P2.2 | How long is the private original of a **rejected or held** image kept? | shorter than approved; period blank | |

To define before cleanup is implemented (as the review note requires):
- **Retention duration:** per class (approved / rejected / held / unattached `pending/`).
- **Hold exceptions:** per P2.3-P2.5 above.
- **Deletion and retry behaviour:** reuse the 0055 ledger shape (durable intent row first, idempotent delete where a missing object counts as done, 5 attempts with 2^n-minute backoff capped at 6 h, then `escalated`, lease/crash recovery, "completed" only when every object is confirmed gone). Escalation recipient: see B1.3.
- **Reconciliation:** report-only first; an R2-only object is deleted only after the class period elapses and no hold applies.

**Consequence of leaving P2 blank:** private originals (including EXIF/GPS) are kept indefinitely, including after account deletion, and the scan rows naming them cascade away with the profile so the originals become orphans. This is the confirmed open gap in `OFFLINE_RELEASE_AUDIT_2026-10-19.md`, and it means **account deletion is not complete for media** at release. It also contradicts any "your data is deleted" statement in the privacy policy unless the policy says otherwise.

---

## Part 4: Open risks that are not decisions

### R-DL Deep-link denial-of-service (`decode-uri-component` 0.2.2)
- **Evidence:** `query-string/index.js` and `decode-uri-component/index.js` are in the real Android bundle (sourcemap, 2,319 modules). `query-string.parse` is called from `expo-router/build/react-navigation/core/getStateFromPath.js:499`, the URL-to-navigation-state path, and the app registers scheme `suuqplus`.
- **Not demonstrated:** end-to-end exploit; nothing was run on a device. Impact if it works: hang/crash of the app that opens the link; no data exposure.
- **Options:** (1) accept with a written note (moderate, DoS only); (2) schedule the compatible `expo-router` upgrade in a separate branch with regression tests for valid and malformed deep links (the npm fix is `expo-router` 58, semver-major, a framework upgrade).
- **Recommended wording until resolved:** "known, unfixed, not proven exploitable." Do not describe it as harmless or fixed.
- **Not covered:** native (Gradle) dependencies; the `web/` package.
- **Owner decision:** ____________  **Approver / date:** ____________

### S-STG Staging and emergency-stop validation (STAGING, blocked)
- **Why blocked:** no staging Supabase project (free-project limit of 2 reached), no Cloudflare login/token, no Vision key, no Docker.
- **Unverified in any deployed environment:**
  - `R2_PRESIGN_DISABLED` kill switch (runbook gate G-7 / evidence E-8): with it set, presign for `avatars/<uid>`, `business/<uid>/logo` and `listings/<uid>` must all fail; without it, the first two stay refused and listings follow `legacy_presign_closed`.
  - The scanner Worker's **independent** stop (runbook U-4(c): "stop the Worker (disable route)"): expected `offline`/`unavailable` with no public object and no saved row.
  - Account deletion including private-original cleanup. This depends on P2, so it **cannot be tested until P2 is approved and built**.
  - Also gated: B2 audit-failure behaviour (S9; no URL on audit failure), signed-URL expiry (S3), ledger drain (S7b), Storage controls (S1/S2), public-view security (S4/S5).
- **Production fact to keep visible:** deployed `r2-presign` (v10) is OLDER than the committed source (no listing, business or avatar gates). Redeploying any older version reopens direct public-bucket uploads. Production migrations 0046-0059 are not applied.
- **What staging needs from the owner:** a place to run it (a paid or second Supabase project, or removing "DAwa's Project"), a Cloudflare account/token, and a Vision key. These are decisions with cost attached.

### T Somali and Amharic wording (OWNER, needs a native speaker)
First-pass translations exist for the eight upload messages and storefront strings; they are unreviewed. B1.4's wording will need the same.

---

## Part 5: Approval record (blank)

| Blocker | Approver (name/role) | Decision date | Changes from proposed defaults |
|---|---|---|---|
| B1 | | | |
| B2 | | | |
| B3 (with counsel) | | | |
| P1 audit retention | | | |
| P2 private-original retention | | | |
| Business media (W, H, L, AV) | | | |
| Deep-link risk R-DL | | | |
| Escalation recipient (B1.3 / P2.7) | | | |

## What happens after you answer

1. The engineer copies approved rows into the approval tables of `STOREFRONTS_0054_OWNER_DECISIONS.md` (B1-B3, P1, P2) and into `BUSINESS_MEDIA_DECISION_REQUEST.md`.
2. Then, and only then: new migration for the audit RPC (B2.3/B2.4/P1.4) and a logged redaction job; B1.4 copy; R2 deletion lifecycle against the approved periods; escalation wiring to the named recipient.
3. Then staging gates, with disposable data and raw output captured. PGlite results do not count as staging evidence.
4. Rows left blank stay at their safe defaults: nothing is redacted, nothing is auto-deleted, no recipient is wired, 0054 stays unapplied.
