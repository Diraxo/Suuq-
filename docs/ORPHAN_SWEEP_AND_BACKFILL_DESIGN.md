# Orphan-derivative sweep and legacy-photo backfill: design

Written 2026-10-17. **Status: design only.** Nothing here is built, applied, run or scheduled. No application code, migration or config was changed to write this. Proposed windows and numbers are **for the owner to approve**; none is a decision.

Companions: [cost and resource plan](STAGING_COST_AND_RESOURCE_PLAN.md), [verification checklist](STAGING_VERIFICATION_CHECKLIST.md).

**Standing rules for both designs**
1. Dry-run is the only mode until written approval to enable deletion, per environment.
2. Nothing is deleted on a single signal. An object must be unreferenced by every reference source (§2), older than the grace period, and unreferenced again at action time.
3. Deletion is two-stage: **quarantine** (restorable) then **delete** after a second grace.
4. Every run and every item is written to an audit log (§5). No audit row, no action.
5. Anything with a legal hold, or connected to a report or evidence record, is excluded unconditionally.

---

## Part A: Orphan sweep

### 1. What can become orphaned (from the code)

| Class | Key shape | Bucket | How it orphans |
|---|---|---|---|
| A1 Public derivative never published | `wm/listings/{uid}/{listingId}/{uuid}.jpg` | public | Worker writes the object in [pipeline.ts](../workers/image-scan/src/pipeline.ts) step 6 **before** `saveResult` (step 7). If `saveResult` fails, the object exists with **no database row at all**. Also: seller abandons the draft, rescans (new `{uuid}` each time), or never publishes. |
| A2 Superseded derivative | same | public | Seller replaces/removes a photo on edit; the client's best-effort `deleteR2Assets` fails silently or the app is closed. |
| A3 Held copy never promoted | `pending/wm/listings/…` | private | Staff rejects or ignores a held photo; or the listing is deleted. |
| A4 Original without a row | `orig/{uid}/{listingId}/{sha}.bin` | private | `listing_scan_images.source_key` is nulled by retention (and the object never deleted: nothing deletes it today) **or** the row cascades away. |
| A5 Legacy upload never referenced | `listings/{uid}/{draft}/{uuid}.jpg` | public | Old/legacy path: draft abandoned, photo removed, mobile abandoned-derivative cleanup was never built. |
| A6 Account-deletion leftovers | all of the above | both | See finding F1 below. |

Out of scope for v1: replaced avatars and business logo/banner, legacy `chat/` objects. Add later with their own reference sets.

### 2. Findings that change the design (read from code, not run)

* **F1: account deletion likely leaves derivatives and originals behind.** [delete-account](../supabase/functions/delete-account/index.ts) only deletes keys accepted by `isKeyForKind`, whose `listing` pattern is `^listings/{uid}/…`; keys under `wm/listings/…` fail that check and are **skipped** (not deleted). Nothing in it touches `orig/` or `pending/`. And `listing_scans` has `user_id … on delete cascade`, so the rows that record `orig/` keys vanish with the profile, orphaning those objects with no index to find them. A deleted user's marked photos and private originals could therefore remain in R2. Needs confirming in staging (checklist). **This is a data-erasure issue independent of the sweep and should be fixed in its own change.**
* **F2: the Worker has no way to list or delete in bulk.** There is no list operation on its storage adapter; the retention purge returns keys to delete but no consumer exists. The sweep needs a *read-only* listing capability and a *separate* delete path.
* **F3: drafts are long-lived on the device.** The mobile draft is persisted ([store/postDraft.ts](../store/postDraft.ts), AsyncStorage). A seller can resume a draft weeks later, holding a derivative URL whose scan row may be old. Deleting that object means the later publish succeeds (the trigger checks the scan *row*, not that the object exists) and the listing shows a dead image.
* **F4: service-role writes bypass the publish gate** (`is_client_write()` returns false), so a privileged backfill needs no scan row to write `images`. It should still create one for audit (Part B).
* **F5: no object-listing credential is provisioned.** R2 list access must be a separate read-only token, not the presign token.

### 3. Reference sources: an object is live if ANY of these points at it

Reference check is by full-table membership (unnest and compare), never by per-listing assumption: legacy keys are freely shared, and `listing_scan_images` has a unique index on `public_url` only for scanned derivatives.

