-- 0050 — rollout ladder for listing-photo scans: off → shadow → enforce, plus a separate, gated switch that closes the
-- legacy public upload path. Needs 0048 applied first. NOT APPLIED anywhere; applying it changes nothing (mode 'off').
--
-- Why a ladder: 0048 has one boolean. Flipping it on while old app builds (which upload straight to the public
-- bucket and know nothing about scans) are still in use would make every one of their publishes fail with a generic
-- error. The ladder lets us measure first, then enforce, then close the old door — each step reversible by one UPDATE.
--
--   off      today's behaviour. Nothing is checked, nothing is recorded.
--   shadow   nothing is blocked or held. Every client write that adds photos records HOW MANY of them had a finished
--            scan and how many did not. That count is the evidence for "old clients are gone" — no guessing.
--   enforce  0048's rules: unscanned/rejected photos cannot be published; "review" photos hide the listing.
--   legacy_presign_closed (only valid in enforce) tells r2-presign to stop issuing public `listings/…` upload URLs.
--
-- Rollback of any step: set mode back (one statement); leaving enforce automatically re-opens the legacy presign path.

-- ============================================================================
-- 1. Config columns (the 0048 `enforce` boolean stays and is kept in sync, so 0048-era code and tests still work)
-- ============================================================================
alter table public.image_scan_config
  add column if not exists mode text not null default 'off',
  add column if not exists legacy_presign_closed boolean not null default false,
  add column if not exists shadow_started_at timestamptz,
  add column if not exists min_shadow_hours int not null default 72 check (min_shadow_hours >= 0);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'image_scan_config_mode_check') then
    alter table public.image_scan_config add constraint image_scan_config_mode_check check (mode in ('off', 'shadow', 'enforce'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'image_scan_config_closure_needs_enforce') then
    alter table public.image_scan_config add constraint image_scan_config_closure_needs_enforce check (not legacy_presign_closed or mode = 'enforce');
  end if;
end $$;

-- Existing rows: carry the old boolean over (an unapplied-0048 database simply has enforce = false → 'off').
update public.image_scan_config set mode = 'enforce' where enforce and mode = 'off';

-- `enforce` and `mode` can never disagree, whichever one an operator edits. Leaving 'enforce' also re-opens the
-- legacy presign path, so a rollback is always one statement.
create or replace function public.trg_image_scan_config_sync()
returns trigger language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.enforce is distinct from old.enforce and new.mode is not distinct from old.mode then
    new.mode := case when new.enforce then 'enforce' else case when old.mode = 'enforce' then 'off' else old.mode end end;
  end if;
  new.enforce := (new.mode = 'enforce');
  if new.mode <> 'enforce' then new.legacy_presign_closed := false; end if;
  if new.mode = 'shadow' and (tg_op = 'INSERT' or old.mode is distinct from 'shadow') then new.shadow_started_at := now(); end if;
  if new.mode = 'off' then new.shadow_started_at := null; end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists image_scan_config_sync on public.image_scan_config;
create trigger image_scan_config_sync before insert or update on public.image_scan_config
  for each row execute function public.trg_image_scan_config_sync();

create or replace function public.image_scan_mode()
returns text language sql stable security definer set search_path = public
as $$ select coalesce((select mode from public.image_scan_config where id), 'off') $$;

-- ============================================================================
-- 2. What shadow mode records
-- ============================================================================
create table if not exists public.image_scan_shadow_events (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null,
  listing_id uuid not null,
  op text not null check (op in ('INSERT', 'UPDATE')),
  photos_added int not null check (photos_added > 0),
  verified int not null default 0,      -- photos that had a finished scan by this user for this listing
  unverified int not null default 0,    -- photos with no scan (old app build, direct API write, bulk import…)
  rejected int not null default 0,      -- photos whose scan verdict was reject and not overridden
  held int not null default 0           -- photos that enforcement WOULD have put on hold for review
);
create index if not exists image_scan_shadow_events_created_idx on public.image_scan_shadow_events (created_at desc);
alter table public.image_scan_shadow_events enable row level security;
drop policy if exists "staff read shadow events" on public.image_scan_shadow_events;
create policy "staff read shadow events" on public.image_scan_shadow_events for select using (public.staff_can('read'));
revoke all on public.image_scan_shadow_events from anon, authenticated;
grant select on public.image_scan_shadow_events to authenticated; -- RLS limits it to staff

create or replace function public._scan_shadow_record(p_listing uuid, p_user uuid, p_op text, p_verified int, p_unverified int, p_rejected int, p_held int)
returns void language sql security definer set search_path = public
as $$
  insert into public.image_scan_shadow_events (listing_id, user_id, op, photos_added, verified, unverified, rejected, held)
  values (p_listing, p_user, p_op, p_verified + p_unverified + p_rejected + p_held, p_verified, p_unverified, p_rejected, p_held)
$$;
revoke execute on function public._scan_shadow_record(uuid, uuid, text, int, int, int, int) from public, anon;
grant execute on function public._scan_shadow_record(uuid, uuid, text, int, int, int, int) to authenticated;   -- called by the invoker trigger

-- ============================================================================
-- 3. The trigger: off = nothing, shadow = record only, enforce = 0048's rules (unchanged)
-- ============================================================================
create or replace function public.trg_listing_image_scan()
returns trigger
language plpgsql
as $$
declare
  v_mode text;
  v_url text;
  v_state record;
  v_hold boolean := false;
  v_scans uuid[] := '{}';
  v_check text[];
  v_ok int := 0;
  v_none int := 0;
  v_rej int := 0;
  v_rev int := 0;
begin
  if not public.is_client_write() then
    return new;
  end if;
  v_mode := public.image_scan_mode();
  if v_mode = 'off' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.images is not distinct from old.images then
    return new;
  end if;

  -- Insert: every photo must be verified. Update: new photos must be; photos that were already on the listing are
  -- re-checked only when the listing is being released from a scan hold.
  v_check := case when tg_op = 'INSERT' then new.images
                  else coalesce(array(select u from unnest(new.images) u where not (u = any (old.images))), '{}') end;

  if v_mode = 'shadow' then
    foreach v_url in array v_check loop
      select * into v_state from public._scan_image_state(v_url, new.user_id, new.id);
      if not found then v_none := v_none + 1;
      elsif v_state.review_status = 'rejected' or (v_state.verdict = 'reject' and v_state.review_status <> 'approved') then v_rej := v_rej + 1;
      elsif v_state.verdict = 'review' and v_state.review_status <> 'approved' then v_rev := v_rev + 1;
      else v_ok := v_ok + 1;
      end if;
    end loop;
    if coalesce(array_length(v_check, 1), 0) > 0 then
      perform public._scan_shadow_record(new.id, new.user_id, tg_op, v_ok, v_none, v_rej, v_rev);
    end if;
    return new;   -- shadow never blocks and never holds
  end if;

  foreach v_url in array v_check loop
    select * into v_state from public._scan_image_state(v_url, new.user_id, new.id);
    if not found then
      raise exception 'Photo has not been checked' using errcode = '42501', hint = 'image_not_verified';
    end if;
    if v_state.review_status = 'rejected' or (v_state.verdict = 'reject' and v_state.review_status <> 'approved') then
      raise exception 'Photo was not accepted' using errcode = '42501', hint = 'image_rejected';
    end if;
    if v_state.verdict = 'review' and v_state.review_status <> 'approved' then
      v_hold := true;
      v_scans := v_scans || v_state.scan_id;
    end if;
  end loop;

  if v_hold then
    new.status_before_moderation := case when tg_op = 'UPDATE' and old.status not in ('removed', 'deactivated') then old.status else 'available' end;
    new.status := 'deactivated';
    perform public._scan_mark_held(v_scans);
  elsif tg_op = 'UPDATE' and old.status = 'deactivated' and public._listing_awaiting_replacement(old.id)
        and public._scan_unresolved_count(new.images, new.user_id, new.id) = 0 then
    new.status := coalesce(nullif(old.status_before_moderation, ''), 'available');
    new.status_before_moderation := null;
  end if;
  return new;
end;
$$;

-- ============================================================================
-- 4. What the apps / presign function / staff can read, and the only ways to move the ladder
-- ============================================================================
-- Public, secret-free: lets a client fail closed with a clear "update required" message instead of a generic error.
create or replace function public.image_scan_client_policy()
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('mode', c.mode, 'scanRequired', c.mode <> 'off', 'legacyUploadClosed', c.legacy_presign_closed)
    from public.image_scan_config c where c.id
$$;
revoke execute on function public.image_scan_client_policy() from public;
grant execute on function public.image_scan_client_policy() to anon, authenticated, service_role;

create or replace function public.admin_image_scan_rollout_status()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare r jsonb;
begin
  if not public.staff_can('read') then raise exception 'Not authorized' using errcode = '42501'; end if;
  select jsonb_build_object(
    'mode', c.mode,
    'legacyPresignClosed', c.legacy_presign_closed,
    'shadowStartedAt', c.shadow_started_at,
    'shadowHours', case when c.shadow_started_at is null then null else round((extract(epoch from now() - c.shadow_started_at) / 3600)::numeric, 1) end,
    'minShadowHours', c.min_shadow_hours,
    'last7d', (select jsonb_build_object(
        'writes', count(*), 'verifiedPhotos', coalesce(sum(verified), 0), 'unverifiedPhotos', coalesce(sum(unverified), 0),
        'rejectedPhotos', coalesce(sum(rejected), 0), 'wouldHold', coalesce(sum(held), 0),
        'distinctUsersWithUnverified', count(distinct user_id) filter (where unverified > 0))
      from public.image_scan_shadow_events where created_at > now() - interval '7 days'),
    'last24hUnverifiedPhotos', (select coalesce(sum(unverified), 0) from public.image_scan_shadow_events where created_at > now() - interval '24 hours')
  ) into r from public.image_scan_config c where c.id;
  return r;
end;
$$;
revoke execute on function public.admin_image_scan_rollout_status() from anon, public;
grant execute on function public.admin_image_scan_rollout_status() to authenticated;

-- Moves the ladder one rung at a time. Going up requires admin + a reason; going down is always allowed to an admin.
-- off → shadow → enforce only (no jumping), and enforce needs min_shadow_hours of shadow data.
create or replace function public.admin_set_image_scan_mode(p_mode text, p_reason text)
returns text language plpgsql security definer set search_path = public
as $$
declare c public.image_scan_config%rowtype;
begin
  if public.staff_role() is distinct from 'admin' then raise exception 'Only an administrator can change the photo-check mode' using errcode = '42501'; end if;
  if p_mode not in ('off', 'shadow', 'enforce') then raise exception 'Unknown mode %', p_mode using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'A reason is required' using errcode = '22023'; end if;
  select * into c from public.image_scan_config where id for update;
  if p_mode = 'enforce' and c.mode <> 'shadow' and c.mode <> 'enforce' then
    raise exception 'Enforcement can only follow shadow mode' using errcode = '55000';
  end if;
  if p_mode = 'enforce' and c.mode = 'shadow'
     and (c.shadow_started_at is null or now() - c.shadow_started_at < make_interval(hours => c.min_shadow_hours)) then
    raise exception 'Shadow mode must run for at least % hours first', c.min_shadow_hours using errcode = '55000';
  end if;
  update public.image_scan_config set mode = p_mode where id;
  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), 'set_image_scan_mode', 'config', 'image_scan', btrim(p_reason), jsonb_build_object('from', c.mode, 'to', p_mode));
  return p_mode;
