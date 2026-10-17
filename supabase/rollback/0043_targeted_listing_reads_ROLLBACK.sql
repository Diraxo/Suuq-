-- ROLLBACK for 0043_targeted_listing_reads.sql.  NOT APPLIED ANYWHERE. Review before use.
--
-- Restores search_listings(), home_feed() and home_feed_currencies() to their 0038 / 0042 bodies (viewer's own blocks
-- only), then drops the four targeted-read functions, the private helper and the reverse-lookup index. Tables, policies
-- and data are untouched. After this, app builds that call listings_by_ids()/seller_listings()/comparable_listings()/
-- saved_search_counts() stop loading listing detail, Favorites, Compare, Offers and the seller screens — roll the apps
-- back too. The `private` schema itself is left in place (it may hold other objects). Re-runnable.
-- If supabase/proposed/0044_block_enforcement.sql was applied, run supabase/proposed/0044_block_enforcement_ROLLBACK.sql first (it depends on private.blocked_either_way()).

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
    v_extra := ' and l.last_price_drop_at is not null';
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
    || ' and not exists (select 1 from public.blocked_users b'
    ||                  ' where (b.blocker_id = auth.uid() and b.blocked_id = l.user_id)'
    ||                     ' or (b.blocked_id = auth.uid() and b.blocker_id = l.user_id))'
    || v_extra
    || case
         when p_cursor_id is null then ''
         when p_tab = 'latest' then ' and (l.created_at < $5 or (l.created_at = $5 and l.id > $6))'
         else ' and ((' || v_rank || ') > $12 or ((' || v_rank || ') = $12 and (l.created_at < $5 or (l.created_at = $5 and l.id > $6))))'
       end
    || ' order by ' || case when p_tab = 'latest' then '' else '(' || v_rank || ') asc, ' end || 'l.created_at desc, l.id asc'
    || ' limit $13';

  -- $7 trending "now", $8 price currency, $9 anchor, $10/$11 region/country place sets; unused ones are bound anyway.
  return query execute v_sql
    using v_cats, p_subcategory, p_city, v_scope, p_cursor_created_at, p_cursor_id,
          v_now, v_currency, p_anchor_id, v_region_ids, v_country_ids, coalesce(p_cursor_rank, 0), v_limit + 1;
end;
$$;
grant execute on function public.home_feed(text, text[], text, uuid, text, uuid, text, text, int, timestamptz, double precision, timestamptz, uuid) to anon, authenticated;

create or replace function public.home_feed_currencies(
  p_categories text[] default null,
  p_scope_id uuid default null
)
returns table (code text, n bigint)
language sql
stable
set search_path = public, extensions
as $$
  select upper(coalesce(nullif(l.currency, ''), 'ETB')) as code, count(*) as n
    from public.listings l
    join public.profiles p on p.id = l.user_id
   where l.status not in ('removed', 'deactivated')
     and (p_categories is null or cardinality(p_categories) = 0 or l.category = any(p_categories))
     and (p_scope_id is null or l.location_id in (select s.id from public.locations_in_scope(p_scope_id) s))
     and not exists (select 1 from public.blocked_users b
                      where (b.blocker_id = auth.uid() and b.blocked_id = l.user_id)
                         or (b.blocked_id = auth.uid() and b.blocker_id = l.user_id))
   group by 1
   order by n desc, code asc;
$$;
grant execute on function public.home_feed_currencies(text[], uuid) to anon, authenticated;

drop function if exists public.saved_search_counts(text[]);
drop function if exists public.comparable_listings(text, text, uuid, int);
drop function if exists public.seller_listings(uuid, int);
drop function if exists public.listings_by_ids(uuid[]);
drop function if exists private.blocked_either_way();
drop index if exists public.blocked_users_blocked_idx;
