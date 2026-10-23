
-- ===== 0043_targeted_listing_reads.sql =====
-- 0043 — Targeted listing reads (so the app no longer downloads every listing at launch) + two-way block enforcement.
--
-- WHY. The app used to call `listings.select('*')` at startup and resolve Favorites, Compare, Offers, the seller
-- screens and the listing-detail screen from that in-memory copy. These read paths now ask Postgres for exactly what a
-- screen shows:
--   listings_by_ids(uuid[])          the listings of a favourites / recently-viewed / deep-link set (<= 200 ids per call)
--   seller_listings(uuid, int)       one seller's listings (seller + dealer screens)
--   comparable_listings(...)         same-category candidates for Compare / market-price / price suggestions
--   saved_search_counts(text[])      the "N matches" badge of each saved search
-- All four are SECURITY INVOKER: the listings RLS policy (0039) still decides visibility, and they additionally hide
-- removed/deactivated rows exactly like the old startup query did (`status not in ('removed','deactivated')`).
--
-- BLOCKING (both directions). `blocked_users` has one policy — "users manage their own blocks": a user can only see the
-- rows THEY created (blocker_id = auth.uid()). A SECURITY INVOKER function therefore can never see "X blocked me", so
-- search_listings() (0038) and home_feed() (0042) only hid the viewer's own blocks; the blocked user still saw the
-- blocker's listings, and the client's "blocked by" list (a second blocked_users query) was always empty for the same
-- reason. The fix keeps blocked_users private (no new policy, no read access to the table):
--   private.blocked_either_way()     SECURITY DEFINER; returns ONLY the caller's own counterparties, as one uuid[]. It
--                                    lives in schema `private` (NOT exposed by PostgREST, so a client cannot call it as an
--                                    RPC and cannot use it as an oracle) and takes no arguments, so nobody can ask about a
--                                    third party's relationships. It is evaluated once per query, not once per row.
-- Because the read RPCs return the same empty/missing result for a blocked listing as for a deleted one, the caller
-- cannot tell "blocked me" from "removed" in a single response. (A user can still notice that a listing which used to
-- be visible has vanished — unavoidable for any hiding scheme.)
-- NOT done here: the base `listings` table policy. A direct PostgREST `from('listings').select()` by a blocked user still
-- returns the blocker's rows. Hardening that would also hide a blocker's listing from existing chat/offer joins; the
-- tested option is in supabase/proposed/0044_block_enforcement.sql and needs an owner decision.
--
-- Depends on 0017 (blocked_users), 0038 (search_listings), 0039 (listings RLS), 0042 (home_feed). Safe to re-run.
-- Rollback: supabase/rollback/0043_targeted_listing_reads_ROLLBACK.sql.

create schema if not exists private;
grant usage on schema private to anon, authenticated;

-- The reverse lookup (blocked_id = me) needs its own index; the primary key (blocker_id, blocked_id) only serves blocker lookups.
create index if not exists blocked_users_blocked_idx on public.blocked_users (blocked_id);

create or replace function private.blocked_either_way()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct x.other_id), '{}'::uuid[])
    from (
      select b.blocked_id as other_id from public.blocked_users b where b.blocker_id = auth.uid()
      union all
      select b.blocker_id from public.blocked_users b where b.blocked_id = auth.uid()
    ) x
   where auth.uid() is not null;
$$;
revoke all on function private.blocked_either_way() from public;
grant execute on function private.blocked_either_way() to anon, authenticated;

-- ============================================================================
-- Targeted reads
-- ============================================================================
-- Rows are `to_jsonb(l.*)`, the same shape home_feed()/search_listings() return, so the client hydrates them with the
-- same code. Order is unspecified — callers key by id.
create or replace function public.listings_by_ids(p_ids uuid[])
returns table (listing jsonb)
language plpgsql
stable
set search_path = public, extensions
as $$
begin
  if p_ids is not null and cardinality(p_ids) > 200 then
    raise exception 'Too many ids (max 200)' using errcode = '22023';
  end if;
  return query
  select to_jsonb(l.*)
    from public.listings l
   where l.id = any(coalesce(p_ids, '{}'::uuid[]))
     and l.status not in ('removed', 'deactivated')
     and l.user_id <> all((select private.blocked_either_way())::uuid[]);
end;
$$;
grant execute on function public.listings_by_ids(uuid[]) to anon, authenticated;

-- One seller's listings, newest first. Returns up to p_limit + 1 rows (p_limit max 100) so the caller can tell "there are more".
create or replace function public.seller_listings(p_seller_id uuid, p_limit int default 100)
returns table (listing jsonb)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 100);
begin
  if p_seller_id is null or p_seller_id = any((select private.blocked_either_way())::uuid[]) then
    return;
  end if;
  return query
  select to_jsonb(l.*)
    from public.listings l
   where l.user_id = p_seller_id
     and l.status not in ('removed', 'deactivated')
   order by l.created_at desc, l.id desc
   limit v_limit + 1;
end;
$$;
grant execute on function public.seller_listings(uuid, int) to anon, authenticated;

-- Candidates for "similar listings": same category, available, not the listing itself. Same-subcategory rows come first
-- (they score highest client-side), then newest. Capped at p_limit (max 100) — the client ranks within this sample.
create or replace function public.comparable_listings(
  p_category text,
  p_subcategory text default null,
  p_exclude_id uuid default null,
  p_limit int default 60
)
returns table (listing jsonb)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 60), 1), 100);
begin
  if p_category is null or btrim(p_category) = '' then
    return;
  end if;
  return query
  select to_jsonb(l.*)
    from public.listings l
   where l.category = p_category
     and l.status = 'available'
     and (p_exclude_id is null or l.id <> p_exclude_id)
     and l.user_id <> all((select private.blocked_either_way())::uuid[])
   order by (p_subcategory is not null and l.subcategory is not distinct from p_subcategory) desc, l.created_at desc, l.id desc
   limit v_limit;
end;
$$;
grant execute on function public.comparable_listings(text, text, uuid, int) to anon, authenticated;

