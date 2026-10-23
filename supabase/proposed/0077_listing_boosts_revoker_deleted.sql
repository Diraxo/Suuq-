-- PROPOSED 0077 (follow-up to 0074). NOT in supabase/migrations on purpose: it is not applied anywhere and needs the owner's approval.
--
-- Defect in 0074 (reproduced on PGlite, supabase/tests/account_deletion_0074.test.mjs):
--   0074 makes listing_boosts.revoked_by ON DELETE SET NULL, but 0038 also declared
--     check ((revoked_at is null) = (revoked_by is null))
--   so deleting a staff account that REVOKED a boost sets revoked_by = NULL while revoked_at stays set, the CHECK fails, and the whole
--   deletion aborts with 23514 ("Database error deleting user"). Deleting the account that GRANTED a boost works; only revokers are affected.
--
-- Fix: keep the part of the invariant that matters (a revoker implies a revocation) and allow the revoker pointer to be gone:
--     check (revoked_by is null or revoked_at is not null)
--   Every row that satisfied the old CHECK satisfies this one, so adding it cannot fail on existing data. "Is this boost revoked?" is, and
--   always was, answered by revoked_at (every reader and writer sets both together).
begin;
set local lock_timeout = '10s';
alter table public.listing_boosts
  drop constraint listing_boosts_revoke_consistent,
  add constraint listing_boosts_revoke_consistent check (revoked_by is null or revoked_at is not null);
commit;
