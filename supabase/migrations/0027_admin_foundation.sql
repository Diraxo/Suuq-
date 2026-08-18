-- Admin Dashboard Phase 1: foundation + core moderation loop
-- (reports workflow, warn/suspend a user, remove a listing), fully audited.
--
-- MANUAL STEP REQUIRED after this migration runs — there is no admin yet:
--   1. Sign in once on the site with the Google account that should be admin
--      (this creates its `profiles` row via the existing on_auth_user_created
--      trigger).
--   2. In the Supabase SQL editor, find that user's id:
--        select id, email from auth.users where email = 'you@example.com';
--   3. Grant admin:
--        insert into public.admin_users (user_id) values ('<that id>');
-- There is no other way to become an admin — admin_users has zero RLS
-- policies granted to `authenticated`, so no client request can ever insert
-- into it.

-- ============================================================================
-- 1. admin_users + is_admin() — the only authorization primitive
-- ============================================================================
create table if not exists public.admin_users (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
-- Intentionally zero policies: not even admins can read/write this table via
-- PostgREST. Only a SECURITY DEFINER function (below) or the SQL editor can
-- touch it.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

grant execute on function public.is_admin() to authenticated;

-- ============================================================================
-- 2. admin_audit_log — every privileged write lands one row here, in the
--    same transaction as the write itself (see the RPCs below).
-- ============================================================================
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles (id),
  action text not null,
  target_type text not null,
  target_id text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_target_idx
  on public.admin_audit_log (target_type, target_id);
create index if not exists admin_audit_log_created_idx
  on public.admin_audit_log (created_at desc);

alter table public.admin_audit_log enable row level security;

drop policy if exists "admins can view audit log" on public.admin_audit_log;
create policy "admins can view audit log" on public.admin_audit_log
  for select using (public.is_admin());
-- No insert/update/delete policy: only the SECURITY DEFINER RPCs below
-- (running as the table owner) can write it.

-- ============================================================================
-- 3. Reports: reviewing status, admin read access, status-change RPC
-- ============================================================================
-- The original inline CHECK on reports.status (0003_reports.sql) was never
-- named, so Postgres auto-named it — find it dynamically, same trick
-- 0022_review_reports.sql used for reports.target_type.
do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where conrelid = 'public.reports'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%status%';

  if v_constraint_name is not null then
    execute format('alter table public.reports drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table public.reports
  add constraint reports_status_check
  check (status in ('pending', 'reviewing', 'reviewed', 'dismissed'));

-- Bug fix: the original trigger (0021_report_status_notify.sql) fires the
-- reporter notification on ANY non-'pending' status, so an untouched
-- 'pending' -> 'reviewing' transition would send a false "Your report was
-- dismissed" message (it falls into the trigger's `else` branch). Only
-- notify on transitions into a terminal state.
create or replace function public.notify_on_report_status_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = old.status or new.status not in ('reviewed', 'dismissed') then
    return new;
  end if;

  insert into public.notifications (user_id, title, body, type, data)
  values (
    new.reporter_id,
    case
      when new.status = 'reviewed' then 'Your report was reviewed'
      else 'Your report was dismissed'
    end,
    case new.target_type
      when 'listing' then 'Thanks for helping keep Suuq+ safe.'
      else 'Thanks for helping keep Suuq+ safe.'
    end,
    'report_result',
    jsonb_build_object('reportId', new.id, 'targetType', new.target_type, 'targetId', new.target_id, 'status', new.status)
  );

  return new;
end;
$$;

drop policy if exists "admins can view all reports" on public.reports;
create policy "admins can view all reports" on public.reports
  for select using (public.is_admin());

create or replace function public.admin_update_report_status(
  p_report_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can update report status' using errcode = '42501';
  end if;

  if p_status not in ('pending', 'reviewing', 'reviewed', 'dismissed') then
    raise exception 'Invalid report status: %', p_status;
  end if;

  update public.reports set status = p_status where id = p_report_id;

  if not found then
    raise exception 'Report % not found', p_report_id;
  end if;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason)
  values (auth.uid(), 'report_status_change', 'report', p_report_id::text, p_note);
end;
$$;

grant execute on function public.admin_update_report_status(uuid, text, text) to authenticated;

-- ============================================================================
-- 4. Profiles: account_status (suspension), moderation_warnings, rate-limit
--    trigger fixes, warn/suspend RPCs
-- ============================================================================
alter table public.profiles
  add column if not exists account_status text not null default 'active'
    check (account_status in ('active', 'suspended'));

-- Lock the column down the same way 0019_security_hardening.sql locked down
-- notifications' protected columns: the existing "users can update their own
-- profile" policy (using (auth.uid() = id), no column restriction) would
-- otherwise let a user PATCH their own account_status back to 'active'.
revoke update (account_status) on public.profiles from authenticated;

create table if not exists public.moderation_warnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  admin_id uuid not null references public.profiles (id),
  reason text not null,
  note text,
  created_at timestamptz not null default now()
);

alter table public.moderation_warnings enable row level security;

drop policy if exists "admins can view warnings" on public.moderation_warnings;
create policy "admins can view warnings" on public.moderation_warnings
  for select using (public.is_admin());
-- No client insert/update/delete policy: only admin_warn_user() below.

-- Bug fix + new enforcement, both in trg_enforce_rate_limit
-- (0019_security_hardening.sql):
--   1. Without a bypass, admin_set_account_status()'s UPDATE on `profiles`
--      would fire this trigger under the ADMIN's own auth.uid() (SECURITY
--      DEFINER changes the executing role, not what auth.uid() resolves to —
--      that's a per-request PostgREST GUC), silently spending the admin's
--      personal 20/hour update_profile budget and risking the moderation
--      action failing outright.
--   2. Suspension enforcement: block the 5 listed actions for a suspended
--      user. update_profile is exempt so a suspended user can still, e.g.,
--      change their language.
create or replace function public.trg_enforce_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('fursad.admin_write', true), '') = 'true' then
    return new;
  end if;

  if tg_argv[0] <> 'update_profile' and exists (
    select 1 from public.profiles where id = auth.uid() and account_status = 'suspended'
  ) then
    raise exception 'Account suspended' using errcode = '42501';
  end if;

  case tg_argv[0]
    when 'create_listing' then perform public.enforce_rate_limit('create_listing', 10, interval '1 hour');
    when 'create_offer' then perform public.enforce_rate_limit('create_offer', 20, interval '1 hour');
    when 'create_review' then perform public.enforce_rate_limit('create_review', 10, interval '1 day');
    when 'create_favorite' then perform public.enforce_rate_limit('create_favorite', 60, interval '1 minute');
    when 'create_follow' then perform public.enforce_rate_limit('create_follow', 30, interval '1 minute');
    when 'update_profile' then perform public.enforce_rate_limit('update_profile', 20, interval '1 hour');
    else raise exception 'trg_enforce_rate_limit: unknown action %', tg_argv[0];
  end case;
  return new;