-- "N matches" per saved search: titles containing the text (case-insensitive), any visible status — the same rule the
-- screen applied to its in-memory copy. Each count stops at 100 and at most 20 searches are answered per call.
create or replace function public.saved_search_counts(p_queries text[])
returns table (query text, n int)
language plpgsql
stable
set search_path = public, extensions
as $$
begin
  return query
  select qq.q,
         case when btrim(qq.q) = '' then 0 else (
           select count(*)::int from (
             select 1 from public.listings l
              where l.title ilike '%' || replace(replace(replace(btrim(left(qq.q, 100)), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
                and l.status not in ('removed', 'deactivated')
                and l.user_id <> all((select private.blocked_either_way())::uuid[])
              limit 100
           ) s
         ) end
    from (select distinct u.q from unnest((coalesce(p_queries, '{}'::text[]))[1:20]) as u(q) where u.q is not null) qq;
end;
$$;
grant execute on function public.saved_search_counts(text[]) to anon, authenticated;

-- ============================================================================
-- Existing read paths, now enforcing blocks in BOTH directions
-- (bodies are 0038 / 0042 verbatim except the block predicate)
-- ============================================================================

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
     and l.user_id <> all((select private.blocked_either_way())::uuid[])
   group by 1
   order by n desc, code asc;
$$;
grant execute on function public.home_feed_currencies(text[], uuid) to anon, authenticated;

-- ===== 0044_block_enforcement.sql =====
-- 0044 — block enforcement on the base listings table, chat and offers. Needs 0043. Tested in supabase/tests/block_enforcement.test.mjs.
-- Rollback: supabase/rollback/0044_block_enforcement_ROLLBACK.sql. (Replaces the earlier policy-only proposal.)
--
-- ONE RULE, enforced in the database: when either user has blocked the other,
--   (1) neither can READ the other's listings  (base-table RLS policy; closes direct PostgREST `from('listings')` reads),
--   (2) neither can START anything with the other: new conversation, new offer, counter-offer, accept, new message.
-- Block rows stay private: blocked_users keeps its single "own rows only" policy, and nothing here is callable from the API.
--
-- WHY the chat/offers review changed the design of the earlier proposal. Auditing every workflow that touches listings:
--   * chat list / chat screen / offers inbox embed `listing:listings(...)` (PostgREST LEFT join) and read `row.listing?.x`,
--     so a hidden listing only blanks the title/image of a thread with a blocked person; no thread is dropped and nothing
--     errors. (Clients now show an explicit "listing unavailable" label instead of an empty title / 0 price.)
--   * find_or_create_conversation / create_offer / respond_to_offer are SECURITY DEFINER: they read listings as the owner,
--     so the RLS policy never applied to them — and they never checked blocks at all. A blocked user could still open a
--     chat, send offers and send messages by calling the RPC / inserting into messages directly. (A pure policy change, like
--     the first proposal, would NOT have closed that. Triggers do, and they work for definer functions too.)
--   * Existing, NON-blocked conversations and offers are untouched: the policy only hides a row whose owner is one of the
--     caller's blocked_either_way() counterparties. History between two users stays readable (messages / offers tables);
--     only the listing row is hidden, and decline/cancel/expire of an old offer stay allowed so nobody is trapped.
--
-- Error text is the same one a missing listing gives ('Listing not found'), so a blocked caller cannot tell "blocked" from "gone".

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Base listings policy: block-aware (owner and staff always see the row)
-- ---------------------------------------------------------------------------------------------------------------------
drop policy if exists "listings are publicly readable" on public.listings;
create policy "listings are publicly readable" on public.listings
  for select using (
    (status not in ('removed', 'deactivated') or auth.uid() = user_id or public.is_staff())
    and (auth.uid() = user_id or public.is_staff() or user_id <> all((select private.blocked_either_way())::uuid[]))
  );

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Pair check used only by the triggers below. SECURITY DEFINER (blocked_users is RLS-private), in schema `private`
--    (not exposed by PostgREST), no EXECUTE for API roles -> it cannot be used as an oracle about third parties.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function private.users_blocked(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.blocked_users x
     where (x.blocker_id = p_a and x.blocked_id = p_b) or (x.blocker_id = p_b and x.blocked_id = p_a)
  );
$$;
revoke all on function private.users_blocked(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Write-path guards. Trigger functions run as their owner; the pair is read from the row, never from the caller, so
--    they also hold for service-role / definer inserts (find_or_create_conversation, create_offer, respond_to_offer).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function private.guard_conversation_block()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if private.users_blocked(new.buyer_id, new.seller_id) then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_conversation_block() from public, anon, authenticated;
drop trigger if exists conversations_block_guard on public.conversations;
create trigger conversations_block_guard before insert on public.conversations
  for each row execute function private.guard_conversation_block();

-- New offers (including counters, which insert a row) and the move to 'accepted'. Reject / cancel / expire stay allowed.
create or replace function private.guard_offer_block()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and not (new.status = 'accepted' and old.status is distinct from 'accepted') then
    return new;
  end if;
  if private.users_blocked(new.buyer_id, new.seller_id) then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_offer_block() from public, anon, authenticated;
drop trigger if exists offers_block_guard_insert on public.offers;
create trigger offers_block_guard_insert before insert on public.offers
  for each row execute function private.guard_offer_block();
drop trigger if exists offers_block_guard_accept on public.offers;
create trigger offers_block_guard_accept before update of status on public.offers
  for each row execute function private.guard_offer_block();

create or replace function private.guard_message_block()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_buyer uuid;
  v_seller uuid;
begin
  select c.buyer_id, c.seller_id into v_buyer, v_seller from public.conversations c where c.id = new.conversation_id;
  if v_buyer is not null and private.users_blocked(v_buyer, v_seller) then
    raise exception 'Conversation not available' using errcode = 'P0002';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_message_block() from public, anon, authenticated;
drop trigger if exists messages_block_guard on public.messages;
create trigger messages_block_guard before insert on public.messages
  for each row execute function private.guard_message_block();

-- ===== 0045_report_notifies_staff.sql =====
-- 0045 — a new report reaches the admin side immediately.
--
-- Until now a report was only a row in public.reports: staff saw it when they next opened the dashboard. This adds an
-- AFTER INSERT trigger that writes one in-app notification (and, through the existing notifications push webhook from
-- 0012, a push) to every admin and moderator, naming the category (listing / user / review) and the reason. The
-- notification carries only ids, never the reporter's identity or free-text details.
-- A failure to notify must never block a report from being filed, so the body is wrapped in an exception handler.
-- Needs 0039 (staff roles). Rollback: supabase/rollback/0045_report_notifies_staff_ROLLBACK.sql.

create or replace function public.trg_reports_notify_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.notifications (user_id, title, body, type, data)
    select a.user_id,
           case new.target_type when 'listing' then 'New listing report' when 'user' then 'New user report' else 'New ' || new.target_type || ' report' end,
           left(new.reason, 120),
           'report_staff',
           jsonb_build_object('reportId', new.id, 'targetType', new.target_type, 'targetId', new.target_id)
      from public.admin_users a
     where a.role in ('admin', 'moderator')
       and a.user_id <> new.reporter_id;
  exception when others then
    null; -- never block a report because a notification could not be written
  end;
  return new;
end;
$$;
revoke execute on function public.trg_reports_notify_staff() from public, anon, authenticated;

drop trigger if exists reports_c_notify_staff on public.reports;
create trigger reports_c_notify_staff after insert on public.reports
  for each row execute function public.trg_reports_notify_staff();

-- ===== 0046_whatsapp_style_blocking.sql =====
-- 0046 — WhatsApp-style blocking for chat. Needs 0043 + 0044. Tested in supabase/tests/chat_blocking.test.mjs.
-- Rollback: supabase/rollback/0046_whatsapp_style_blocking_ROLLBACK.sql.
--
-- WHAT CHANGES vs 0044 (which refused every message between a blocked pair, so the blocked person saw "Failed to send"
-- and the blocker lost the conversation). The behaviour now matches WhatsApp:
--
--   * The BLOCKED person sends a message -> it is accepted, the sender sees it with a single tick, and it is NEVER shown
--     to the blocker: no row visible, no unread count, no notification / push, no chat-list preview. It is not delivered
--     later either (unblocking does not release it). The sender is not told anything — they just never get a second tick.
--   * The BLOCKER keeps the conversation and its history. They cannot send while the block is on (the app asks them to
--     unblock first); a direct API call gets the error 'unblock_to_send' (only the blocker can ever see that text).
--   * Read receipts / "seen" for the other side are hidden while blocked (conversation_participants), so a suppressed
--     message can never turn into a double tick because the blocker opened the chat.
--   * Reactions between a blocked pair are silently dropped.
--   * "You blocked X" / "You unblocked X" lines come from a PRIVATE log (block_events) that only its owner can read.
--
-- PRIVACY. blocked_users stays "own rows only". Which messages were suppressed lives in private.suppressed_messages
-- (schema `private`, not exposed by PostgREST, no grants). The only door is private.message_hidden_from_me(id), which
-- answers true only for the RECIPIENT, so the sender can never use it to find out they are blocked.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Suppressed messages (private). The FK is deferred: the row is written by the BEFORE INSERT guard, before the message.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists private.suppressed_messages (
  message_id uuid primary key references public.messages (id) on delete cascade deferrable initially deferred,
  recipient_id uuid not null references public.profiles (id) on delete cascade
);
revoke all on table private.suppressed_messages from public, anon, authenticated;
-- RLS on with no policies = deny-all for API roles even if a grant is ever added by mistake. The SECURITY DEFINER functions
-- below run as the table owner, who bypasses RLS, so they keep working.
alter table private.suppressed_messages enable row level security;

-- Internal (triggers / definer RPCs only): is this message suppressed for anyone?
create or replace function private.message_is_suppressed(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from private.suppressed_messages s where s.message_id = p_id);
$$;
revoke all on function private.message_is_suppressed(uuid) from public, anon, authenticated;

-- Used by RLS and the unread counter: true only when the CALLER is the recipient the message is hidden from.
create or replace function private.message_hidden_from_me(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from private.suppressed_messages s where s.message_id = p_id and s.recipient_id = auth.uid());
$$;
revoke all on function private.message_hidden_from_me(uuid) from public;
grant execute on function private.message_hidden_from_me(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. The send guard (replaces 0044's, same trigger).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function private.guard_message_block()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_buyer uuid;
  v_seller uuid;
  v_recipient uuid;
begin
  select c.buyer_id, c.seller_id into v_buyer, v_seller from public.conversations c where c.id = new.conversation_id;
  if v_buyer is null then
    return new;
  end if;
  v_recipient := case when new.sender_id = v_buyer then v_seller else v_buyer end;

  -- The sender blocked the recipient: like WhatsApp, they must unblock before writing.
  if exists (select 1 from public.blocked_users x where x.blocker_id = new.sender_id and x.blocked_id = v_recipient) then
    raise exception 'unblock_to_send' using errcode = 'P0001';
  end if;

  -- The recipient blocked the sender: accept it (one tick for the sender) but never deliver it.
  if exists (select 1 from public.blocked_users x where x.blocker_id = v_recipient and x.blocked_id = new.sender_id) then
    insert into private.suppressed_messages (message_id, recipient_id) values (new.id, v_recipient);
  end if;
  return new;
end;
$$;
revoke all on function private.guard_message_block() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Read side: the recipient never sees a suppressed message; unread counts skip it.
-- ---------------------------------------------------------------------------------------------------------------------
drop policy if exists "participants can read conversation messages" on public.messages;
create policy "participants can read conversation messages" on public.messages
  for select using (
    exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = messages.conversation_id and cp.user_id = auth.uid()
    )
    and (messages.sender_id = auth.uid() or not private.message_hidden_from_me(messages.id))
  );

create or replace function public.get_conversation_unread_counts()
returns table (conversation_id uuid, unread_count bigint)
language sql stable security definer set search_path = public
as $$
  select m.conversation_id, count(*)
  from public.messages m
  join public.conversation_participants cp
    on cp.conversation_id = m.conversation_id and cp.user_id = auth.uid()
  where m.sender_id <> auth.uid()
    and m.deleted_at is null
    and m.created_at > coalesce(cp.last_read_at, 'epoch'::timestamptz)
    and not private.message_is_suppressed(m.id)
  group by m.conversation_id;
$$;
grant execute on function public.get_conversation_unread_counts() to authenticated;

-- Read receipts: while blocked, each side stops seeing the other's membership row (and so their last_read_at).
drop policy if exists "participants can read conversation membership" on public.conversation_participants;
create policy "participants can read conversation membership" on public.conversation_participants
  for select using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (auth.uid() = c.buyer_id or auth.uid() = c.seller_id)
    )
    and (user_id = auth.uid() or user_id <> all((select private.blocked_either_way())::uuid[]))
  );

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. A suppressed message must not touch the conversation preview or notify anyone (bodies = 0023 / 0037, plus the guard).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.handle_new_message()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_recipient_id uuid;
  v_listing_id uuid;
  v_sender_name text;
  v_listing_title text;
  v_preview text;
begin
  perform set_config('suuqplus.skip_rate_limit', 'true', true);
  update public.profiles set last_seen_at = now() where id = new.sender_id;

  if private.message_is_suppressed(new.id) then
    return new; -- blocked sender: no preview bump, no notification, no push
  end if;

  v_preview := public.message_preview(new.text, new.images, null);

  update public.conversations
  set last_message = v_preview, last_message_at = new.created_at
  where id = new.conversation_id
  returning (case when buyer_id = new.sender_id then seller_id else buyer_id end), listing_id
  into v_recipient_id, v_listing_id;

  select title into v_listing_title from public.listings where id = v_listing_id;
  select coalesce(full_name, 'Someone') into v_sender_name from public.profiles where id = new.sender_id;

  if v_recipient_id is not null then
    insert into public.notifications (user_id, title, body, type, data)
    values (
      v_recipient_id,
      v_sender_name || ' sent you a message',
      coalesce(v_listing_title, v_preview),
      'message',
      jsonb_build_object('conversationId', new.conversation_id)
    );
  end if;

  return new;
end;
$$;

create or replace function public.edit_message(p_message_id uuid, p_text text)
returns public.messages
language plpgsql
security definer set search_path = public
as $$
declare
  v_msg public.messages;
  v_is_latest boolean;
begin
  if p_text is null or char_length(btrim(p_text)) = 0 then
    raise exception 'Message text cannot be empty';
  end if;
  if char_length(p_text) > 4000 then
    raise exception 'Message too long';
  end if;

  update public.messages
  set text = p_text, edited_at = now()
  where id = p_message_id and sender_id = auth.uid() and deleted_at is null
  returning * into v_msg;

  if not found then
    raise exception 'Message not found or not editable';
  end if;

  select (m.id = v_msg.id) into v_is_latest
  from public.messages m
  where m.conversation_id = v_msg.conversation_id
  order by m.created_at desc, m.id desc
  limit 1;

  if v_is_latest and not private.message_is_suppressed(v_msg.id) then
    update public.conversations
    set last_message = public.message_preview(v_msg.text, v_msg.images, v_msg.deleted_at)
    where id = v_msg.conversation_id;
  end if;

  return v_msg;
end;
$$;
grant execute on function public.edit_message(uuid, text) to authenticated;

create or replace function public.delete_message(p_message_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_msg public.messages;
  v_is_latest boolean;
begin
  update public.messages
  set deleted_at = now(), text = null, images = '{}', image_keys = '{}'
  where id = p_message_id and sender_id = auth.uid() and deleted_at is null
  returning * into v_msg;

  if not found then
    raise exception 'Message not found or not deletable';
  end if;

  select (m.id = v_msg.id) into v_is_latest
  from public.messages m
  where m.conversation_id = v_msg.conversation_id
  order by m.created_at desc, m.id desc
  limit 1;

  if v_is_latest and not private.message_is_suppressed(v_msg.id) then
    update public.conversations
    set last_message = public.message_preview(v_msg.text, v_msg.images, v_msg.deleted_at)
    where id = v_msg.conversation_id;
  end if;
end;
$$;
revoke execute on function public.delete_message(uuid) from public, anon;
grant execute on function public.delete_message(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Reactions between a blocked pair are dropped silently (a BEFORE trigger returning NULL skips the row, no error).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function private.guard_reaction_block()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_buyer uuid;
  v_seller uuid;
begin
  select c.buyer_id, c.seller_id into v_buyer, v_seller
    from public.messages m join public.conversations c on c.id = m.conversation_id
   where m.id = new.message_id;
  if v_buyer is not null and private.users_blocked(v_buyer, v_seller) then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_reaction_block() from public, anon, authenticated;
drop trigger if exists reactions_block_guard on public.message_reactions;
create trigger reactions_block_guard before insert or update on public.message_reactions
  for each row execute function private.guard_reaction_block();

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. block_events: the private "You blocked / unblocked X" log. Written only by the trigger below; each user reads only
--    the rows they authored, so the blocked person can never see them.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.block_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  other_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('blocked', 'unblocked')),
  created_at timestamptz not null default now()
);
create index if not exists block_events_pair_idx on public.block_events (user_id, other_id, created_at desc);
alter table public.block_events enable row level security;
drop policy if exists "users read their own block events" on public.block_events;
create policy "users read their own block events" on public.block_events for select using (user_id = auth.uid());
revoke insert, update, delete on public.block_events from anon, authenticated;

create or replace function private.log_block_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.block_events (user_id, other_id, kind) values (new.blocker_id, new.blocked_id, 'blocked');
  else
    -- Skip when the blocker's account itself is being deleted (cascade): the log rows go with the profile.
    if exists (select 1 from public.profiles p where p.id = old.blocker_id) and exists (select 1 from public.profiles p where p.id = old.blocked_id) then
      insert into public.block_events (user_id, other_id, kind) values (old.blocker_id, old.blocked_id, 'unblocked');
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.log_block_event() from public, anon, authenticated;
drop trigger if exists blocked_users_log_event on public.blocked_users;
create trigger blocked_users_log_event after insert or delete on public.blocked_users
  for each row execute function private.log_block_event();

-- ===== 0047_report_review_workspace.sql =====
-- 0047 — Report review workspace, verification notifications, notification integrity.
--
-- Audit findings this migration answers (details in docs/MODERATION_REPAIR_REPORT.md):
--   1. admin_set_verified() (0038) changed profiles.verified_at and wrote an audit row but NEVER told the user.
--   2. notify_on_report_status_change() (0021) sent "Your report was dismissed" for the 'reviewing' status too, and sent a
--      second copy every time a report was reopened and re-closed.
--   3. The admin report queue / detail read raw tables: reporter NAME only, and a removed listing is invisible to the
--      public-read RLS policy, so the evidence (images, description, price...) could not be shown.
--   4. Reports have no reviewer, no resolution note, no internal notes, and nothing survives a hard-deleted listing.
--   5. "users manage their own notifications" (FOR ALL) let any signed-in user INSERT a notification for themselves with
--      any title/body/type (e.g. a forged "You are now verified") and rewrite the text of the ones they received.
--   6. No way to tell whether a notification was ever pushed to a device.
--
-- Nothing here weakens a public policy (0039 'listings are publicly readable', 0044 block enforcement are untouched):
-- the admin screens use SECURITY DEFINER RPCs that re-check staff_can('report_status') inside Postgres.
-- Needs 0039. Rollback: supabase/rollback/0047_report_review_workspace_ROLLBACK.sql (not executed automatically).

-- ============================================================================
-- 1. Notifications: idempotency key, push-delivery status, no client forgery
-- ============================================================================
alter table public.notifications add column if not exists dedupe_key text;
alter table public.notifications add column if not exists push_status text;
alter table public.notifications add column if not exists push_attempted_at timestamptz;
alter table public.notifications add column if not exists push_error text;

alter table public.notifications drop constraint if exists notifications_push_status_check;
alter table public.notifications add constraint notifications_push_status_check
  check (push_status is null or push_status in ('pending', 'sent', 'no_devices', 'disabled', 'failed'));

-- One notification per (recipient, event). Retries / replays hit this and are ignored by the writers below.
create unique index if not exists notifications_dedupe_idx on public.notifications (user_id, dedupe_key) where dedupe_key is not null;

-- Normalises server-written rows: every moderation notification is keyed by its event id (so it can never be written
-- twice), carries the id of the user-visible notice it summarises, and starts with push_status = 'pending' (the push
-- edge function records the real outcome; 'pending' that never changes means "push was never confirmed").
create or replace function public.trg_notifications_normalize()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notice uuid;
begin
  if new.type = 'moderation' and new.data ? 'eventId' then
    if new.dedupe_key is null then
      new.dedupe_key := 'moderation:' || (new.data ->> 'eventId');
    end if;
    if not (new.data ? 'noticeId') then
      select n.id into v_notice from public.moderation_notices n where n.event_id::text = new.data ->> 'eventId' limit 1;
      if v_notice is not null then
        new.data := new.data || jsonb_build_object('noticeId', v_notice);
      end if;
    end if;
  end if;
  if new.push_status is null then
    new.push_status := 'pending';
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_notifications_normalize() from public, anon, authenticated;
drop trigger if exists notifications_a_normalize on public.notifications;
create trigger notifications_a_normalize before insert on public.notifications
  for each row execute function public.trg_notifications_normalize();

-- Clients may read, mark read, and delete their own rows. They can no longer INSERT, and an UPDATE may only change `read`.
drop policy if exists "users manage their own notifications" on public.notifications;
drop policy if exists "users read their own notifications" on public.notifications;
drop policy if exists "users update their own notifications" on public.notifications;
drop policy if exists "users delete their own notifications" on public.notifications;
create policy "users read their own notifications" on public.notifications for select using (auth.uid() = user_id);
create policy "users update their own notifications" on public.notifications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users delete their own notifications" on public.notifications for delete using (auth.uid() = user_id);

create or replace function public.trg_notifications_guard_update()
returns trigger
language plpgsql
as $$
begin
  if public.is_client_write() and (
       (new.user_id, new.title, new.body, new.type, new.data, new.created_at, new.dedupe_key, new.push_status, new.push_attempted_at, new.push_error)
       is distinct from
       (old.user_id, old.title, old.body, old.type, old.data, old.created_at, old.dedupe_key, old.push_status, old.push_attempted_at, old.push_error)) then
    raise exception 'Notifications are read-only except for the read flag' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists notifications_b_guard on public.notifications;
create trigger notifications_b_guard before update on public.notifications
  for each row execute function public.trg_notifications_guard_update();

-- ============================================================================
-- 2. Staff-only report review state (kept OUT of public.reports: the reporter can read their own report row)
-- ============================================================================
create table if not exists public.report_admin (
  report_id uuid primary key references public.reports (id) on delete cascade,
  assigned_to uuid references public.profiles (id) on delete set null,
  reviewed_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  resolution_note text,
  evidence jsonb,                 -- minimal snapshot taken when the report was filed (survives a deleted listing)
  evidence_purged_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.report_admin enable row level security;
drop policy if exists "staff read report admin state" on public.report_admin;
create policy "staff read report admin state" on public.report_admin for select using (public.staff_can('report_status'));
-- no write policies: only the SECURITY DEFINER functions below write it.

create table if not exists public.report_notes (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  note text not null check (char_length(btrim(note)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists report_notes_report_idx on public.report_notes (report_id, created_at);
alter table public.report_notes enable row level security;
drop policy if exists "staff read report notes" on public.report_notes;
create policy "staff read report notes" on public.report_notes for select using (public.staff_can('report_status'));

-- Snapshot of what the reviewer needs if the target later disappears. Deliberately small: no phone/email/address, at most
-- 10 image keys, description cut to 500 chars. Purged by purge_report_evidence().
create or replace function public._report_evidence(p_type text, p_target text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if p_type = 'listing' then
    select jsonb_build_object('title', l.title, 'description', left(coalesce(l.description, ''), 500), 'price', l.price, 'currency', l.currency,
                              'category', l.category, 'city', l.city, 'condition', l.condition, 'status', l.status, 'owner_id', l.user_id,
                              'images', to_jsonb(l.images[1:10]), 'listing_created_at', l.created_at)
      into v from public.listings l where l.id::text = p_target;
  elsif p_type = 'user' then
    select jsonb_build_object('name', p.full_name, 'avatar_url', p.avatar_url) into v from public.profiles p where p.id::text = p_target;
  end if;
  return v;
end;
$$;
revoke execute on function public._report_evidence(text, text) from public, anon, authenticated;

create or replace function public.trg_reports_capture_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.report_admin (report_id, evidence) values (new.id, public._report_evidence(new.target_type, new.target_id))
    on conflict (report_id) do nothing;
  exception when others then
    null; -- evidence is best-effort and must never block a report
  end;
  return new;
end;
$$;
revoke execute on function public.trg_reports_capture_evidence() from public, anon, authenticated;
drop trigger if exists reports_d_capture_evidence on public.reports;
create trigger reports_d_capture_evidence after insert on public.reports
  for each row execute function public.trg_reports_capture_evidence();

-- Existing reports get a row (and a snapshot where the target still exists).
insert into public.report_admin (report_id, evidence)
select r.id, public._report_evidence(r.target_type, r.target_id) from public.reports r
on conflict (report_id) do nothing;

-- Retention: closed reports lose their snapshot after the window. Not scheduled here; run from a cron / the dashboard.
create or replace function public.purge_report_evidence(p_older_than interval default interval '24 months')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  update public.report_admin ra set evidence = null, evidence_purged_at = now()
   from public.reports r
  where r.id = ra.report_id and r.status in ('reviewed', 'dismissed') and ra.evidence is not null
    and coalesce(ra.resolved_at, r.created_at) < now() - p_older_than;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.purge_report_evidence(interval) from public, anon, authenticated;

-- ============================================================================
-- 3. Report status changes: reviewer, resolution note, audit, and ONE honest notification to the reporter
-- ============================================================================
create or replace function public.admin_update_report_status(p_report_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.staff_can('report_status') then
    raise exception 'Only staff can update report status' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'reviewing', 'reviewed', 'dismissed') then
    raise exception 'Invalid report status: %', p_status using errcode = '22023';
  end if;
  if p_status = 'dismissed' and (v_note is null or char_length(v_note) < 3) then
    raise exception 'A reason is required to dismiss a report' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 2000 then
    raise exception 'The note is too long' using errcode = '22023';
  end if;
  select status into v_old from public.reports where id = p_report_id for update;
  if not found then
    raise exception 'Report % not found', p_report_id using errcode = 'P0002';
  end if;
  if v_old = p_status then
    raise exception 'Report is already %', p_status using errcode = '23505';
  end if;

  update public.reports set status = p_status where id = p_report_id;

  insert into public.report_admin (report_id) values (p_report_id) on conflict (report_id) do nothing;
  if p_status = 'reviewing' then
    update public.report_admin set assigned_to = coalesce(assigned_to, auth.uid()), resolved_at = null, updated_at = now() where report_id = p_report_id;
  elsif p_status in ('reviewed', 'dismissed') then
    update public.report_admin set reviewed_by = auth.uid(), resolved_at = now(), resolution_note = v_note, updated_at = now() where report_id = p_report_id;
  else
    update public.report_admin set resolved_at = null, updated_at = now() where report_id = p_report_id;
  end if;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), 'report_status_change', 'report', p_report_id::text, v_note,
          jsonb_build_object('report_id', p_report_id, 'from', v_old, 'to', p_status));
end;
$$;
grant execute on function public.admin_update_report_status(uuid, text, text) to authenticated;
revoke execute on function public.admin_update_report_status(uuid, text, text) from anon, public;

create or replace function public.admin_add_report_note(p_report_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.staff_can('report_status') then
    raise exception 'Only staff can add report notes' using errcode = '42501';
  end if;
  if p_note is null or char_length(btrim(p_note)) < 1 or char_length(p_note) > 2000 then
    raise exception 'A note of 1-2000 characters is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.reports where id = p_report_id) then
    raise exception 'Report % not found', p_report_id using errcode = 'P0002';
  end if;
  insert into public.report_notes (report_id, author_id, note) values (p_report_id, auth.uid(), btrim(p_note)) returning id into v_id;
  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), 'report_note', 'report', p_report_id::text, null, jsonb_build_object('report_id', p_report_id, 'note_id', v_id));
  return v_id;
end;
$$;
grant execute on function public.admin_add_report_note(uuid, text) to authenticated;
revoke execute on function public.admin_add_report_note(uuid, text) from anon, public;

-- The reporter hears about a closed report once per outcome. 'reviewing' (and a reopen) say nothing.
create or replace function public.notify_on_report_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = old.status or new.status not in ('reviewed', 'dismissed') then
    return new;
  end if;
  insert into public.notifications (user_id, title, body, type, data, dedupe_key)
  values (
    new.reporter_id,
    case when new.status = 'reviewed' then 'Your report was reviewed' else 'Your report was dismissed' end,
    'Thanks for helping keep Suuq+ safe.',
    'report_result',
    jsonb_build_object('reportId', new.id, 'targetType', new.target_type, 'targetId', new.target_id, 'status', new.status),
    'report:' || new.id::text || ':' || new.status
  )
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  return new;
end;
$$;

-- ============================================================================
-- 4. Verification: the user is told, exactly once, in the same transaction as the decision
-- ============================================================================
create or replace function public.admin_set_verified(p_user_id uuid, p_verified boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current timestamptz;
  v_event uuid;
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
  values (p_user_id, case when p_verified then 'grant' else 'revoke' end, auth.uid(), btrim(p_reason))
  returning id into v_event;
  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), case when p_verified then 'verify_user' else 'unverify_user' end, 'user', p_user_id::text, btrim(p_reason),
          jsonb_build_object('event_id', v_event, 'from', v_current is not null, 'to', p_verified));

  -- The internal reason is never copied into the user-facing text.
  insert into public.notifications (user_id, title, body, type, data, dedupe_key)
  values (
    p_user_id,
    case when p_verified then 'You are now verified' else 'Your verification was removed' end,
    case when p_verified then 'Your SUUQIYE account has been verified. The verified badge now shows on your profile and listings.'
         else 'The verified badge was removed from your account. If you think this is a mistake, contact support from the Notices & Support page.' end,
    'verification',
    jsonb_build_object('kind', case when p_verified then 'verified' else 'verification_revoked' end, 'eventId', v_event),
    'verification:' || v_event::text
  )
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
end;
$$;
grant execute on function public.admin_set_verified(uuid, boolean, text) to authenticated;
revoke execute on function public.admin_set_verified(uuid, boolean, text) from anon, public;

-- ============================================================================
-- 5. Admin report queue + detail (SECURITY DEFINER, staff_can('report_status') = admin + moderator)
-- ============================================================================
create or replace function public.admin_report_queue(
  p_status text default null,
  p_target_type text default null,
  p_query text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_assigned_to uuid default null,
  p_limit int default 25,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := lower(nullif(btrim(coalesce(p_query, '')), ''));
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_out jsonb;
begin
  if not public.staff_can('report_status') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  with base as (
    select r.id, r.status, r.target_type, r.target_id, r.reason, r.created_at, r.reporter_id,
           rp.full_name as reporter_name, rp.avatar_url as reporter_avatar,
           l.id as l_id, l.title as l_title, l.images as l_images, l.status as l_status, l.user_id as l_owner,
           ra.evidence as ev, ra.assigned_to, asg.full_name as assigned_name,
           case r.target_type when 'listing' then l.user_id when 'user' then tu.id else rv.seller_id end as reported_id
      from public.reports r
      left join public.profiles rp on rp.id = r.reporter_id
      left join public.report_admin ra on ra.report_id = r.id
      left join public.profiles asg on asg.id = ra.assigned_to
      left join public.listings l on r.target_type = 'listing' and l.id::text = r.target_id
      left join public.profiles tu on r.target_type = 'user' and tu.id::text = r.target_id
      left join public.reviews rv on r.target_type = 'review' and rv.id::text = r.target_id
     where (p_status is null or r.status = p_status)
       and (p_target_type is null or r.target_type = p_target_type)
       and (p_from is null or r.created_at >= p_from)
       and (p_to is null or r.created_at < p_to)
       and (p_assigned_to is null or ra.assigned_to = p_assigned_to)
  ), enriched as (
    select b.*, ru.full_name as reported_name, ru.avatar_url as reported_avatar,
           (select count(*) from public.reports r2 where r2.target_type = b.target_type and r2.target_id = b.target_id) as target_report_count
      from base b left join public.profiles ru on ru.id = b.reported_id
  ), filtered as (
    select * from enriched e
     where v_q is null
        or strpos(lower(e.reason), v_q) > 0
        or strpos(lower(coalesce(e.reporter_name, '')), v_q) > 0
        or strpos(lower(coalesce(e.reported_name, '')), v_q) > 0
        or strpos(lower(coalesce(e.l_title, e.ev ->> 'title', '')), v_q) > 0
        or strpos(e.id::text, v_q) = 1
  ), page as (
    select f.*, count(*) over () as total from filtered f order by f.created_at desc, f.id limit v_limit offset greatest(coalesce(p_offset, 0), 0)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'status', p.status, 'target_type', p.target_type, 'reason', p.reason, 'created_at', p.created_at, 'total', p.total,
           'reporter', jsonb_build_object('id', p.reporter_id, 'name', coalesce(p.reporter_name, 'SUUQIYE user'), 'avatar_url', p.reporter_avatar),
           'reported_user', case when p.reported_id is null then null else
              jsonb_build_object('id', p.reported_id, 'name', coalesce(p.reported_name, 'SUUQIYE user'), 'avatar_url', p.reported_avatar) end,
           'listing', case when p.target_type <> 'listing' then null else jsonb_build_object(
              'id', p.target_id,
              'title', coalesce(p.l_title, p.ev ->> 'title'),
              'thumb', coalesce(p.l_images[1], p.ev -> 'images' ->> 0),
              'status', p.l_status,
              'available', p.l_id is not null) end,
           'assigned_to', case when p.assigned_to is null then null else jsonb_build_object('id', p.assigned_to, 'name', coalesce(p.assigned_name, 'Staff')) end,
           'target_report_count', p.target_report_count
         ) order by p.created_at desc, p.id), '[]'::jsonb)
    into v_out from page p;
  return v_out;
end;
$$;
grant execute on function public.admin_report_queue(text, text, text, timestamptz, timestamptz, uuid, int, int) to authenticated;
revoke execute on function public.admin_report_queue(text, text, text, timestamptz, timestamptz, uuid, int, int) from anon, public;

create or replace function public.admin_report_detail(p_report_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_r public.reports%rowtype;
  v_ra public.report_admin%rowtype;
  v_l public.listings%rowtype;
  v_listing_found boolean := false;
  v_reported uuid;
  v_review jsonb;
  v_listing jsonb;
begin
  if not public.staff_can('report_status') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_r from public.reports where id = p_report_id;
  if not found then
    return null;
  end if;
  select * into v_ra from public.report_admin where report_id = p_report_id;

  if v_r.target_type = 'listing' then
    select * into v_l from public.listings where id::text = v_r.target_id;
    v_listing_found := found;
    v_reported := case when v_listing_found then v_l.user_id else nullif(v_ra.evidence ->> 'owner_id', '')::uuid end;
    -- Explicit column list: no phone/email, and the row is readable here even when it is removed/deactivated (staff-only RPC).
    v_listing := jsonb_build_object(
      'id', v_r.target_id,
      'found', v_listing_found,
      'state', case when not v_listing_found then 'deleted'
                    when v_l.status in ('removed', 'deactivated') then 'moderated'
                    when v_l.status = 'expired' then 'expired' else 'live' end,
      'listing', case when v_listing_found then jsonb_build_object(
          'id', v_l.id, 'title', v_l.title, 'description', v_l.description, 'price', v_l.price, 'currency', v_l.currency,
          'category', v_l.category, 'subcategory', v_l.subcategory, 'condition', v_l.condition, 'city', v_l.city, 'region', v_l.region,
          'negotiable', v_l.negotiable, 'images', v_l.images, 'attributes', v_l.attributes, 'status', v_l.status,
          'views', v_l.views, 'favorites_count', v_l.favorites_count, 'created_at', v_l.created_at, 'updated_at', v_l.updated_at,
          'user_id', v_l.user_id) else null end,
      'snapshot', case when v_listing_found then null else v_ra.evidence end);
  elsif v_r.target_type = 'user' then
    v_reported := nullif(v_r.target_id, '')::uuid;
  else
    select jsonb_build_object('id', rv.id, 'rating', rv.rating, 'comment', rv.comment, 'created_at', rv.created_at, 'reviewer_id', rv.reviewer_id, 'seller_id', rv.seller_id),
           rv.seller_id
      into v_review, v_reported from public.reviews rv where rv.id::text = v_r.target_id;
  end if;

  return jsonb_build_object(
    'report', jsonb_build_object('id', v_r.id, 'status', v_r.status, 'target_type', v_r.target_type, 'target_id', v_r.target_id,
                                 'reason', v_r.reason, 'details', v_r.details, 'created_at', v_r.created_at,
                                 'assigned_to', (select jsonb_build_object('id', a.id, 'name', coalesce(a.full_name, 'Staff')) from public.profiles a where a.id = v_ra.assigned_to),
                                 'reviewed_by', (select jsonb_build_object('id', a.id, 'name', coalesce(a.full_name, 'Staff')) from public.profiles a where a.id = v_ra.reviewed_by),
                                 'resolved_at', v_ra.resolved_at, 'resolution_note', v_ra.resolution_note),
    'reporter', (select jsonb_build_object(
                   'id', p.id, 'name', coalesce(p.full_name, 'SUUQIYE user'), 'avatar_url', p.avatar_url, 'created_at', p.created_at,
                   'reports_filed', (select count(*) from public.reports x where x.reporter_id = p.id),
                   'reports_actioned', (select count(*) from public.reports x where x.reporter_id = p.id and x.status = 'reviewed'),
                   'reports_dismissed', (select count(*) from public.reports x where x.reporter_id = p.id and x.status = 'dismissed'))
                 from public.profiles p where p.id = v_r.reporter_id),
    'reported_user', (select jsonb_build_object(
                   'id', p.id, 'name', coalesce(p.full_name, 'SUUQIYE user'), 'avatar_url', p.avatar_url, 'created_at', p.created_at,
                   'account_status', public.account_effective_status(p.id), 'suspended_until', p.suspended_until, 'verified_at', p.verified_at,
                   'is_staff', exists (select 1 from public.admin_users au where au.user_id = p.id),
                   'listings_total', (select count(*) from public.listings x where x.user_id = p.id),
                   'listings_live', (select count(*) from public.listings x where x.user_id = p.id and x.status in ('available', 'reserved')),
                   'listings_moderated', (select count(*) from public.listings x where x.user_id = p.id and x.status in ('removed', 'deactivated')),
                   'warnings_count', (select count(*) from public.moderation_warnings w where w.user_id = p.id),
                   'reports_against', (select count(*) from public.reports x where (x.target_type = 'user' and x.target_id = p.id::text)
                                          or (x.target_type = 'listing' and exists (select 1 from public.listings l2 where l2.id::text = x.target_id and l2.user_id = p.id))),
                   'history', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'action', e.action, 'reason', e.reason, 'public_message', e.public_message,
                                                                           'until', e.until, 'created_at', e.created_at, 'report_id', e.report_id,
                                                                           'actor_name', coalesce(a.full_name, 'System')) order by e.created_at desc, e.id desc)
                                          from (select * from public.moderation_events me where me.user_id = p.id order by me.created_at desc limit 20) e
                                          left join public.profiles a on a.id = e.actor_id), '[]'::jsonb))
                 from public.profiles p where p.id = v_reported),
    'listing', v_listing,
    'review', v_review,
    'other_reports', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'reason', x.reason, 'status', x.status, 'created_at', x.created_at,
                                                                  'reporter_name', coalesce(xp.full_name, 'SUUQIYE user')) order by x.created_at desc)
                                 from public.reports x left join public.profiles xp on xp.id = x.reporter_id
                                where x.target_type = v_r.target_type and x.target_id = v_r.target_id and x.id <> v_r.id), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'note', n.note, 'created_at', n.created_at, 'author_name', coalesce(a.full_name, 'Staff')) order by n.created_at)
                         from public.report_notes n left join public.profiles a on a.id = n.author_id where n.report_id = p_report_id), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(jsonb_build_object(
                          'event_id', e.id, 'action', e.action, 'reason', e.reason, 'public_message', e.public_message, 'from_status', e.from_status,
                          'to_status', e.to_status, 'until', e.until, 'created_at', e.created_at, 'actor_name', coalesce(a.full_name, 'System'),
                          'notified', exists (select 1 from public.notifications n where n.data ->> 'eventId' = e.id::text),
                          'push_status', (select n.push_status from public.notifications n where n.data ->> 'eventId' = e.id::text limit 1)) order by e.created_at desc)
                         from public.moderation_events e left join public.profiles a on a.id = e.actor_id where e.report_id = p_report_id), '[]'::jsonb),
    'reporter_notification', (select jsonb_build_object('status', n.data ->> 'status', 'created_at', n.created_at, 'push_status', n.push_status)
                                from public.notifications n where n.user_id = v_r.reporter_id and n.type = 'report_result' and n.data ->> 'reportId' = p_report_id::text
                               order by n.created_at desc limit 1),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('action', au.action, 'reason', au.reason, 'created_at', au.created_at,
                                                           'admin_name', coalesce(a.full_name, 'Staff'), 'metadata', au.metadata) order by au.created_at desc)
                         from public.admin_audit_log au left join public.profiles a on a.id = au.admin_id
                        where au.target_type = 'report' and au.target_id = p_report_id::text), '[]'::jsonb)
  );
