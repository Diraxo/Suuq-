-- 0079 — one discount rule for the badge, the "Discounted" search filter and the Discounts home tab.
-- Mirrors lib/discount.ts activeDiscount(): listing is 'available', the recorded drop is within price_reduced_window(),
-- the current price is still below the price it dropped from, and the cut is at least a whole 1%.
-- Also closes two stale-state holes in the 0038 trigger: a currency change used to leave last_price_drop_from in the
-- OLD currency (so price < from compared two currencies), and a price raised back to/above the old price left a dead drop.
-- Depends on 0038, 0042, 0043. Re-runnable.

create or replace function public.listing_discount_active(p_price numeric, p_from numeric, p_at timestamptz, p_status text)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
    p_status = 'available'
    and p_at is not null and p_from is not null and p_from > 0 and p_price < p_from
    and p_at >= now() - public.price_reduced_window()
    and (p_from - p_price) * 100 >= p_from,
    false)
$$;
grant execute on function public.listing_discount_active(numeric, numeric, timestamptz, text) to anon, authenticated;

create or replace function public.trg_listings_record_price_drop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.currency is distinct from old.currency then
    -- The remembered "from" price is in the old currency: it can no longer be compared with the new price.
    new.last_price_drop_at := null;
    new.last_price_drop_from := null;
  elsif new.price < old.price then
    insert into public.price_drops (listing_id, old_price, new_price) values (new.id, old.price, new.price);
    new.last_price_drop_at := now();
    new.last_price_drop_from := old.price;
  elsif new.price > old.price and new.last_price_drop_from is not null and new.price >= new.last_price_drop_from then
    -- Raised back to (or above) where the discount started: the discount is over.
    new.last_price_drop_at := null;
    new.last_price_drop_from := null;
  end if;
  return new;
end;
$$;

drop trigger if exists listings_b_record_price_drop on public.listings;
create trigger listings_b_record_price_drop
  before update of price, currency on public.listings
  for each row execute function public.trg_listings_record_price_drop();

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
         public.listing_discount_active(l.price, l.last_price_drop_from, l.last_price_drop_at, l.status),
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
          or public.listing_discount_active(l.price, l.last_price_drop_from, l.last_price_drop_at, l.status))
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
    v_rank := '(-floor(extract(epoch from l.last_price_drop_at) * 1000))::double precision';
    v_extra := ' and l.last_price_drop_at is not null and l.last_price_drop_at >= now() - public.price_reduced_window()'
               || ' and public.listing_discount_active(l.price, l.last_price_drop_from, l.last_price_drop_at, l.status)';
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
