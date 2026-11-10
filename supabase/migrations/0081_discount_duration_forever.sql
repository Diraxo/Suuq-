-- 0081 — discount duration: any whole number of days up to 365, or "until I end it" (Phase 2 follow-up to 0080).
--   * set_listing_discount() takes p_days 1..365 (was 1..30) or p_forever => true. A permanent discount stores NO expiry
--     (discount_ends_at stays null; the explicit flag discount_permanent says so) and stays live until the seller ends it
--     or the listing stops being 'available'. Nothing is faked with a far-future timestamp.
--   * The price-hold rule is unchanged (a price must have been held 3 days before it can be discounted). Its refusal now
--     carries the exact UTC instant the hold ends, so a client can show the seller's local date and time, not a bare date.
--   * The price stays frozen while a discount runs (permanent ones included); client writes still cannot touch any
--     discount column; settling only ever touches finite discounts whose end has passed.
--   * listing_discount_live() gains the permanent flag; search_listings() and home_feed() pass it. The 4-argument form is dropped.
-- Applied on top of 0080 (already in production) — it replaces functions and adds one column; it does not edit 0080.
-- Depends on 0080. Re-runnable.

alter table public.listings add column if not exists discount_permanent boolean not null default false;

alter table public.listings drop constraint if exists listings_discount_shape;
alter table public.listings add constraint listings_discount_shape check (
  (discount_original_price is null and discount_started_at is null and discount_ends_at is null and discount_note is null
     and not discount_permanent)
  or (discount_original_price > 0 and discount_started_at is not null
      and ((discount_permanent and discount_ends_at is null) or (not discount_permanent and discount_ends_at > discount_started_at))
      and (discount_note is null or char_length(discount_note) between 1 and 60))
);

-- ----------------------------------------------------------------------------------------------------------------
-- The one rule every screen and query shares (mirrored by lib/discount.ts activeDiscount()).
create or replace function public.listing_discount_live(p_price numeric, p_original numeric, p_ends timestamptz, p_status text, p_permanent boolean)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
    p_status = 'available' and p_original is not null
    and ((coalesce(p_permanent, false) and p_ends is null) or (not coalesce(p_permanent, false) and p_ends is not null and p_ends > now()))
    and p_original > 0 and p_price < p_original and (p_original - p_price) * 100 >= p_original,
    false)
$$;
grant execute on function public.listing_discount_live(numeric, numeric, timestamptz, text, boolean) to anon, authenticated;

-- ----------------------------------------------------------------------------------------------------------------
-- Client writes: discount_* / price_changed_at are server-owned; the price is frozen while a discount runs.
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
    new.discount_original_price := null;
    new.discount_started_at := null;
    new.discount_ends_at := null;
    new.discount_note := null;
    new.discount_permanent := false;
    new.price_changed_at := now();
    new.status_before_moderation := null;
    new.views := 0;
    new.favorites_count := 0;
    if new.status in ('removed', 'deactivated') then
      raise exception 'Only staff can remove or deactivate a listing' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.boosted_until is distinct from old.boosted_until
     or new.last_price_drop_at is distinct from old.last_price_drop_at
     or new.last_price_drop_from is distinct from old.last_price_drop_from
     or new.discount_original_price is distinct from old.discount_original_price
     or new.discount_started_at is distinct from old.discount_started_at
     or new.discount_ends_at is distinct from old.discount_ends_at
     or new.discount_note is distinct from old.discount_note
     or new.discount_permanent is distinct from old.discount_permanent
     or new.price_changed_at is distinct from old.price_changed_at
     or new.status_before_moderation is distinct from old.status_before_moderation
     or new.views is distinct from old.views
     or new.favorites_count is distinct from old.favorites_count then
    raise exception 'Protected listing column' using errcode = '42501';
  end if;
  if (new.price is distinct from old.price or new.currency is distinct from old.currency) and old.discount_original_price is not null then
    if old.discount_permanent or old.discount_ends_at > now() then
      raise exception 'End the discount before changing the price' using errcode = 'P0001';
    end if;
    -- An expired discount that has not been settled yet: the seller's explicit new price wins.
    new.discount_original_price := null;
    new.discount_started_at := null;
    new.discount_ends_at := null;
    new.discount_note := null;
    new.discount_permanent := false;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------------------------------------------