end;
$$;
grant execute on function public.admin_report_detail(uuid) to authenticated;
revoke execute on function public.admin_report_detail(uuid) from anon, public;

-- ===== 0048_listing_image_scans.sql =====
-- 0048 — listing photo scans: server-side proof that every published photo was checked, plus the review path.
--
-- STATUS: written and tested on PGlite only. NOT applied to any database. Enforcement ships OFF
-- (image_scan_config.enforce = false) so applying this alone changes nothing for the live apps; flip it only
-- after the scan Worker is deployed and the apps send scans (docs/IMAGE_SAFETY.md §Rollout).
--
-- Model
--   listing_scans          one row per (user, draft listing id, scan fingerprint) → duplicate jobs collapse
--   listing_scan_images    one row per photo: private source key, public watermarked derivative, verdict, issues
--   image_hashes           64-bit perceptual hashes of published photos, for near-duplicate matching
-- Only the service role (the Worker) writes these. Clients get NO table access; the seller reads a sanitised
-- result through my_scan_result(); staff read evidence under the existing moderator permission.
--
-- Enforcement (when image_scan_config.enforce): a client write that adds a photo to a listing must reference a
-- derivative this user's scan produced for THIS listing. A photo whose verdict is "review" puts the listing in the
-- existing hidden 'deactivated' state (never public) until staff approve; a "reject" can't be published at all.