end;
$$;
-- Existing triggers already point at this function by name (create or
-- replace above updates their behavior in place); no re-creation needed.

create or replace function public.admin_warn_user(
  p_user_id uuid,
  p_reason text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can warn a user' using errcode = '42501';
  end if;

  insert into public.moderation_warnings (user_id, admin_id, reason, note)
  values (p_user_id, auth.uid(), p_reason, p_note);

  insert into public.notifications (user_id, title, body, type, data)
  values (
    p_user_id,
    'You received a warning',
    p_reason,
    'moderation_warning',
    jsonb_build_object('reason', p_reason, 'note', p_note)
  );

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason)
  values (auth.uid(), 'warn_user', 'user', p_user_id::text, coalesce(p_note, p_reason));
end;
$$;

grant execute on function public.admin_warn_user(uuid, text, text) to authenticated;

create or replace function public.admin_set_account_status(
  p_user_id uuid,
  p_status text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change account status' using errcode = '42501';
  end if;

  if p_status not in ('active', 'suspended') then
    raise exception 'Invalid account status: %', p_status;
  end if;

  perform set_config('fursad.admin_write', 'true', true);

  update public.profiles set account_status = p_status where id = p_user_id;

  if not found then
    raise exception 'User % not found', p_user_id;
  end if;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason)
  values (
    auth.uid(),
    case when p_status = 'suspended' then 'suspend_user' else 'unsuspend_user' end,
    'user',
    p_user_id::text,
    p_reason
  );
end;
$$;

grant execute on function public.admin_set_account_status(uuid, text, text) to authenticated;

-- ============================================================================
-- 5. Listings: removed status, public-feed hide, self-service guard, RPC
-- ============================================================================
do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where conrelid = 'public.listings'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%status%';

  if v_constraint_name is not null then
    execute format('alter table public.listings drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table public.listings
  add constraint listings_status_check
  check (status in ('available', 'reserved', 'sold', 'expired', 'removed'));

-- No existing read path (web or mobile) filters listings by status — the
-- old policy was `using (true)`. Without this, an admin-removed listing
-- would keep appearing everywhere, unbadged, indistinguishable from a normal
-- listing. This one policy change hides it from the public on both
-- platforms with zero app-code changes.
drop policy if exists "listings are publicly readable" on public.listings;
create policy "listings are publicly readable" on public.listings
  for select using (status <> 'removed' or auth.uid() = user_id or public.is_admin());

-- The owner UPDATE policy (using (auth.uid() = user_id), no column/value
-- restriction) would otherwise let a seller self-remove a listing to dodge a
-- bad situation, or un-remove one an admin just took down.
create or replace function public.guard_listing_removed_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    (new.status = 'removed' and old.status is distinct from 'removed')
    or (old.status = 'removed' and new.status is distinct from 'removed')
  ) and not public.is_admin() then
    raise exception 'Only an admin can remove or restore a listing' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists listings_guard_removed on public.listings;
create trigger listings_guard_removed
  before update on public.listings
  for each row execute function public.guard_listing_removed_transition();

create or replace function public.admin_set_listing_status(
  p_listing_id uuid,
  p_status text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change listing status' using errcode = '42501';
  end if;

  if p_status not in ('available', 'removed') then
    raise exception 'Invalid listing status for moderation: %', p_status;
  end if;

  update public.listings set status = p_status where id = p_listing_id;

  if not found then
    raise exception 'Listing % not found', p_listing_id;
  end if;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason)
  values (
    auth.uid(),
    case when p_status = 'removed' then 'remove_listing' else 'restore_listing' end,
    'listing',
    p_listing_id::text,
    p_reason
  );
end;
$$;

grant execute on function public.admin_set_listing_status(uuid, text, text) to authenticated;
