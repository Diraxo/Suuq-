-- 0042 — Home / category / city feed pagination.
--
-- Until now Home, the category screen and the city screen downloaded EVERY listing (plus every price drop) and
-- filtered/sorted them in memory. This adds one server-side, keyset-paginated feed so each screen asks for one page
-- at a time. Depends on 0032 (listings.location_id, locations), 0038 (last_price_drop_at, locations_in_scope) and
-- 0039 (listings RLS). Safe to re-run. Rollback: supabase/rollback/0042_home_feed_down.sql.
--
-- Semantics are the ones lib/homeFeed.ts defines (the reference implementation; supabase/tests/homefeed.test.mjs
-- proves this function returns the same listings in the same order for every tab):
--   * visibility: every status except removed/deactivated (sold/expired stay visible with their badge, exactly as
--     before). The listings RLS policy still applies — this function is SECURITY INVOKER.
--   * blocked sellers (either direction) are excluded, listings whose seller profile is gone are excluded.
--   * every tab orders by (sort_rank asc, created_at desc, id asc); the cursor is the last row's
--     (sort_rank, created_at, id), so a page never repeats or skips a row that existed when the feed started.
--
-- sort_rank per tab:
--   latest      0 (constant)                    -> pure newest-first, served by the feed indexes below
--   price_drops -(ms epoch of last price drop)  -> most recent drop first
--   trending    -(views + 5*favorites) / (1 + age_days/7), age measured at p_now (frozen for the whole feed session)
--   price       +/-price for usable prices (price > 0), a huge constant for the rest (they go last)
--   nearby      0 same place, 1 same region, 2 same country, 3 elsewhere (3 only when a place is chosen)

-- Why only these two (planner evidence in supabase/tests/homefeed.test.mjs): Latest/For You read straight off the first
-- one (no sort of the table); a rare category needs the second (without it: sequential scan + sort). A place feed
-- needs nothing new: listings_location_id_idx (0032) already serves a single-city feed and the first index serves
-- region/country feeds, so a (location_id, created_at) index was measured and dropped as redundant.
create index if not exists listings_home_feed_idx
  on public.listings (created_at desc, id)
  where status not in ('removed', 'deactivated');
create index if not exists listings_home_category_idx
  on public.listings (category, created_at desc, id)
  where status not in ('removed', 'deactivated');

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

-- Currencies present in the browsed set (category + place), most common first — the Price tab's currency choices
-- and its "N more listings are in other currencies" count. Same visibility/blocked rules as home_feed().
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