end;
$$;
revoke execute on function public.admin_set_image_scan_mode(text, text) from anon, public;
grant execute on function public.admin_set_image_scan_mode(text, text) to authenticated;

-- Closes (or re-opens) the legacy public listing-photo upload path. Only while enforcing; only an admin.
create or replace function public.admin_set_legacy_presign_closed(p_closed boolean, p_reason text)
returns boolean language plpgsql security definer set search_path = public
as $$
declare c public.image_scan_config%rowtype;
begin
  if public.staff_role() is distinct from 'admin' then raise exception 'Only an administrator can change this' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'A reason is required' using errcode = '22023'; end if;
  select * into c from public.image_scan_config where id for update;
  if p_closed and c.mode <> 'enforce' then raise exception 'The legacy upload path can only be closed while photo checks are enforced' using errcode = '55000'; end if;
  update public.image_scan_config set legacy_presign_closed = p_closed where id;
  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), 'set_legacy_presign_closed', 'config', 'image_scan', btrim(p_reason), jsonb_build_object('from', c.legacy_presign_closed, 'to', p_closed));
  return p_closed;
end;
$$;
revoke execute on function public.admin_set_legacy_presign_closed(boolean, text) from anon, public;
grant execute on function public.admin_set_legacy_presign_closed(boolean, text) to authenticated;

-- r2-presign (service role) reads the closure flag with this; fail-safe default when the row is missing is "open".
create or replace function public.legacy_presign_closed()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select legacy_presign_closed from public.image_scan_config where id), false) $$;
revoke execute on function public.legacy_presign_closed() from public, anon, authenticated;
grant execute on function public.legacy_presign_closed() to service_role;
