-- 0064 — Active profile identity: one account, two profiles (personal | business), with a server-side switch.
--
-- STATUS: written and tested on PGlite only. NOT applied to any database. Needs 0038 (is_client_write, protected-column triggers).
-- It does not need 0054: the gold business badge is read from the staff-verified storefront (public_storefronts.verified) when that exists.
--
-- What it adds
--   * profiles.active_mode  'personal' | 'business'. It decides which identity every other person sees. It lives in the database
--     (and is in the Realtime publication with the rest of profiles), so a switch reaches other viewers without a refresh.
--   * set_active_mode(p_mode)  the ONLY way a client changes it. 'business' requires a non-blank business_name. It never
--     creates a second account and never touches names, photos or verification of either identity.
--   * guard trigger  a direct client UPDATE/INSERT of active_mode is refused/ignored (same pattern as verified_at in 0038), and an
--     account whose business_name becomes blank falls back to 'personal' so a nameless business page can never be public.
--   * Backfill  accounts that already have a business_name keep showing it ('business'), which is what the app showed before.
--     Everyone else stays 'personal'. Owners can switch back at any time.
--
-- Not changed: verified_at (personal, staff-only), storefront verification (business, staff-only), any media rule.
-- Rollback: supabase/rollback/0064_profile_active_mode_ROLLBACK.sql

begin;

alter table public.profiles
  add column if not exists active_mode text not null default 'personal';
alter table public.profiles
  add constraint profiles_active_mode_check check (active_mode in ('personal', 'business'));

-- Existing business owners keep the identity they were already showing. Runs before the guard trigger exists.
-- Row by row: a row that already violates a NOT VALID check from 0056 (they are enforced on UPDATE) is skipped and stays 'personal'
-- instead of aborting the whole migration; its owner can switch later once the row is fixed.
do $$
declare r record;
begin
  for r in select id from public.profiles where nullif(btrim(business_name), '') is not null loop
    begin
      update public.profiles set active_mode = 'business' where id = r.id;
    exception when others then
      raise notice '0064 backfill skipped profile %: %', r.id, sqlerrm;
    end;
  end loop;
end $$;

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
  -- A business identity needs a name (whoever writes). Clearing the name switches the account back to personal.
  if new.active_mode = 'business' and nullif(btrim(new.business_name), '') is null then
    new.active_mode := 'personal';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_profile_active_mode() from public, anon, authenticated;

drop trigger if exists profiles_d_guard_active_mode on public.profiles;
create trigger profiles_d_guard_active_mode
  before insert or update on public.profiles
  for each row execute function public.guard_profile_active_mode();

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
  -- Staff-set protections (suspension etc.) are untouched; this only flips the one column.
  perform set_config('fursad.admin_write', 'true', true);
  update public.profiles set active_mode = p_mode where id = v_uid and active_mode is distinct from p_mode;
  return p_mode;
end;
$$;
revoke all on function public.set_active_mode(text) from public, anon;
grant execute on function public.set_active_mode(text) to authenticated;

commit;
