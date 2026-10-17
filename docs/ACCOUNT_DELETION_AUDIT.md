# Account deletion: read-only audit and proposed fix plan

Written 2026-10-17. **Status: audit and plan only.** No code, migration, config or storage was changed, run or deployed to write this. Everything below is read from source and **unrun**; confirming it needs the isolated-staging steps in §8. Kept separate from the image-watermark rollout so each can be reviewed alone.

Related: [orphan sweep and backfill design](ORPHAN_SWEEP_AND_BACKFILL_DESIGN.md) (finding F1 originates there), [delete-account key validation proposal](../supabase/proposed/delete-account-key-validation.md).

## 1. Verdict

Account deletion removes the database rows reliably (hard-delete of `auth.users` cascades), but it **does not reliably remove stored photos**, and it **loses the record of which photos existed at the moment it deletes the rows**. Four independent gaps:

| # | Gap | Severity |
|---|---|---|
| G1 | Watermarked derivatives `wm/listings/{uid}/{listingId}/{uuid}.jpg` are skipped by the key validator | High once scanning is on; none today if scanning never ran |
| G2 | Private `orig/…` and `pending/wm/…` objects are never touched, and the rows that index them cascade away | High (likely the most sensitive material) |
| G3 | Deletion is best-effort and unrecorded: failures are only counted in a log line, keys are then unrecoverable | High |
| G4 | Retained copies elsewhere (report evidence, local device draft) are undecided / uncleaned | Medium; needs a policy decision |

## 2. Code path today (exact)

1. Mobile [lib/accountDeletion.ts](../lib/accountDeletion.ts) `deleteAccount()` invokes edge function `delete-account` (optionally with an Apple authorization code), then clears the local session. Web [web/src/services/accountDeletion.ts](../web/src/services/accountDeletion.ts) invokes the same function with no body.
2. [supabase/functions/delete-account/index.ts](../supabase/functions/delete-account/index.ts), in order:
   1. verify JWT via service-role `auth.getUser`;
   2. optionally revoke the Apple token (before anything is deleted, so a later failure leaves a still-existing account without its Apple link);
   3. read `profiles.{avatar,business_logo,business_banner}_public_id`, `listings.images`, `listings.image_public_ids`, and every `messages.image_keys` for `sender_id = uid`;
   4. validate each key with [`isKeyForKind`](../supabase/functions/_shared/accountKeys.ts) (owner-writable columns are not trusted); invalid keys are **skipped and counted**;
   5. delete the survivors from **one bucket, `R2_BUCKET_NAME`**, 25 at a time; failures counted in a log, never retried, never persisted;
   6. delete `rate_limit_events` rows;
   7. `auth.admin.deleteUser(uid)`, which cascades.
3. If any secret is missing the R2 step is skipped (logged) and deletion still proceeds.

Local state of the function file: it carries uncommitted changes and the key-validation fix is documented as **not deployed**. What is live on Supabase is unverified (see [production-migration status](../supabase/proposed/delete-account-key-validation.md)); inspect with `supabase functions list`/dashboard before assuming either version.

## 3. Inventory: every photo reference and storage location

Key formats come from [uploadPaths.ts](../supabase/functions/_shared/uploadPaths.ts) and [pipeline.ts](../workers/image-scan/src/pipeline.ts). "Cleaned today" is from the code above.

| Class | Key / reference | Bucket | DB reference (what indexes it) | FK on delete | Cleaned today |
|---|---|---|---|---|---|
| Avatar | `avatars/{uid}/{uuid}.jpg` | public | `profiles.avatar_public_id`, `avatar_url` | cascade | Yes, if DB column intact |
| Business logo / banner | `business/{uid}/(logo\|banner)/{uuid}.jpg` | public | `profiles.business_*_public_id`, `*_url` | cascade | Yes, same caveat |
| Legacy/draft listing photo | `listings/{uid}[/{draft}]/{uuid}.jpg` | public | `listings.image_public_ids` / `images` | cascade | Yes (also derived from `images` URLs for web-era rows) |
| **Watermarked derivative** | `wm/listings/{uid}/{listingId}/{uuid}.jpg` | public | `listings.image_public_ids`, `listing_scan_images.public_key/public_url`, `bulk_import_rows.image_urls` | cascade (scan rows) | **No: fails `listing` regex (G1)** |
| **Private original** | `orig/{uid}/{listingId}/{sha}.bin` | **private** | `listing_scan_images.source_key` (nulled by retention) | `listing_scans` → cascade | **No: wrong bucket, no code (G2)** |
| **Held derivative** | `pending/wm/listings/{uid}/{listingId}/{uuid}.jpg` | **private** | `listing_scan_images.public_key` while `review_status = pending` | cascade | **No (G2)** |
| Scan orphans (no row) | any of the above | both | none (Worker writes object before the row; failure leaves no row) | n/a | **No, and unfindable by DB** |
| Legacy chat photo | `chat/{conv}/{uid}/{uuid}.jpg` | public | `messages.image_keys` (`sender_id`) | cascade | Yes (sender only) |
| Bulk CSV source URLs | third-party URLs in `bulk_import_rows.photo_urls` | external | n/a, never copied | cascade | Nothing stored by us |
| Perceptual hashes | `image_hashes` (phash, sha256) | DB | `user_id` | cascade | Rows deleted; see §5 |
| Report evidence snapshot | up to 10 image URLs, `owner_id`, name, `avatar_url` in `report_admin.evidence` | DB (+ the objects) | `report_id` → `reports`, **not** the reported user | reports **against** the user are not removed | **No: retained up to 24 months (G4)** |
| Local device | persisted post draft `suuqplus.postDraft.v1` + draft photos | device | n/a | n/a | **Not reset on delete (G4)** |
| CDN / cached copies | public URLs | edge cache | n/a | n/a | Out of our control; depends on cache headers |

