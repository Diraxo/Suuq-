-- Rollback for 0039_moderation_enforcement.sql (run AFTER rolling back anything built on it: 0040, 0041).
-- DESTRUCTIVE for data created by 0039: moderation_events, moderation_notices and staff roles are dropped.
-- Safety conversions so no row violates the restored constraints and nothing becomes publicly visible:
--   listings 'deactivated' -> 'removed' (still hidden), profiles 'banned' -> 'suspended' (still restricted).
-- Previous function bodies are the ones from 0027 / 0031 / 0038, restored verbatim.

update public.listings set status = 'removed' where status = 'deactivated';
update public.profiles set account_status = 'suspended', suspended_until = null where account_status = 'banned';

-- policies back to the 0027 forms
drop policy if exists "listings are publicly readable" on public.listings;
create policy "listings are publicly readable" on public.listings
  for select using (status <> 'removed' or auth.uid() = user_id or public.is_admin());
drop policy if exists "staff can view all reports" on public.reports;
create policy "admins can view all reports" on public.reports for select using (public.is_admin());
drop policy if exists "staff can view warnings" on public.moderation_warnings;
create policy "admins can view warnings" on public.moderation_warnings for select using (public.is_admin());

-- triggers added by 0039
drop trigger if exists listings_c_block_restricted on public.listings;
drop function if exists public.trg_block_restricted_listing_writes();
drop trigger if exists rate_limit_reports on public.reports;
drop trigger if exists reports_a_guard on public.reports;
drop function if exists public.trg_reports_guard();
alter table public.reports drop constraint if exists reports_details_length;
alter table public.reports drop constraint if exists reports_reason_length;

-- functions restored to their previous bodies
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

create or replace function public.guard_profile_protected_columns()
returns trigger
language plpgsql
as $$
begin
  if not public.is_client_write() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.verified_at := null;
    new.account_status := 'active';
    return new;
  end if;
  if new.verified_at is distinct from old.verified_at then
    raise exception 'verified_at is managed by staff only' using errcode = '42501';
  end if;
  if new.account_status is distinct from old.account_status then
    raise exception 'account_status is managed by staff only' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.guard_listing_protected_columns()
returns trigger
language plpgsql
as $$
begin
  if not public.is_client_write() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.boosted_until := null;
    new.last_price_drop_at := null;
    new.last_price_drop_from := null;
    new.views := 0;
    new.favorites_count := 0;
    return new;
  end if;
  if new.boosted_until is distinct from old.boosted_until
     or new.last_price_drop_at is distinct from old.last_price_drop_at
     or new.last_price_drop_from is distinct from old.last_price_drop_from
     or new.views is distinct from old.views
     or new.favorites_count is distinct from old.favorites_count then
    raise exception 'Protected listing column' using errcode = '42501';
  end if;
  return new;
end;
$$;

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

  if current_setting('suuqplus.skip_rate_limit', true) = 'true' then
    return new;
  end if;

  if tg_argv[0] <> 'update_profile' and exists (
    select 1 from public.profiles where id = auth.uid() and account_status = 'suspended'
  ) then
    raise exception 'Account suspended' using errcode = '42501';
  end if;

  case tg_argv[0]
    when 'create_listing' then
      -- Only a genuinely new listing counts toward the limit. An
      -- `INSERT ... ON CONFLICT (id) DO UPDATE` retry (an idempotent publish
      -- re-send with a stable client id) fires this BEFORE INSERT trigger
      -- even though it resolves to an UPDATE -- don't let that burn the
      -- seller's hourly quota. See migration header.
      if not exists (select 1 from public.listings where id = new.id) then
        perform public.enforce_rate_limit('create_listing', 10, interval '1 hour');
      end if;
    when 'create_offer' then perform public.enforce_rate_limit('create_offer', 20, interval '1 hour');
    when 'create_review' then perform public.enforce_rate_limit('create_review', 10, interval '1 day');
    when 'create_favorite' then perform public.enforce_rate_limit('create_favorite', 60, interval '1 minute');
    when 'create_follow' then perform public.enforce_rate_limit('create_follow', 30, interval '1 minute');
    when 'update_profile' then perform public.enforce_rate_limit('update_profile', 20, interval '1 hour');
    when 'create_message' then perform public.enforce_rate_limit('create_message', 60, interval '1 minute');
    else raise exception 'trg_enforce_rate_limit: unknown action %', tg_argv[0];
  end case;
  return new;
end;
$$;

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

-- new objects
drop function if exists public.admin_moderate_listing(uuid, text, text, text, uuid);
drop function if exists public.admin_moderate_user(uuid, text, text, text, timestamptz, uuid);
drop function if exists public.my_account_state();
drop function if exists public.lift_expired_suspensions();
drop function if exists public._lift_expired_suspension(uuid);
drop function if exists public._moderation_record(uuid, text, uuid, uuid, uuid, text, text, text, text, timestamptz, jsonb);
drop function if exists public.mark_notice_read(uuid);
drop table if exists public.moderation_notices;
drop table if exists public.moderation_events;
drop function if exists public.account_effective_status(uuid);

-- constraints / columns
alter table public.listings drop constraint if exists listings_status_check;
alter table public.listings add constraint listings_status_check check (status in ('available', 'reserved', 'sold', 'expired', 'removed'));
alter table public.listings drop column if exists status_before_moderation;
alter table public.profiles drop constraint if exists profiles_suspension_consistent;
alter table public.profiles drop constraint if exists profiles_account_status_check;
alter table public.profiles add constraint profiles_account_status_check check (account_status in ('active', 'suspended'));
alter table public.profiles drop column if exists suspended_until;

drop function if exists public.staff_can(text);
drop function if exists public.is_staff();
drop function if exists public.staff_role();
alter table public.admin_users drop constraint if exists admin_users_role_check;
alter table public.admin_users drop column if exists role;
