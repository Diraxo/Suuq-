-- Account deletion was failing with "Database error deleting user": these foreign keys to
-- profiles had no ON DELETE action, so deleting any user who had a row in them was blocked.
--
-- * offers.from_user_id is always the buyer or the seller, both of which already cascade, so
--   the offer is deleted with the user anyway; cascade here removes the blocking check.
-- * The staff/audit columns keep their rows (the audit trail outlives the staff account) and
--   lose only the pointer: nullable + ON DELETE SET NULL. Readers must tolerate a null actor.

alter table public.offers
  drop constraint offers_from_user_id_fkey,
  add constraint offers_from_user_id_fkey foreign key (from_user_id) references public.profiles (id) on delete cascade;

alter table public.admin_audit_log alter column admin_id drop not null;
alter table public.admin_audit_log
  drop constraint admin_audit_log_admin_id_fkey,
  add constraint admin_audit_log_admin_id_fkey foreign key (admin_id) references public.profiles (id) on delete set null;

alter table public.moderation_warnings alter column admin_id drop not null;
alter table public.moderation_warnings
  drop constraint moderation_warnings_admin_id_fkey,
  add constraint moderation_warnings_admin_id_fkey foreign key (admin_id) references public.profiles (id) on delete set null;

alter table public.profile_verification_events alter column actor_id drop not null;
alter table public.profile_verification_events
  drop constraint profile_verification_events_actor_id_fkey,
  add constraint profile_verification_events_actor_id_fkey foreign key (actor_id) references public.profiles (id) on delete set null;

alter table public.listing_boosts alter column granted_by drop not null;
alter table public.listing_boosts
  drop constraint listing_boosts_granted_by_fkey,
  add constraint listing_boosts_granted_by_fkey foreign key (granted_by) references public.profiles (id) on delete set null,
  drop constraint listing_boosts_revoked_by_fkey,
  add constraint listing_boosts_revoked_by_fkey foreign key (revoked_by) references public.profiles (id) on delete set null;

alter table public.report_notes alter column author_id drop not null;
alter table public.report_notes
  drop constraint report_notes_author_id_fkey,
  add constraint report_notes_author_id_fkey foreign key (author_id) references public.profiles (id) on delete set null;