Notes:
* `isOwnedKey` (used by `r2-delete`) already accepts `wm/listings/{uid}/{listingId}/…`, but `accountKeys.ts` does not. The two validators have **drifted**; a test asserts agreement only for the kinds `accountKeys` knows.
* `delete-account` talks to one bucket via one credential. The private bucket (`suuqiye-private` in the Worker config) is only bound inside the image-scan Worker; the edge function has no way to reach it.
* Deleting an ordinary listing (not the account) has the same gap for `wm/` and `orig/`; that is the same code family but out of scope here.

## 4. Why the failures matter (concrete scenarios, unrun)

* **G1:** seller publishes through the scan path; `image_public_ids` holds `wm/listings/…` keys; deletion validates them as `listing` kind, fails the regex, increments `r2_keys_skipped`, deletes nothing. Public URLs keep serving the photo after "account deleted".
* **G2:** `orig/` objects stay in the private bucket; with `listing_scan_images` cascaded away there is no remaining index of their keys. Only a bucket listing can find them.
* **G3a:** a transient R2 error on 3 of 40 keys is logged as `failedCount: 3` and the cascade then destroys the only record of those keys.
* **G3b:** `deleteUser` fails after R2 deletion succeeded: the account still exists with dead images, and a retry has no keys to retry.
* **G3c:** a very large account can exceed the function's execution limit mid-way; there is no resume.
* **G3d:** the Apple token is revoked before the rest runs, so a later failure leaves a half-detached account.
* **Missing secrets** silently skip R2 cleanup yet report `{ success: true }` to the user.

## 5. Deletion and legal-hold rules (proposed; owner and counsel to decide)

Principle: ordinary deletion removes everything we are not **affirmatively obliged** to keep; a hold is an explicit, narrow, time-boxed exception, never a default.

| Material | Proposed rule at account deletion | Needs decision from |
|---|---|---|
| Public photos (avatar, logo, banner, listing, `wm/`) | Delete. | none |
| `orig/` and `pending/` of a **passed** scan | Delete. | none |
| `orig/` of a **rejected/held** scan, no open report | Delete (the 30-day retention default does not outlive the account). | owner |
| Any object tied to an **open report, appeal or staff review** | Move to `held` state with reason, owner, expiry; delete when the matter closes. | owner |
| Legal hold (`legal_hold` flag does not exist yet) | Set only by an authorised staff role with reason, audited; excluded from deletion; **expiry required**, reviewed on a schedule. | counsel |
| Suspected illegal material | Engineering does not decide. Preservation and reporting are counsel's call; the system only guarantees held items are never touched and are tracked. | counsel |
| `image_hashes` | Cascade-deleted today. Decide whether any hash may be kept for repeat-offender matching after deletion; default **no**. | counsel |
| `report_admin.evidence` (name, `owner_id`, image URLs) | Today kept up to 24 months. Decide: scrub on deletion except where a report is open. | owner / counsel |
| Backups | State the retention honestly in the privacy policy; not controlled by this change. | owner |

A hold must not become "retain everything": the plan keeps held items in a table with `expires_at` and a periodic review report.

## 6. Proposed fix (design only)

### 6.1 Principle: record first, delete later, retry until done
1. **Collect the key set before touching rows**, from two independent sources and merged:
   * the database (all columns in §3);
   * a **prefix listing** of the storage buckets, because every object key embeds `uid`: `avatars/{uid}/`, `business/{uid}/`, `listings/{uid}/`, `wm/listings/{uid}/`, `orig/{uid}/`, `pending/wm/listings/{uid}/`. This catches Worker orphans that have no row. `chat/{conv}/{uid}/` cannot be prefix-listed and stays DB-only.
2. **Write the keys to a deletion ledger in one transaction** (service role only, no FK to `profiles`) before `auth.admin.deleteUser`.
3. Delete the auth user. Only then are ledger rows released to the drain; if `deleteUser` fails, the batch is marked `cancelled` and nothing is removed (account and photos stay consistent for the retry).
4. A **retryable drain** deletes objects, one state per object, with backoff and a max-attempt ceiling that raises an alert instead of giving up silently.
5. Respond to the user only after step 3 succeeds; storage cleanup completes asynchronously and is reported as such.

