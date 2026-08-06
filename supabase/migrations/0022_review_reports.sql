-- Final Google Play compliance pass: let users report reviews, not just
-- listings and profiles (report/index.tsx and reviews.tsx gain a "Report" entry
-- point for reviews in this same pass). Run once after 0001-0021.
--
-- The original inline check constraint on reports.target_type (0003_reports.sql)
-- was never named, so Postgres auto-named it — found dynamically here instead
-- of hardcoding the generated name, then replaced with a named constraint that
-- includes 'review'.

do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where conrelid = 'public.reports'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%target_type%';

  if v_constraint_name is not null then
    execute format('alter table public.reports drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table public.reports
  add constraint reports_target_type_check check (target_type in ('listing', 'user', 'review'));
