-- 0038 — Search & discovery: real filters (Verified / Boosted today / Price reduced / Negotiable),
-- and an indexed, paginated server-side search.
--
-- NOT applied to any real database by this commit. Tested against a disposable PGlite (real PostgreSQL)
-- by supabase/tests/discovery.test.mjs. Rollback: supabase/rollback/0038_search_discovery_ROLLBACK.sql.
--
-- Definitions (single source of truth; mobile + web copy them in lib/searchFilters.ts):
--   Verified       profiles.verified_at IS NOT NULL. Granted/revoked ONLY by an admin through
--                  admin_set_verified(), with a mandatory reason and an audit row. Nobody is auto-verified.
--                  It does NOT assert that a phone number or an ID document was checked.
--   Boosted today  the listing has a non-revoked admin-granted boost that is LIVE at this moment
--                  (listings.boosted_until > now()). Boosts are granted in whole marketplace days
--                  (Africa/Addis_Ababa, UTC+3, no DST): p_days = 1 ends at the coming Addis midnight.
--                  Not the same as "posted today" (created_at) — that is a separate filter.
--   Price reduced  the listing's LATEST qualifying decrease (same currency, new < old) was recorded within
--                  the last 14 days AND the current price is still below that decrease's old price.
--   Negotiable     listings.negotiable = true (the seller's persisted choice).
--   Eligible       status IN ('available','reserved') and visible under RLS (so never removed/deactivated).

create extension if not exists pg_trgm with schema extensions;

-- ============================================================================
-- 1. Protected-column guard (REAL enforcement).
--    `revoke update (col)` (used by 0019 / 0027) does nothing while the role also holds a table-level UPDATE
--    grant — which is Supabase's default. A BEFORE trigger that looks at current_user is what actually works:
--    direct client writes run as `authenticated`/`anon`; SECURITY DEFINER RPCs run as the function owner.
-- ============================================================================
create or replace function public.is_client_write()
returns boolean
language sql
stable
as $$
  select current_user in ('authenticated', 'anon') and coalesce(current_setting('fursad.admin_write', true), '') <> 'true';
$$;

create or replace function public.guard_profile_protected_columns()
returns trigger
language plpgsql
as $$
begin
  if not public.is_client_write() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.verified_at := null;
    new.account_status := 'active';
    return new;
  end if;
  if new.verified_at is distinct from old.verified_at then
    raise exception 'verified_at is managed by staff only' using errcode = '42501';
  end if;
  if new.account_status is distinct from old.account_status then
    raise exception 'account_status is managed by staff only' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.guard_listing_protected_columns()
returns trigger
language plpgsql
as $$
begin
  if not public.is_client_write() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.boosted_until := null;
    new.last_price_drop_at := null;
    new.last_price_drop_from := null;
    new.views := 0;
    new.favorites_count := 0;
    return new;
  end if;
  if new.boosted_until is distinct from old.boosted_until
     or new.last_price_drop_at is distinct from old.last_price_drop_at
     or new.last_price_drop_from is distinct from old.last_price_drop_from
     or new.views is distinct from old.views
     or new.favorites_count is distinct from old.favorites_count then
    raise exception 'Protected listing column' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ============================================================================
-- 2. Verified
-- ============================================================================
alter table public.profiles add column if not exists verified_at timestamptz;
create index if not exists profiles_verified_idx on public.profiles (id) where verified_at is not null;

drop trigger if exists profiles_a_guard_protected on public.profiles;
create trigger profiles_a_guard_protected
  before insert or update on public.profiles
  for each row execute function public.guard_profile_protected_columns();

create table if not exists public.profile_verification_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  action text not null check (action in ('grant', 'revoke')),
  actor_id uuid not null references public.profiles (id),
  reason text not null check (char_length(btrim(reason)) >= 3),
  created_at timestamptz not null default now()
);
create index if not exists profile_verification_events_profile_idx
  on public.profile_verification_events (profile_id, created_at desc);
alter table public.profile_verification_events enable row level security;
drop policy if exists "admins read verification events" on public.profile_verification_events;
create policy "admins read verification events" on public.profile_verification_events
  for select using (public.is_admin());
-- no write policies: only admin_set_verified() writes.

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
grant execute on function public.admin_set_verified(uuid, boolean, text) to authenticated;
revoke execute on function public.admin_set_verified(uuid, boolean, text) from anon, public;

-- ============================================================================
-- 3. Boosts (admin-granted only; there is no payment flow)
-- ============================================================================
create or replace function public.marketplace_day_start(p_ts timestamptz default now())
returns timestamptz
language sql
stable
as $$
  select date_trunc('day', p_ts at time zone 'Africa/Addis_Ababa') at time zone 'Africa/Addis_Ababa';
