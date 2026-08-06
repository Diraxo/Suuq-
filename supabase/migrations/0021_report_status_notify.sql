-- Final QA round follow-up:
--   1. reports.status (0003) was writable but nothing ever notified the
--      reporter when it changed — the one QA-flagged event type with no
--      notification path at all. There's still no in-app admin UI to change
--      status (out of scope here), but the trigger is now correct and live
--      for whenever that status is updated (Supabase dashboard/SQL today, an
--      admin panel later).
--   2. Drops a leftover, unauthenticated AFTER INSERT trigger on
--      public.notifications named "send-push-notification" (created via the
--      Dashboard's Database Webhooks UI, calling supabase_functions.http_request
--      with no secret header) — a dead duplicate of the properly-authenticated
--      on_notification_insert_push trigger from 0019. It's harmless (fire-and-
--      forget, gets 401'd by the edge function's auth gate) but fires on every
--      notification insert for no benefit; removing it for hygiene.

-- ============================================================================
-- 1. Notify the reporter when their report is reviewed/dismissed
-- ============================================================================
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

drop trigger if exists on_report_status_change_notify on public.reports;
create trigger on_report_status_change_notify
  after update of status on public.reports
  for each row execute function public.notify_on_report_status_change();

-- ============================================================================
-- 2. Drop the dead duplicate webhook trigger
-- ============================================================================
drop trigger if exists "send-push-notification" on public.notifications;
