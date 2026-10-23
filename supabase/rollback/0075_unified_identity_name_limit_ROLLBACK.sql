-- ROLLBACK for 0075. Run as ONE transaction (the script has its own begin/commit; with psql use ON_ERROR_STOP=1). Order if 0076 is applied:
-- roll back 0076 FIRST, then this file.
--
-- Removes the name-change limit and restores the 0064 rule that a business identity needs a business name. Touches no profile name,
-- photo or bio. Business-mode accounts WITHOUT a business name cannot exist under the restored rule, so they are put back to personal.
-- That demotion is the one irreversible-looking step, so it is recorded first, in the same transaction:
--
--   private.rollback_0075_demoted_profiles       one row per demoted account (before-state). Written in the same transaction as the demotion:
--                                                it exists if and only if the rollback committed. Re-running the rollback adds no rows (nobody
--                                                is left to demote); each run's rows share a run_id.
--   private.rollback_0075_name_change_archive    copy of profile_name_changes (old/new name + timestamps) taken before that table is dropped.
--
-- Both are in the private schema with RLS on and no grants for anon/authenticated: only the database owner / service role can read them.
-- profile_id references profiles ON DELETE CASCADE, so they never outlive an account (account-deletion rules still hold).
-- Retention: operator tooling only, nothing reads them. Keep until the incident is closed (suggested 90 days), then:
--     drop table private.rollback_0075_demoted_profiles, private.rollback_0075_name_change_archive;
-- Restore one or all demoted accounts to business mode (needs 0075 re-applied first, because only 0075 allows business mode with no name):
--     select set_config('fursad.admin_write', 'true', true);
--     update public.profiles p set active_mode = 'business' from private.rollback_0075_demoted_profiles r where r.profile_id = p.id;
--
-- Failure behaviour: all-or-nothing. The demotion runs per row only so that a failure names the account; any failure aborts the whole
-- transaction (no account demoted, no table dropped, no recovery rows kept) and the error says which profile and why. Nothing is skipped.
--
-- Bypass (verified, tests/rollback_0075_audit.test.mjs): the profile triggers 0056 (content), 0057/0059 (media scan), 0062 (host pin), 0063
-- (url-only) and 0038 (protected columns) each return early unless public.is_client_write() is true, and is_client_write() is false when
-- fursad.admin_write = 'true' OR current_user is not authenticated/anon. 0064's mode guard (client branch) uses the same function, and its
-- unconditional "business needs a name" branch is exactly the 0075 change being undone, so it does not fire before it is restored below.
-- The setting is transaction-local and is cleared again at the end of this script.
begin;

create schema if not exists private;

create table if not exists private.rollback_0075_demoted_profiles (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  rolled_back_at timestamptz not null default now(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  before_active_mode text not null,
  before_business_name text,
  before_full_name text,
  before_account_status text,
  business_presented_listings int,
  note text not null default 'business mode with no business_name; returned to personal by the 0075 rollback'
);
create index if not exists rollback_0075_demoted_profiles_profile_idx on private.rollback_0075_demoted_profiles (profile_id);
alter table private.rollback_0075_demoted_profiles enable row level security;
revoke all on table private.rollback_0075_demoted_profiles from public, anon, authenticated;

create table if not exists private.rollback_0075_name_change_archive (
  archived_at timestamptz not null default now(),
  id uuid,
  user_id uuid not null references public.profiles (id) on delete cascade,
  old_name text,
  new_name text,
  changed_at timestamptz,
  waived_at timestamptz,
  waived_by uuid
);
alter table private.rollback_0075_name_change_archive enable row level security;
revoke all on table private.rollback_0075_name_change_archive from public, anon, authenticated;

do $$
begin
  if to_regclass('public.profile_name_changes') is not null then
    insert into private.rollback_0075_name_change_archive (id, user_id, old_name, new_name, changed_at, waived_at, waived_by)
    select id, user_id, old_name, new_name, changed_at, waived_at, waived_by from public.profile_name_changes;
  end if;
end $$;

-- Capture, then demote, per row, inside this one transaction. No exception is swallowed: a failure aborts everything.
select set_config('fursad.admin_write', 'true', true);
do $$
declare
  r record;
  v_run uuid := gen_random_uuid();
  v_listings int;
  v_demoted int := 0;
begin
  for r in
    select id, active_mode, business_name, full_name, account_status
    from public.profiles
    where active_mode = 'business' and nullif(btrim(business_name), '') is null
    order by id
  loop
    begin
      v_listings := null;
      if to_regclass('public.listings') is not null
         and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'listings' and column_name = 'seller_presentation') then
        execute 'select count(*) from public.listings where user_id = $1 and seller_presentation = ''business''' into v_listings using r.id;
      end if;
      insert into private.rollback_0075_demoted_profiles
        (run_id, profile_id, before_active_mode, before_business_name, before_full_name, before_account_status, business_presented_listings)
      values (v_run, r.id, r.active_mode, r.business_name, r.full_name, r.account_status, v_listings);
      update public.profiles set active_mode = 'personal' where id = r.id;
      v_demoted := v_demoted + 1;
    exception when others then
      raise exception '0075 rollback aborted, nothing was changed: could not return profile % to personal mode: %', r.id, sqlerrm using errcode = sqlstate;
    end;
  end loop;
  raise notice '0075 rollback: % business-mode account(s) with no business name returned to personal (run %); before-state in private.rollback_0075_demoted_profiles', v_demoted, v_run;
end $$;
select set_config('fursad.admin_write', '', true);

drop trigger if exists profiles_e_limit_name_change on public.profiles;
drop function if exists private.limit_name_change();
drop function if exists public.my_name_change_status();
drop function if exists public.admin_reset_name_changes(uuid, text);
drop function if exists private.name_change_limit();
drop function if exists private.name_change_window();
drop table if exists public.profile_name_changes;

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
  end if;
  if new.active_mode = 'business' and nullif(btrim(new.business_name), '') is null then
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
  v_name text;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  if p_mode is null or p_mode not in ('personal', 'business') then
    raise exception 'Unknown profile mode' using errcode = '22023';
  end if;
  select business_name into v_name from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  if p_mode = 'business' and nullif(btrim(v_name), '') is null then
    raise exception 'Add a business name before switching to your business profile' using errcode = '22023', hint = 'business_profile_incomplete';
  end if;
  perform set_config('fursad.admin_write', 'true', true);
  update public.profiles set active_mode = p_mode where id = v_uid and active_mode is distinct from p_mode;
  return p_mode;
end;
$$;
revoke all on function public.set_active_mode(text) from public, anon;
grant execute on function public.set_active_mode(text) to authenticated;

commit;
