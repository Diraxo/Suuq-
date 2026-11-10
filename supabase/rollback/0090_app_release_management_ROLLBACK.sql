-- Rollback for 0090. Keeps 0078's app_update_policy and its original columns (and so its mandatory-update enforcement) intact.
-- Apps that ask for the new columns get an error and fall back to the 0078 columns, so this is safe at any time.
drop table if exists public.app_update_dismissals;
drop trigger if exists app_update_policy_before_write on public.app_update_policy;
drop function if exists public.app_update_policy_before_write();
alter table public.app_update_policy
  drop column if exists current_release_id,
  drop column if exists reminder_interval_hours,
  drop column if exists first_reminder_delay_hours,
  drop column if exists show_whats_new,
  drop column if exists support_url;
drop table if exists public.app_releases;
drop function if exists public.app_releases_before_write();
drop function if exists public.app_version_tuple(text);
