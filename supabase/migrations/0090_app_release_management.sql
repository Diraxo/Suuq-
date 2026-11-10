-- 0090 — App release management: release history, per-platform release announcements, per-user reminder history.
--
--   EXTENDS 0078 (app_update_policy); nothing is dropped or rewritten. Requires 0078. Not applied by the code change that added it.
--   Operator guide + example SQL: docs/MANDATORY_UPDATES.md and supabase/examples/app_release_examples.sql.
--   Rollback: supabase/rollback/0090_app_release_management_ROLLBACK.sql.
--
--   Release types (app_releases.release_type)
--     normal     routine fixes           -> dismissible reminder   (default every 72 h)
--     important  major features          -> prominent announcement (default every 24 h); blocks only when mandatory = true
--     critical   security/compatibility  -> full-screen mandatory gate. A critical release is ALWAYS mandatory (CHECK below), so a
--                                          row cannot be saved that silently downgrades it to optional.
--
--   How the app uses it: app_update_policy keeps one row per platform. `current_release_id` points at the active release; the app reads
--   the policy row with the release embedded. Enforcement is unchanged and additive:
--     effective minimum = max(policy.minimum_version, release.minimum_supported_version) when the release is mandatory
--                         (a mandatory release with no minimum_supported_version requires its target_version).
--   `enabled = false` on a platform leaves its users completely unaffected (no gate, no announcement).
--
--   Existing columns are reused, not duplicated: policy.minimum_version is the "minimum supported version", policy.recommended_version the
--   "recommended version", policy.store_url the platform's store listing (the release carries android_/ios_store_url for the announcement).
--   There is deliberately no second `mandatory`/`release_type` flag on the policy row: the type and mandatory status live on the release, and
--   minimum_version alone decides blocking when no release is linked, exactly as in 0078.

-- ───────── helpers ─────────

-- "1.10.0" -> {1,10,0}; null for anything that is not strictly major.minor.patch. Compares numerically, never as text.
create or replace function public.app_version_tuple(v text)
returns integer[] language sql immutable strict as $$
  select case when v ~ '^[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}$' then string_to_array(v, '.')::integer[] else null end
$$;

-- ───────── app_releases ─────────

create table if not exists public.app_releases (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('android', 'ios', 'all')),
  version text not null check (public.app_version_tuple(version) is not null),
  version_code integer check (version_code is null or version_code > 0),
  release_type text not null check (release_type in ('normal', 'important', 'critical')),
  title text not null check (length(btrim(title)) between 1 and 120),
  description text not null check (length(btrim(description)) between 1 and 2000),
  -- {"items":[{"title":"..","description":"..","icon":"image"}]}. Structure is validated again in the app; unknown icons fall back to a default.
  changelog jsonb not null default '{"items": []}'::jsonb check (
    jsonb_typeof(changelog) = 'object'
    and jsonb_typeof(changelog -> 'items') = 'array'
    and jsonb_array_length(changelog -> 'items') <= 20
  ),
  -- Optional per-language overrides: {"so": {"title": "..", "description": "..", "items": [{"title": "..", "description": ".."}]}}; items align by index.
  translations jsonb not null default '{}'::jsonb check (jsonb_typeof(translations) = 'object'),
  mandatory boolean not null default false,
  minimum_supported_version text check (minimum_supported_version is null or public.app_version_tuple(minimum_supported_version) is not null),
  target_version text not null check (public.app_version_tuple(target_version) is not null),
  android_store_url text check (android_store_url is null or (length(android_store_url) <= 500 and android_store_url ~* '^(https://play\.google\.com/|market://details)')),
  ios_store_url text check (ios_store_url is null or (length(ios_store_url) <= 500 and ios_store_url ~* '^(https://(apps|itunes)\.apple\.com/|itms-apps://apps\.apple\.com/)')),
  support_url text check (support_url is null or (length(support_url) <= 500 and support_url ~* '^(https://[^[:space:]/?#]+|mailto:[^[:space:]@]+@[^[:space:]@]+)')),
  published boolean not null default false,
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- a critical release is never optional; a mandatory release must state a meaningful reason (the description is shown on the gate)
  constraint app_releases_critical_is_mandatory check (release_type <> 'critical' or mandatory),
  constraint app_releases_mandatory_reason check (not mandatory or length(btrim(description)) >= 20),
  constraint app_releases_minimum_not_above_target check (
    minimum_supported_version is null or public.app_version_tuple(minimum_supported_version) <= public.app_version_tuple(target_version)
  ),
  -- a published release must be installable from the store(s) it targets
  constraint app_releases_published_has_store check (
    not published or (
      case platform
        when 'android' then android_store_url is not null
        when 'ios' then ios_store_url is not null
        else android_store_url is not null and ios_store_url is not null
      end
    )
  ),
  constraint app_releases_expiry_after_publish check (published_at is null or expires_at is null or expires_at > published_at)
);

