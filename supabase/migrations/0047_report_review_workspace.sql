-- 0047 — Report review workspace, verification notifications, notification integrity.
--
-- Audit findings this migration answers (details in docs/MODERATION_REPAIR_REPORT.md):
--   1. admin_set_verified() (0038) changed profiles.verified_at and wrote an audit row but NEVER told the user.
--   2. notify_on_report_status_change() (0021) sent "Your report was dismissed" for the 'reviewing' status too, and sent a
--      second copy every time a report was reopened and re-closed.
--   3. The admin report queue / detail read raw tables: reporter NAME only, and a removed listing is invisible to the
--      public-read RLS policy, so the evidence (images, description, price...) could not be shown.
--   4. Reports have no reviewer, no resolution note, no internal notes, and nothing survives a hard-deleted listing.
--   5. "users manage their own notifications" (FOR ALL) let any signed-in user INSERT a notification for themselves with
--      any title/body/type (e.g. a forged "You are now verified") and rewrite the text of the ones they received.
--   6. No way to tell whether a notification was ever pushed to a device.
--
-- Nothing here weakens a public policy (0039 'listings are publicly readable', 0044 block enforcement are untouched):
-- the admin screens use SECURITY DEFINER RPCs that re-check staff_can('report_status') inside Postgres.
-- Needs 0039. Rollback: supabase/rollback/0047_report_review_workspace_ROLLBACK.sql (not executed automatically).

-- ============================================================================
-- 1. Notifications: idempotency key, push-delivery status, no client forgery
-- ============================================================================
alter table public.notifications add column if not exists dedupe_key text;
alter table public.notifications add column if not exists push_status text;
alter table public.notifications add column if not exists push_attempted_at timestamptz;
alter table public.notifications add column if not exists push_error text;

alter table public.notifications drop constraint if exists notifications_push_status_check;
alter table public.notifications add constraint notifications_push_status_check
  check (push_status is null or push_status in ('pending', 'sent', 'no_devices', 'disabled', 'failed'));

-- One notification per (recipient, event). Retries / replays hit this and are ignored by the writers below.
create unique index if not exists notifications_dedupe_idx on public.notifications (user_id, dedupe_key) where dedupe_key is not null;

-- Normalises server-written rows: every moderation notification is keyed by its event id (so it can never be written
-- twice), carries the id of the user-visible notice it summarises, and starts with push_status = 'pending' (the push
-- edge function records the real outcome; 'pending' that never changes means "push was never confirmed").
create or replace function public.trg_notifications_normalize()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notice uuid;
begin
  if new.type = 'moderation' and new.data ? 'eventId' then
    if new.dedupe_key is null then
      new.dedupe_key := 'moderation:' || (new.data ->> 'eventId');
    end if;
    if not (new.data ? 'noticeId') then
      select n.id into v_notice from public.moderation_notices n where n.event_id::text = new.data ->> 'eventId' limit 1;
      if v_notice is not null then
        new.data := new.data || jsonb_build_object('noticeId', v_notice);
      end if;
    end if;
  end if;
  if new.push_status is null then
    new.push_status := 'pending';
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_notifications_normalize() from public, anon, authenticated;
drop trigger if exists notifications_a_normalize on public.notifications;
create trigger notifications_a_normalize before insert on public.notifications
  for each row execute function public.trg_notifications_normalize();

-- Clients may read, mark read, and delete their own rows. They can no longer INSERT, and an UPDATE may only change `read`.
drop policy if exists "users manage their own notifications" on public.notifications;
drop policy if exists "users read their own notifications" on public.notifications;
drop policy if exists "users update their own notifications" on public.notifications;
drop policy if exists "users delete their own notifications" on public.notifications;
create policy "users read their own notifications" on public.notifications for select using (auth.uid() = user_id);
create policy "users update their own notifications" on public.notifications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users delete their own notifications" on public.notifications for delete using (auth.uid() = user_id);

create or replace function public.trg_notifications_guard_update()
returns trigger
language plpgsql
as $$
begin
  if public.is_client_write() and (
       (new.user_id, new.title, new.body, new.type, new.data, new.created_at, new.dedupe_key, new.push_status, new.push_attempted_at, new.push_error)
       is distinct from
       (old.user_id, old.title, old.body, old.type, old.data, old.created_at, old.dedupe_key, old.push_status, old.push_attempted_at, old.push_error)) then
    raise exception 'Notifications are read-only except for the read flag' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists notifications_b_guard on public.notifications;
