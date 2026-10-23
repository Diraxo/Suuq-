-- ROLLBACK for 0074 (account-deletion FK fix). Run as ONE transaction (the script has its own begin/commit; with psql use ON_ERROR_STOP=1).
-- Order if later migrations are applied: 0076 rollback, then 0075 rollback, then (if the proposed 0077 was applied) the 0077 rollback, then this file.
--
-- WHAT THIS RESTORES: the pre-0074 state exactly: offers.from_user_id and the staff/audit pointers back to "references profiles (id)" with no ON DELETE
-- action, and admin_id / actor_id / granted_by / author_id back to NOT NULL.
--
-- RESTORING NOT NULL IS UNSAFE ONCE ANY ROW HAS A NULL ACTOR. After 0074 every deletion of a staff account leaves its audit rows behind with the pointer
-- set to NULL, and nothing records who that was. There is no honest value to put back: this script never invents one (no placeholder staff account, no
-- "system" user, no copy of another actor), and it never deletes the rows to make the constraint fit (that would destroy the audit trail).
-- So it REFUSES while any NULL exists, names the column and the count, and changes nothing (the check runs before the first ALTER, and the whole file is
-- one transaction). Consequences the operator must accept before running it:
--   * Possible only while no staff account has been deleted since 0074 was applied (all five columns still free of NULL). Otherwise it cannot run at all.
--   * After it runs, deleting any account that ever acted as staff fails again ("Database error deleting user", 23503). The only supported way to remove such
--     an account is to deactivate it instead (delete its admin_users row) and leave the profile in place.
-- If rows with NULL actors already exist and you still need the pre-0074 foreign-key behaviour, that is a different, deliberate decision (keep the columns
-- nullable and restore only the FK actions). It is not scripted here because it leaves the schema in a state neither 0073 nor 0074 describes.
--
-- The listing_boosts CHECK (listing_boosts_revoke_consistent) is not touched by 0074 and is not touched here. If the proposed 0077 changed it, roll 0077 back first.
begin;

set local lock_timeout = '10s';

do $$
declare
  r record;
  v_blocked text := '';
begin
  for r in
    select * from (
      select 'admin_audit_log.admin_id' col, count(*) n from public.admin_audit_log where admin_id is null
      union all select 'moderation_warnings.admin_id', count(*) from public.moderation_warnings where admin_id is null
      union all select 'profile_verification_events.actor_id', count(*) from public.profile_verification_events where actor_id is null
      union all select 'listing_boosts.granted_by', count(*) from public.listing_boosts where granted_by is null
      union all select 'report_notes.author_id', count(*) from public.report_notes where author_id is null
    ) c where n > 0
  loop
    v_blocked := v_blocked || format(' %s=%s', r.col, r.n);
  end loop;
  if v_blocked <> '' then
    raise exception '0074 rollback refused, nothing was changed: rows with a NULL actor exist (%). NOT NULL cannot be restored without inventing or deleting actor identities. See the header of this file.', btrim(v_blocked)
      using errcode = '23502', hint = 'null_actor_rows_exist';
  end if;
end $$;

alter table public.report_notes alter column author_id set not null;
alter table public.report_notes
  drop constraint report_notes_author_id_fkey,
  add constraint report_notes_author_id_fkey foreign key (author_id) references public.profiles (id);

alter table public.listing_boosts alter column granted_by set not null;
alter table public.listing_boosts
  drop constraint listing_boosts_revoked_by_fkey,
  add constraint listing_boosts_revoked_by_fkey foreign key (revoked_by) references public.profiles (id),
  drop constraint listing_boosts_granted_by_fkey,
  add constraint listing_boosts_granted_by_fkey foreign key (granted_by) references public.profiles (id);

alter table public.profile_verification_events alter column actor_id set not null;
alter table public.profile_verification_events
  drop constraint profile_verification_events_actor_id_fkey,
  add constraint profile_verification_events_actor_id_fkey foreign key (actor_id) references public.profiles (id);

alter table public.moderation_warnings alter column admin_id set not null;
alter table public.moderation_warnings
  drop constraint moderation_warnings_admin_id_fkey,
  add constraint moderation_warnings_admin_id_fkey foreign key (admin_id) references public.profiles (id);

alter table public.admin_audit_log alter column admin_id set not null;
alter table public.admin_audit_log
  drop constraint admin_audit_log_admin_id_fkey,
  add constraint admin_audit_log_admin_id_fkey foreign key (admin_id) references public.profiles (id);

alter table public.offers
  drop constraint offers_from_user_id_fkey,
  add constraint offers_from_user_id_fkey foreign key (from_user_id) references public.profiles (id);

commit;
