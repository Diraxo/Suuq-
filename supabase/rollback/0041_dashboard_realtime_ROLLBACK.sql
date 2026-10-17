-- Rollback for 0041_dashboard_realtime.sql. Drops read-only RPCs, the visibility broadcast trigger and the extra
-- indexes; removes the three tables from the realtime publication. No data is deleted.

drop function if exists public.purge_old_support_data(interval);
drop trigger if exists listings_visibility_broadcast on public.listings;
drop function if exists public.trg_listing_visibility_broadcast();
drop function if exists public.hidden_listing_ids(uuid[]);
drop function if exists public.admin_case_detail(uuid);
drop function if exists public.admin_list_cases(text, int, int);
drop function if exists public.admin_listing_detail(uuid);
drop function if exists public.admin_list_listings(text, boolean, text, uuid, text, int, int, boolean);
drop function if exists public.admin_dashboard_counts();

do $$
begin
  begin alter publication supabase_realtime drop table public.support_cases; exception when undefined_object then null; end;
  begin alter publication supabase_realtime drop table public.moderation_notices; exception when undefined_object then null; end;
end $$;

drop index if exists public.listings_status_created_idx;
drop index if exists public.reports_reporter_idx;
drop index if exists public.reports_status_created_idx;
drop index if exists public.reports_target_idx;
