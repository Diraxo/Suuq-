-- Rollback for 0047. Re-runnable. NOT executed automatically.
-- Restores the pre-0047 behaviour: the 0038 admin_set_verified (no notification), the 0021 report-status trigger body,
-- the 0039 admin_update_report_status, and the permissive "FOR ALL" notifications policy.
-- Data in report_admin / report_notes and the notifications.dedupe_key / push_* columns is DROPPED by this script;
-- export it first if you need the internal notes.

drop function if exists public.admin_report_queue(text, text, text, timestamptz, timestamptz, uuid, int, int);
drop function if exists public.admin_report_detail(uuid);
drop function if exists public.admin_add_report_note(uuid, text);
drop function if exists public.purge_report_evidence(interval);

drop trigger if exists reports_d_capture_evidence on public.reports;
drop function if exists public.trg_reports_capture_evidence();
drop function if exists public._report_evidence(text, text);
drop table if exists public.report_notes;
drop table if exists public.report_admin;

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

create or replace function public.notify_on_report_status_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = old.status or new.status = 'pending' then
    return new;
  end if;
  insert into public.notifications (user_id, title, body, type, data)
  values (
    new.reporter_id,
    case when new.status = 'reviewed' then 'Your report was reviewed' else 'Your report was dismissed' end,
    'Thanks for helping keep Suuq+ safe.',
    'report_result',
    jsonb_build_object('reportId', new.id, 'targetType', new.target_type, 'targetId', new.target_id, 'status', new.status)
  );
  return new;
end;
$$;

create or replace function public.admin_set_verified(p_user_id uuid, p_verified boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current timestamptz;
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
  values (p_user_id, case when p_verified then 'grant' else 'revoke' end, auth.uid(), btrim(p_reason));
  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason)
  values (auth.uid(), case when p_verified then 'verify_user' else 'unverify_user' end, 'user', p_user_id::text, btrim(p_reason));
end;
$$;

drop trigger if exists notifications_a_normalize on public.notifications;
drop trigger if exists notifications_b_guard on public.notifications;
drop function if exists public.trg_notifications_normalize();
drop function if exists public.trg_notifications_guard_update();
drop policy if exists "users read their own notifications" on public.notifications;
drop policy if exists "users update their own notifications" on public.notifications;
drop policy if exists "users delete their own notifications" on public.notifications;
drop policy if exists "users manage their own notifications" on public.notifications;
create policy "users manage their own notifications" on public.notifications
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop index if exists public.notifications_dedupe_idx;
alter table public.notifications drop constraint if exists notifications_push_status_check;
alter table public.notifications drop column if exists dedupe_key;
alter table public.notifications drop column if exists push_status;
alter table public.notifications drop column if exists push_attempted_at;
alter table public.notifications drop column if exists push_error;