| Ref | Source | Condition |
|---|---|---|
| R1 | `listings.images[]` (URL) and `listings.image_public_ids[]` (key) | **every** listing regardless of status (`available`, `reserved`, `sold`, `expired`) and including moderation-hidden / held listings. A hidden listing can be restored. |
| R2 | `listing_scan_images.public_url` / `public_key` | scan not older than the draft TTL (§4), or `review_status in ('pending','replacement_requested')`, or listing exists |
| R3 | `bulk_import_rows.image_urls` | row status in `queued, processing, ready, ready_review, needs_changes`, or `failed` while retries/seller retry are possible |
| R4 | `listing_scan_images.source_key` | any non-null value is live for the retention window |
| R5 | Moderation/report records that quote an image (reports, appeals, evidence) | always live; excluded entirely |
| R6 | `profiles.avatar_url`, `business_logo_url`, `business_banner_url`, `messages.images` | for the classes in scope that can collide (legacy `listings/` only if a profile/message points there) |
| R7 | Legal hold (`legal_hold` flag, **not yet designed in schema**) | always live; excluded unconditionally |

### 4. Candidate rules and grace periods (proposed; owner to approve)

An object is a **candidate** only when all hold:
1. Key matches a known class pattern (A1–A5). Unknown shapes are reported, never acted on.
2. Object `LastModified` older than **G1**.
3. No reference in R1–R7 at snapshot time **and** again immediately before action (§7).
4. Owner's account exists or is deleted but the object is older than G1 (deleted-account leftovers are the easiest true orphans, F1).

| Parameter | Proposed value | Reason |
|---|---|---|
| **G1** minimum object age | **30 days** | Covers worst-case Worker runtime, client retries, offline publish, and delayed DB writes by a wide margin |
| **Draft TTL** (scan rows still protecting their derivatives) | **60 days**, or longer than the client's draft lifetime, whichever larger | F3. A client change (re-scan a draft whose scan is older than TTL) is a prerequisite and is **not built** |
| **Q** quarantine period | **14 days** | Wrongly quarantined object is restorable; users have time to hit a broken image and surface the bug |
| `pending/` copies | not swept while `review_status` is `pending`/`replacement_requested`; otherwise as A3 with G1 | Staff may take weeks |
| `orig/` | **not swept by this job**: governed by the retention policy in Part A §6 | Different purpose and legal exposure |

### 5. Audit log (proposed schema, not applied)

```sql
-- PROPOSAL ONLY. Not a migration.
storage_sweep_runs (
  id uuid pk, started_at, finished_at, mode text check (mode in ('dry_run','quarantine','delete')),
  environment text, params jsonb,          -- G1, draft TTL, Q, class filter
  scanned int, candidates int, quarantined int, deleted int, restored int, errors int,
  approved_by uuid, approval_note text, report_hash text)
storage_sweep_items (
  run_id uuid, bucket text, key text, class text, size bigint, last_modified timestamptz,
  decision text,                           -- 'keep:referenced:R1' | 'candidate' | 'quarantined' | 'deleted' | 'restored' | 'error'
  reason text, references jsonb, acted_at timestamptz,
  primary key (run_id, bucket, key))
```
Staff-readable only (RLS), service-role-writable only, append-only. `deleted` rows are never removed. Items record **why** an object was kept, so a "why wasn't this deleted?" question has an answer.

### 6. Retention for private originals (links to cost plan §8; decision 4)

Not the orphan sweep, but it must exist before real photos:

| Item | Proposal |
|---|---|
| Ordinary reject `orig/…` | delete **30 days** after the scan (already the config default `evidence_retention_days`) |
| Legal hold | `legal_hold` column on `listing_scan_images` exempting it from purge **and** from any sweep; set by an authorised staff role only, with reason, audited |
| Purge consumer | a job that deletes the R2 objects `purge_scan_evidence()` nulls, **writes an audit row**, and retries failures; today nothing consumes the returned keys |
| `pending/` and `image_hashes` | covered by the same window or a documented exception |
| Suspected illegal material | outside engineering's remit: counsel decides preservation, deletion and reporting. The sweep and purge simply must never touch held items. |
| Access | Worker binding + staff-only RLS; periodic access review (checklist §7) |

