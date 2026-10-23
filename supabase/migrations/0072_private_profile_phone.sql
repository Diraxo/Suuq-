-- 0072 — Private account phone: the number leaves the publicly readable profiles row.
--
-- STATUS: written and tested on PGlite only. NOT applied to any database. Independent of 0048-0063 and 0071; needs 0044
-- (private.users_blocked), 0039 (account_effective_status), 0019 (enforce_rate_limit), 0066 (direct conversations) and 0068
-- (business_phone_public, listings.seller_presentation). Production already has all of those.
--
-- THE PROBLEM (verified read-only on production 2026-10-22): profiles has the policy "profiles are publicly readable" (using true)
-- and table-wide SELECT for anon + authenticated, so profiles.phone was readable by anyone, with business_phone_public = false, through
-- GET /rest/v1/profiles and through every feed loader that does select('*'). The toggle only hid the number in OUR screens.
--
-- WHY NOT A COLUMN REVOKE: (a) every client that does select('*') on profiles (feeds, search, seller page, own profile) would then fail
-- outright with "permission denied" — that includes app builds already in users' hands; (b) Realtime does not honour column privileges,
-- so the number would still be broadcast on profile updates; (c) every future profiles column would need its own GRANT.
--
-- WHAT THIS DOES INSTEAD
--   1. The number lives in private.profile_phones (no API grants, RLS on with no policies; the private schema is not exposed by PostgREST).
--   2. Existing numbers are MOVED there and profiles.phone is set to NULL (user triggers are paused for that one UPDATE so nobody gets a
--      "profile edited" staff alert and updated_at does not move).
--   3. A BEFORE trigger keeps every existing write path working: when any client writes profiles.phone, the value is stored privately and the
--      public column stays NULL. A NULL write is ignored (an old build that cannot see the number must not erase it by saving its form).
--      Clearing is explicit: clear_my_phone().
--   4. Reading is only through authorization-checked functions (all return NULL, never an error, when the answer is "no"):
--        my_phone()                                   the caller's own number (edit-profile forms)
--        get_contact_phone(owner, context, ref)       the number a signed-in, non-blocked viewer may call, for ONE context:
--            'listing'           ref = listing id    live listing of that owner; business-presented listing needs business_phone_public
--            'chat'              ref = conversation  caller is the BUYER and the owner is the seller; direct business inquiries and
--                                                    business-presented listings need business_phone_public. The buyer's number is
--                                                    never returned to the seller (the buyer never published it).
--            'business_profile'                      owner has a business name AND business_phone_public
--            'personal_profile'                      the personal number (no toggle exists for personal; see decision D1 in the report)
--      Always denied: anonymous, blocked either way, owner or caller not in good standing, unknown context. Rate limited (200/hour).
--   5. Old builds degrade safely: they read NULL, so the Call button simply does not appear.
--
-- NOT COVERED: profiles.email (also publicly readable — same class of problem, separate decision), phone_country (kept public: it only
-- says which country code the number has), the admin_listing_detail jsonb 'phone' key (0041) now reads NULL for staff; no admin screen shows it.
-- Rollback: supabase/rollback/0072_private_profile_phone_ROLLBACK.sql (copies the numbers back first).

begin;

-- 1. Private storage --------------------------------------------------------------------------------------------------------------------
create table if not exists private.profile_phones (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  phone      text not null check (btrim(phone) <> ''),
  updated_at timestamptz not null default now()
);
alter table private.profile_phones enable row level security;
revoke all on table private.profile_phones from public, anon, authenticated;

-- 2. Move the existing numbers (idempotent: only rows that still hold a number in the public column) ---------------------------------
insert into private.profile_phones (user_id, phone)
select id, btrim(phone) from public.profiles where nullif(btrim(phone), '') is not null
on conflict (user_id) do update set phone = excluded.phone, updated_at = now();

alter table public.profiles disable trigger user;
update public.profiles set phone = null where phone is not null;
alter table public.profiles enable trigger user;

-- 3. Keep every write path working: a written number is stored privately, the public column stays NULL -------------------------------
create or replace function private.divert_profile_phone()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if nullif(btrim(new.phone), '') is not null then
    insert into private.profile_phones (user_id, phone) values (new.id, btrim(new.phone))
    on conflict (user_id) do update set phone = excluded.phone, updated_at = now();
  end if;
  new.phone := null;
  return new;
end;
$$;
revoke all on function private.divert_profile_phone() from public, anon, authenticated;

drop trigger if exists profiles_e_divert_phone on public.profiles;
create trigger profiles_e_divert_phone
  before insert or update on public.profiles
  for each row execute function private.divert_profile_phone();

comment on column public.profiles.phone is 'Always NULL since 0072. The number is in private.profile_phones; read it with my_phone() / get_contact_phone().';

-- 4. Reads -----------------------------------------------------------------------------------------------------------------------------
create or replace function public.my_phone()
returns text
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select p.phone from private.profile_phones p where p.user_id = auth.uid();
$$;
revoke all on function public.my_phone() from public, anon;
grant execute on function public.my_phone() to authenticated;

create or replace function public.clear_my_phone()
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  delete from private.profile_phones where user_id = auth.uid();
end;
$$;
revoke all on function public.clear_my_phone() from public, anon;
grant execute on function public.clear_my_phone() to authenticated;

create or replace function public.get_contact_phone(p_owner uuid, p_context text, p_ref uuid default null)
returns text
language plpgsql
volatile
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_toggle boolean;
  v_business_name text;
  v_business boolean;
  v_conv public.conversations%rowtype;
begin
  if v_me is null or p_owner is null or p_context is null then
    return null;
  end if;

  select pr.business_phone_public, nullif(btrim(pr.business_name), '')
    into v_toggle, v_business_name
    from public.profiles pr where pr.id = p_owner;
  if not found then
    return null;
  end if;

  if v_me <> p_owner then
    perform public.enforce_rate_limit('reveal_phone', 200, interval '1 hour');
    if public.account_effective_status(v_me) is distinct from 'active'
       or public.account_effective_status(p_owner) is distinct from 'active' then
      return null;
    end if;
    if private.users_blocked(v_me, p_owner) then
      return null;
    end if;
  end if;

  if p_context = 'listing' then
    select l.seller_presentation = 'business' into v_business
      from public.listings l
     where l.id = p_ref and l.user_id = p_owner and l.status in ('available', 'reserved');
    if not found then
      return null;
    end if;
  elsif p_context = 'chat' then
    select * into v_conv from public.conversations c
     where c.id = p_ref and c.buyer_id = v_me and c.seller_id = p_owner;
    if not found then
      return null;
    end if;
    if v_conv.listing_id is null then
      v_business := true;
    else
      select l.seller_presentation = 'business' into v_business
        from public.listings l where l.id = v_conv.listing_id and l.user_id = p_owner;
      if not found then
        return null;
      end if;
    end if;
  elsif p_context = 'business_profile' then
    if v_business_name is null then
      return null;
    end if;
    v_business := true;
  elsif p_context = 'personal_profile' then
    v_business := false;
  else
    return null;
  end if;

  if v_business and v_toggle is not true then
    return null;
  end if;

  return (select p.phone from private.profile_phones p where p.user_id = p_owner);
end;
$$;
revoke all on function public.get_contact_phone(uuid, text, uuid) from public, anon;
grant execute on function public.get_contact_phone(uuid, text, uuid) to authenticated;

commit;
