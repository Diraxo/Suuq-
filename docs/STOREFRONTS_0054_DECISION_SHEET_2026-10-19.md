# B1 / B2 / B3 decision sheet (2026-10-19)

For the owner (and local counsel for B3). Quotes are verbatim from `STOREFRONTS_0054_OWNER_DECISIONS.md`. **Nothing here is approved.** The approval record in that file is still blank and 0054 stays unapplied. This sheet changes no code.

"Existing business owners" = sellers who today have `business_*` fields on their profile and a public business section.

---

## B1: Account deletion

> **Question:** what must happen to verification documents when an account is deleted?
> **Recommendation: a durable deletion ledger with retryable cleanup.**

Steps as quoted: write the job row *before* touching any file, outside the cascade (no FK to `auth.users`); remove everything under `storefront-verification/<uid>/` before deleting the user; record a result per object, retry failures, escalate after N; "Never report deletion complete while any object remains"; keep only the minimum audit record B3 permits.

| # | Question (verbatim) | Proposed default (not approved) | Effect on existing owners |
|---|---|---|---|
| B1.1 | Is the ledger-first approach approved? | Yes. Built locally as 0055 | None until they delete an account. Then their verification documents are removed first and deletion shows as in progress until clean |
| B1.2 | Retry cadence and the failure count that escalates | 5 attempts, backoff 2^n minutes capped at 6 h (parameters, easy to change) | A stuck deletion can take hours and then needs a human |
| B1.3 | Who is notified on a stuck deletion? | **Owner must name a person/role.** No recipient is wired | Without a name, stuck deletions are visible only in `account_deletion_report()` |
| B1.4 | What the user is told while cleanup is incomplete | "Deletion in progress" (wording not written) | Users see a pending state, not "deleted" |
| B1.5 | Which fields may remain in the audit trail after deletion | Job state, retry metadata, timestamps; no FK to the user. Document paths: proposed NOT to remain, but the audit RPC still writes them today (see B2.4); not removed | Conflicts with current audit rows (see B2.4) |

Limits to keep visible: B1 covers **Supabase verification documents only**, not R2 images (logos, banners, listing photos).

**Decision needed from you:** B1.3 (a name) and B1.4 (wording). The rest can be accepted as proposed.

---

## B2: Staff access and auditing

> **Question:** how may staff view verification documents?
> **Recommendation: keep direct staff Storage access off; require the audited Edge Function.**

Code flow as quoted: staff JWT → `admin_authorize_verification_document(request, path)` (checks `business_review`, writes one audit row per document) → only then a service-role signed URL, 120 s. Audit failure returns an error and no URL. "Staging must prove this, not assume it."

| # | Question (verbatim) | Proposed default (not approved) | Effect |
|---|---|---|---|
| B2.1 | Keep 120 s expiry? | Yes unless staging shows a usability problem | Reviewers must open/download within 2 minutes or re-request (re-request writes another audit row) |
| B2.2 | Which roles may view? (today: admin only; moderator/support denied) | Only roles granted `business_review` | Moderators/support cannot review documents unless you widen it |
| B2.3 | Is a reason/case reference required per view? | Not decided | If yes, needs an RPC change and UI field |
| B2.4 | Audit row contents and how long audit rows are kept | Staff id, request, document, time, outcome; no contents. **Retention period blank** | **Discrepancy:** the RPC currently writes the document *path* (contains the uploader's user id) into `admin_audit_log.metadata`, and those rows survive account deletion. Decide keep / hash / drop |

**Decision needed from you:** B2.2 (who), B2.3 (yes/no), B2.4 (path handling + retention period).

---

## B3: Retention and legal holds

> **Question:** how long are documents kept, and what happens under a hold?
> **Recommendation: agree a written policy with the owner and qualified local counsel before any cleanup job exists. Do not activate a cleaner until it is approved.**

| Item | Hardening-doc proposal (NOT approved) | Effect on existing owners |
|---|---|---|
| Unattached files | delete after 7 days, after dry-run review | Abandoned uploads vanish; no effect on submitted requests |
| Rejected | keep through appeal window (suggest 30 days), then delete | Rejected owners have 30 days to appeal before documents go |
| Approved | keep while verified + tail (suggest 90 days after revocation/deletion) | Documents stay as long as the badge does |
| Account deleted | delete files, keep minimal audit | See B1 |
| When each clock starts and resets | **not defined** | Needed before any timer is coded |
| Who may place / release a hold; how audited | **not defined** | |
| Hold vs scheduled deletion | hold wins (proposal) | |
| Minimal audit metadata after deletion | **not defined** | Ties to B1.5, B2.4, P1 |

**Decision needed from you and counsel:** every "not defined" row, plus whether the periods above are acceptable. These are technical proposals, not legal advice. Suspected-illegal material may carry preservation/reporting duties that forbid automatic deletion.

---

## Related blanks that block the R2 cleanup build (from the same file)

- **P1** audit retention after deletion (period blank).
- **P2** private-original retention for `orig/`, `orig-media/`, `pending/` (period blank; rejected-image handling and holds undefined). The cleanup-with-retry build waits on this.
- Business media: confirm "no watermark on logos/banners" and "review = not published".

## What I can do without your answers

Nothing that changes behaviour. Once B1.3/B1.4, B2.2–B2.4, and B3 (with counsel) are answered, I will fill the approval record, then finish the R2 cleanup (retry and failure tests) against those numbers.