-- ============================================================================
-- 1. Config (singleton)
-- ============================================================================
create table if not exists public.image_scan_config (
  id boolean primary key default true check (id),
  enforce boolean not null default false,
  evidence_retention_days int not null default 30 check (evidence_retention_days between 1 and 365),
  updated_at timestamptz not null default now()
);
insert into public.image_scan_config (id) values (true) on conflict do nothing;
alter table public.image_scan_config enable row level security;
drop policy if exists "staff read scan config" on public.image_scan_config;
create policy "staff read scan config" on public.image_scan_config for select using (public.staff_can('read'));
revoke insert, update, delete on public.image_scan_config from anon, authenticated;

create or replace function public.image_scan_enforced()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select enforce from public.image_scan_config where id), false) $$;

-- ============================================================================
-- 2. Scans
-- ============================================================================
create table if not exists public.listing_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  listing_id uuid not null,                       -- the client-generated id the listing will be published under
  fingerprint text not null,                      -- lib/imageSafety.ts scanFingerprint(): same photos + context → same scan
  category text not null,
  status text not null default 'processing' check (status in ('processing', 'approved', 'needs_changes', 'pending_review', 'failed')),
  held_listing boolean not null default false,    -- true once enforcement hid a listing because of this scan
  flagged_for_staff boolean not null default false,
  result jsonb,                                   -- the sanitised answer returned to the app (idempotent replays)
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, listing_id, fingerprint)
);
create index if not exists listing_scans_listing_idx on public.listing_scans (listing_id);
create index if not exists listing_scans_review_idx on public.listing_scans (created_at desc) where status = 'pending_review';

create table if not exists public.listing_scan_images (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.listing_scans (id) on delete cascade,
  slot int not null check (slot between 0 and 7),
  source_key text,                                -- PRIVATE original (nulled by retention purge)
  public_key text,                                -- watermarked derivative key (wm/...)
  public_url text,                                -- exactly what listings.images will contain
  sha256 text,
  phash text check (phash is null or phash ~ '^[0-9a-f]{16}$'),
  verdict text not null default 'pass' check (verdict in ('pass', 'review', 'reject')),
  issues text[] not null default '{}',
  internal jsonb not null default '{}'::jsonb,    -- classifier evidence — staff only, never returned to sellers
  review_status text not null default 'not_needed' check (review_status in ('not_needed', 'pending', 'approved', 'rejected', 'replacement_requested')),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_reason text,                             -- INTERNAL
  unique (scan_id, slot)
);
create unique index if not exists listing_scan_images_url_idx on public.listing_scan_images (public_url) where public_url is not null;
create index if not exists listing_scan_images_pending_idx on public.listing_scan_images (scan_id) where review_status = 'pending';

