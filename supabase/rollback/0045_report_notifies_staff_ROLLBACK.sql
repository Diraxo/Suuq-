-- Rollback for 0045. Re-runnable.
drop trigger if exists reports_c_notify_staff on public.reports;
drop function if exists public.trg_reports_notify_staff();