### 7. Concurrency protections (the part that makes it safe)

| Hazard | Protection |
|---|---|
| Publish in flight (object written, row not yet saved, listing not yet inserted) | **G1 = 30 days** dwarfs any realistic window; an object younger than G1 is never examined |
| Delayed DB write after the snapshot | **Re-check at action time**: for each candidate, re-run R1–R7 immediately before quarantine **and** immediately before delete; any reference found → `decision = keep:late_reference`, logged |
| Draft resumed after long idle (F3) | Draft TTL protects the scan row's derivatives; deletion only after TTL; client rescan-on-stale prerequisite |
| Shared references | full-table unnest, not per-listing assumption; an object referenced by two rows is live if either is |
| Sweep racing itself | advisory lock / single `running` row in `storage_sweep_runs`; second run refuses |
| Sweep racing retention purge and bulk drain | the sweep takes the same lock; it skips any key whose scan is in `processing`; bulk rows in R3 states are live |
| Wrongly deleted | quarantine first: copy to `quarantine/{run}/{key}` (private), then delete from public; restore = copy back, same key, same URL. Delete only after Q days and a second re-check |
| Cache / shared links | quarantine removes the public object; CDN-cached copies may linger or 404 inconsistently. Q covers cache TTL; check the bucket's cache headers in staging |
| Operator error / wrong environment | environment recorded in the run; refuses unless the Worker/DB env tags match; `--dry-run` default |
| Partial failure | idempotent per item; interrupted run resumes by item state; never "delete all in list" without per-item recheck |
| Runaway | per-run caps (max items quarantined, max % of bucket) → abort and alert |

### 8. Dry-run output (what the owner reviews)

A report, no side effects: total objects by class; candidates by class, age and size; **top reasons objects were kept**; unknown-pattern keys; candidates belonging to deleted accounts; estimated bytes; a random sample of ~50 candidates with their full reference-check trace for human spot-check; and a "would-have-hit" list for anything referenced by R5/R7. Run on **staging first** with seeded orphans (§9), compare to known truth, then production dry-run only with approval.

### 9. Staging validation (cannot be skipped)

Seed known cases and confirm classification: published photo (kept); replaced photo (candidate after G1); draft within TTL (kept); draft beyond TTL (candidate); held `pending/` awaiting review (kept); bulk `ready` row (kept); object shared by two rows (kept); deleted-account leftover (candidate); unknown key shape (reported, untouched); legal-hold item (untouched); an object whose reference appears **between** snapshot and action (kept via late re-check). Use backdated `LastModified` or a shortened G1 on staging only.

### 10. Recovery

Restore from `quarantine/` by copying back to the original key (listed in the audit log); verify with the checklist inspector; record `restored`. After final delete there is no recovery: that is why deletion needs its own explicit approval and the second re-check. A bad run is stopped by lowering the per-run cap to 0 or disabling the job.

### 11. Approvals to turn it on (all separate)

1. Design approved (this). 2. Schema + code built and tested locally (PGlite for reference queries; Worker/adapter tests with fakes). 3. Staging dry-run reviewed. 4. Staging quarantine/delete reviewed. 5. Production **dry-run** only. 6. Production **quarantine** approved. 7. Production **delete** approved, with caps. Each approval names the parameters (G1, TTL, Q, caps).

---

## Part B: Backfill of existing unmarked photos

### 1. The honest scope question

Existing listings have unmarked photos at `listings/{uid}/…` in the public bucket. Re-pointing `listings.images` to marked copies protects **in-app display only**. The original unmarked object stays publicly fetchable at its old URL, to anyone who has it or scraped it, **until that object is removed**. So backfill without eventual removal is mostly cosmetic. Removal breaks old shared links, cached OG images and push-notification images. That trade-off is the real decision.

| Option | Protects | Costs / risks |
|---|---|---|
| B0 Do nothing; keep viewer overlay | Display deterrent only | Free; unmarked bytes remain fetchable and GPS metadata may remain in them |
| B1 Re-derive, repoint, **keep** old objects | App display | Storage doubles; originals still public |
| B2 Re-derive, repoint, **quarantine then delete** old objects | App display and the public copy | Dead old links; needs notice and a rollback window |
| B3 Edge watermark-on-read for legacy keys (checklist §8 alternative) | All reads through that domain, no data movement | Per-view compute cost unknown; bytes at origin unchanged |