create trigger notifications_b_guard before update on public.notifications
  for each row execute function public.trg_notifications_guard_update();

-- ============================================================================
-- 2. Staff-only report review state (kept OUT of public.reports: the reporter can read their own report row)
-- ============================================================================
create table if not exists public.report_admin (
  report_id uuid primary key references public.reports (id) on delete cascade,
  assigned_to uuid references public.profiles (id) on delete set null,
  reviewed_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  resolution_note text,
  evidence jsonb,                 -- minimal snapshot taken when the report was filed (survives a deleted listing)
  evidence_purged_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.report_admin enable row level security;
drop policy if exists "staff read report admin state" on public.report_admin;
create policy "staff read report admin state" on public.report_admin for select using (public.staff_can('report_status'));
-- no write policies: only the SECURITY DEFINER functions below write it.

create table if not exists public.report_notes (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  note text not null check (char_length(btrim(note)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists report_notes_report_idx on public.report_notes (report_id, created_at);
alter table public.report_notes enable row level security;
drop policy if exists "staff read report notes" on public.report_notes;
create policy "staff read report notes" on public.report_notes for select using (public.staff_can('report_status'));

-- Snapshot of what the reviewer needs if the target later disappears. Deliberately small: no phone/email/address, at most
-- 10 image keys, description cut to 500 chars. Purged by purge_report_evidence().
create or replace function public._report_evidence(p_type text, p_target text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if p_type = 'listing' then
    select jsonb_build_object('title', l.title, 'description', left(coalesce(l.description, ''), 500), 'price', l.price, 'currency', l.currency,
                              'category', l.category, 'city', l.city, 'condition', l.condition, 'status', l.status, 'owner_id', l.user_id,
                              'images', to_jsonb(l.images[1:10]), 'listing_created_at', l.created_at)
      into v from public.listings l where l.id::text = p_target;
  elsif p_type = 'user' then
    select jsonb_build_object('name', p.full_name, 'avatar_url', p.avatar_url) into v from public.profiles p where p.id::text = p_target;
  end if;
  return v;
end;
$$;
revoke execute on function public._report_evidence(text, text) from public, anon, authenticated;

create or replace function public.trg_reports_capture_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.report_admin (report_id, evidence) values (new.id, public._report_evidence(new.target_type, new.target_id))
    on conflict (report_id) do nothing;
  exception when others then
    null; -- evidence is best-effort and must never block a report
  end;
  return new;
end;
$$;
revoke execute on function public.trg_reports_capture_evidence() from public, anon, authenticated;
drop trigger if exists reports_d_capture_evidence on public.reports;
create trigger reports_d_capture_evidence after insert on public.reports
  for each row execute function public.trg_reports_capture_evidence();

-- Existing reports get a row (and a snapshot where the target still exists).
insert into public.report_admin (report_id, evidence)
select r.id, public._report_evidence(r.target_type, r.target_id) from public.reports r
on conflict (report_id) do nothing;

-- Retention: closed reports lose their snapshot after the window. Not scheduled here; run from a cron / the dashboard.
create or replace function public.purge_report_evidence(p_older_than interval default interval '24 months')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  update public.report_admin ra set evidence = null, evidence_purged_at = now()
   from public.reports r
  where r.id = ra.report_id and r.status in ('reviewed', 'dismissed') and ra.evidence is not null
    and coalesce(ra.resolved_at, r.created_at) < now() - p_older_than;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.purge_report_evidence(interval) from public, anon, authenticated;

-- ============================================================================
-- 3. Report status changes: reviewer, resolution note, audit, and ONE honest notification to the reporter
-- ============================================================================
create or replace function public.admin_update_report_status(p_report_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.staff_can('report_status') then
    raise exception 'Only staff can update report status' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'reviewing', 'reviewed', 'dismissed') then
    raise exception 'Invalid report status: %', p_status using errcode = '22023';
  end if;
  if p_status = 'dismissed' and (v_note is null or char_length(v_note) < 3) then
    raise exception 'A reason is required to dismiss a report' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 2000 then
    raise exception 'The note is too long' using errcode = '22023';
  end if;
  select status into v_old from public.reports where id = p_report_id for update;
  if not found then
    raise exception 'Report % not found', p_report_id using errcode = 'P0002';
  end if;
  if v_old = p_status then
    raise exception 'Report is already %', p_status using errcode = '23505';
  end if;

  update public.reports set status = p_status where id = p_report_id;

  insert into public.report_admin (report_id) values (p_report_id) on conflict (report_id) do nothing;
  if p_status = 'reviewing' then
    update public.report_admin set assigned_to = coalesce(assigned_to, auth.uid()), resolved_at = null, updated_at = now() where report_id = p_report_id;
  elsif p_status in ('reviewed', 'dismissed') then
    update public.report_admin set reviewed_by = auth.uid(), resolved_at = now(), resolution_note = v_note, updated_at = now() where report_id = p_report_id;
  else
    update public.report_admin set resolved_at = null, updated_at = now() where report_id = p_report_id;
  end if;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), 'report_status_change', 'report', p_report_id::text, v_note,
          jsonb_build_object('report_id', p_report_id, 'from', v_old, 'to', p_status));
end;
$$;
grant execute on function public.admin_update_report_status(uuid, text, text) to authenticated;
revoke execute on function public.admin_update_report_status(uuid, text, text) from anon, public;

create or replace function public.admin_add_report_note(p_report_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.staff_can('report_status') then
    raise exception 'Only staff can add report notes' using errcode = '42501';
  end if;
  if p_note is null or char_length(btrim(p_note)) < 1 or char_length(p_note) > 2000 then
    raise exception 'A note of 1-2000 characters is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.reports where id = p_report_id) then
    raise exception 'Report % not found', p_report_id using errcode = 'P0002';
  end if;
  insert into public.report_notes (report_id, author_id, note) values (p_report_id, auth.uid(), btrim(p_note)) returning id into v_id;
  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), 'report_note', 'report', p_report_id::text, null, jsonb_build_object('report_id', p_report_id, 'note_id', v_id));
  return v_id;
end;
$$;
grant execute on function public.admin_add_report_note(uuid, text) to authenticated;
revoke execute on function public.admin_add_report_note(uuid, text) from anon, public;

-- The reporter hears about a closed report once per outcome. 'reviewing' (and a reopen) say nothing.
create or replace function public.notify_on_report_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = old.status or new.status not in ('reviewed', 'dismissed') then
    return new;
  end if;
  insert into public.notifications (user_id, title, body, type, data, dedupe_key)
  values (
    new.reporter_id,
    case when new.status = 'reviewed' then 'Your report was reviewed' else 'Your report was dismissed' end,
    'Thanks for helping keep Suuq+ safe.',
    'report_result',
    jsonb_build_object('reportId', new.id, 'targetType', new.target_type, 'targetId', new.target_id, 'status', new.status),
    'report:' || new.id::text || ':' || new.status
  )
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  return new;
end;
$$;

-- ============================================================================
-- 4. Verification: the user is told, exactly once, in the same transaction as the decision
-- ============================================================================
create or replace function public.admin_set_verified(p_user_id uuid, p_verified boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current timestamptz;
  v_event uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change verification' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  select verified_at into v_current from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'User % not found', p_user_id using errcode = 'P0002';
  end if;
  if p_verified and v_current is not null then
    raise exception 'User is already verified' using errcode = '23505';
  end if;
  if not p_verified and v_current is null then
    raise exception 'User is not verified' using errcode = '23505';
  end if;

  perform set_config('fursad.admin_write', 'true', true);
  update public.profiles set verified_at = case when p_verified then now() else null end where id = p_user_id;

  insert into public.profile_verification_events (profile_id, action, actor_id, reason)
  values (p_user_id, case when p_verified then 'grant' else 'revoke' end, auth.uid(), btrim(p_reason))
  returning id into v_event;
  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), case when p_verified then 'verify_user' else 'unverify_user' end, 'user', p_user_id::text, btrim(p_reason),
          jsonb_build_object('event_id', v_event, 'from', v_current is not null, 'to', p_verified));

  -- The internal reason is never copied into the user-facing text.
  insert into public.notifications (user_id, title, body, type, data, dedupe_key)
  values (
    p_user_id,
    case when p_verified then 'You are now verified' else 'Your verification was removed' end,
    case when p_verified then 'Your SUUQIYE account has been verified. The verified badge now shows on your profile and listings.'
         else 'The verified badge was removed from your account. If you think this is a mistake, contact support from the Notices & Support page.' end,
    'verification',
    jsonb_build_object('kind', case when p_verified then 'verified' else 'verification_revoked' end, 'eventId', v_event),
    'verification:' || v_event::text
  )
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
end;
$$;
grant execute on function public.admin_set_verified(uuid, boolean, text) to authenticated;
revoke execute on function public.admin_set_verified(uuid, boolean, text) from anon, public;

-- ============================================================================
-- 5. Admin report queue + detail (SECURITY DEFINER, staff_can('report_status') = admin + moderator)
-- ============================================================================
create or replace function public.admin_report_queue(
  p_status text default null,
  p_target_type text default null,
  p_query text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_assigned_to uuid default null,
  p_limit int default 25,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := lower(nullif(btrim(coalesce(p_query, '')), ''));
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_out jsonb;
begin
  if not public.staff_can('report_status') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  with base as (
    select r.id, r.status, r.target_type, r.target_id, r.reason, r.created_at, r.reporter_id,
           rp.full_name as reporter_name, rp.avatar_url as reporter_avatar,
           l.id as l_id, l.title as l_title, l.images as l_images, l.status as l_status, l.user_id as l_owner,
           ra.evidence as ev, ra.assigned_to, asg.full_name as assigned_name,
           case r.target_type when 'listing' then l.user_id when 'user' then tu.id else rv.seller_id end as reported_id
      from public.reports r
      left join public.profiles rp on rp.id = r.reporter_id
      left join public.report_admin ra on ra.report_id = r.id
      left join public.profiles asg on asg.id = ra.assigned_to
      left join public.listings l on r.target_type = 'listing' and l.id::text = r.target_id
      left join public.profiles tu on r.target_type = 'user' and tu.id::text = r.target_id
      left join public.reviews rv on r.target_type = 'review' and rv.id::text = r.target_id
     where (p_status is null or r.status = p_status)
       and (p_target_type is null or r.target_type = p_target_type)
       and (p_from is null or r.created_at >= p_from)
       and (p_to is null or r.created_at < p_to)
       and (p_assigned_to is null or ra.assigned_to = p_assigned_to)
  ), enriched as (
    select b.*, ru.full_name as reported_name, ru.avatar_url as reported_avatar,
           (select count(*) from public.reports r2 where r2.target_type = b.target_type and r2.target_id = b.target_id) as target_report_count
      from base b left join public.profiles ru on ru.id = b.reported_id
  ), filtered as (
    select * from enriched e
     where v_q is null
        or strpos(lower(e.reason), v_q) > 0
        or strpos(lower(coalesce(e.reporter_name, '')), v_q) > 0
        or strpos(lower(coalesce(e.reported_name, '')), v_q) > 0
        or strpos(lower(coalesce(e.l_title, e.ev ->> 'title', '')), v_q) > 0
        or strpos(e.id::text, v_q) = 1
  ), page as (
    select f.*, count(*) over () as total from filtered f order by f.created_at desc, f.id limit v_limit offset greatest(coalesce(p_offset, 0), 0)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'status', p.status, 'target_type', p.target_type, 'reason', p.reason, 'created_at', p.created_at, 'total', p.total,
           'reporter', jsonb_build_object('id', p.reporter_id, 'name', coalesce(p.reporter_name, 'SUUQIYE user'), 'avatar_url', p.reporter_avatar),
           'reported_user', case when p.reported_id is null then null else
              jsonb_build_object('id', p.reported_id, 'name', coalesce(p.reported_name, 'SUUQIYE user'), 'avatar_url', p.reported_avatar) end,
           'listing', case when p.target_type <> 'listing' then null else jsonb_build_object(
              'id', p.target_id,
              'title', coalesce(p.l_title, p.ev ->> 'title'),
              'thumb', coalesce(p.l_images[1], p.ev -> 'images' ->> 0),
              'status', p.l_status,
              'available', p.l_id is not null) end,
           'assigned_to', case when p.assigned_to is null then null else jsonb_build_object('id', p.assigned_to, 'name', coalesce(p.assigned_name, 'Staff')) end,
           'target_report_count', p.target_report_count
         ) order by p.created_at desc, p.id), '[]'::jsonb)
    into v_out from page p;
  return v_out;