create table if not exists public.image_hashes (
  id uuid primary key default gen_random_uuid(),
  phash text not null check (phash ~ '^[0-9a-f]{16}$'),
  sha256 text,
  user_id uuid not null references public.profiles (id) on delete cascade,
  listing_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists image_hashes_listing_idx on public.image_hashes (listing_id);
create index if not exists image_hashes_sha_idx on public.image_hashes (sha256);

alter table public.listing_scans enable row level security;
alter table public.listing_scan_images enable row level security;
alter table public.image_hashes enable row level security;
drop policy if exists "staff read scans" on public.listing_scans;
create policy "staff read scans" on public.listing_scans for select using (public.staff_can('moderate_listing'));
drop policy if exists "staff read scan images" on public.listing_scan_images;
create policy "staff read scan images" on public.listing_scan_images for select using (public.staff_can('moderate_listing'));
-- image_hashes: no policy at all → invisible to every API role (service role bypasses RLS).
revoke all on public.listing_scans, public.listing_scan_images, public.image_hashes from anon;
revoke insert, update, delete on public.listing_scans, public.listing_scan_images from authenticated;
revoke all on public.image_hashes from authenticated;

-- ============================================================================
-- 3. Reads
-- ============================================================================
-- What the SELLER may see of a scan: per-photo verdict and issue codes only (the client maps codes to friendly
-- text). No keys, hashes, evidence, reviewer or internal notes.
create or replace function public.my_scan_result(p_scan_id uuid)
returns table (scan_status text, slot int, public_url text, verdict text, issues text[], review_status text)
language sql stable security definer set search_path = public
as $$
  select s.status, i.slot, i.public_url, i.verdict, i.issues, i.review_status
    from public.listing_scans s join public.listing_scan_images i on i.scan_id = s.id
   where s.id = p_scan_id and s.user_id = auth.uid()
   order by i.slot
$$;
grant execute on function public.my_scan_result(uuid) to authenticated;
revoke execute on function public.my_scan_result(uuid) from anon, public;

-- Near-duplicate lookup for the Worker. Returns distance + whether the match is the caller's own image — never
-- the other listing's id or owner (the uploader must not learn who else posted a photo).
create or replace function public.find_similar_images(p_phash text, p_user uuid, p_max int default 6, p_exclude_listing uuid default null)
returns table (distance int, same_owner boolean)
language sql stable security definer set search_path = public
as $$
  select bit_count((('x' || h.phash)::bit(64) # ('x' || p_phash)::bit(64)))::int as distance, h.user_id = p_user as same_owner
    from public.image_hashes h
   where (p_exclude_listing is null or h.listing_id <> p_exclude_listing)
     and bit_count((('x' || h.phash)::bit(64) # ('x' || p_phash)::bit(64))) <= p_max
   order by 1
   limit 20
$$;
revoke execute on function public.find_similar_images(text, uuid, int, uuid) from anon, authenticated, public;
grant execute on function public.find_similar_images(text, uuid, int, uuid) to service_role;

-- ============================================================================
-- 4. Enforcement
-- ============================================================================
-- Definer helpers (the trigger itself must stay INVOKER: is_client_write() inspects current_user).
create or replace function public._scan_image_state(p_url text, p_user uuid, p_listing uuid)
returns table (scan_id uuid, verdict text, review_status text)
language sql stable security definer set search_path = public
as $$
  select s.id, i.verdict, i.review_status
    from public.listing_scan_images i join public.listing_scans s on s.id = i.scan_id
   where i.public_url = p_url and s.user_id = p_user and s.listing_id = p_listing and s.status <> 'processing'
   limit 1
$$;
revoke execute on function public._scan_image_state(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public._scan_image_state(text, uuid, uuid) to authenticated;   -- needed by the invoker trigger

-- Photos in `p_urls` that still block a listing (unreviewed, rejected, or flagged for replacement).
create or replace function public._scan_unresolved_count(p_urls text[], p_user uuid, p_listing uuid)
returns int
language sql stable security definer set search_path = public
as $$
  select count(*)::int
    from unnest(p_urls) u
    left join (public.listing_scan_images i join public.listing_scans s on s.id = i.scan_id and s.user_id = p_user and s.listing_id = p_listing) on i.public_url = u
   where i.id is null
      or i.review_status in ('pending', 'rejected', 'replacement_requested')
      or (i.verdict <> 'pass' and i.review_status <> 'approved')
$$;
revoke execute on function public._scan_unresolved_count(text[], uuid, uuid) from public, anon;
grant execute on function public._scan_unresolved_count(text[], uuid, uuid) to authenticated;

create or replace function public._scan_mark_held(p_scan_ids uuid[])
returns void language sql security definer set search_path = public
as $$ update public.listing_scans set held_listing = true where id = any(p_scan_ids) $$;
revoke execute on function public._scan_mark_held(uuid[]) from public, anon, authenticated;
grant execute on function public._scan_mark_held(uuid[]) to authenticated;

create or replace function public._listing_awaiting_replacement(p_listing uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.listing_scans s join public.listing_scan_images i on i.scan_id = s.id
     where s.listing_id = p_listing and s.held_listing and i.review_status = 'replacement_requested')
$$;
revoke execute on function public._listing_awaiting_replacement(uuid) from public, anon;
grant execute on function public._listing_awaiting_replacement(uuid) to authenticated;

create or replace function public.trg_listing_image_scan()
returns trigger
language plpgsql
as $$
declare
  v_url text;
  v_state record;
  v_hold boolean := false;
  v_scans uuid[] := '{}';
  v_check text[];
begin
  if not public.is_client_write() or not public.image_scan_enforced() then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.images is not distinct from old.images then
    return new;
  end if;

  -- Insert: every photo must be verified. Update: new photos must be; photos that were already on the listing are
  -- re-checked only when the listing is being released from a scan hold.
  v_check := case when tg_op = 'INSERT' then new.images
                  else coalesce(array(select u from unnest(new.images) u where not (u = any (old.images))), '{}') end;
  foreach v_url in array v_check loop
    select * into v_state from public._scan_image_state(v_url, new.user_id, new.id);
    if not found then
      raise exception 'Photo has not been checked' using errcode = '42501', hint = 'image_not_verified';
    end if;
    if v_state.review_status = 'rejected' or (v_state.verdict = 'reject' and v_state.review_status <> 'approved') then
      raise exception 'Photo was not accepted' using errcode = '42501', hint = 'image_rejected';
    end if;
    if v_state.verdict = 'review' and v_state.review_status <> 'approved' then
      v_hold := true;
      v_scans := v_scans || v_state.scan_id;
    end if;
  end loop;

  if v_hold then
    -- Never public while a human has not looked: the existing hidden state, restorable by staff.
    new.status_before_moderation := case when tg_op = 'UPDATE' and old.status not in ('removed', 'deactivated') then old.status else 'available' end;
    new.status := 'deactivated';
    perform public._scan_mark_held(v_scans);
  elsif tg_op = 'UPDATE' and old.status = 'deactivated' and public._listing_awaiting_replacement(old.id)
        and public._scan_unresolved_count(new.images, new.user_id, new.id) = 0 then
    -- Seller replaced the flagged photo with clean ones → the scan hold is lifted.
    new.status := coalesce(nullif(old.status_before_moderation, ''), 'available');
    new.status_before_moderation := null;
  end if;
  return new;
end;
$$;
drop trigger if exists listings_z_image_scan on public.listings;
create trigger listings_z_image_scan
  before insert or update of images on public.listings
  for each row execute function public.trg_listing_image_scan();

-- 0039's lock ("nobody edits a deactivated listing") gets ONE exception: while staff are waiting for a
-- replacement photo, the owner may update (not delete) that listing so they can swap it.
create or replace function public.trg_block_restricted_listing_writes()
returns trigger
language plpgsql
as $$
declare
  v_owner uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
begin
  if public.is_client_write() then
    if public.account_effective_status(v_owner) in ('suspended', 'banned') then
      raise exception 'Account suspended' using errcode = '42501';
    end if;
    if tg_op in ('UPDATE', 'DELETE') and old.status in ('removed', 'deactivated')
       and not (tg_op = 'UPDATE' and old.status = 'deactivated' and public._listing_awaiting_replacement(old.id)) then
      raise exception 'This listing is under review and cannot be changed' using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- ============================================================================
-- 5. Staff review (approve / reject / ask for a replacement)
-- ============================================================================
create or replace function public.admin_review_scan_image(p_image_id uuid, p_decision text, p_reason text, p_message text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_img public.listing_scan_images%rowtype;
  v_scan public.listing_scans%rowtype;
  v_l public.listings%rowtype;
  v_title text;
  v_body text;
  v_kind text;
  v_notice uuid;
  v_open int;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if not public.staff_can('moderate_listing') then
    raise exception 'Not authorized to review photos' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject', 'request_replacement') then
    raise exception 'Unknown decision %', p_decision using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  if v_msg is not null and char_length(v_msg) > 1000 then
    raise exception 'The message to the seller is too long' using errcode = '22023';
  end if;
  select * into v_img from public.listing_scan_images where id = p_image_id for update;
  if not found then raise exception 'Photo not found' using errcode = 'P0002'; end if;
  select * into v_scan from public.listing_scans where id = v_img.scan_id for update;
  -- Overriding an automatic REJECT (clear violation) is an administrator decision, not a moderator's.
  if p_decision = 'approve' and v_img.verdict = 'reject' and public.staff_role() <> 'admin' then
    raise exception 'Only an administrator can override a rejected photo' using errcode = '42501';
  end if;

  update public.listing_scan_images
     set review_status = case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'replacement_requested' end,
         reviewed_by = auth.uid(), reviewed_at = now(), review_reason = btrim(p_reason)
   where id = p_image_id;

  select * into v_l from public.listings where id = v_scan.listing_id for update;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), 'review_scan_image', 'listing', v_scan.listing_id::text, btrim(p_reason),
          jsonb_build_object('image_id', p_image_id, 'scan_id', v_scan.id, 'decision', p_decision, 'verdict', v_img.verdict, 'issues', to_jsonb(v_img.issues)));

  if p_decision = 'approve' then
    -- Release the hold once nothing else on this scan is waiting.
    select count(*) into v_open from public.listing_scan_images
     where scan_id = v_scan.id and review_status in ('pending', 'rejected', 'replacement_requested');
    if v_open = 0 then
      update public.listing_scans set status = 'approved' where id = v_scan.id;
      if found and v_l.id is not null and v_l.status = 'deactivated' and v_scan.held_listing then
        perform set_config('fursad.admin_write', 'true', true);
        update public.listings set status = coalesce(nullif(status_before_moderation, ''), 'available'), status_before_moderation = null where id = v_l.id;
        v_notice := public._moderation_record(auth.uid(), 'listing_restored', v_l.user_id, v_l.id, null, p_reason, v_msg, 'deactivated', 'available', null,
                                              jsonb_build_object('title', v_l.title));
      end if;
    end if;
    return v_notice;
  end if;

  v_kind := case p_decision when 'reject' then 'image_rejected' else 'image_replacement_requested' end;
  v_title := case p_decision when 'reject' then 'A photo was not approved' else 'Please replace a photo' end;
  v_body := case p_decision
    when 'reject' then format('A photo on your listing “%s” can’t be used on Suuqiye. Please choose a different photo.', coalesce(v_l.title, 'your listing'))
    else format('Please replace one photo on your listing “%s” with a clear, original photo of the item. Your listing stays hidden until you do.', coalesce(v_l.title, 'your listing')) end;
  if v_msg is not null then v_body := v_body || E'\n\n' || v_msg; end if;
  insert into public.moderation_notices (user_id, kind, listing_id, title, body, data, appealable)
  values (v_scan.user_id, v_kind, v_l.id, v_title, v_body, jsonb_build_object('listingTitle', v_l.title), p_decision = 'reject')
  returning id into v_notice;
  insert into public.notifications (user_id, title, body, type, data)
  values (v_scan.user_id, 'Suuqiye Support Team', v_title, 'moderation', jsonb_build_object('kind', v_kind, 'listingId', v_l.id, 'noticeId', v_notice));
  return v_notice;
end;
$$;
grant execute on function public.admin_review_scan_image(uuid, text, text, text) to authenticated;
revoke execute on function public.admin_review_scan_image(uuid, text, text, text) from anon, public;

-- ============================================================================
-- 6. Retention
-- ============================================================================
-- Drops the private source key and classifier evidence for finished scans older than the configured window.
-- Returns the R2 source keys the caller (a scheduled Worker) must now delete from the private bucket. Photos
-- still waiting for review are never purged.
create or replace function public.purge_scan_evidence()
returns table (source_key text)
language plpgsql security definer set search_path = public
as $$
declare
  v_days int := (select evidence_retention_days from public.image_scan_config where id);
begin
  return query
    with due as (
      select i.id, i.source_key as old_key
        from public.listing_scan_images i join public.listing_scans s on s.id = i.scan_id
       where s.created_at < now() - make_interval(days => v_days)
         and i.review_status not in ('pending', 'replacement_requested') and i.source_key is not null
         for update of i
    ), cleared as (
      update public.listing_scan_images i set source_key = null, internal = '{}'::jsonb from due where i.id = due.id returning i.id
    )
    select due.old_key from due join cleared on cleared.id = due.id;
end;
$$;
revoke execute on function public.purge_scan_evidence() from anon, authenticated, public;
grant execute on function public.purge_scan_evidence() to service_role;

-- ===== 0049_sell_server_validation.sql =====
-- 0049 — Sell-flow server-side validation (was supabase/proposed/0036). NOT YET APPLIED.
-- Needs 0038-0048 applied first. See docs/SELL_AUDIT.md §6 for the reasoning behind every statement.
--
-- Goal: make the database itself refuse the invalid listings the UI already
-- refuses, so a hand-written PostgREST request can't bypass the Sell flow.
--
-- Photo cap: the apps allow 5 photos (data/sellRules.ts MAX_LISTING_PHOTOS), but this CHECK stays at 8 so that
-- older listings with 6-8 photos can still be edited / marked sold (a NOT VALID check is still evaluated on every
-- UPDATE of an existing row). Tighten to 5 once no listing has more.
--
-- Safety design:
--   * Every CHECK is added NOT VALID: it is enforced for new/changed rows
--     immediately but does NOT scan or reject existing rows, so applying it
--     cannot break any currently published listing. After reviewing the
--     existing data (queries at the bottom) run the VALIDATE statements.
--   * RLS is not touched. No policy is weakened or replaced.
--   * Limits mirror data/sellRules.ts exactly (price, text lengths, photo
--     count, condition values). If you change one, change the other.
-- ============================================================================

-- ── 1. Column-level rules ───────────────────────────────────────────────────
alter table public.listings
  -- price: positive, finite, whole currency units are the product rule but the
  -- column is numeric, so only bound it (fractions are not rejected here).
  add constraint listings_price_range check (price > 0 and price <= 999999999999) not valid,
  -- 0019 already caps title (<= 200) and description (<= 5000); these add the
  -- "not blank" side.
  add constraint listings_title_not_blank check (char_length(btrim(title)) >= 1) not valid,
  add constraint listings_description_not_blank check (description is null or char_length(btrim(description)) >= 1) not valid,
  add constraint listings_condition_valid check (condition is null or condition in ('new', 'like-new', 'used', 'for-parts')) not valid,
  add constraint listings_currency_format check (currency ~ '^[A-Z]{3}$') not valid,
  add constraint listings_images_count check (coalesce(array_length(images, 1), 0) between 1 and 8) not valid,
  add constraint listings_attributes_shape check (jsonb_typeof(attributes) = 'object' and pg_column_size(attributes) <= 8192) not valid,
  add constraint listings_features_count check (coalesce(array_length(features, 1), 0) <= 30) not valid,
  add constraint listings_seller_notes_count check (coalesce(array_length(seller_notes, 1), 0) <= 20) not valid;

-- ── 2. Numeric specification ranges (mirror NUMERIC_RULES in data/sellRules.ts) ─
-- Only keys that mean the same thing in every category are checked here.
-- `size` ("Size (sqm)" vs clothing "M") and `resolution` ("Resolution (MP)" vs
-- the HD/4K selector) are label-dependent in the app schema, so the database
-- cannot judge them by key alone and they stay app-validated.
create or replace function public.validate_listing_attributes()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  -- key, min, max, whole_number_only
  rules constant jsonb := '{
    "battery":        [0, 100, true],
    "mileage":        [0, 2000000, true],
    "engineCC":       [50, 20000, true],
    "quantity":       [1, 1000000, true],
    "gears":          [1, 30, true],
    "setPieces":      [1, 1000, true],
    "lengthMeters":   [0.1, 500, false],
    "ceilingHeight":  [1, 20, false],
    "voltage":        [0.1, 100000, false],
    "weightCapacity": [0.1, 10000000, false]
  }';
  k text;
  v text;
  r jsonb;
  n numeric;
begin
  if coalesce(current_setting('fursad.admin_write', true), '') = 'true' then
    return new;
  end if;

  for k, r in select * from jsonb_each(rules) loop
    v := btrim(coalesce(new.attributes ->> k, ''));
    if v = '' then
      continue;
    end if;
    -- The CASE is parenthesised: PL/pgSQL ends an IF condition at the first THEN token, including the one inside a CASE.
    if v !~ (case when (r ->> 2)::boolean then '^[0-9]{1,16}$' else '^[0-9]{1,16}(\.[0-9]+)?$' end) then
      raise exception 'Invalid value for %: digits only' , k using errcode = '23514';
    end if;
    n := v::numeric;
    if n < (r ->> 0)::numeric or n > (r ->> 1)::numeric then
      raise exception 'Value for % is out of range', k using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists listings_validate_attributes on public.listings;
create trigger listings_validate_attributes
  before insert or update of attributes on public.listings
  for each row execute function public.validate_listing_attributes();

-- ── 3. Server-owned columns can't be forged on INSERT ───────────────────────
-- 0019 revoked UPDATE on views / favorites_count, but INSERT still accepts
-- them, so a hand-written insert could publish a listing that already shows
-- a million views, a backdated created_at (ranking), or status 'sold'.
create or replace function public.sanitize_new_listing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('fursad.admin_write', true), '') = 'true'
     or coalesce(current_setting('suuqplus.skip_rate_limit', true), '') = 'true' then
    return new;
  end if;
  -- An idempotent publish retry (upsert with a stable client id) fires this
  -- BEFORE INSERT trigger even though it resolves to an UPDATE (see 0031) —
  -- leave those alone so a retry can't reset a live listing's counters.
  if exists (select 1 from public.listings where id = new.id) then
    return new;
  end if;
  new.views := 0;
  new.favorites_count := 0;
  new.created_at := now();
  new.updated_at := now();
  new.sold_at := null;
  new.status := 'available';
  return new;
end;
$$;

-- Name sorts before rate_limit_listings / other triggers on purpose (BEFORE
-- INSERT triggers fire in alphabetical order).
drop trigger if exists a_listings_sanitize_new on public.listings;
create trigger a_listings_sanitize_new
  before insert on public.listings
  for each row execute function public.sanitize_new_listing();

-- ── 4. After reviewing existing rows, enforce the constraints on them too ───
-- Find rows that would fail first:
--   select id, title, price, condition, currency, array_length(images,1) as photos
--   from public.listings
--   where not (price > 0 and price <= 999999999999)
--      or char_length(btrim(title)) < 1
--      or (description is not null and char_length(btrim(description)) < 1)
--      or (condition is not null and condition not in ('new','like-new','used','for-parts'))
--      or currency !~ '^[A-Z]{3}$'
--      or coalesce(array_length(images,1),0) not between 1 and 8;
-- Fix or remove those, then:
--   alter table public.listings validate constraint listings_price_range;
--   alter table public.listings validate constraint listings_title_not_blank;
--   alter table public.listings validate constraint listings_description_not_blank;
--   alter table public.listings validate constraint listings_condition_valid;
--   alter table public.listings validate constraint listings_currency_format;
--   alter table public.listings validate constraint listings_images_count;
--   alter table public.listings validate constraint listings_attributes_shape;
--   alter table public.listings validate constraint listings_features_count;
--   alter table public.listings validate constraint listings_seller_notes_count;
--   alter table public.listings validate constraint listings_title_length;        -- from 0019
--   alter table public.listings validate constraint listings_description_length;  -- from 0019

-- ===== 0050_image_scan_rollout_modes.sql =====
-- 0050 — rollout ladder for listing-photo scans: off → shadow → enforce, plus a separate, gated switch that closes the
-- legacy public upload path. Needs 0048 applied first. NOT APPLIED anywhere; applying it changes nothing (mode 'off').
--
-- Why a ladder: 0048 has one boolean. Flipping it on while old app builds (which upload straight to the public
-- bucket and know nothing about scans) are still in use would make every one of their publishes fail with a generic
-- error. The ladder lets us measure first, then enforce, then close the old door — each step reversible by one UPDATE.
--
--   off      today's behaviour. Nothing is checked, nothing is recorded.
--   shadow   nothing is blocked or held. Every client write that adds photos records HOW MANY of them had a finished
--            scan and how many did not. That count is the evidence for "old clients are gone" — no guessing.
--   enforce  0048's rules: unscanned/rejected photos cannot be published; "review" photos hide the listing.
--   legacy_presign_closed (only valid in enforce) tells r2-presign to stop issuing public `listings/…` upload URLs.
--
-- Rollback of any step: set mode back (one statement); leaving enforce automatically re-opens the legacy presign path.

-- ============================================================================
-- 1. Config columns (the 0048 `enforce` boolean stays and is kept in sync, so 0048-era code and tests still work)
-- ============================================================================
alter table public.image_scan_config
  add column if not exists mode text not null default 'off',
  add column if not exists legacy_presign_closed boolean not null default false,
  add column if not exists shadow_started_at timestamptz,
  add column if not exists min_shadow_hours int not null default 72 check (min_shadow_hours >= 0);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'image_scan_config_mode_check') then
    alter table public.image_scan_config add constraint image_scan_config_mode_check check (mode in ('off', 'shadow', 'enforce'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'image_scan_config_closure_needs_enforce') then
    alter table public.image_scan_config add constraint image_scan_config_closure_needs_enforce check (not legacy_presign_closed or mode = 'enforce');
  end if;
end $$;

-- Existing rows: carry the old boolean over (an unapplied-0048 database simply has enforce = false → 'off').
update public.image_scan_config set mode = 'enforce' where enforce and mode = 'off';

-- `enforce` and `mode` can never disagree, whichever one an operator edits. Leaving 'enforce' also re-opens the
-- legacy presign path, so a rollback is always one statement.
create or replace function public.trg_image_scan_config_sync()
returns trigger language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.enforce is distinct from old.enforce and new.mode is not distinct from old.mode then
    new.mode := case when new.enforce then 'enforce' else case when old.mode = 'enforce' then 'off' else old.mode end end;
  end if;
  new.enforce := (new.mode = 'enforce');
  if new.mode <> 'enforce' then new.legacy_presign_closed := false; end if;
  if new.mode = 'shadow' and (tg_op = 'INSERT' or old.mode is distinct from 'shadow') then new.shadow_started_at := now(); end if;
  if new.mode = 'off' then new.shadow_started_at := null; end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists image_scan_config_sync on public.image_scan_config;
create trigger image_scan_config_sync before insert or update on public.image_scan_config
  for each row execute function public.trg_image_scan_config_sync();

create or replace function public.image_scan_mode()
returns text language sql stable security definer set search_path = public
as $$ select coalesce((select mode from public.image_scan_config where id), 'off') $$;

-- ============================================================================
-- 2. What shadow mode records
-- ============================================================================
create table if not exists public.image_scan_shadow_events (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null,
  listing_id uuid not null,
  op text not null check (op in ('INSERT', 'UPDATE')),
  photos_added int not null check (photos_added > 0),
  verified int not null default 0,      -- photos that had a finished scan by this user for this listing
  unverified int not null default 0,    -- photos with no scan (old app build, direct API write, bulk import…)
  rejected int not null default 0,      -- photos whose scan verdict was reject and not overridden
  held int not null default 0           -- photos that enforcement WOULD have put on hold for review
);
create index if not exists image_scan_shadow_events_created_idx on public.image_scan_shadow_events (created_at desc);
alter table public.image_scan_shadow_events enable row level security;
drop policy if exists "staff read shadow events" on public.image_scan_shadow_events;
create policy "staff read shadow events" on public.image_scan_shadow_events for select using (public.staff_can('read'));
revoke all on public.image_scan_shadow_events from anon, authenticated;
grant select on public.image_scan_shadow_events to authenticated; -- RLS limits it to staff

create or replace function public._scan_shadow_record(p_listing uuid, p_user uuid, p_op text, p_verified int, p_unverified int, p_rejected int, p_held int)
returns void language sql security definer set search_path = public
as $$
  insert into public.image_scan_shadow_events (listing_id, user_id, op, photos_added, verified, unverified, rejected, held)
  values (p_listing, p_user, p_op, p_verified + p_unverified + p_rejected + p_held, p_verified, p_unverified, p_rejected, p_held)
$$;
revoke execute on function public._scan_shadow_record(uuid, uuid, text, int, int, int, int) from public, anon;
grant execute on function public._scan_shadow_record(uuid, uuid, text, int, int, int, int) to authenticated;   -- called by the invoker trigger

-- ============================================================================
-- 3. The trigger: off = nothing, shadow = record only, enforce = 0048's rules (unchanged)
-- ============================================================================
create or replace function public.trg_listing_image_scan()
returns trigger
language plpgsql
as $$
declare
  v_mode text;
  v_url text;
  v_state record;
  v_hold boolean := false;
  v_scans uuid[] := '{}';
  v_check text[];
  v_ok int := 0;
  v_none int := 0;
  v_rej int := 0;
  v_rev int := 0;
begin
  if not public.is_client_write() then
    return new;
  end if;
  v_mode := public.image_scan_mode();
  if v_mode = 'off' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.images is not distinct from old.images then
    return new;
  end if;

  -- Insert: every photo must be verified. Update: new photos must be; photos that were already on the listing are
  -- re-checked only when the listing is being released from a scan hold.
  v_check := case when tg_op = 'INSERT' then new.images
                  else coalesce(array(select u from unnest(new.images) u where not (u = any (old.images))), '{}') end;

  if v_mode = 'shadow' then
    foreach v_url in array v_check loop
      select * into v_state from public._scan_image_state(v_url, new.user_id, new.id);
      if not found then v_none := v_none + 1;
      elsif v_state.review_status = 'rejected' or (v_state.verdict = 'reject' and v_state.review_status <> 'approved') then v_rej := v_rej + 1;
      elsif v_state.verdict = 'review' and v_state.review_status <> 'approved' then v_rev := v_rev + 1;
      else v_ok := v_ok + 1;
      end if;
    end loop;
    if coalesce(array_length(v_check, 1), 0) > 0 then
      perform public._scan_shadow_record(new.id, new.user_id, tg_op, v_ok, v_none, v_rej, v_rev);
    end if;
    return new;   -- shadow never blocks and never holds
  end if;

  foreach v_url in array v_check loop
    select * into v_state from public._scan_image_state(v_url, new.user_id, new.id);
    if not found then
      raise exception 'Photo has not been checked' using errcode = '42501', hint = 'image_not_verified';
    end if;
    if v_state.review_status = 'rejected' or (v_state.verdict = 'reject' and v_state.review_status <> 'approved') then
      raise exception 'Photo was not accepted' using errcode = '42501', hint = 'image_rejected';
    end if;
    if v_state.verdict = 'review' and v_state.review_status <> 'approved' then
      v_hold := true;
      v_scans := v_scans || v_state.scan_id;
    end if;
  end loop;

  if v_hold then
    new.status_before_moderation := case when tg_op = 'UPDATE' and old.status not in ('removed', 'deactivated') then old.status else 'available' end;
    new.status := 'deactivated';
    perform public._scan_mark_held(v_scans);
  elsif tg_op = 'UPDATE' and old.status = 'deactivated' and public._listing_awaiting_replacement(old.id)
        and public._scan_unresolved_count(new.images, new.user_id, new.id) = 0 then
    new.status := coalesce(nullif(old.status_before_moderation, ''), 'available');
    new.status_before_moderation := null;
  end if;
  return new;
end;
$$;

-- ============================================================================
-- 4. What the apps / presign function / staff can read, and the only ways to move the ladder
-- ============================================================================
-- Public, secret-free: lets a client fail closed with a clear "update required" message instead of a generic error.
create or replace function public.image_scan_client_policy()
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('mode', c.mode, 'scanRequired', c.mode <> 'off', 'legacyUploadClosed', c.legacy_presign_closed)
    from public.image_scan_config c where c.id
$$;
revoke execute on function public.image_scan_client_policy() from public;
grant execute on function public.image_scan_client_policy() to anon, authenticated, service_role;

create or replace function public.admin_image_scan_rollout_status()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare r jsonb;
begin
  if not public.staff_can('read') then raise exception 'Not authorized' using errcode = '42501'; end if;
  select jsonb_build_object(
    'mode', c.mode,
    'legacyPresignClosed', c.legacy_presign_closed,
    'shadowStartedAt', c.shadow_started_at,
    'shadowHours', case when c.shadow_started_at is null then null else round((extract(epoch from now() - c.shadow_started_at) / 3600)::numeric, 1) end,
    'minShadowHours', c.min_shadow_hours,
    'last7d', (select jsonb_build_object(
        'writes', count(*), 'verifiedPhotos', coalesce(sum(verified), 0), 'unverifiedPhotos', coalesce(sum(unverified), 0),
        'rejectedPhotos', coalesce(sum(rejected), 0), 'wouldHold', coalesce(sum(held), 0),
        'distinctUsersWithUnverified', count(distinct user_id) filter (where unverified > 0))
      from public.image_scan_shadow_events where created_at > now() - interval '7 days'),
    'last24hUnverifiedPhotos', (select coalesce(sum(unverified), 0) from public.image_scan_shadow_events where created_at > now() - interval '24 hours')
  ) into r from public.image_scan_config c where c.id;
  return r;
end;
$$;
revoke execute on function public.admin_image_scan_rollout_status() from anon, public;
grant execute on function public.admin_image_scan_rollout_status() to authenticated;

-- Moves the ladder one rung at a time. Going up requires admin + a reason; going down is always allowed to an admin.
-- off → shadow → enforce only (no jumping), and enforce needs min_shadow_hours of shadow data.
create or replace function public.admin_set_image_scan_mode(p_mode text, p_reason text)
returns text language plpgsql security definer set search_path = public
as $$
declare c public.image_scan_config%rowtype;
begin
  if public.staff_role() is distinct from 'admin' then raise exception 'Only an administrator can change the photo-check mode' using errcode = '42501'; end if;
  if p_mode not in ('off', 'shadow', 'enforce') then raise exception 'Unknown mode %', p_mode using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'A reason is required' using errcode = '22023'; end if;
  select * into c from public.image_scan_config where id for update;
  if p_mode = 'enforce' and c.mode <> 'shadow' and c.mode <> 'enforce' then
    raise exception 'Enforcement can only follow shadow mode' using errcode = '55000';
  end if;
  if p_mode = 'enforce' and c.mode = 'shadow'
     and (c.shadow_started_at is null or now() - c.shadow_started_at < make_interval(hours => c.min_shadow_hours)) then
    raise exception 'Shadow mode must run for at least % hours first', c.min_shadow_hours using errcode = '55000';
  end if;
  update public.image_scan_config set mode = p_mode where id;
  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), 'set_image_scan_mode', 'config', 'image_scan', btrim(p_reason), jsonb_build_object('from', c.mode, 'to', p_mode));
  return p_mode;
end;
$$;
revoke execute on function public.admin_set_image_scan_mode(text, text) from anon, public;
grant execute on function public.admin_set_image_scan_mode(text, text) to authenticated;

-- Closes (or re-opens) the legacy public listing-photo upload path. Only while enforcing; only an admin.
create or replace function public.admin_set_legacy_presign_closed(p_closed boolean, p_reason text)
returns boolean language plpgsql security definer set search_path = public
as $$
declare c public.image_scan_config%rowtype;
begin
  if public.staff_role() is distinct from 'admin' then raise exception 'Only an administrator can change this' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'A reason is required' using errcode = '22023'; end if;
  select * into c from public.image_scan_config where id for update;
  if p_closed and c.mode <> 'enforce' then raise exception 'The legacy upload path can only be closed while photo checks are enforced' using errcode = '55000'; end if;
  update public.image_scan_config set legacy_presign_closed = p_closed where id;
  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), 'set_legacy_presign_closed', 'config', 'image_scan', btrim(p_reason), jsonb_build_object('from', c.legacy_presign_closed, 'to', p_closed));
  return p_closed;
