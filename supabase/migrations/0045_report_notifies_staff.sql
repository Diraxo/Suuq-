-- 0045 — a new report reaches the admin side immediately.
--
-- Until now a report was only a row in public.reports: staff saw it when they next opened the dashboard. This adds an
-- AFTER INSERT trigger that writes one in-app notification (and, through the existing notifications push webhook from
-- 0012, a push) to every admin and moderator, naming the category (listing / user / review) and the reason. The
-- notification carries only ids, never the reporter's identity or free-text details.
-- A failure to notify must never block a report from being filed, so the body is wrapped in an exception handler.
-- Needs 0039 (staff roles). Rollback: supabase/rollback/0045_report_notifies_staff_ROLLBACK.sql.

create or replace function public.trg_reports_notify_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.notifications (user_id, title, body, type, data)
    select a.user_id,
           case new.target_type when 'listing' then 'New listing report' when 'user' then 'New user report' else 'New ' || new.target_type || ' report' end,
           left(new.reason, 120),
           'report_staff',
           jsonb_build_object('reportId', new.id, 'targetType', new.target_type, 'targetId', new.target_id)
      from public.admin_users a
     where a.role in ('admin', 'moderator')
       and a.user_id <> new.reporter_id;
  exception when others then
    null; -- never block a report because a notification could not be written
  end;
  return new;
end;
$$;
revoke execute on function public.trg_reports_notify_staff() from public, anon, authenticated;

drop trigger if exists reports_c_notify_staff on public.reports;
create trigger reports_c_notify_staff after insert on public.reports
  for each row execute function public.trg_reports_notify_staff();