$$;

alter table public.listings add column if not exists boosted_until timestamptz;
create index if not exists listings_boosted_idx on public.listings (boosted_until) where boosted_until is not null;

create table if not exists public.listing_boosts (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  source text not null default 'admin_grant' check (source in ('admin_grant')),
  granted_by uuid not null references public.profiles (id),
  reason text not null check (char_length(btrim(reason)) >= 3),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  revoke_reason text,
  created_at timestamptz not null default now(),
  constraint listing_boosts_window check (ends_at > starts_at),
  constraint listing_boosts_revoke_consistent check ((revoked_at is null) = (revoked_by is null))
);
create index if not exists listing_boosts_listing_idx on public.listing_boosts (listing_id, ends_at desc);
alter table public.listing_boosts enable row level security;
drop policy if exists "admins read boosts" on public.listing_boosts;
create policy "admins read boosts" on public.listing_boosts for select using (public.is_admin());

drop trigger if exists listings_a_guard_protected on public.listings;
create trigger listings_a_guard_protected
  before insert or update on public.listings
  for each row execute function public.guard_listing_protected_columns();

create or replace function public.admin_grant_boost(p_listing_id uuid, p_days int, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_until timestamptz;
  v_ends timestamptz;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can grant a boost' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 30 then
    raise exception 'Boost length must be 1-30 marketplace days' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  select status, boosted_until into v_status, v_until from public.listings where id = p_listing_id for update;
  if not found then
    raise exception 'Listing % not found', p_listing_id using errcode = 'P0002';
  end if;
  if v_status not in ('available', 'reserved') then
    raise exception 'Only an available listing can be boosted' using errcode = '23514';
  end if;
  if v_until is not null and v_until > now() then
    raise exception 'Listing is already boosted until %', v_until using errcode = '23505';
  end if;

  v_ends := public.marketplace_day_start(now()) + make_interval(days => p_days);
  insert into public.listing_boosts (listing_id, starts_at, ends_at, granted_by, reason)
  values (p_listing_id, now(), v_ends, auth.uid(), btrim(p_reason))
  returning id into v_id;

  perform set_config('fursad.admin_write', 'true', true);
  update public.listings set boosted_until = v_ends where id = p_listing_id;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), 'grant_boost', 'listing', p_listing_id::text, btrim(p_reason),
          jsonb_build_object('boost_id', v_id, 'ends_at', v_ends, 'days', p_days));
  return v_id;
end;
$$;

create or replace function public.admin_revoke_boost(p_boost_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can revoke a boost' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  update public.listing_boosts
     set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = btrim(p_reason)
   where id = p_boost_id and revoked_at is null
  returning listing_id into v_listing;
  if not found then
    raise exception 'Boost not found or already revoked' using errcode = 'P0002';
  end if;

  perform set_config('fursad.admin_write', 'true', true);
  update public.listings
     set boosted_until = (select max(b.ends_at) from public.listing_boosts b
                           where b.listing_id = v_listing and b.revoked_at is null and b.ends_at > now())
   where id = v_listing;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), 'revoke_boost', 'listing', v_listing::text, btrim(p_reason), jsonb_build_object('boost_id', p_boost_id));
end;
$$;
grant execute on function public.admin_grant_boost(uuid, int, text), public.admin_revoke_boost(uuid, text) to authenticated;
revoke execute on function public.admin_grant_boost(uuid, int, text), public.admin_revoke_boost(uuid, text) from anon, public;

-- ============================================================================
-- 4. Price reductions — recorded by the database for EVERY price change path
--    (explicit "drop price" action and normal listing edits alike).
-- ============================================================================
alter table public.listings add column if not exists last_price_drop_at timestamptz;
alter table public.listings add column if not exists last_price_drop_from numeric;
create index if not exists listings_price_drop_idx on public.listings (last_price_drop_at desc) where last_price_drop_at is not null;
create index if not exists price_drops_listing_created_idx on public.price_drops (listing_id, created_at desc);

create or replace function public.price_reduced_window()
returns interval
language sql
immutable
as $$ select interval '14 days' $$;

create or replace function public.trg_listings_record_price_drop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only a genuine decrease in the same currency counts. Unchanged price, an increase, or a price that changes
  -- only because the currency changed are NOT reductions.
  if new.price < old.price and new.currency is not distinct from old.currency then
    insert into public.price_drops (listing_id, old_price, new_price) values (new.id, old.price, new.price);
    new.last_price_drop_at := now();
    new.last_price_drop_from := old.price;
  end if;
  return new;
end;
$$;

drop trigger if exists listings_b_record_price_drop on public.listings;
create trigger listings_b_record_price_drop
  before update of price on public.listings
  for each row execute function public.trg_listings_record_price_drop();