end;
$$;
revoke execute on function public.admin_set_legacy_presign_closed(boolean, text) from anon, public;
grant execute on function public.admin_set_legacy_presign_closed(boolean, text) to authenticated;

-- r2-presign (service role) reads the closure flag with this; fail-safe default when the row is missing is "open".
create or replace function public.legacy_presign_closed()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select legacy_presign_closed from public.image_scan_config where id), false) $$;
revoke execute on function public.legacy_presign_closed() from public, anon, authenticated;
grant execute on function public.legacy_presign_closed() to service_role;

-- ===== 0051_bulk_photo_queue.sql =====
-- 0051 — queue for business bulk-upload photos. Needs 0048 + 0050. NOT APPLIED anywhere; INACTIVE after applying:
-- bulk_scan_config.enabled defaults to false and the daily quota to 0, so applying this alone changes nothing.
--
-- Problem: business bulk upload (CSV with image URLs) inserts each row straight into `listings` with whatever URLs the
-- CSV contains — remote, unscanned, unmarked, possibly hot-linked from someone else's site. Under photo enforcement
-- those inserts are refused; and the interactive scan limit (20 scans/hour/user) is meant for one seller posting one
-- item, not a business posting 200.
--
-- Design (owner approval needed for the numbers — see docs/IMAGE_PARITY_REPORT.md "Bulk upload"):
--   * The CSV rows are saved server-side as a batch (`bulk_import_batches`, `bulk_import_rows`). One row = one listing.
--   * A scheduled Worker claims queued rows (a few per user at a time, fairly), downloads each photo through a guarded
--     fetcher, runs the SAME scan/watermark pipeline as the interactive flow with source = 'bulk', and records the
--     outcome on the row. Failures retry with exponential backoff, then settle as `failed` (visible, retryable).
--   * Publication stays the client write guarded by the 0048/0050 trigger: when a row is `ready` the app inserts the
--     listing with the DERIVATIVE urls, and the trigger verifies the scan exactly as for any other listing. There is no
--     second, server-side publish path to keep in step.
--   * Separate limits, never the interactive 20/hour: a per-user DAILY PHOTO QUOTA, a cap on rows per batch and photos
--     per listing, one active batch per user, and at most 2 rows per user in flight. Bulk scans carry source = 'bulk'
--     and are not counted against the interactive hourly limit.
--   * Bulk can only be enabled while photo checks are enforced (otherwise held photos would be private/404).