-- Settling: only a finite discount whose end has passed. A permanent discount has no end to pass.
create or replace function public.settle_expired_discounts(p_owner uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  with s as (
    update public.listings l
       set price = l.discount_original_price,
           discount_original_price = null, discount_started_at = null, discount_ends_at = null, discount_note = null,
           updated_at = now()
     where l.discount_original_price is not null and not l.discount_permanent and l.discount_ends_at <= now()
       and (p_owner is null or l.user_id = p_owner)
    returning 1)
  select count(*) into v_n from s;
  return v_n;
end;
$$;
revoke all on function public.settle_expired_discounts(uuid) from public, anon, authenticated;

drop function if exists public.set_listing_discount(uuid, numeric, int, text);
create or replace function public.set_listing_discount(
  p_listing uuid, p_new_price numeric, p_days int default null, p_note text default null, p_forever boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  l public.listings;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_forever boolean := coalesce(p_forever, false);
  v_held_since timestamptz;
  v_hold_until timestamptz;
  v_ends timestamptz;
begin
  if v_uid is null then raise exception 'Sign in to set a discount' using errcode = '42501'; end if;
  if public.account_effective_status(v_uid) in ('suspended', 'banned') then
    raise exception 'Your account cannot set discounts' using errcode = '42501';
  end if;
  perform public.settle_expired_discounts(v_uid);
  select * into l from public.listings where id = p_listing for update;
  if not found or l.user_id <> v_uid then raise exception 'Listing not found' using errcode = '42501'; end if;
  if l.status <> 'available' then raise exception 'Only an available listing can be discounted' using errcode = 'P0001'; end if;
  if l.discount_original_price is not null then raise exception 'A discount is already running on this listing' using errcode = 'P0001'; end if;
  if not v_forever and (p_days is null or p_days < 1 or p_days > 365) then
    raise exception 'A discount runs for 1 to 365 days, or until you end it' using errcode = 'P0001';
  end if;
  v_hold_until := l.price_changed_at + interval '3 days';
  if v_hold_until > now() then
    -- The exact instant (UTC), so the app can show it in the seller's own time zone. Begins with the date, as in 0080.
    raise exception 'The price was changed recently. You can set a discount from %', to_char(v_hold_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      using errcode = 'P0001';
  end if;
  if p_new_price is null or p_new_price <= 0 or p_new_price <> trunc(p_new_price) then raise exception 'Enter a whole number for the new price' using errcode = 'P0001'; end if;
  if p_new_price >= l.price then raise exception 'The new price must be lower than the current price' using errcode = 'P0001'; end if;
  if (l.price - p_new_price) * 100 < l.price then raise exception 'A discount must be at least 1%%' using errcode = 'P0001'; end if;
  if p_new_price * 10 < l.price then raise exception 'A discount can be at most 90%%' using errcode = 'P0001'; end if;
  if v_note is not null and (char_length(v_note) > 60 or v_note ~ '[[:cntrl:]]') then
    raise exception 'The note must be at most 60 characters, without special characters' using errcode = 'P0001';
  end if;

  v_held_since := l.price_changed_at;
  v_ends := case when v_forever then null else now() + make_interval(hours => p_days * 24) end;
  update public.listings
     set price = p_new_price, discount_original_price = l.price, discount_started_at = now(),
         discount_ends_at = v_ends, discount_permanent = v_forever, discount_note = v_note, updated_at = now()
   where id = l.id;
  -- Starting a discount does not restart the "price held" clock for the original price.
  update public.listings set price_changed_at = v_held_since where id = l.id;
  return jsonb_build_object('price', p_new_price, 'original_price', l.price, 'ends_at', v_ends, 'permanent', v_forever, 'note', v_note,
                            'started_at', (select discount_started_at from public.listings where id = l.id));
end;
$$;
revoke all on function public.set_listing_discount(uuid, numeric, int, text, boolean) from public, anon;
grant execute on function public.set_listing_discount(uuid, numeric, int, text, boolean) to authenticated;

create or replace function public.end_listing_discount(p_listing uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  l public.listings;
begin
  if v_uid is null then raise exception 'Sign in to end a discount' using errcode = '42501'; end if;
  select * into l from public.listings where id = p_listing for update;
  if not found or l.user_id <> v_uid then raise exception 'Listing not found' using errcode = '42501'; end if;
  if l.discount_original_price is null then
    return jsonb_build_object('price', l.price, 'ended', false);
  end if;
  update public.listings
     set price = discount_original_price,
         discount_original_price = null, discount_started_at = null, discount_ends_at = null, discount_note = null,
         discount_permanent = false, updated_at = now()
   where id = l.id;
  return jsonb_build_object('price', l.discount_original_price, 'ended', true);
end;
$$;
revoke all on function public.end_listing_discount(uuid) from public, anon;
grant execute on function public.end_listing_discount(uuid) to authenticated;

-- ----------------------------------------------------------------------------------------------------------------
-- Reads (copied from 0080, now passing the permanent flag).
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
         public.listing_discount_live(l.price, l.discount_original_price, l.discount_ends_at, l.status, l.discount_permanent),
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
          or public.listing_discount_live(l.price, l.discount_original_price, l.discount_ends_at, l.status, l.discount_permanent))
     and (not coalesce(p_negotiable, false) or l.negotiable)
     and (not coalesce(p_posted_today, false) or l.created_at >= v_day_start)
     and l.user_id <> all((select private.blocked_either_way())::uuid[])
     and (p_cursor_created_at is null or (l.created_at, l.id) < (p_cursor_created_at, coalesce(p_cursor_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by l.created_at desc, l.id desc
   limit v_limit + 1;
end;
$$;
grant execute on function public.search_listings(text, text, uuid, boolean, boolean, boolean, boolean, boolean, int, timestamptz, uuid) to anon, authenticated;

create or replace function public.home_feed(
  p_tab text default 'latest',
  p_categories text[] default null,
  p_subcategory text default null,
  p_scope_id uuid default null,
  p_city text default null,
  p_anchor_id uuid default null,
  p_currency text default null,
  p_price_order text default 'asc',
  p_limit int default 24,
  p_now timestamptz default null,
  p_cursor_rank double precision default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (listing jsonb, sort_rank double precision)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 24), 1), 60);
  v_now timestamptz := least(coalesce(p_now, now()), now() + interval '5 minutes');
  v_currency text := upper(coalesce(nullif(btrim(p_currency), ''), 'ETB'));
  v_cats text[] := case when p_categories is null or cardinality(p_categories) = 0 then null else p_categories end;
  v_region uuid;
  v_country uuid;
  v_scope uuid[];
  v_cat_sql text;
  v_scope_sql text;
  v_region_ids uuid[] := '{}';
  v_country_ids uuid[] := '{}';
  v_rank text;
  v_extra text := '';
  v_sql text;
begin
  if p_tab not in ('latest', 'nearby', 'trending', 'price', 'price_drops') then
    raise exception 'Unknown feed tab %', p_tab using errcode = '22023';
  end if;
  if p_price_order not in ('asc', 'desc') then
    raise exception 'Unknown price order %', p_price_order using errcode = '22023';
  end if;

  -- Approved places at or below the chosen one. Resolved once, up front, so the filter below is a plain equality
  -- (index-friendly) for the common case of a single city. An unknown/unapproved place matches nothing.
  if p_scope_id is not null then
    v_scope := array(select s.id from public.locations_in_scope(p_scope_id) s);
  end if;
  v_cat_sql := case when v_cats is null then ''
                    when cardinality(v_cats) = 1 then ' and l.category = ($1)[1]'
                    else ' and l.category = any($1)' end;
  v_scope_sql := case when p_scope_id is null then ''
                      when cardinality(v_scope) = 0 then ' and false'
                      when cardinality(v_scope) = 1 then ' and l.location_id = ($4)[1]'
                      else ' and l.location_id = any($4)' end;

  if p_tab = 'latest' then
    v_rank := '0::double precision';
  elsif p_tab = 'price_drops' then
    v_rank := '(-floor(extract(epoch from l.discount_started_at) * 1000))::double precision';
    v_extra := ' and public.listing_discount_live(l.price, l.discount_original_price, l.discount_ends_at, l.status, l.discount_permanent)';
  elsif p_tab = 'trending' then
    v_rank := '(-(greatest(l.views, 0) + greatest(l.favorites_count, 0) * 5)::double precision'
              || ' / (1 + greatest(0, extract(epoch from ($7 - l.created_at)) / 86400.0) / 7.0))';
  elsif p_tab = 'price' then
    v_rank := '(case when l.price > 0 then ' || case when p_price_order = 'asc' then 'l.price::double precision' else '(-l.price)::double precision' end
              || ' else 1e18::double precision end)';
    v_extra := ' and upper(coalesce(nullif(l.currency, ''''), ''ETB'')) = $8';
  else -- nearby
    -- Region = the anchor itself when it is a region, else its nearest region ancestor; country likewise.
    with recursive up as (
      select a.id, a.parent_id, a.kind, 0 as depth from public.locations a where a.id = p_anchor_id and a.status = 'approved'
      union all
      select p.id, p.parent_id, p.kind, up.depth + 1 from public.locations p join up on p.id = up.parent_id where p.status = 'approved'
    )
    select (select u.id from up u where u.kind = 'region' order by u.depth limit 1),
           (select u.id from up u where u.kind = 'country' order by u.depth limit 1)
      into v_region, v_country;
    if v_region is not null then
      v_region_ids := array(select s.id from public.locations_in_scope(v_region) s);
    end if;
    if v_country is not null then
      v_country_ids := array(select s.id from public.locations_in_scope(v_country) s);
    end if;
    v_rank := '(case when l.location_id = $9 then 0 when l.location_id = any($10) then 1 when l.location_id = any($11) then 2 else 3 end)::double precision';
    -- With no chosen place "near me" stops at the home country; a chosen place is the area being browsed.
    if p_scope_id is null then
      v_extra := ' and (case when l.location_id = $9 then 0 when l.location_id = any($10) then 1 when l.location_id = any($11) then 2 else 3 end) <= 2';
    end if;
  end if;

  -- Every user-supplied value is bound ($n); only fixed fragments are concatenated.
  v_sql := 'select to_jsonb(l.*), ' || v_rank || ' as sort_rank'
    || ' from public.listings l join public.profiles p on p.id = l.user_id'
    || ' where l.status not in (''removed'', ''deactivated'')'
    || v_cat_sql
    || ' and ($2::text is null or l.subcategory = $2)'
    || ' and ($3::text is null or l.city = $3)'
    || v_scope_sql
    || ' and l.user_id <> all($14)'
    || v_extra
    || case
         when p_cursor_id is null then ''
         when p_tab = 'latest' then ' and (l.created_at < $5 or (l.created_at = $5 and l.id > $6))'
         else ' and ((' || v_rank || ') > $12 or ((' || v_rank || ') = $12 and (l.created_at < $5 or (l.created_at = $5 and l.id > $6))))'
       end
    || ' order by ' || case when p_tab = 'latest' then '' else '(' || v_rank || ') asc, ' end || 'l.created_at desc, l.id asc'
    || ' limit $13';

  -- $14 the viewer's blocks in either direction (private.blocked_either_way(), 0043). $7 trending "now", $8 price currency, $9 anchor, $10/$11 region/country place sets; unused ones are bound anyway.
  return query execute v_sql
    using v_cats, p_subcategory, p_city, v_scope, p_cursor_created_at, p_cursor_id,
          v_now, v_currency, p_anchor_id, v_region_ids, v_country_ids, coalesce(p_cursor_rank, 0), v_limit + 1,
          private.blocked_either_way();
end;
$$;
grant execute on function public.home_feed(text, text[], text, uuid, text, uuid, text, text, int, timestamptz, double precision, timestamptz, uuid) to anon, authenticated;

-- 0080 four-argument predicate is superseded (search_listings / home_feed above no longer call it).
drop function if exists public.listing_discount_live(numeric, numeric, timestamptz, text);

-- ----------------------------------------------------------------------------------------------------------------
-- A sale ends the discount for good. Whatever marks the listing sold - the app, the website, mark-sold RPCs or a direct
-- UPDATE - the discount fields are cleared and the price stays what it sold for. Reopening later gives an ordinary
-- listing at that price (a Forever discount does not come back); price_changed_at restarts the 3-day hold before a new
-- discount. Reserved is not touched: the discount is only hidden from buyers (listing_discount_live) and its clock runs.
-- Runs after listings_a_guard_protected (trigger order is by name), so a client write is checked first and this
-- server-side clearing is not mistaken for a client edit of protected columns.
create or replace function public.trg_listings_sold_ends_discount()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'sold' and old.status is distinct from 'sold' and new.discount_original_price is not null then
    new.discount_original_price := null;
    new.discount_started_at := null;
    new.discount_ends_at := null;
    new.discount_note := null;
    new.discount_permanent := false;
    new.price_changed_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists listings_b_sold_ends_discount on public.listings;
create trigger listings_b_sold_ends_discount
  before update of status on public.listings
  for each row execute function public.trg_listings_sold_ends_discount();

-- Listings already sold with a discount still attached (written before this rule): clear them the same way.
update public.listings
   set discount_original_price = null, discount_started_at = null, discount_ends_at = null, discount_note = null,
       discount_permanent = false
 where status = 'sold' and discount_original_price is not null;
