-- 0075 — One identity per account: (1) business mode no longer needs a business name, (2) two display-name changes per rolling 7 days.
--
-- STATUS: written and tested on PGlite only. NOT applied to any database. Needs 0064 (active_mode) and 0039 (is_admin, admin_audit_log).
--
-- 1. Business mode without a second identity
--    The account's name, photo and bio are profiles.full_name / avatar_url / bio and nothing else. Business mode only adds a banner and
--    business details, so switching to it must not require profiles.business_name. This replaces two 0064 rules:
--      * set_active_mode('business') no longer demands a non-blank business_name.
--      * the guard trigger no longer forces 'personal' when business_name is blank. It keeps one server-side rule: when staff or the
--        storefront mirror withdraw a legacy business name (suspension / unpublish), the account returns to personal. A suspended storefront
--        also cannot be re-entered through set_active_mode().
--    business_name / business_logo_url / business_logo_public_id stay in the table for legacy rows. They are not dropped, and no
--    client reads them as identity any more. Retiring them is a separate, approved migration.
--
-- 2. Name-change limit (enforced here, so mobile, web and hand-written requests behave the same)
--    * At most 2 successful changes of profiles.full_name in any rolling 7 days, per account (not per device, session or mode).
--    * Only an actual change counts: saving the same name, or editing avatar / bio / city, does not. The first time a name is set
--      (old name blank) is free.
--    * Direct client writes only (an authenticated caller updating their own row). Staff RPCs that set fursad.admin_write, the service
--      role and migrations are not limited and are not counted.
--    * Concurrency: the check and the history insert run in one BEFORE UPDATE row trigger under a per-account advisory lock, and the
--      UPDATE itself already holds the row lock, so two parallel requests cannot both read "1 used" and both pass.
--    * profile_name_changes keeps the history (old/new name, when). It is private (RLS on, no policies, no grants) and is deleted with
--      the profile. my_name_change_status() tells the caller used / remaining / next_available_at.
--    * Existing accounts: no backfill. History starts empty, so everyone has both changes available the moment this is applied.
--    * Administrative correction: admin_reset_name_changes(user, reason) waives the changes inside the window (rows are kept, marked
--      waived, and one admin_audit_log row records who and why). Staff can also simply rename through any admin path; that is not counted.
--
-- Rollback: supabase/rollback/0075_unified_identity_name_limit_ROLLBACK.sql

begin;

-- 1 ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.guard_profile_active_mode()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.is_client_write() then
    if tg_op = 'INSERT' then
      new.active_mode := 'personal';
    elsif new.active_mode is distinct from old.active_mode then
      raise exception 'Use set_active_mode() to switch profiles' using errcode = '42501', hint = 'active_mode_rpc_only';
    end if;
  elsif tg_op = 'UPDATE' and new.active_mode = 'business' and nullif(btrim(old.business_name), '') is not null and nullif(btrim(new.business_name), '') is null then
    -- Server-side only (staff action, storefront mirror 0054): when the server withdraws a legacy business (suspension, unpublish), the account
    -- stops presenting as a business. A user clearing their own legacy business name does not switch mode: the name is no longer an identity.
    new.active_mode := 'personal';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_profile_active_mode() from public, anon, authenticated;

create or replace function public.set_active_mode(p_mode text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_suspended boolean := false;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  if p_mode is null or p_mode not in ('personal', 'business') then
    raise exception 'Unknown profile mode' using errcode = '22023';
  end if;
  perform 1 from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  -- A suspended storefront (0054, when it exists) cannot be re-entered by switching modes.
  if p_mode = 'business' and to_regclass('public.storefronts') is not null then
    execute 'select exists (select 1 from public.storefronts where owner_id = $1 and status = ''suspended'')' into v_suspended using v_uid;
    if v_suspended then
      raise exception 'Your business is suspended' using errcode = '42501', hint = 'business_suspended';
    end if;
  end if;
  perform set_config('fursad.admin_write', 'true', true);
  update public.profiles set active_mode = p_mode where id = v_uid and active_mode is distinct from p_mode;
  return p_mode;
end;
$$;
revoke all on function public.set_active_mode(text) from public, anon;
grant execute on function public.set_active_mode(text) to authenticated;

-- 2 ---------------------------------------------------------------------------------------------------------------------------------
create schema if not exists private;

create table if not exists public.profile_name_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  old_name text,
  new_name text,
  changed_at timestamptz not null default now(),
  waived_at timestamptz,
  waived_by uuid references public.profiles (id) on delete set null
);
create index if not exists profile_name_changes_user_idx on public.profile_name_changes (user_id, changed_at desc);
alter table public.profile_name_changes enable row level security;
revoke all on table public.profile_name_changes from public, anon, authenticated;

