-- 0039 — Moderation enforcement (Phase 3): staff roles, listing removal / reversible deactivation, warnings,
-- temporary suspensions with expiry, permanent bans. Everything is enforced IN THE DATABASE (RLS, triggers,
-- SECURITY DEFINER RPCs). Every action writes an internal moderation event, an audit row and a seller-visible
-- notice in one transaction.
--
-- NOT applied to any real database by this commit. Tested on PGlite (real PostgreSQL) by
-- supabase/tests/moderation.test.mjs. Rollback: supabase/rollback/0039_moderation_enforcement_ROLLBACK.sql.
-- Requires 0038 (is_client_write(), protected-column triggers).
--
-- Deployment note: apply 0038 -> 0039 before shipping the app versions that read these tables.
-- Staff members are still created manually (see 0027's header): insert into admin_users(user_id, role).
--
-- Backward compatibility: the 0027 RPCs (admin_set_listing_status / admin_warn_user / admin_set_account_status)
-- keep their names and signatures and now delegate to the new functions, so an older web admin keeps working
-- (and its actions gain events + seller notices). Status 'removed' keeps its meaning.

-- ============================================================================
-- 1. Staff roles
-- ============================================================================
alter table public.admin_users add column if not exists role text not null default 'admin';
alter table public.admin_users drop constraint if exists admin_users_role_check;
alter table public.admin_users add constraint admin_users_role_check check (role in ('admin', 'moderator', 'support'));

create or replace function public.staff_role()
returns text
language sql
stable
security definer
set search_path = public
as $$ select role from public.admin_users where user_id = auth.uid() $$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists (select 1 from public.admin_users where user_id = auth.uid()) $$;

-- is_admin() keeps meaning "full administrator" (all existing rows default to role 'admin').
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists (select 1 from public.admin_users where user_id = auth.uid() and role = 'admin') $$;

-- Permission matrix. admin: everything. moderator: moderation + support + appeal decisions except bans.
-- support: read + support conversations only.
create or replace function public.staff_can(p_action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case public.staff_role()
    when 'admin' then true
    when 'moderator' then p_action in ('read', 'report_status', 'moderate_listing', 'warn', 'suspend', 'support', 'decide_appeal_listing', 'decide_appeal_suspension')
    when 'support' then p_action in ('read', 'support')
    else false
  end
$$;
-- These stay executable by anon on purpose: RLS policy expressions run with the CALLER's privileges, and
-- 'listings are publicly readable' (which calls is_staff()) must keep working for signed-out visitors. Without a
-- session they simply return false/null.
grant execute on function public.staff_role(), public.is_staff(), public.staff_can(text) to anon, authenticated;

drop policy if exists "admins can view all reports" on public.reports;
drop policy if exists "staff can view all reports" on public.reports;
create policy "staff can view all reports" on public.reports for select using (public.staff_can('report_status'));
drop policy if exists "admins can view warnings" on public.moderation_warnings;
drop policy if exists "staff can view warnings" on public.moderation_warnings;
create policy "staff can view warnings" on public.moderation_warnings for select using (public.staff_can('warn'));

-- ============================================================================
-- 2. Account state: suspended (with expiry) / banned
-- ============================================================================
alter table public.profiles add column if not exists suspended_until timestamptz;
alter table public.profiles drop constraint if exists profiles_account_status_check;
alter table public.profiles add constraint profiles_account_status_check check (account_status in ('active', 'suspended', 'banned'));
alter table public.profiles drop constraint if exists profiles_suspension_consistent;
alter table public.profiles add constraint profiles_suspension_consistent check (suspended_until is null or account_status = 'suspended');

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
    new.suspended_until := null;
    return new;
  end if;
  if new.verified_at is distinct from old.verified_at then
    raise exception 'verified_at is managed by staff only' using errcode = '42501';
  end if;
  if new.account_status is distinct from old.account_status or new.suspended_until is distinct from old.suspended_until then
    raise exception 'account_status is managed by staff only' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- What the account can do RIGHT NOW (a suspension whose end date has passed is already over — no cron needed).
create or replace function public.account_effective_status(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when p.account_status = 'suspended' and p.suspended_until is not null and p.suspended_until <= now()
              then 'active' else p.account_status end
    from public.profiles p where p.id = p_uid
$$;
grant execute on function public.account_effective_status(uuid) to authenticated;
revoke execute on function public.account_effective_status(uuid) from anon, public;

-- ============================================================================
-- 3. Listings: 'deactivated' status, hidden from the public, staff-only transitions
-- ============================================================================
alter table public.listings add column if not exists status_before_moderation text;
alter table public.listings drop constraint if exists listings_status_check;
alter table public.listings add constraint listings_status_check
  check (status in ('available', 'reserved', 'sold', 'expired', 'removed', 'deactivated'));

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
    new.status_before_moderation := null;
    new.views := 0;
    new.favorites_count := 0;
    if new.status in ('removed', 'deactivated') then
      raise exception 'Only staff can remove or deactivate a listing' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.boosted_until is distinct from old.boosted_until
     or new.last_price_drop_at is distinct from old.last_price_drop_at
     or new.last_price_drop_from is distinct from old.last_price_drop_from
     or new.status_before_moderation is distinct from old.status_before_moderation
     or new.views is distinct from old.views
     or new.favorites_count is distinct from old.favorites_count then
    raise exception 'Protected listing column' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Invoker (not definer) on purpose: is_client_write() looks at current_user.
create or replace function public.guard_listing_removed_transition()
returns trigger
language plpgsql
as $$
begin
  if public.is_client_write() and (
       (new.status in ('removed', 'deactivated') and old.status is distinct from new.status)
    or (old.status in ('removed', 'deactivated') and new.status is distinct from old.status)
  ) then
    raise exception 'Only staff can remove, deactivate or restore a listing' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop policy if exists "listings are publicly readable" on public.listings;
create policy "listings are publicly readable" on public.listings
  for select using (status not in ('removed', 'deactivated') or auth.uid() = user_id or public.is_staff());

-- A suspended/banned seller cannot create, edit or delete listings; nobody can edit or delete a listing while it
-- is removed/deactivated (the evidence stays intact and the decision can only be changed by staff).
create or replace function public.trg_block_restricted_listing_writes()
returns trigger
language plpgsql
as $$
declare
  v_owner uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
begin
  if public.is_client_write() then
    if public.account_effective_status(v_owner) in ('suspended', 'banned') then
      raise exception 'Account suspended' using errcode = '42501';
    end if;
    if tg_op in ('UPDATE', 'DELETE') and old.status in ('removed', 'deactivated') then
      raise exception 'This listing is under review and cannot be changed' using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists listings_c_block_restricted on public.listings;
create trigger listings_c_block_restricted
  before insert or update or delete on public.listings
  for each row execute function public.trg_block_restricted_listing_writes();

-- ============================================================================
-- 4. Rate limits / suspension gate (0031 body preserved, suspension check now expiry-aware, banned included,
--    new actions for reports and support)
-- ============================================================================
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

  -- Restricted accounts may still change their profile settings, file reports and use support/appeals.
  if tg_argv[0] not in ('update_profile', 'create_report', 'create_support_case', 'create_support_message', 'create_appeal')
     and public.account_effective_status(auth.uid()) in ('suspended', 'banned') then
    raise exception 'Account suspended' using errcode = '42501';
  end if;

  case tg_argv[0]
    when 'create_listing' then
      if not exists (select 1 from public.listings where id = new.id) then
        perform public.enforce_rate_limit('create_listing', 10, interval '1 hour');
      end if;
    when 'create_offer' then perform public.enforce_rate_limit('create_offer', 20, interval '1 hour');
    when 'create_review' then perform public.enforce_rate_limit('create_review', 10, interval '1 day');
    when 'create_favorite' then perform public.enforce_rate_limit('create_favorite', 60, interval '1 minute');
    when 'create_follow' then perform public.enforce_rate_limit('create_follow', 30, interval '1 minute');
    when 'update_profile' then perform public.enforce_rate_limit('update_profile', 20, interval '1 hour');
    when 'create_message' then perform public.enforce_rate_limit('create_message', 60, interval '1 minute');
    when 'create_report' then perform public.enforce_rate_limit('create_report', 20, interval '1 day');
    when 'create_support_case' then perform public.enforce_rate_limit('create_support_case', 5, interval '1 day');
    when 'create_support_message' then perform public.enforce_rate_limit('create_support_message', 30, interval '1 hour');
    when 'create_appeal' then perform public.enforce_rate_limit('create_appeal', 5, interval '1 day');
    else raise exception 'trg_enforce_rate_limit: unknown action %', tg_argv[0];
  end case;
  return new;
end;
$$;

-- Report abuse: one report per target per reporter already exists (unique constraint, 0003); add the daily cap,
-- forbid reporting yourself, and bound the free text.
alter table public.reports drop constraint if exists reports_details_length;
alter table public.reports add constraint reports_details_length check (details is null or char_length(details) <= 1000) not valid;
alter table public.reports drop constraint if exists reports_reason_length;
alter table public.reports add constraint reports_reason_length check (char_length(reason) between 1 and 200) not valid;

create or replace function public.trg_reports_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.target_type = 'user' and new.target_id = new.reporter_id::text then
    raise exception 'You cannot report yourself' using errcode = '23514';
  end if;
  if new.target_type = 'listing' and exists (select 1 from public.listings l where l.id::text = new.target_id and l.user_id = new.reporter_id) then
    raise exception 'You cannot report your own listing' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists reports_a_guard on public.reports;
create trigger reports_a_guard before insert on public.reports for each row execute function public.trg_reports_guard();
drop trigger if exists rate_limit_reports on public.reports;
create trigger rate_limit_reports before insert on public.reports for each row execute function public.trg_enforce_rate_limit('create_report');

-- ============================================================================
-- 5. Internal moderation events + seller-visible notices
-- ============================================================================
create table if not exists public.moderation_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  actor_id uuid references public.profiles (id) on delete set null,   -- null = system (e.g. suspension expiry)
  action text not null check (action in (
    'listing_removed', 'listing_deactivated', 'listing_restored', 'warning', 'suspension', 'suspension_lifted',
    'suspension_expired', 'ban', 'unban', 'appeal_approved', 'appeal_rejected')),
  target_type text not null check (target_type in ('listing', 'user')),
  listing_id uuid references public.listings (id) on delete set null,
  user_id uuid not null references public.profiles (id) on delete cascade,   -- the affected seller
  report_id uuid references public.reports (id) on delete set null,
  reason text not null,               -- INTERNAL justification, never shown to the seller
  public_message text,                -- what the seller was told
  from_status text,
  to_status text,
  until timestamptz,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists moderation_events_listing_idx on public.moderation_events (listing_id, created_at desc);
create index if not exists moderation_events_user_idx on public.moderation_events (user_id, created_at desc);
create index if not exists moderation_events_created_idx on public.moderation_events (created_at desc);
alter table public.moderation_events enable row level security;
drop policy if exists "staff read moderation events" on public.moderation_events;
create policy "staff read moderation events" on public.moderation_events for select using (public.staff_can('read'));

create table if not exists public.moderation_notices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_id uuid references public.moderation_events (id) on delete set null,
  kind text not null,                 -- same vocabulary as moderation_events.action
  listing_id uuid references public.listings (id) on delete set null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  from_label text not null default 'Suuqiye Support Team',
  appealable boolean not null default false,
  expires_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists moderation_notices_user_idx on public.moderation_notices (user_id, created_at desc);
alter table public.moderation_notices enable row level security;
drop policy if exists "users read their own notices" on public.moderation_notices;
create policy "users read their own notices" on public.moderation_notices for select using (auth.uid() = user_id);
-- No client write policies: notices are created by _moderation_record(), marked read by mark_notice_read().

create or replace function public.mark_notice_read(p_notice_id uuid)
returns void
language sql
security definer
set search_path = public
as $$ update public.moderation_notices set read_at = coalesce(read_at, now()) where id = p_notice_id and user_id = auth.uid() $$;
grant execute on function public.mark_notice_read(uuid) to authenticated;
revoke execute on function public.mark_notice_read(uuid) from anon, public;

-- Internal writer — never callable by API roles.
create or replace function public._moderation_record(
  p_actor uuid, p_action text, p_user uuid, p_listing uuid, p_report uuid,
  p_reason text, p_message text, p_from text, p_to text, p_until timestamptz, p_meta jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event uuid;
  v_title text;
  v_body text;
  v_appealable boolean := false;
  v_item text := coalesce(p_meta ->> 'title', 'your listing');
  v_target text := case when p_listing is null then 'user' else 'listing' end;
  v_audit text;
  -- An appeal decision records the reversal itself and tells the seller once (0040 sets this for the statement).
  v_quiet boolean := coalesce(current_setting('fursad.suppress_notice', true), '') = 'true';
begin
  select title, body, appealable into v_title, v_body, v_appealable from (values
    ('listing_removed',     'Your listing was removed',        format('Your listing “%s” was removed because it does not follow the SUUQIYE community guidelines.', v_item), true),
    ('listing_deactivated', 'Your listing was deactivated',    format('Your listing “%s” is hidden from buyers while our team reviews it.', v_item), true),
    ('listing_restored',    'Your listing is live again',      format('Your listing “%s” has been restored and is visible to buyers again.', v_item), false),
    ('warning',             'You received a warning',          'Your account received a warning for not following the SUUQIYE community guidelines.', false),
    ('suspension',          'Your account is suspended',       'Your account is suspended. You can browse, but you cannot post, message or make offers until the suspension ends.', true),
    ('suspension_lifted',   'Your suspension was lifted',      'Your account is active again.', false),
    ('suspension_expired',  'Your suspension has ended',       'Your account is active again.', false),
    ('ban',                 'Your account was banned',         'Your account was permanently banned and your listings are hidden.', true),
    ('unban',               'Your ban was lifted',             'Your account is active again.', false),
    ('appeal_approved',     'Your appeal was approved',        'Our team reviewed your appeal and reversed the decision.', false),
    ('appeal_rejected',     'Your appeal was not approved',    'Our team reviewed your appeal and kept the original decision.', false)
  ) as t(kind, title, body, appealable) where kind = p_action;
  if v_title is null then
    raise exception 'Unknown moderation action %', p_action;
  end if;
  if nullif(btrim(coalesce(p_message, '')), '') is not null then
    v_body := v_body || E'\n\n' || btrim(p_message);
  end if;

  insert into public.moderation_events (actor_id, action, target_type, listing_id, user_id, report_id, reason, public_message, from_status, to_status, until, metadata)
  values (p_actor, p_action, v_target, p_listing, p_user, p_report, btrim(p_reason), nullif(btrim(coalesce(p_message, '')), ''), p_from, p_to, p_until, p_meta)
  returning id into v_event;

  if not v_quiet then
    insert into public.moderation_notices (user_id, event_id, kind, listing_id, title, body, data, appealable, expires_at)
    values (p_user, v_event, p_action, p_listing, v_title, v_body,
            jsonb_strip_nulls(jsonb_build_object('listingTitle', p_meta ->> 'title', 'until', p_until)), v_appealable, p_until);

    -- Push/in-app notification (existing notifications pipeline). Wording is deliberately generic.
    insert into public.notifications (user_id, title, body, type, data)
    values (p_user, 'Suuqiye Support Team', v_title, 'moderation',
            jsonb_build_object('kind', p_action, 'listingId', p_listing, 'eventId', v_event));
  end if;

  v_audit := case p_action
    when 'listing_removed' then 'remove_listing' when 'listing_restored' then 'restore_listing'
    when 'warning' then 'warn_user' when 'suspension' then 'suspend_user' when 'suspension_lifted' then 'unsuspend_user'
    else p_action end;
  if p_actor is not null then
    insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason, metadata)
    values (p_actor, v_audit, v_target, coalesce(p_listing, p_user)::text, btrim(p_reason), jsonb_build_object('event_id', v_event, 'user_id', p_user));
  end if;
  return v_event;
end;
$$;
revoke execute on function public._moderation_record(uuid, text, uuid, uuid, uuid, text, text, text, text, timestamptz, jsonb) from public, anon, authenticated;

-- ============================================================================
-- 6. Enforcement RPCs
-- ============================================================================
create or replace function public.admin_moderate_listing(
  p_listing_id uuid, p_action text, p_reason text, p_message text default null, p_report_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_l public.listings%rowtype;
  v_to text;
  v_event text;
  v_owner_status text;
  v_id uuid;
begin
  if not public.staff_can('moderate_listing') then
    raise exception 'Not authorized to moderate listings' using errcode = '42501';
  end if;
  if p_action not in ('remove', 'deactivate', 'restore') then
    raise exception 'Unknown listing action %', p_action using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  if p_message is not null and char_length(p_message) > 1000 then
    raise exception 'The message to the seller is too long' using errcode = '22023';
  end if;
  select * into v_l from public.listings where id = p_listing_id for update;
  if not found then
    raise exception 'Listing % not found', p_listing_id using errcode = 'P0002';
  end if;
  perform set_config('fursad.admin_write', 'true', true);

  if p_action = 'restore' then
    if v_l.status not in ('removed', 'deactivated') then
      raise exception 'Listing is not removed or deactivated' using errcode = '23514';
    end if;
    select account_status into v_owner_status from public.profiles where id = v_l.user_id;
    if v_owner_status = 'banned' then
      raise exception 'The seller is banned; lift the ban first' using errcode = '23514';
    end if;
    v_to := coalesce(nullif(v_l.status_before_moderation, ''), 'available');
    if v_to in ('removed', 'deactivated') then v_to := 'available'; end if;
    update public.listings set status = v_to, status_before_moderation = null where id = p_listing_id;
    v_event := 'listing_restored';
  else
    v_to := case p_action when 'remove' then 'removed' else 'deactivated' end;
    if v_l.status = v_to then
      raise exception 'Listing is already %', v_to using errcode = '23505';
    end if;
    if p_action = 'deactivate' and v_l.status = 'removed' then
      raise exception 'A removed listing cannot be deactivated; restore it first' using errcode = '23514';
    end if;
    update public.listings
       set status = v_to,
           status_before_moderation = case when v_l.status in ('removed', 'deactivated') then v_l.status_before_moderation else v_l.status end,
           boosted_until = null
     where id = p_listing_id;
    update public.listing_boosts set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = 'Listing moderated'
     where listing_id = p_listing_id and revoked_at is null and ends_at > now();
    v_event := case p_action when 'remove' then 'listing_removed' else 'listing_deactivated' end;
  end if;

  v_id := public._moderation_record(auth.uid(), v_event, v_l.user_id, v_l.id, p_report_id, p_reason, p_message, v_l.status, v_to, null,
                                    jsonb_build_object('title', v_l.title));

  if p_action = 'remove' then
    update public.reports set status = 'reviewed'
     where target_type = 'listing' and target_id = p_listing_id::text and status in ('pending', 'reviewing');
  elsif p_report_id is not null then
    update public.reports set status = 'reviewed' where id = p_report_id and status in ('pending', 'reviewing');
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_moderate_user(
  p_user_id uuid, p_action text, p_reason text, p_message text default null, p_until timestamptz default null, p_report_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.profiles%rowtype;
  v_perm text;
  v_id uuid;
  v_count int := 0;
begin
  v_perm := case p_action when 'warn' then 'warn' when 'suspend' then 'suspend' when 'lift_suspension' then 'suspend'
                          when 'ban' then 'ban' when 'unban' then 'ban' else null end;
  if v_perm is null then
    raise exception 'Unknown user action %', p_action using errcode = '22023';
  end if;
  if not public.staff_can(v_perm) then
    raise exception 'Not authorized for %', p_action using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  if p_message is not null and char_length(p_message) > 1000 then
    raise exception 'The message to the seller is too long' using errcode = '22023';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot moderate your own account' using errcode = '42501';
  end if;
  if exists (select 1 from public.admin_users where user_id = p_user_id) then
    raise exception 'Staff accounts cannot be moderated here' using errcode = '42501';
  end if;
  select * into v_p from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'User % not found', p_user_id using errcode = 'P0002';
  end if;
  perform set_config('fursad.admin_write', 'true', true);

  if p_action = 'warn' then
    insert into public.moderation_warnings (user_id, admin_id, reason, note) values (p_user_id, auth.uid(), btrim(p_reason), nullif(btrim(coalesce(p_message, '')), ''));
    v_id := public._moderation_record(auth.uid(), 'warning', p_user_id, null, p_report_id, p_reason, p_message, v_p.account_status, v_p.account_status, null);

  elsif p_action = 'suspend' then
    if v_p.account_status = 'banned' then
      raise exception 'User is banned' using errcode = '23514';
    end if;
    if p_until is null or p_until <= now() + interval '1 minute' then
      raise exception 'A suspension needs a future end date' using errcode = '22023';
    end if;
    if p_until > now() + interval '365 days' then
      raise exception 'A suspension lasts at most 365 days; use a ban for longer' using errcode = '22023';
    end if;
    update public.profiles set account_status = 'suspended', suspended_until = p_until where id = p_user_id;
    v_id := public._moderation_record(auth.uid(), 'suspension', p_user_id, null, p_report_id, p_reason, p_message, v_p.account_status, 'suspended', p_until);

  elsif p_action = 'lift_suspension' then
    if v_p.account_status <> 'suspended' then
      raise exception 'User is not suspended' using errcode = '23514';
    end if;
    update public.profiles set account_status = 'active', suspended_until = null where id = p_user_id;
    v_id := public._moderation_record(auth.uid(), 'suspension_lifted', p_user_id, null, null, p_reason, p_message, 'suspended', 'active', null);

  elsif p_action = 'ban' then
    if v_p.account_status = 'banned' then
      raise exception 'User is already banned' using errcode = '23505';
    end if;
    update public.profiles set account_status = 'banned', suspended_until = null where id = p_user_id;
    -- Hide everything the user has on the marketplace; remember each listing's previous status for an unban.
    with moved as (
      update public.listings set status_before_moderation = status, status = 'deactivated', boosted_until = null
       where user_id = p_user_id and status in ('available', 'reserved', 'sold', 'expired')
      returning id, status_before_moderation
    ), ev as (
      insert into public.moderation_events (actor_id, action, target_type, listing_id, user_id, reason, from_status, to_status, metadata)
      select auth.uid(), 'listing_deactivated', 'listing', m.id, p_user_id, btrim(p_reason), m.status_before_moderation, 'deactivated', '{"cascade":"ban"}'::jsonb
        from moved m returning 1
    )
    select count(*) into v_count from ev;
    update public.listing_boosts set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = 'Account banned'
     where revoked_at is null and ends_at > now() and listing_id in (select id from public.listings where user_id = p_user_id);
    v_id := public._moderation_record(auth.uid(), 'ban', p_user_id, null, p_report_id, p_reason, p_message, v_p.account_status, 'banned', null,
                                      jsonb_build_object('listings_deactivated', v_count));

  else -- unban
    if v_p.account_status <> 'banned' then
      raise exception 'User is not banned' using errcode = '23514';
    end if;
    update public.profiles set account_status = 'active', suspended_until = null where id = p_user_id;
    -- Restore only the listings the ban itself hid (latest event for the listing is the ban cascade).
    with cand as (
      select l.id from public.listings l
       where l.user_id = p_user_id and l.status = 'deactivated'
         and (select e.metadata ->> 'cascade' from public.moderation_events e where e.listing_id = l.id order by e.created_at desc, e.id desc limit 1) = 'ban'
    ), moved as (
      update public.listings l
         set status = case when coalesce(l.status_before_moderation, '') in ('', 'removed', 'deactivated') then 'available' else l.status_before_moderation end,
             status_before_moderation = null
        from cand where l.id = cand.id
      returning l.id, l.status
    ), ev as (
      insert into public.moderation_events (actor_id, action, target_type, listing_id, user_id, reason, from_status, to_status, metadata)
      select auth.uid(), 'listing_restored', 'listing', m.id, p_user_id, btrim(p_reason), 'deactivated', m.status, '{"cascade":"unban"}'::jsonb from moved m returning 1
    )
    select count(*) into v_count from ev;
    v_id := public._moderation_record(auth.uid(), 'unban', p_user_id, null, null, p_reason, p_message, 'banned', 'active', null,
                                      jsonb_build_object('listings_restored', v_count));
  end if;

  if p_report_id is not null then
    update public.reports set status = 'reviewed' where id = p_report_id and status in ('pending', 'reviewing');
  end if;
  return v_id;
end;
$$;

-- Suspension expiry: lazy per user (called by my_account_state when the app opens) and bulk (for a scheduled job).
create or replace function public._lift_expired_suspension(p_uid uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_until timestamptz;
begin
  select suspended_until into v_until from public.profiles
   where id = p_uid and account_status = 'suspended' and suspended_until is not null and suspended_until <= now() for update;
  if not found then
    return false;
  end if;
  perform set_config('fursad.admin_write', 'true', true);
  update public.profiles set account_status = 'active', suspended_until = null where id = p_uid;
  perform public._moderation_record(null, 'suspension_expired', p_uid, null, null, 'Suspension period ended', null, 'suspended', 'active', null, '{}'::jsonb);
  return true;
end;
$$;
revoke execute on function public._lift_expired_suspension(uuid) from public, anon, authenticated;

create or replace function public.lift_expired_suspensions()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in select id from public.profiles where account_status = 'suspended' and suspended_until is not null and suspended_until <= now() loop
    if public._lift_expired_suspension(r.id) then n := n + 1; end if;
  end loop;
  return n;
end;
$$;
-- Service role / scheduled job only (pg_cron wiring is a production step — see docs).
revoke execute on function public.lift_expired_suspensions() from public, anon, authenticated;

create or replace function public.my_account_state()
returns table (status text, suspended_until timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  perform public._lift_expired_suspension(auth.uid());
  return query select p.account_status, p.suspended_until from public.profiles p where p.id = auth.uid();
end;
$$;
grant execute on function public.my_account_state() to authenticated;
revoke execute on function public.my_account_state() from anon, public;

grant execute on function public.admin_moderate_listing(uuid, text, text, text, uuid), public.admin_moderate_user(uuid, text, text, text, timestamptz, uuid) to authenticated;
revoke execute on function public.admin_moderate_listing(uuid, text, text, text, uuid), public.admin_moderate_user(uuid, text, text, text, timestamptz, uuid) from anon, public;

-- ---- 0027 RPCs: same names/signatures, now delegating (older admin UIs keep working) ----
create or replace function public.admin_set_listing_status(p_listing_id uuid, p_status text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('available', 'removed') then
    raise exception 'Invalid listing status for moderation: %', p_status;
  end if;
  perform public.admin_moderate_listing(p_listing_id, case when p_status = 'removed' then 'remove' else 'restore' end, p_reason);
end;
$$;

create or replace function public.admin_warn_user(p_user_id uuid, p_reason text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_moderate_user(p_user_id, 'warn', p_reason, p_note);
end;
$$;

-- Legacy "suspend" had no end date; the wrapper applies a 30-day suspension (new clients choose an explicit date).
create or replace function public.admin_set_account_status(p_user_id uuid, p_status text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('active', 'suspended') then
    raise exception 'Invalid account status: %', p_status;
  end if;
  if p_status = 'suspended' then
    perform public.admin_moderate_user(p_user_id, 'suspend', p_reason, null, now() + interval '30 days');
  else
    perform public.admin_moderate_user(p_user_id, 'lift_suspension', p_reason);
  end if;
end;
$$;

-- Report status changes by moderators (0027 allowed admins only).
create or replace function public.admin_update_report_status(p_report_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.staff_can('report_status') then
    raise exception 'Only staff can update report status' using errcode = '42501';
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