end;
$$;
grant execute on function public.admin_report_queue(text, text, text, timestamptz, timestamptz, uuid, int, int) to authenticated;
revoke execute on function public.admin_report_queue(text, text, text, timestamptz, timestamptz, uuid, int, int) from anon, public;

create or replace function public.admin_report_detail(p_report_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_r public.reports%rowtype;
  v_ra public.report_admin%rowtype;
  v_l public.listings%rowtype;
  v_listing_found boolean := false;
  v_reported uuid;
  v_review jsonb;
  v_listing jsonb;
begin
  if not public.staff_can('report_status') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_r from public.reports where id = p_report_id;
  if not found then
    return null;
  end if;
  select * into v_ra from public.report_admin where report_id = p_report_id;

  if v_r.target_type = 'listing' then
    select * into v_l from public.listings where id::text = v_r.target_id;
    v_listing_found := found;
    v_reported := case when v_listing_found then v_l.user_id else nullif(v_ra.evidence ->> 'owner_id', '')::uuid end;
    -- Explicit column list: no phone/email, and the row is readable here even when it is removed/deactivated (staff-only RPC).
    v_listing := jsonb_build_object(
      'id', v_r.target_id,
      'found', v_listing_found,
      'state', case when not v_listing_found then 'deleted'
                    when v_l.status in ('removed', 'deactivated') then 'moderated'
                    when v_l.status = 'expired' then 'expired' else 'live' end,
      'listing', case when v_listing_found then jsonb_build_object(
          'id', v_l.id, 'title', v_l.title, 'description', v_l.description, 'price', v_l.price, 'currency', v_l.currency,
          'category', v_l.category, 'subcategory', v_l.subcategory, 'condition', v_l.condition, 'city', v_l.city, 'region', v_l.region,
          'negotiable', v_l.negotiable, 'images', v_l.images, 'attributes', v_l.attributes, 'status', v_l.status,
          'views', v_l.views, 'favorites_count', v_l.favorites_count, 'created_at', v_l.created_at, 'updated_at', v_l.updated_at,
          'user_id', v_l.user_id) else null end,
      'snapshot', case when v_listing_found then null else v_ra.evidence end);
  elsif v_r.target_type = 'user' then
    v_reported := nullif(v_r.target_id, '')::uuid;
  else
    select jsonb_build_object('id', rv.id, 'rating', rv.rating, 'comment', rv.comment, 'created_at', rv.created_at, 'reviewer_id', rv.reviewer_id, 'seller_id', rv.seller_id),
           rv.seller_id
      into v_review, v_reported from public.reviews rv where rv.id::text = v_r.target_id;
  end if;

  return jsonb_build_object(
    'report', jsonb_build_object('id', v_r.id, 'status', v_r.status, 'target_type', v_r.target_type, 'target_id', v_r.target_id,
                                 'reason', v_r.reason, 'details', v_r.details, 'created_at', v_r.created_at,
                                 'assigned_to', (select jsonb_build_object('id', a.id, 'name', coalesce(a.full_name, 'Staff')) from public.profiles a where a.id = v_ra.assigned_to),
                                 'reviewed_by', (select jsonb_build_object('id', a.id, 'name', coalesce(a.full_name, 'Staff')) from public.profiles a where a.id = v_ra.reviewed_by),
                                 'resolved_at', v_ra.resolved_at, 'resolution_note', v_ra.resolution_note),
    'reporter', (select jsonb_build_object(
                   'id', p.id, 'name', coalesce(p.full_name, 'SUUQIYE user'), 'avatar_url', p.avatar_url, 'created_at', p.created_at,
                   'reports_filed', (select count(*) from public.reports x where x.reporter_id = p.id),
                   'reports_actioned', (select count(*) from public.reports x where x.reporter_id = p.id and x.status = 'reviewed'),
                   'reports_dismissed', (select count(*) from public.reports x where x.reporter_id = p.id and x.status = 'dismissed'))
                 from public.profiles p where p.id = v_r.reporter_id),
    'reported_user', (select jsonb_build_object(
                   'id', p.id, 'name', coalesce(p.full_name, 'SUUQIYE user'), 'avatar_url', p.avatar_url, 'created_at', p.created_at,
                   'account_status', public.account_effective_status(p.id), 'suspended_until', p.suspended_until, 'verified_at', p.verified_at,
                   'is_staff', exists (select 1 from public.admin_users au where au.user_id = p.id),
                   'listings_total', (select count(*) from public.listings x where x.user_id = p.id),
                   'listings_live', (select count(*) from public.listings x where x.user_id = p.id and x.status in ('available', 'reserved')),
                   'listings_moderated', (select count(*) from public.listings x where x.user_id = p.id and x.status in ('removed', 'deactivated')),
                   'warnings_count', (select count(*) from public.moderation_warnings w where w.user_id = p.id),
                   'reports_against', (select count(*) from public.reports x where (x.target_type = 'user' and x.target_id = p.id::text)
                                          or (x.target_type = 'listing' and exists (select 1 from public.listings l2 where l2.id::text = x.target_id and l2.user_id = p.id))),
                   'history', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'action', e.action, 'reason', e.reason, 'public_message', e.public_message,
                                                                           'until', e.until, 'created_at', e.created_at, 'report_id', e.report_id,
                                                                           'actor_name', coalesce(a.full_name, 'System')) order by e.created_at desc, e.id desc)
                                          from (select * from public.moderation_events me where me.user_id = p.id order by me.created_at desc limit 20) e
                                          left join public.profiles a on a.id = e.actor_id), '[]'::jsonb))
                 from public.profiles p where p.id = v_reported),
    'listing', v_listing,
    'review', v_review,
    'other_reports', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'reason', x.reason, 'status', x.status, 'created_at', x.created_at,
                                                                  'reporter_name', coalesce(xp.full_name, 'SUUQIYE user')) order by x.created_at desc)
                                 from public.reports x left join public.profiles xp on xp.id = x.reporter_id
                                where x.target_type = v_r.target_type and x.target_id = v_r.target_id and x.id <> v_r.id), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'note', n.note, 'created_at', n.created_at, 'author_name', coalesce(a.full_name, 'Staff')) order by n.created_at)
                         from public.report_notes n left join public.profiles a on a.id = n.author_id where n.report_id = p_report_id), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(jsonb_build_object(
                          'event_id', e.id, 'action', e.action, 'reason', e.reason, 'public_message', e.public_message, 'from_status', e.from_status,
                          'to_status', e.to_status, 'until', e.until, 'created_at', e.created_at, 'actor_name', coalesce(a.full_name, 'System'),
                          'notified', exists (select 1 from public.notifications n where n.data ->> 'eventId' = e.id::text),
                          'push_status', (select n.push_status from public.notifications n where n.data ->> 'eventId' = e.id::text limit 1)) order by e.created_at desc)
                         from public.moderation_events e left join public.profiles a on a.id = e.actor_id where e.report_id = p_report_id), '[]'::jsonb),
    'reporter_notification', (select jsonb_build_object('status', n.data ->> 'status', 'created_at', n.created_at, 'push_status', n.push_status)
                                from public.notifications n where n.user_id = v_r.reporter_id and n.type = 'report_result' and n.data ->> 'reportId' = p_report_id::text
                               order by n.created_at desc limit 1),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('action', au.action, 'reason', au.reason, 'created_at', au.created_at,
                                                           'admin_name', coalesce(a.full_name, 'Staff'), 'metadata', au.metadata) order by au.created_at desc)
                         from public.admin_audit_log au left join public.profiles a on a.id = au.admin_id
                        where au.target_type = 'report' and au.target_id = p_report_id::text), '[]'::jsonb)
  );
end;
$$;
grant execute on function public.admin_report_detail(uuid) to authenticated;
revoke execute on function public.admin_report_detail(uuid) from anon, public;