Recommendation for discussion, not a decision: evaluate **B3 versus B2** after M2. Both can coexist (B3 now as a shield, B2 later to clean up).

### 2. Inventory first (read-only, safe to approve early)

Report: number of listings and photos by status and age; photos referenced only by sold/expired listings (candidates to skip or let age out); listings with `image_public_ids` missing (web-era rows: keys must be derived from URLs by the same strict textual-prefix rule `delete-account` uses); URLs on non-bucket hosts (e.g. legacy Cloudinary) which are **not** ours to re-host without a decision; broken/0-byte objects (the existing [cleanup-r2-images.mjs](../scripts/cleanup-r2-images.mjs) already finds some, dry-run by default); total bytes; estimated scan cost.

### 3. Pipeline

1. **Select** active (`available`/`reserved`) listings only, newest or highest-view first; sold/expired are skipped or deferred.
2. **Fetch from our own bucket** by key (an internal read; no remote-URL fetch, so none of the bulk SSRF surface and no third-party copyright question).
3. **Process** through the existing normalise, watermark, verify and metadata-strip steps. Decide separately whether to also run Vision: ~US$3 per 1,000 photos at list price, **unreconciled**. Legacy photos were published without a scan, so scanning them is a moderation catch-up, but it will surface findings that need staff capacity and, for anything serious, counsel's process. Option: watermark-only first, scan later.
4. **Keep the original**: copy the legacy bytes to private `orig/…` before anything changes (also preserves the seller's own image). Subject to the same retention window as Part A §6.
5. **Write a scan record** with a new `source = 'backfill'` (the check constraint on `listing_scans.source` currently allows only `interactive`/`bulk`; a migration is needed) so the audit trail shows how each derivative came to exist. The publish trigger does not gate privileged writes (F4), so the backfill writes `images` and `image_public_ids` by service role in one statement per listing, index-aligned.
6. **Verify before swapping**: fetch the new public URL anonymously, run the independent inspector (mark present, upright, no metadata, size sane), only then update the row. Compare-and-swap on the previous `images` value so a seller edit made during the run is not clobbered.
7. **Retain the legacy object** untouched through the grace window. Under B2 it then enters the sweep as class "superseded", with the same G1/Q rules. Under B1 it is kept.

### 4. Protections

| Concern | Protection |
|---|---|
| Seller edits during backfill | compare-and-swap; skip and retry later on mismatch |
| Broken links | verify before swap; keep old object through the window; no deletion in the first approval |
| Rate and cost | queue with its own daily cap (like bulk 0051), kill switch, cost estimate in the dry run |
| Quality | pilot batch of N staging listings, owner eyeballs sample; then a small production cohort |
| Idempotence | per-photo state table; a re-run never double-marks (input is the legacy original, never a `wm/` file; assert key shape) |
| Failure | per-listing atomic; failure leaves the listing untouched and logged |
| Reporting | audit table analogous to §5, per photo: old key, new key, hashes, result, who approved |

### 5. Recovery

Until old objects are deleted, rollback is one statement per listing: restore the previous `images`/`image_public_ids` from the audit row. After deletion, recovery is from the private `orig/` copy, if the retention window has not expired. State this to the owner when approving B2.

### 6. Approvals

Inventory (read-only) → option choice B0/B1/B2/B3 → Vision-or-not decision → cost ceiling → schema (`source='backfill'`, audit table) → staging pilot → production pilot cohort → full run → (separately) any deletion of legacy objects. **Nothing is modified, deleted or republished until the plan is reviewed and approved.**

---

## Open questions for the owner

1. Draft TTL and whether the client should auto-rescan stale drafts (changes app code).
2. Appetite for deleting legacy public objects (B2) versus shielding on read (B3).
3. Vision on backfill or watermark-only first.
4. Who is the authorised staff role for `legal_hold`, and counsel's input on its semantics.
5. Whether F1 (account deletion leaving `wm/` and `orig/` objects) should be fixed now as a separate, small change, since it is an erasure problem regardless of everything else here.
