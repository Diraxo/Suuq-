-- ROLLBACK for 0055 (account-deletion ledger). Run as ONE transaction (SQL editor, or psql --single-transaction).
--
-- Prefer NOT to run this. 0055 is additive and inert: service-role-only tables and functions, no trigger, no change to any existing
-- table. Leaving it in place after a client/Worker rollback costs nothing; dropping it can lose the only record of private identity
-- documents that still have to be removed from Storage.
--
-- ORDER (strict):
--   1. Redeploy the delete-account Edge Function from BEFORE the ledger (git history). The current one calls account_deletion_begin
--      first and, if that RPC is missing, answers 500 "Nothing was deleted" for EVERY deletion request. That is fail-closed (nothing is
--      removed) but it blocks users from deleting their accounts, which the stores require. So the function goes back first, or this
--      rollback is not worth running.
--   2. EXPORT the ledger (kept outside the database; it holds user ids):
--        copy (select * from public.account_deletion_jobs) to stdout with csv header;
--        copy (select * from public.account_deletion_objects) to stdout with csv header;   -- names are sha256 digests once completed
--   3. Run this script. It REFUSES while any job is still open, because dropping an open job orphans the files it was going to delete.
--      Drain or cancel them first (account_deletion_claim / _record / _finish), or accept the leftovers explicitly by deleting the rows
--      yourself AFTER exporting them and recording who decided that and why.
--
-- Re-applying migrations/0055 afterwards is safe (the tables and functions are dropped completely, so create succeeds).
do $$
declare v_open int;
begin
  select count(*) into v_open from public.account_deletion_jobs where status in ('awaiting_account_delete', 'pending', 'in_progress', 'escalated');
  if v_open > 0 then
    raise exception 'refusing to drop the account-deletion ledger: % job(s) still open. Drain, cancel or export them first (see header).', v_open
      using errcode = '55000';
  end if;
end $$;

drop function if exists public.account_deletion_report();
drop function if exists public.account_deletion_requeue(uuid);
drop function if exists public.account_deletion_finish(uuid, int);
drop function if exists public.account_deletion_record(uuid, jsonb);
drop function if exists public.account_deletion_claim(uuid, int, interval);
drop function if exists public.account_deletion_cancel(uuid);
drop function if exists public.account_deletion_mark_user_deleted(uuid);
drop function if exists public.account_deletion_begin(uuid, jsonb);
drop function if exists public.account_deletion_collect_verification_paths(uuid);
drop table if exists public.account_deletion_objects;
drop table if exists public.account_deletion_jobs;