### 6.2 Ledger (proposal, not a migration)
```sql
-- PROPOSAL ONLY
account_deletion_batches (
  id uuid pk, user_id uuid,            -- no FK: must outlive the profile
  requested_at, auth_deleted_at, completed_at,
  status text,                         -- collecting | awaiting_auth_delete | draining | completed | cancelled | stuck
  environment text)
account_deletion_objects (
  batch_id uuid, bucket text, key text, class text,
  state text,                          -- pending | deleted | failed | held | skipped_invalid
  attempts int, last_error text, next_attempt_at, hold_reason text, hold_expires_at,
  primary key (batch_id, bucket, key))
```
Staff-readable, service-role-writable, append-only history. After completion, key strings are replaced by a hash so the ledger stops carrying a deleted user's `uid`-bearing paths; counts and states remain as the audit trail.

### 6.3 Where deletion runs
* Public bucket: the edge function can keep its current S3-style credential.
* Private bucket: do **not** hand the edge function private-bucket credentials. Add a narrowly scoped service endpoint on the existing image-scan Worker (which already holds both bindings) that accepts a signed request for `delete ledger batch X`, validates every key against the owner shape, and deletes. Credentials stay where they already are, and the Worker already has `deletePrivate`.
* A scheduled drain (cron or scheduled function) re-attempts `failed`/`pending` rows; a reconciler also picks up batches whose `auth.users` row is gone but never finished.
* Listing a bucket by prefix needs a read-only list credential, which does not exist yet (finding F5 of the sweep design). That is a separate secret the owner provisions.

### 6.4 Code changes required (when approved)
1. `accountKeys.ts`: add kinds `derivative` (`wm/listings/{uid}/{UUID}/{FILE}`), `held` (`pending/wm/…`), `original` (`orig/{uid}/{UUID}/{sha}.bin`); add a test asserting `accountKeys` and `uploadPaths.isOwnedKey` agree for every public kind (closing the drift).
2. `delete-account`: collect-then-ledger-then-delete ordering; stop reporting success when cleanup is unconfigured (fail closed, or record `pending` so the drain does it later); move the Apple revoke to after the auth delete or make it idempotent.
3. New Worker delete endpoint plus drain job; new migration for the ledger; `legal_hold` columns.
4. Client: reset `postDraft` and its draft photos in `deleteAccount()` (today only the session is cleared).
5. Privacy policy / `docs/index.html` wording updated to match the approved retention.

### 6.5 Rollout compatibility
Old clients keep working: the function name and response contract (`{ success: true }` / `{ error }`) do not change. The client never needs to know about the ledger.

## 7. Test plan (fake storage first)

All with an in-memory fake storage and a PGlite database; no network, no real buckets.

| Test | Asserts |
|---|---|
| Every object class | seeded user with one object per §3 class: all appear in the ledger, all end `deleted`; none missed |
| Orphan without a row | object under the prefix but absent from the DB is still found and deleted |
| Other user's keys | keys in the user's own owner-writable columns that point at someone else's namespace are skipped, never deleted (existing property preserved) |
| Partial failure | storage errors for N keys: batch stays `draining`, ledger keeps them, retry deletes them, no key lost after the cascade |
| `deleteUser` fails | batch `cancelled`; no object deleted; retry succeeds end to end |
| Crash between steps | ledger written but process dies: reconciler completes; idempotent on re-run |
| Idempotence | second run on an already-completed batch is a no-op; 404 on delete counts as success |
| Large account | thousands of keys: bounded concurrency, resumable across invocations |
| Legal hold | held objects stay, state `held`, expire and are deleted afterwards; hold never applies to unflagged items |
| Missing config | unset secrets produce a `pending` ledger, not a false success |
| Validator agreement | `accountKeys` ≡ `uploadPaths.isOwnedKey` on a shared fixture |
| Client | `deleteAccount()` resets the persisted draft |

## 8. Isolated-staging verification (separate approval, US$0 phase rules apply)

Synthetic objects and a throwaway account only; never production buckets or real photos. Note `workers/image-scan/wrangler.toml` currently binds production-looking bucket names: staging needs its own config first.

1. Seed one object of each class for a test user, plus decoys under another test user.
2. Delete the test account through the real function.
3. Confirm: each target object is gone from storage and its public URL returns 404 (also via any cache); decoys untouched; ledger shows every state; kill the drain mid-run and confirm resumption.
4. Confirm held items behave per §5.
5. Record results in the staging checklist before any production step.

## 9. What is not authorized and not done

No production deployment, migration, bucket listing, bulk cleanup, spend, or change to production deletion behavior. Reviewing this document and the test plan comes first.

## 10. Decisions needed

1. Rule for `orig/` of a rejected photo when the account is deleted with no open report: delete immediately (proposed) or wait out the 30 days.
2. Open-report / appeal handling: hold until closed (proposed) vs delete regardless.
3. Who may set `legal_hold`, maximum duration, and counsel's wording; whether any `image_hashes` may survive.
4. `report_admin.evidence`: scrub on deletion (proposed) or keep the 24-month window.
5. Provision a read-only list credential for prefix scanning (US$0), and whether the Worker delete endpoint is acceptable versus giving the edge function its own private-bucket credential (not recommended).
6. Is the `delete-account` currently deployed the old (unvalidated) or the local version? Needs a dashboard check before any further change.
