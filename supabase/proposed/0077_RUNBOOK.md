# 0077 production runbook (PREPARED, NOT EXECUTED)

Scope: one constraint change on `public.listing_boosts`. Nothing else. No `supabase db push`, no ledger edits, no file moves.
Execute only after the owner says so in writing for this run. Every step below is run by a human in the Supabase SQL editor (or `psql`) against the production project; steps 1-2 and 5 are read-only.

Files used (must be byte-identical to what was reviewed):
- Apply: `supabase/proposed/0077_listing_boosts_revoker_deleted.sql`
- Rollback: `supabase/proposed/0077_listing_boosts_revoker_deleted_ROLLBACK.sql`

## Why this is safe to run alone
- New CHECK `(revoked_by is null or revoked_at is not null)` is implied by the old `(revoked_at is null) = (revoked_by is null)`, so it cannot fail on existing rows.
- Production reportedly has 0 `listing_boosts` rows (re-verify in step 1).
- It only has an effect if production already has `revoked_by ON DELETE SET NULL` (0074's schema). Step 1 checks that; if the FK is still the old NO ACTION/RESTRICT, 0077 is harmless but pointless and 0074 is the real gap: stop and report.

## Step 0 - Preconditions (stop if any is false)
- [ ] Owner has authorised this run explicitly.
- [ ] You are looking at the production project (see step 1a). Not staging, not a local DB.
- [ ] No other migration or deploy is in progress.

## Step 1 - Fresh read-only snapshot (save all output)
```sql
-- 1a. Identity
select current_database(), current_user, inet_server_addr(), now();
-- Also confirm the project ref in the dashboard URL / `supabase projects list` matches production.

-- 1b. Current constraint
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.listing_boosts'::regclass and conname = 'listing_boosts_revoke_consistent';
-- expect: CHECK (((revoked_at IS NULL) = (revoked_by IS NULL)))   (the OLD form)
-- if it already reads (revoked_by IS NULL OR revoked_at IS NOT NULL): 0077 is already applied, STOP.

-- 1c. Foreign keys on the actor columns
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.listing_boosts'::regclass and contype = 'f'
order by conname;
-- expect granted_by and revoked_by both ... ON DELETE SET NULL (0074 live)

-- 1d. Row counts
select count(*) as total,
       count(*) filter (where revoked_at is not null) as revoked,
       count(*) filter (where revoked_at is not null and revoked_by is null) as revoked_no_revoker
from public.listing_boosts;
-- expect 0 / 0 / 0. Any other number: pause, the reasoning above changes slightly (still safe for the apply, but note it).

-- 1e. Table exists with the expected columns
select column_name, is_nullable from information_schema.columns
where table_schema = 'public' and table_name = 'listing_boosts' order by ordinal_position;
```
Abort if 1b shows an unexpected definition or 1c shows the revoker FK is not SET NULL.

## Step 2 - Confirm the files
- [ ] `git status` shows the two 0077 files unmodified since review; compare a hash of each against the reviewed copy.
- [ ] The apply file contains only: `begin; set local lock_timeout = '10s'; alter table ... drop/add constraint; commit;`

## Step 3 - Apply (one transaction, lock timeout in the file)
Paste the contents of the apply file and run it once. If it errors (e.g. lock timeout), the transaction aborts and nothing changes; do not loosen the timeout, wait for a quiet moment and rerun the whole file.
Do not use `supabase db push` / `supabase migration repair`.

## Step 4 - Verify
```sql
select conname, pg_get_constraintdef(oid), convalidated
from pg_constraint
where conrelid = 'public.listing_boosts'::regclass and conname = 'listing_boosts_revoke_consistent';
-- expect: CHECK (((revoked_by IS NULL) OR (revoked_at IS NOT NULL))), convalidated = true
```

## Step 5 - Post-checks (read-only; keep output as release evidence)
- Re-run 1c and 1d: FKs unchanged, row counts unchanged.
- `select count(*) from pg_constraint where conrelid='public.listing_boosts'::regclass and conname='listing_boosts_revoke_consistent';` returns 1.
- Do NOT test by deleting a real account or inserting fake boosts in production. The behaviour is covered by `supabase/tests/account_deletion_0074.test.mjs` on PGlite.
- Record: timestamp, who ran it, project ref, before/after outputs.

## Rollback (manual decision only, never automatic)
Run `0077_..._ROLLBACK.sql` only if the owner asks. It refuses (23514, `revoker_deleted_rows_exist`) if any revoked boost has lost its revoker, because restoring the old CHECK would require inventing a revoker or erasing a revocation. If it refuses, the correct state is to stay on 0077. Run it BEFORE any 0074 rollback.

## Explicitly out of scope
- Ledger: 0046-0076 are applied-but-unrecorded in places; needs its own evidence-based reconciliation plan. Do not mark 0074/0077 as applied by hand to tidy it.
- 0075 / 0076: production effect unknown; probe separately, read-only.
- delete-account Edge Function: still deletes R2 images and revokes the Apple token before `auth.admin.deleteUser`; needs a code fix, deploy, and a GoTrue test.
- 0054: `storefront_verification_requests.reviewed_by` RESTRICT must be revisited before 0054 is introduced (staff who decided a verification cannot be deleted).