-- price_drops rows are now written only by the trigger above. Old app versions still INSERT one right after
-- changing the price: with no insert policy that INSERT is rejected, and those clients ignore the result
-- (verified in the code: dropPrice / dropListingPrice never check it), so the trigger's row is the only one
-- and notify_on_price_drop (0007) fires exactly once. It also removes the way for a seller to forge a
-- "reduced" badge by inserting a fake drop row.
drop policy if exists "listing owners can record price drops" on public.price_drops;

-- Backfill from existing history (genuine decreases only).
update public.listings l
   set last_price_drop_at = d.created_at, last_price_drop_from = d.old_price
  from (select distinct on (listing_id) listing_id, created_at, old_price, new_price
          from public.price_drops
         where new_price < old_price
         order by listing_id, created_at desc) d
 where d.listing_id = l.id and l.last_price_drop_at is null;

-- ============================================================================
-- 5. Indexed server-side search
-- ============================================================================
create index if not exists listings_title_trgm_idx on public.listings using gin (title extensions.gin_trgm_ops);
create index if not exists listings_feed_idx on public.listings (created_at desc, id desc) where status in ('available', 'reserved');
create index if not exists listings_category_feed_idx on public.listings (category, created_at desc, id desc) where status in ('available', 'reserved');
create index if not exists listings_location_feed_idx on public.listings (location_id, created_at desc, id desc) where status in ('available', 'reserved');
create index if not exists listings_negotiable_feed_idx on public.listings (created_at desc, id desc) where negotiable and status in ('available', 'reserved');
create index if not exists listings_user_created_idx on public.listings (user_id, created_at desc);

-- Approved places at or below p_scope_id (the same set the client's approved-only location index exposes).
create or replace function public.locations_in_scope(p_scope_id uuid)
returns table (id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with recursive d as (
    select l.id from public.locations l where l.id = p_scope_id and l.status = 'approved'
    union all
    select c.id from public.locations c join d on c.parent_id = d.id where c.status = 'approved'
  )
  select id from d;
$$;

create or replace function public.search_listings(
  p_query text default null,
  p_category text default null,
  p_scope_id uuid default null,
  p_verified boolean default false,
  p_boosted_today boolean default false,
  p_price_reduced boolean default false,
  p_negotiable boolean default false,
  p_posted_today boolean default false,
  p_limit int default 24,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (listing jsonb, is_boosted boolean, price_reduced boolean, seller_verified boolean)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 24), 1), 60);
  v_q text := nullif(btrim(left(coalesce(p_query, ''), 100)), '');
  v_pattern text;
  v_day_start timestamptz := public.marketplace_day_start(now());
  v_window interval := public.price_reduced_window();
begin
  if v_q is not null then
    v_pattern := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  -- Runs as the caller (SECURITY INVOKER): the listings RLS policy still hides removed/deactivated listings,
  -- and every filter below is evaluated inside the database — nothing is fetched and filtered in memory.
  return query
  select to_jsonb(l.*),
         coalesce(l.boosted_until > now(), false),
         (l.last_price_drop_at is not null and l.last_price_drop_at >= now() - v_window and l.price < l.last_price_drop_from),
         (p.verified_at is not null)
    from public.listings l
    join public.profiles p on p.id = l.user_id
   where l.status in ('available', 'reserved')
     and (v_pattern is null or l.title ilike v_pattern escape '\')
     and (p_category is null or l.category = p_category)
     and (p_scope_id is null or l.location_id in (select s.id from public.locations_in_scope(p_scope_id) s))
     and (not coalesce(p_verified, false) or p.verified_at is not null)
     and (not coalesce(p_boosted_today, false) or l.boosted_until > now())
     and (not coalesce(p_price_reduced, false)
          or (l.last_price_drop_at is not null and l.last_price_drop_at >= now() - v_window and l.price < l.last_price_drop_from))
     and (not coalesce(p_negotiable, false) or l.negotiable)
     and (not coalesce(p_posted_today, false) or l.created_at >= v_day_start)
     and not exists (select 1 from public.blocked_users b
                      where (b.blocker_id = auth.uid() and b.blocked_id = l.user_id)
                         or (b.blocked_id = auth.uid() and b.blocker_id = l.user_id))
     and (p_cursor_created_at is null or (l.created_at, l.id) < (p_cursor_created_at, coalesce(p_cursor_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by l.created_at desc, l.id desc
   limit v_limit + 1;
end;
$$;
grant execute on function public.search_listings(text, text, uuid, boolean, boolean, boolean, boolean, boolean, int, timestamptz, uuid) to anon, authenticated;