-- The single place the numbers live (the client shows what the server returns; it never hard-codes them for enforcement).
create or replace function private.name_change_limit() returns int language sql immutable as $$ select 2 $$;
create or replace function private.name_change_window() returns interval language sql immutable as $$ select interval '7 days' $$;

create or replace function private.limit_name_change()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_used int;
  v_next timestamptz;
begin
  -- Only the account holder writing their own row directly is limited. Staff RPCs set fursad.admin_write; the service role and
  -- migrations carry no user id.
  if auth.uid() is null or auth.uid() <> new.id or coalesce(current_setting('fursad.admin_write', true), '') = 'true' then
    return new;
  end if;
  if new.full_name is not distinct from old.full_name then
    return new;
  end if;
  -- Setting a name for the first time is not a change.
  if nullif(btrim(old.full_name), '') is null then
    return new;
  end if;
  -- Whitespace-only edits of the same name are not a change either.
  if btrim(new.full_name) is not distinct from btrim(old.full_name) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('name_change:' || new.id::text, 0));

  select count(*), min(changed_at) into v_used, v_next
  from public.profile_name_changes
  where user_id = new.id and waived_at is null and changed_at > now() - private.name_change_window();

  if v_used >= private.name_change_limit() then
    raise exception 'name_change_limit' using errcode = 'P0001', hint = 'name_change_limit',
      detail = (v_next + private.name_change_window())::text;
  end if;

  insert into public.profile_name_changes (user_id, old_name, new_name) values (new.id, old.full_name, new.full_name);
  return new;
end;
$$;
revoke all on function private.limit_name_change() from public, anon, authenticated;

drop trigger if exists profiles_e_limit_name_change on public.profiles;
create trigger profiles_e_limit_name_change
  before update of full_name on public.profiles
  for each row execute function private.limit_name_change();

create or replace function public.my_name_change_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_used int;
  v_oldest timestamptz;
  v_limit int := private.name_change_limit();
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  select count(*), min(changed_at) into v_used, v_oldest
  from public.profile_name_changes
  where user_id = v_uid and waived_at is null and changed_at > now() - private.name_change_window();
  return jsonb_build_object(
    'limit', v_limit,
    'window_days', extract(day from private.name_change_window())::int,
    'used', v_used,
    'remaining', greatest(v_limit - v_used, 0),
    'next_available_at', case when v_used >= v_limit then v_oldest + private.name_change_window() else null end
  );
end;
$$;
revoke all on function public.my_name_change_status() from public, anon;
grant execute on function public.my_name_change_status() to authenticated;

create or replace function public.admin_reset_name_changes(p_user uuid, p_reason text)
returns int
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_n int;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if p_user is null or nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A user and a reason are required' using errcode = '22023';
  end if;
  update public.profile_name_changes set waived_at = now(), waived_by = auth.uid()
  where user_id = p_user and waived_at is null and changed_at > now() - private.name_change_window();
  get diagnostics v_n = row_count;
  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), 'reset_name_changes', 'user', p_user::text, btrim(p_reason), jsonb_build_object('waived', v_n));
  return v_n;
end;
$$;
revoke all on function public.admin_reset_name_changes(uuid, text) from public, anon;
grant execute on function public.admin_reset_name_changes(uuid, text) to authenticated;

commit;