-- ============================================================================
-- 1. Config (singleton, staff-readable, admin-changeable through one audited function)
-- ============================================================================
create table if not exists public.bulk_scan_config (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  daily_photo_quota int not null default 0 check (daily_photo_quota between 0 and 100000),
  max_rows_per_batch int not null default 50 check (max_rows_per_batch between 1 and 1000),
  max_photos_per_row int not null default 5 check (max_photos_per_row between 1 and 8),
  max_active_batches int not null default 1 check (max_active_batches between 1 and 10),
  max_in_flight_per_user int not null default 2 check (max_in_flight_per_user between 1 and 10),
  max_attempts int not null default 4 check (max_attempts between 1 and 10),
  lease_seconds int not null default 300 check (lease_seconds between 30 and 3600),
  updated_at timestamptz not null default now()
);
insert into public.bulk_scan_config (id) values (true) on conflict do nothing;
alter table public.bulk_scan_config enable row level security;
drop policy if exists "staff read bulk config" on public.bulk_scan_config;
create policy "staff read bulk config" on public.bulk_scan_config for select using (public.staff_can('read'));
revoke insert, update, delete on public.bulk_scan_config from anon, authenticated;

-- Bulk scans must not eat the interactive hourly allowance.
alter table public.listing_scans add column if not exists source text not null default 'interactive';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'listing_scans_source_check') then
    alter table public.listing_scans add constraint listing_scans_source_check check (source in ('interactive', 'bulk'));
  end if;
end $$;

-- ============================================================================
-- 2. Batches and rows
-- ============================================================================
create table if not exists public.bulk_import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  total_rows int not null check (total_rows > 0),
  total_photos int not null check (total_photos > 0)
);
create index if not exists bulk_import_batches_user_idx on public.bulk_import_batches (user_id, created_at desc);

create table if not exists public.bulk_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.bulk_import_batches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null default gen_random_uuid(),     -- the id the listing will be published under; the scan is bound to it
  payload jsonb not null,                                  -- the validated listing fields (title, price, …); photos live in photo_urls
  photo_urls text[] not null,                              -- source URLs from the CSV (never published)
  status text not null default 'queued' check (status in ('queued', 'processing', 'ready', 'ready_review', 'needs_changes', 'failed', 'published', 'cancelled')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  error_code text,
  scan_id uuid references public.listing_scans(id) on delete set null,
  image_urls text[],                                       -- the watermarked derivatives, index-aligned with photo_urls, once scanned
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bulk_import_rows_claim_idx on public.bulk_import_rows (next_attempt_at) where status in ('queued', 'processing');
create index if not exists bulk_import_rows_batch_idx on public.bulk_import_rows (batch_id);
create index if not exists bulk_import_rows_user_idx on public.bulk_import_rows (user_id, created_at desc);

alter table public.bulk_import_batches enable row level security;
alter table public.bulk_import_rows enable row level security;
revoke all on public.bulk_import_batches, public.bulk_import_rows from anon, authenticated;
-- No client policies at all: clients go through the functions below, which check ownership.
drop policy if exists "staff read bulk batches" on public.bulk_import_batches;
create policy "staff read bulk batches" on public.bulk_import_batches for select using (public.staff_can('read'));
drop policy if exists "staff read bulk rows" on public.bulk_import_rows;
create policy "staff read bulk rows" on public.bulk_import_rows for select using (public.staff_can('read'));
grant select on public.bulk_import_batches, public.bulk_import_rows to authenticated;   -- RLS limits it to staff

-- ============================================================================
-- 3. Seller-facing functions
-- ============================================================================
create or replace function public.bulk_scan_quota()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare c public.bulk_scan_config%rowtype; v_used int;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into c from public.bulk_scan_config where id;
  select coalesce(sum(array_length(photo_urls, 1)), 0)::int into v_used
    from public.bulk_import_rows where user_id = auth.uid() and created_at > now() - interval '24 hours' and (status <> 'cancelled' or attempts > 0);
  return jsonb_build_object('enabled', c.enabled, 'dailyQuota', c.daily_photo_quota, 'usedToday', v_used,
                            'remaining', greatest(c.daily_photo_quota - v_used, 0),
                            'maxRowsPerBatch', c.max_rows_per_batch, 'maxPhotosPerRow', c.max_photos_per_row);
end;
$$;
revoke execute on function public.bulk_scan_quota() from anon, public;
grant execute on function public.bulk_scan_quota() to authenticated;

-- A cancelled row still counts once a Worker has started on it (the scan cost was incurred); cancelling before that is free.
-- p_rows: [{ "payload": {…listing fields…}, "photoUrls": ["https://…", …] }, …]
create or replace function public.enqueue_bulk_import(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  c public.bulk_scan_config%rowtype;
  v_user uuid := auth.uid();
  v_rows int;
  v_photos int := 0;
  v_used int;
  v_batch uuid;
  r jsonb;
  v_urls text[];
  v_out jsonb := '[]'::jsonb;
  v_row_id uuid;
  v_listing uuid;
begin
  if v_user is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if public.account_effective_status(v_user) in ('suspended', 'banned') then raise exception 'Account suspended' using errcode = '42501'; end if;
  select * into c from public.bulk_scan_config where id for update;
  if not c.enabled then raise exception 'Bulk photo upload is not available yet' using errcode = 'P0001', hint = 'bulk_disabled'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be an array' using errcode = '22023'; end if;
  v_rows := jsonb_array_length(p_rows);
  if v_rows < 1 or v_rows > c.max_rows_per_batch then
    raise exception 'A batch can have 1 to % listings', c.max_rows_per_batch using errcode = 'P0001', hint = 'bulk_too_many_rows';
  end if;
  if (select count(*) from public.bulk_import_batches where user_id = v_user and status = 'open') >= c.max_active_batches then
    raise exception 'Finish or cancel your current bulk upload first' using errcode = 'P0001', hint = 'bulk_batch_active';
  end if;

  -- validate every row BEFORE writing anything
  for r in select * from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r -> 'payload') <> 'object' or jsonb_typeof(r -> 'photoUrls') <> 'array' then
      raise exception 'Malformed row' using errcode = '22023';
    end if;
    select array_agg(u) into v_urls from jsonb_array_elements_text(r -> 'photoUrls') u;
    if v_urls is null or array_length(v_urls, 1) < 1 or array_length(v_urls, 1) > c.max_photos_per_row then
      raise exception 'Each listing needs 1 to % photos', c.max_photos_per_row using errcode = 'P0001', hint = 'bulk_bad_photo_count';
    end if;
    if exists (select 1 from unnest(v_urls) u where u !~ '^https://[^\s/@:]+(/[^\s]*)?$' or char_length(u) > 2048) then
      raise exception 'Photo links must be plain https addresses' using errcode = 'P0001', hint = 'bulk_bad_url';
    end if;
    v_photos := v_photos + array_length(v_urls, 1);
  end loop;

  select coalesce(sum(array_length(photo_urls, 1)), 0)::int into v_used
    from public.bulk_import_rows where user_id = v_user and created_at > now() - interval '24 hours' and (status <> 'cancelled' or attempts > 0);
  if v_used + v_photos > c.daily_photo_quota then
    raise exception 'Daily photo allowance exceeded (% left)', greatest(c.daily_photo_quota - v_used, 0) using errcode = 'P0001', hint = 'bulk_quota_exceeded';
  end if;

  insert into public.bulk_import_batches (user_id, total_rows, total_photos) values (v_user, v_rows, v_photos) returning id into v_batch;
  for r in select * from jsonb_array_elements(p_rows) loop
    select array_agg(u) into v_urls from jsonb_array_elements_text(r -> 'photoUrls') u;
    insert into public.bulk_import_rows (batch_id, user_id, payload, photo_urls)
    values (v_batch, v_user, r -> 'payload', v_urls) returning id, listing_id into v_row_id, v_listing;
    v_out := v_out || jsonb_build_object('id', v_row_id, 'listingId', v_listing);
  end loop;
  return jsonb_build_object('batchId', v_batch, 'rows', v_out);
end;
$$;
revoke execute on function public.enqueue_bulk_import(jsonb) from anon, public;
grant execute on function public.enqueue_bulk_import(jsonb) to authenticated;

-- Lets the app resume the progress screen after it was closed (the queue keeps working without the app).
create or replace function public.bulk_active_batch()
returns uuid language sql stable security definer set search_path = public
as $$ select id from public.bulk_import_batches where user_id = auth.uid() and status = 'open' order by created_at desc limit 1 $$;
revoke execute on function public.bulk_active_batch() from anon, public;
grant execute on function public.bulk_active_batch() to authenticated;

-- Progress for the seller's own batch. Never returns source URLs or internals.
create or replace function public.bulk_batch_status(p_batch uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_b public.bulk_import_batches%rowtype;
begin
  select * into v_b from public.bulk_import_batches where id = p_batch and user_id = auth.uid();
  if not found then raise exception 'Not found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'batchId', v_b.id, 'status', v_b.status, 'totalRows', v_b.total_rows,
    'counts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.bulk_import_rows where batch_id = p_batch group by status) s),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'listingId', listing_id, 'status', status, 'attempts', attempts, 'errorCode', error_code,
        'payload', payload, 'imageUrls', case when status in ('ready', 'ready_review', 'published') then image_urls end) order by created_at, id), '[]'::jsonb)
      from public.bulk_import_rows where batch_id = p_batch));
end;
$$;
revoke execute on function public.bulk_batch_status(uuid) from anon, public;
grant execute on function public.bulk_batch_status(uuid) to authenticated;