create index if not exists app_releases_platform_published_idx on public.app_releases (platform, published, published_at desc);

create or replace function public.app_releases_before_write()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.published and new.published_at is null then
    new.published_at := now();
  end if;
  -- re-pointing a release at another platform must not leave a policy row announcing a release meant for the other platform
  if tg_op = 'UPDATE' and new.platform <> 'all' and new.platform is distinct from old.platform and exists (
    select 1 from public.app_update_policy p where p.current_release_id = new.id and p.platform <> new.platform
  ) then
    raise exception 'release % is linked from another platform''s policy row', new.id using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists app_releases_before_write on public.app_releases;
create trigger app_releases_before_write before insert or update on public.app_releases
  for each row execute function public.app_releases_before_write();

alter table public.app_releases enable row level security;

-- Anyone (signed out too) may read a release only while it is published and not expired; drafts and expired releases are invisible.
drop policy if exists "app_releases active readable by everyone" on public.app_releases;
create policy "app_releases active readable by everyone"
  on public.app_releases for select
  to anon, authenticated
  using (published and (expires_at is null or expires_at > now()));

revoke all on public.app_releases from anon, authenticated;
grant select on public.app_releases to anon, authenticated;

-- ───────── app_update_policy (additive) ─────────

alter table public.app_update_policy
  add column if not exists current_release_id uuid references public.app_releases(id) on delete set null,
  -- null = the release type's default (normal 72 h, important 24 h)
  add column if not exists reminder_interval_hours integer check (reminder_interval_hours is null or reminder_interval_hours between 1 and 8760),
  add column if not exists first_reminder_delay_hours integer not null default 0 check (first_reminder_delay_hours between 0 and 8760),
  add column if not exists show_whats_new boolean not null default true,
  add column if not exists support_url text check (support_url is null or (length(support_url) <= 500 and support_url ~* '^(https://[^[:space:]/?#]+|mailto:[^[:space:]@]+@[^[:space:]@]+)'));

create or replace function public.app_update_policy_before_write()
returns trigger language plpgsql as $$
declare
  rel_platform text;
begin
  new.updated_at := now();
  if new.current_release_id is not null then
    select platform into rel_platform from public.app_releases where id = new.current_release_id;
    if rel_platform is not null and rel_platform <> 'all' and rel_platform <> new.platform then
      raise exception 'release % targets %, not %', new.current_release_id, rel_platform, new.platform using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists app_update_policy_before_write on public.app_update_policy;
create trigger app_update_policy_before_write before insert or update on public.app_update_policy
  for each row execute function public.app_update_policy_before_write();

-- ───────── app_update_dismissals ─────────

create table if not exists public.app_update_dismissals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  release_id uuid not null references public.app_releases(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios')),
  dismissed_at timestamptz not null default now(),
  remind_after timestamptz not null,
  created_at timestamptz not null default now(),
  constraint app_update_dismissals_unique unique (user_id, release_id, platform),
  constraint app_update_dismissals_order check (remind_after >= dismissed_at)
);

create index if not exists app_update_dismissals_release_idx on public.app_update_dismissals (release_id);

alter table public.app_update_dismissals enable row level security;

drop policy if exists "app_update_dismissals own select" on public.app_update_dismissals;
create policy "app_update_dismissals own select" on public.app_update_dismissals for select to authenticated using (user_id = auth.uid());
drop policy if exists "app_update_dismissals own insert" on public.app_update_dismissals;
create policy "app_update_dismissals own insert" on public.app_update_dismissals for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "app_update_dismissals own update" on public.app_update_dismissals;
create policy "app_update_dismissals own update" on public.app_update_dismissals for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Private to the signed-in user; never readable signed out, never deletable from the app. (Removed with the account via ON DELETE CASCADE.)
revoke all on public.app_update_dismissals from anon, authenticated;
grant select, insert, update on public.app_update_dismissals to authenticated;
