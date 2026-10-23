-- 0078 — Server-controlled mandatory app updates (one row per platform).
--
--   The apps read their own platform's row (anon + authenticated, SELECT only) at launch and when returning to the foreground.
--   When the installed version is below minimum_version the app shows a non-dismissible "Update required" screen.
--   Only the service role / SQL editor can change a row; there is no insert/update/delete policy for app users.
--   Operator guide: docs/MANDATORY_UPDATES.md.  Rollback: supabase/rollback/0078_app_update_policy_ROLLBACK.sql.
--
--   Ships DISABLED (enabled = false) so applying this migration enforces nothing until an operator turns a platform on.

create table if not exists public.app_update_policy (
  platform text primary key check (platform in ('ios', 'android')),
  enabled boolean not null default false,
  recommended_version text check (recommended_version ~ '^[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}$'),
  minimum_version text not null default '1.0.0' check (minimum_version ~ '^[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}$'),
  store_url text check (
    store_url is null or (
      length(store_url) <= 500 and
      store_url ~* '^(https://(apps\.apple\.com|itunes\.apple\.com|play\.google\.com)/|itms-apps://apps\.apple\.com/|market://details)'
    )
  ),
  -- Optional per-language override, e.g. {"en": "...", "so": "...", "am": "..."}; the app's own translated copy is used when empty.
  message jsonb not null default '{}'::jsonb check (jsonb_typeof(message) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.app_update_policy enable row level security;

drop policy if exists "app_update_policy readable by everyone" on public.app_update_policy;
create policy "app_update_policy readable by everyone"
  on public.app_update_policy for select
  to anon, authenticated
  using (true);

revoke all on public.app_update_policy from anon, authenticated;
grant select on public.app_update_policy to anon, authenticated;

insert into public.app_update_policy (platform, enabled, minimum_version, store_url)
values
  ('ios', false, '1.0.0', null),
  ('android', false, '1.0.0', 'https://play.google.com/store/apps/details?id=suuqiye.com')
on conflict (platform) do nothing;
