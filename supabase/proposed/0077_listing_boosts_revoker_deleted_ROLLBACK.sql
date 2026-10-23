-- ROLLBACK for the proposed 0077. Run BEFORE the 0074 rollback. One transaction.
-- Restoring the old two-way CHECK is impossible while any revoked boost has lost its revoker (revoked_at set, revoked_by NULL): the only ways to
-- make such a row pass are to invent a revoker or to erase the revocation, and this script does neither. It refuses, names the count, changes nothing.
begin;
set local lock_timeout = '10s';
do $$
declare v_n int;
begin
  select count(*) into v_n from public.listing_boosts where revoked_at is not null and revoked_by is null;
  if v_n > 0 then
    raise exception '0077 rollback refused, nothing was changed: % revoked boost(s) have no revoker (their staff account was deleted). The old CHECK cannot hold without inventing a revoker or erasing the revocation.', v_n
      using errcode = '23514', hint = 'revoker_deleted_rows_exist';
  end if;
end $$;
alter table public.listing_boosts
  drop constraint listing_boosts_revoke_consistent,
  add constraint listing_boosts_revoke_consistent check ((revoked_at is null) = (revoked_by is null));
commit;