-- A failed row (outage, unreachable photo host…) goes back in the queue; it does NOT use quota a second time.
create or replace function public.bulk_retry_row(p_row uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
begin
  update public.bulk_import_rows set status = 'queued', attempts = 0, next_attempt_at = now(), lease_until = null, error_code = null, updated_at = now()
   where id = p_row and user_id = auth.uid() and status = 'failed'
     and exists (select 1 from public.bulk_import_batches b where b.id = batch_id and b.status = 'open');
  return found;
end;
$$;
revoke execute on function public.bulk_retry_row(uuid) from anon, public;
grant execute on function public.bulk_retry_row(uuid) to authenticated;

-- Called by the app after it has published a ready row through the normal (trigger-guarded) listing write.
create or replace function public.bulk_mark_published(p_row uuid)
returns boolean language plpgsql security definer set search_path = public
as $$
declare v_batch uuid;
begin
  update public.bulk_import_rows set status = 'published', updated_at = now()
   where id = p_row and user_id = auth.uid() and status in ('ready', 'ready_review')
     and exists (select 1 from public.listings l where l.id = listing_id and l.user_id = auth.uid())   -- only once the listing really exists
  returning batch_id into v_batch;
  if v_batch is null then return false; end if;
  update public.bulk_import_batches b set status = 'done'
   where b.id = v_batch and b.status = 'open' and not exists (select 1 from public.bulk_import_rows r where r.batch_id = b.id and r.status in ('queued', 'processing', 'ready', 'ready_review'));
  return true;
end;
$$;
revoke execute on function public.bulk_mark_published(uuid) from anon, public;
grant execute on function public.bulk_mark_published(uuid) to authenticated;

create or replace function public.bulk_cancel_batch(p_batch uuid)
returns int language plpgsql security definer set search_path = public
as $$
declare n int;
begin
  update public.bulk_import_rows set status = 'cancelled', updated_at = now()
   where batch_id = p_batch and user_id = auth.uid() and status in ('queued', 'processing', 'failed', 'ready', 'ready_review', 'needs_changes');
  get diagnostics n = row_count;
  update public.bulk_import_batches set status = 'cancelled' where id = p_batch and user_id = auth.uid() and status = 'open';
  return n;
end;
$$;
revoke execute on function public.bulk_cancel_batch(uuid) from anon, public;
grant execute on function public.bulk_cancel_batch(uuid) to authenticated;

-- ============================================================================
-- 4. Worker-facing functions (service role only)
-- ============================================================================
-- Claims up to p_limit rows: fair across users (at most max_in_flight_per_user per user, counting rows already in
-- flight), oldest first, with a lease so a crashed Worker's rows come back. Does nothing unless bulk is enabled.
create or replace function public.claim_bulk_rows(p_limit int)
returns table (id uuid, user_id uuid, listing_id uuid, payload jsonb, photo_urls text[], attempts int)
language plpgsql security definer set search_path = public
as $$
declare c public.bulk_scan_config%rowtype;
begin
  select * into c from public.bulk_scan_config where bulk_scan_config.id;
  if not c.enabled then return; end if;
  -- FOR UPDATE can't be combined with a window function, so: rank (no lock) → pick → lock the picked rows, skipping any
  -- another Worker already holds → update. A row another Worker grabbed in between is simply not returned.
  return query
    with in_flight as (
      select r.user_id, count(*)::int n from public.bulk_import_rows r where r.status = 'processing' and r.lease_until > now() group by r.user_id
    ), ranked as (
      select r.id, r.user_id, row_number() over (partition by r.user_id order by r.created_at, r.id) as rn
        from public.bulk_import_rows r
       where ((r.status = 'queued' and r.next_attempt_at <= now()) or (r.status = 'processing' and r.lease_until <= now()))
         and exists (select 1 from public.bulk_import_batches b where b.id = r.batch_id and b.status = 'open')
    ), picked as (
      select d.id from ranked d left join in_flight f on f.user_id = d.user_id
       where d.rn <= greatest(c.max_in_flight_per_user - coalesce(f.n, 0), 0)
       order by d.rn, d.id
       limit greatest(p_limit, 0)
    ), locked as (
      select r.id from public.bulk_import_rows r join picked on picked.id = r.id
       where (r.status = 'queued' and r.next_attempt_at <= now()) or (r.status = 'processing' and r.lease_until <= now())
         for update of r skip locked
    )
    update public.bulk_import_rows r
       set status = 'processing', attempts = r.attempts + 1, lease_until = now() + make_interval(secs => c.lease_seconds), updated_at = now()
      from locked where r.id = locked.id
    returning r.id, r.user_id, r.listing_id, r.payload, r.photo_urls, r.attempts;
end;
$$;
revoke execute on function public.claim_bulk_rows(int) from public, anon, authenticated;
grant execute on function public.claim_bulk_rows(int) to service_role;

create or replace function public.complete_bulk_row(p_row uuid, p_status text, p_scan uuid, p_image_urls text[])
returns void language plpgsql security definer set search_path = public
as $$
begin
  if p_status not in ('ready', 'ready_review', 'needs_changes') then raise exception 'bad status %', p_status using errcode = '22023'; end if;
  update public.bulk_import_rows
     set status = p_status, scan_id = p_scan, image_urls = case when p_status = 'needs_changes' then null else p_image_urls end,
         error_code = null, lease_until = null, updated_at = now()
   where id = p_row and status = 'processing';
end;
$$;
revoke execute on function public.complete_bulk_row(uuid, text, uuid, text[]) from public, anon, authenticated;
grant execute on function public.complete_bulk_row(uuid, text, uuid, text[]) to service_role;

-- Retryable failures back off 1, 2, 4… minutes (capped at an hour) until max_attempts, then settle as `failed`.
create or replace function public.fail_bulk_row(p_row uuid, p_error text, p_retryable boolean)
returns text language plpgsql security definer set search_path = public
as $$
declare r public.bulk_import_rows%rowtype; c public.bulk_scan_config%rowtype; v_status text;
begin
  select * into c from public.bulk_scan_config where id;
  select * into r from public.bulk_import_rows where id = p_row and status = 'processing' for update;
  if not found then return null; end if;
  if p_retryable and r.attempts < c.max_attempts then
    update public.bulk_import_rows
       set status = 'queued', error_code = left(p_error, 60), lease_until = null,
           next_attempt_at = now() + make_interval(mins => least(power(2, greatest(r.attempts - 1, 0))::int, 60)), updated_at = now()
     where id = p_row;
    v_status := 'queued';
  else
    update public.bulk_import_rows set status = 'failed', error_code = left(p_error, 60), lease_until = null, updated_at = now() where id = p_row;
    v_status := 'failed';
  end if;
  return v_status;
end;
$$;
revoke execute on function public.fail_bulk_row(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.fail_bulk_row(uuid, text, boolean) to service_role;

-- ============================================================================
-- 5. The only way to change the numbers (admin, audited). Enabling needs photo checks enforced.
-- ============================================================================
create or replace function public.admin_set_bulk_scan_config(p_enabled boolean, p_daily_photo_quota int, p_reason text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare before_c public.bulk_scan_config%rowtype;
begin
  if public.staff_role() is distinct from 'admin' then raise exception 'Only an administrator can change bulk limits' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'A reason is required' using errcode = '22023'; end if;
  if p_enabled and public.image_scan_mode() <> 'enforce' then
    raise exception 'Bulk photo upload can only be enabled while photo checks are enforced' using errcode = '55000';
  end if;
  if p_enabled and coalesce(p_daily_photo_quota, 0) < 1 then raise exception 'Enabling needs a daily photo quota of at least 1' using errcode = '22023'; end if;
  select * into before_c from public.bulk_scan_config where id for update;
  update public.bulk_scan_config set enabled = p_enabled, daily_photo_quota = coalesce(p_daily_photo_quota, daily_photo_quota), updated_at = now() where id;
  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), 'set_bulk_scan_config', 'config', 'bulk_scan', btrim(p_reason),
          jsonb_build_object('from', jsonb_build_object('enabled', before_c.enabled, 'quota', before_c.daily_photo_quota), 'to', jsonb_build_object('enabled', p_enabled, 'quota', coalesce(p_daily_photo_quota, before_c.daily_photo_quota))));
  return jsonb_build_object('enabled', p_enabled, 'dailyPhotoQuota', coalesce(p_daily_photo_quota, before_c.daily_photo_quota));
end;
$$;
revoke execute on function public.admin_set_bulk_scan_config(boolean, int, text) from anon, public;
grant execute on function public.admin_set_bulk_scan_config(boolean, int, text) to authenticated;

-- Leaving enforce switches bulk off at once (rollback of the photo ladder must not leave a queue running).
create or replace function public.trg_image_scan_config_sync()
returns trigger language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.enforce is distinct from old.enforce and new.mode is not distinct from old.mode then
    new.mode := case when new.enforce then 'enforce' else case when old.mode = 'enforce' then 'off' else old.mode end end;
  end if;
  new.enforce := (new.mode = 'enforce');
  if new.mode <> 'enforce' then
    new.legacy_presign_closed := false;
    update public.bulk_scan_config set enabled = false, updated_at = now() where enabled;
  end if;
  if new.mode = 'shadow' and (tg_op = 'INSERT' or old.mode is distinct from 'shadow') then new.shadow_started_at := now(); end if;
  if new.mode = 'off' then new.shadow_started_at := null; end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ===== 0052_staff_activity_alerts.sql =====
-- 0052 — Staff activity alerts: new listing, new user, and web push subscriptions.
--
-- Reports (0045) and support cases/replies/appeals (0040) already write an in-app notification for staff, and the
-- existing notifications push webhook (0012/0019) turns every notification row into an FCM push for the mobile app.
-- This adds the two events that had no alert at all, plus the table the web app (installed to the home screen) uses
-- to receive the same pushes:
--   * new listing -> admins + moderators   (type 'listing_staff'; a burst from one seller collapses into ONE row so a
--                                           bulk upload is one push, not a hundred)
--   * new user    -> admins                (type 'user_staff')
--   * web_push_subscriptions               (one row per browser/home-screen install, own rows only)
-- A failure to notify must never block a listing or a sign-up, so each trigger body swallows its own errors.
-- Needs 0039 (admin_users.role). Rollback: supabase/rollback/0052_staff_activity_alerts_ROLLBACK.sql.

-- ============================================================================
-- 1. New listing -> admins + moderators
-- ============================================================================
create or replace function public.trg_listings_notify_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff record;
  v_existing record;
  v_seller text;
  v_count int;
begin
  begin
    select coalesce(nullif(btrim(full_name), ''), 'A seller') into v_seller from public.profiles where id = new.user_id;
    v_seller := coalesce(v_seller, 'A seller');

    for v_staff in
      select a.user_id from public.admin_users a
       where a.role in ('admin', 'moderator') and a.user_id <> new.user_id
    loop
      -- Same seller, still unread, within 10 minutes: fold into that row (no new insert => no extra push).
      select id, coalesce((data ->> 'count')::int, 1) as n into v_existing
        from public.notifications
       where user_id = v_staff.user_id and type = 'listing_staff' and read = false
         and data ->> 'sellerId' = new.user_id::text and created_at > now() - interval '10 minutes'
       order by created_at desc limit 1;

      if found then
        v_count := v_existing.n + 1;
        update public.notifications
           set title = v_count || ' new listings from ' || v_seller,
               body = left(new.title, 120),
               created_at = now(),
               data = jsonb_build_object('listingId', new.id, 'sellerId', new.user_id, 'count', v_count)
         where id = v_existing.id;
      else
        insert into public.notifications (user_id, title, body, type, data)
        values (v_staff.user_id, 'New listing', left(new.title, 120) || ' — ' || v_seller, 'listing_staff',
                jsonb_build_object('listingId', new.id, 'sellerId', new.user_id, 'count', 1));
      end if;
    end loop;
  exception when others then
    null;
  end;
  return new;
end;
$$;
revoke execute on function public.trg_listings_notify_staff() from public, anon, authenticated;

drop trigger if exists listings_z_notify_staff on public.listings;
create trigger listings_z_notify_staff after insert on public.listings
  for each row execute function public.trg_listings_notify_staff();

-- ============================================================================
-- 2. New user -> admins
-- ============================================================================
create or replace function public.trg_profiles_notify_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.notifications (user_id, title, body, type, data)
    select a.user_id, 'New user joined', coalesce(nullif(btrim(new.full_name), ''), 'A new account was created'),
           'user_staff', jsonb_build_object('userId', new.id)
      from public.admin_users a
     where a.role = 'admin' and a.user_id <> new.id;
  exception when others then
    null;
  end;
  return new;
end;
$$;
revoke execute on function public.trg_profiles_notify_staff() from public, anon, authenticated;

drop trigger if exists profiles_z_notify_staff on public.profiles;
create trigger profiles_z_notify_staff after insert on public.profiles
  for each row execute function public.trg_profiles_notify_staff();

-- ============================================================================
-- 3. Web push subscriptions (browser / installed home-screen app)
-- ============================================================================
create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  active boolean not null default true,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists web_push_subscriptions_user_idx on public.web_push_subscriptions (user_id) where active;

alter table public.web_push_subscriptions enable row level security;
drop policy if exists "users manage their own web push subscriptions" on public.web_push_subscriptions;
create policy "users manage their own web push subscriptions" on public.web_push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- An endpoint is unique to one browser install: if a different account signs in there, the subscription moves to it.
create or replace function public.register_web_push(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  insert into public.web_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, active = true, updated_at = now();
end;
$$;
revoke execute on function public.register_web_push(text, text, text, text) from public, anon;
grant execute on function public.register_web_push(text, text, text, text) to authenticated;

-- ===== 0053_owner_activity_not_counted.sql =====
-- 0053 — A seller's own activity on their own listing is never counted.
--
--   1. increment_listing_views(): a view by the listing's owner no longer bumps listings.views or writes a
--      listing_view_events row (the apps already skipped this client-side, but the web did not, and a client check
--      is not enforcement). Anonymous visitors still count; any other signed-in user counts.
--   2. favorites: the owner cannot favorite their own listing (insert is refused), and any such rows that already
--      exist are removed, which also decrements listings.favorites_count through the existing trigger.
--
-- Self-follow and self-review are already refused by CHECK constraints from 0001, so nothing is needed for them.
-- Past views by owners were never attributed to a viewer, so old totals cannot be corrected automatically.
-- Rollback: supabase/rollback/0053_owner_activity_not_counted_ROLLBACK.sql.

create or replace function public.increment_listing_views(p_listing_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_seller_id uuid;
begin
  select user_id into v_seller_id from public.listings where id = p_listing_id;
  if v_seller_id is null then
    return;
  end if;
  -- The owner looking at their own listing is not a viewer.
  if auth.uid() is not null and auth.uid() = v_seller_id then
    return;
  end if;

  update public.listings set views = views + 1 where id = p_listing_id;
  insert into public.listing_view_events (listing_id, seller_id) values (p_listing_id, v_seller_id);
end;
$$;

create or replace function public.prevent_self_favorite()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if exists (select 1 from public.listings l where l.id::text = new.listing_id and l.user_id = new.user_id) then
    raise exception 'You cannot favorite your own listing' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists favorites_prevent_self on public.favorites;
create trigger favorites_prevent_self
  before insert on public.favorites
  for each row execute function public.prevent_self_favorite();

-- Existing self-favorites: deleting them fires on_favorite_change, which lowers favorites_count to match.
delete from public.favorites f
using public.listings l
where l.id::text = f.listing_id and l.user_id = f.user_id;
