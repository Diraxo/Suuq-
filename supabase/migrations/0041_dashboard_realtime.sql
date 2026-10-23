-- 0041 — Moderation dashboard reads (Phase 2), real-time visibility (Phase 5) and retention (Phase 6).
--
-- NOT applied to any real database by this commit. Tested on PGlite (real PostgreSQL) by
-- supabase/tests/dashboard.test.mjs. Rollback: supabase/rollback/0041_dashboard_realtime_ROLLBACK.sql.
-- Requires 0038-0040.
--
-- What cannot be proven off-platform (marked BLOCKED in docs/SEARCH_MODERATION_CHECKLIST.md): that Supabase
-- Realtime actually delivers the broadcast / postgres_changes events to a connected client.

-- ============================================================================
-- 1. Indexes for the review queues
-- ============================================================================
create index if not exists reports_target_idx on public.reports (target_type, target_id);
create index if not exists reports_status_created_idx on public.reports (status, created_at desc);
create index if not exists reports_reporter_idx on public.reports (reporter_id, created_at desc);
create index if not exists listings_status_created_idx on public.listings (status, created_at desc);

-- ============================================================================
-- 2. Dashboard reads (staff only). SECURITY DEFINER so they can join sellers/reports efficiently; each one
--    checks the caller's role first, and none returns anything a seller-facing role could reach.
-- ============================================================================
create or replace function public.admin_dashboard_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.staff_can('read') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'pending_reports', (select count(*) from public.reports where status = 'pending'),
    'reviewing_reports', (select count(*) from public.reports where status = 'reviewing'),
    'live_listings', (select count(*) from public.listings where status in ('available', 'reserved')),
    'moderated_listings', (select count(*) from public.listings where status in ('removed', 'deactivated')),
    'suspended_users', (select count(*) from public.profiles where public.account_effective_status(id) = 'suspended'),
    'banned_users', (select count(*) from public.profiles where account_status = 'banned'),
    'verified_users', (select count(*) from public.profiles where verified_at is not null),
    'boosted_now', (select count(*) from public.listings where boosted_until > now()),
    'open_cases', (select count(*) from public.support_cases where status in ('awaiting_staff', 'awaiting_user')),
    'awaiting_staff_cases', (select count(*) from public.support_cases where status = 'awaiting_staff'),
    'pending_appeals', (select count(*) from public.moderation_appeals where status = 'pending')
  );
end;
$$;

create or replace function public.admin_list_listings(
  p_status text default null,           -- null = all, 'live', 'moderated', or an exact status
  p_reported_only boolean default false,
  p_query text default null,            -- matches the title, or the seller's name / email
  p_seller_id uuid default null,
  p_sort text default 'newest',         -- 'newest' | 'most_reported'
  p_limit int default 25,
  p_offset int default 0,
  p_boosted_only boolean default false
)
returns table (total bigint, listing jsonb, seller jsonb, report_count int, open_report_count int, last_report_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_q text := nullif(btrim(left(coalesce(p_query, ''), 100)), '');
  v_pat text;
begin
  if not public.staff_can('read') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('live', 'moderated', 'available', 'reserved', 'sold', 'expired', 'removed', 'deactivated') then
    raise exception 'Unknown status filter %', p_status using errcode = '22023';
  end if;
  if p_sort not in ('newest', 'most_reported') then
    raise exception 'Unknown sort %', p_sort using errcode = '22023';
  end if;
  if v_q is not null then
    v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  if p_sort = 'newest' and not coalesce(p_reported_only, false) then
    -- Page first, then count reports only for the rows being shown (cheap even for very large tables).
    return query
    with page as (
      select l.*, count(*) over () as total_rows
        from public.listings l join public.profiles p on p.id = l.user_id
       where (p_status is null
              or (p_status = 'live' and l.status in ('available', 'reserved'))
              or (p_status = 'moderated' and l.status in ('removed', 'deactivated'))
              or l.status = p_status)
         and (p_seller_id is null or l.user_id = p_seller_id)
         and (not coalesce(p_boosted_only, false) or l.boosted_until > now())
         and (v_pat is null or l.title ilike v_pat escape '\' or p.full_name ilike v_pat escape '\' or p.email ilike v_pat escape '\')
       order by l.created_at desc, l.id desc
       limit v_limit offset v_offset
    )
    select pg.total_rows,
           jsonb_build_object('id', pg.id, 'title', pg.title, 'status', pg.status, 'price', pg.price, 'currency', pg.currency,
                              'category', pg.category, 'city', pg.city, 'negotiable', pg.negotiable, 'images', to_jsonb(pg.images[1:3]),
                              'created_at', pg.created_at, 'boosted_until', pg.boosted_until, 'user_id', pg.user_id),
           jsonb_build_object('id', pr.id, 'full_name', pr.full_name, 'email', pr.email, 'avatar_url', pr.avatar_url,
                              'account_status', public.account_effective_status(pr.id), 'suspended_until', pr.suspended_until,
                              'verified_at', pr.verified_at, 'created_at', pr.created_at),
           coalesce(r.cnt, 0), coalesce(r.open_cnt, 0), r.last_at
      from page pg
      join public.profiles pr on pr.id = pg.user_id
      left join lateral (
        select count(*)::int cnt, (count(*) filter (where rp.status in ('pending', 'reviewing')))::int open_cnt, max(rp.created_at) last_at
          from public.reports rp where rp.target_type = 'listing' and rp.target_id = pg.id::text
      ) r on true
     order by pg.created_at desc, pg.id desc;
  else
    return query
    with cand as (
      select l.id, r.cnt, r.open_cnt, r.last_at
        from public.listings l
        join public.profiles p on p.id = l.user_id
        cross join lateral (
          select count(*)::int cnt, (count(*) filter (where rp.status in ('pending', 'reviewing')))::int open_cnt, max(rp.created_at) last_at
            from public.reports rp where rp.target_type = 'listing' and rp.target_id = l.id::text
        ) r
       where (not coalesce(p_reported_only, false) or r.cnt > 0)
         and (p_status is null
              or (p_status = 'live' and l.status in ('available', 'reserved'))
              or (p_status = 'moderated' and l.status in ('removed', 'deactivated'))
              or l.status = p_status)
         and (p_seller_id is null or l.user_id = p_seller_id)
         and (not coalesce(p_boosted_only, false) or l.boosted_until > now())
         and (v_pat is null or l.title ilike v_pat escape '\' or p.full_name ilike v_pat escape '\' or p.email ilike v_pat escape '\')
    ), page as (
      select c.*, count(*) over () as total_rows
        from cand c
       order by (case when p_sort = 'most_reported' then c.open_cnt end) desc nulls last,
                (case when p_sort = 'most_reported' then c.cnt end) desc nulls last,
                c.last_at desc nulls last, c.id desc
       limit v_limit offset v_offset
    )
    select pg.total_rows,
           jsonb_build_object('id', l.id, 'title', l.title, 'status', l.status, 'price', l.price, 'currency', l.currency,
                              'category', l.category, 'city', l.city, 'negotiable', l.negotiable, 'images', to_jsonb(l.images[1:3]),
                              'created_at', l.created_at, 'boosted_until', l.boosted_until, 'user_id', l.user_id),
           jsonb_build_object('id', pr.id, 'full_name', pr.full_name, 'email', pr.email, 'avatar_url', pr.avatar_url,
                              'account_status', public.account_effective_status(pr.id), 'suspended_until', pr.suspended_until,
                              'verified_at', pr.verified_at, 'created_at', pr.created_at),
           pg.cnt, pg.open_cnt, pg.last_at
      from page pg
      join public.listings l on l.id = pg.id
      join public.profiles pr on pr.id = l.user_id
     order by (case when p_sort = 'most_reported' then pg.open_cnt end) desc nulls last,
              (case when p_sort = 'most_reported' then pg.cnt end) desc nulls last,
              pg.last_at desc nulls last, pg.id desc;
  end if;
end;
$$;

create or replace function public.admin_listing_detail(p_listing_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_l public.listings%rowtype;
  v_seller jsonb;
begin
  if not public.staff_can('read') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_l from public.listings where id = p_listing_id;
  if not found then
    return null;
  end if;
  select jsonb_build_object(
           'id', p.id, 'full_name', p.full_name, 'email', p.email, 'phone', p.phone, 'avatar_url', p.avatar_url, 'city', p.city,
           'created_at', p.created_at, 'account_status', public.account_effective_status(p.id), 'suspended_until', p.suspended_until,
           'verified_at', p.verified_at,
           'listings_total', (select count(*) from public.listings where user_id = p.id),
           'listings_live', (select count(*) from public.listings where user_id = p.id and status in ('available', 'reserved')),
           'listings_sold', (select count(*) from public.listings where user_id = p.id and status = 'sold'),
           'listings_moderated', (select count(*) from public.listings where user_id = p.id and status in ('removed', 'deactivated')),
           'rating_avg', (select round(avg(rating)::numeric, 2) from public.reviews where seller_id = p.id),
           'rating_count', (select count(*) from public.reviews where seller_id = p.id),
           'warnings_count', (select count(*) from public.moderation_warnings where user_id = p.id),
           'reports_against_user', (select count(*) from public.reports where target_type = 'user' and target_id = p.id::text),
           'reports_against_listings', (select count(*) from public.reports r join public.listings l2 on r.target_type = 'listing' and r.target_id = l2.id::text where l2.user_id = p.id))
    into v_seller from public.profiles p where p.id = v_l.user_id;

  return jsonb_build_object(
    'listing', to_jsonb(v_l),
    'seller', v_seller,
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'reporter_id', r.reporter_id, 'reporter_name', coalesce(pr.full_name, pr.email, 'SUUQIYE user'),
                                                             'reason', r.reason, 'details', r.details, 'status', r.status, 'created_at', r.created_at) order by r.created_at desc)
                           from public.reports r left join public.profiles pr on pr.id = r.reporter_id
                          where r.target_type = 'listing' and r.target_id = p_listing_id::text), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'created_at', e.created_at, 'action', e.action, 'actor_name', coalesce(a.full_name, a.email, 'System'),
                                                             'reason', e.reason, 'public_message', e.public_message, 'from_status', e.from_status, 'to_status', e.to_status) order by e.created_at desc, e.id desc)
                           from public.moderation_events e left join public.profiles a on a.id = e.actor_id
                          where e.listing_id = p_listing_id), '[]'::jsonb),
    'boosts', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'reason', b.reason, 'revoked_at', b.revoked_at, 'revoke_reason', b.revoke_reason) order by b.created_at desc)
                          from public.listing_boosts b where b.listing_id = p_listing_id), '[]'::jsonb),
    'price_drops', coalesce((select jsonb_agg(jsonb_build_object('old_price', d.old_price, 'new_price', d.new_price, 'created_at', d.created_at) order by d.created_at desc)
                               from public.price_drops d where d.listing_id = p_listing_id), '[]'::jsonb),
    'appeals', coalesce((select jsonb_agg(jsonb_build_object('id', ap.id, 'status', ap.status, 'statement', ap.statement, 'decision_message', ap.decision_message,
                                                             'created_at', ap.created_at, 'decided_at', ap.decided_at, 'case_id', ap.case_id) order by ap.created_at desc)
                           from public.moderation_appeals ap where ap.listing_id = p_listing_id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_list_cases(
  p_status text default null, p_limit int default 25, p_offset int default 0
)
returns table (total bigint, id uuid, subject text, category text, status text, user_id uuid, user_name text, listing_id uuid,
               created_at timestamptz, last_message_at timestamptz, appeal_id uuid, appeal_kind text, appeal_status text, last_snippet text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.staff_can('support') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('open', 'awaiting_staff', 'awaiting_user', 'resolved', 'closed') then
    raise exception 'Unknown status filter %', p_status using errcode = '22023';
  end if;
  return query
  select count(*) over (), c.id, c.subject, c.category, c.status, c.user_id, coalesce(p.full_name, p.email, 'SUUQIYE user'), c.listing_id,
         c.created_at, c.last_message_at, ap.id, ap.kind, ap.status,
         (select left(m.body, 140) from public.support_messages m where m.case_id = c.id order by m.created_at desc limit 1)
    from public.support_cases c
    join public.profiles p on p.id = c.user_id
    left join public.moderation_appeals ap on ap.case_id = c.id
   where (p_status is null
          or (p_status = 'open' and c.status in ('awaiting_staff', 'awaiting_user'))
          or c.status = p_status)
   order by (c.status = 'awaiting_staff') desc, c.last_message_at desc, c.id desc
   limit v_limit offset v_offset;
end;
$$;

create or replace function public.admin_case_detail(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_c public.support_cases%rowtype;
begin
  if not public.staff_can('support') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_c from public.support_cases where id = p_case_id;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'case', to_jsonb(v_c),
    'user', (select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'email', p.email, 'account_status', public.account_effective_status(p.id),
                                       'suspended_until', p.suspended_until, 'verified_at', p.verified_at, 'created_at', p.created_at)
               from public.profiles p where p.id = v_c.user_id),
    'listing', (select jsonb_build_object('id', l.id, 'title', l.title, 'status', l.status, 'images', to_jsonb(l.images[1:3])) from public.listings l where l.id = v_c.listing_id),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'author_kind', m.author_kind, 'internal', m.internal, 'body', m.body, 'created_at', m.created_at,
                                                              'staff_name', (select coalesce(sp.full_name, sp.email) from public.support_message_staff ms join public.profiles sp on sp.id = ms.staff_id where ms.message_id = m.id))
                                         order by m.created_at)
                            from public.support_messages m where m.case_id = p_case_id), '[]'::jsonb),
    'appeal', (select to_jsonb(ap) from public.moderation_appeals ap where ap.case_id = p_case_id),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'created_at', e.created_at, 'action', e.action, 'reason', e.reason, 'listing_id', e.listing_id) order by e.created_at desc)
                           from (select * from public.moderation_events where user_id = v_c.user_id order by created_at desc, id desc limit 20) e), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.admin_dashboard_counts(), public.admin_list_listings(text, boolean, text, uuid, text, int, int, boolean),
  public.admin_listing_detail(uuid), public.admin_list_cases(text, int, int), public.admin_case_detail(uuid) to authenticated;
revoke execute on function public.admin_dashboard_counts(), public.admin_list_listings(text, boolean, text, uuid, text, int, int, boolean),
  public.admin_listing_detail(uuid), public.admin_list_cases(text, int, int), public.admin_case_detail(uuid) from anon, public;

-- ============================================================================
-- 3. Real-time visibility
-- ============================================================================
-- Why a broadcast and not only postgres_changes: Realtime applies RLS to every change event. Once a listing is
-- removed, buyers can no longer SELECT it, so they would receive NO event at all and keep showing it from cache.
-- The trigger below broadcasts a tiny, non-sensitive payload (id + visible flag) on a public topic so every open
-- client can drop (or refresh) the listing immediately. Clients also reconcile through hidden_listing_ids() after
-- every (re)connect/foreground, so a missed event, a duplicate or a stale cache heals itself.
create or replace function public.trg_listing_visibility_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
  v_visible boolean;
  v_was_visible boolean;
begin
  if tg_op = 'DELETE' then
    v_visible := false;
    v_was_visible := old.status not in ('removed', 'deactivated');
    if not v_was_visible then return null; end if;
  else
    v_visible := new.status not in ('removed', 'deactivated');
    v_was_visible := old.status not in ('removed', 'deactivated');
    if v_visible = v_was_visible then return null; end if;
  end if;
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    perform realtime.send(
      jsonb_build_object('id', v_id, 'visible', v_visible, 'at', (extract(epoch from clock_timestamp()) * 1000)::bigint),
      'listing_visibility', 'listings:visibility', false);
  end if;
  return null;
exception when others then
  -- A broadcast failure must never block a moderation action; clients still reconcile on reconnect.
  return null;
end;
$$;
drop trigger if exists listings_visibility_broadcast on public.listings;
create trigger listings_visibility_broadcast
  after update of status or delete on public.listings
  for each row execute function public.trg_listing_visibility_broadcast();

-- Which of these listing ids are no longer publicly visible (removed, deactivated or gone)? Used to heal caches.
create or replace function public.hidden_listing_ids(p_ids uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(i.id), '{}'::uuid[])
    from unnest(case when cardinality(p_ids) > 200 then p_ids[1:200] else p_ids end) as i(id)
   where not exists (select 1 from public.listings l where l.id = i.id and l.status not in ('removed', 'deactivated'));
$$;
grant execute on function public.hidden_listing_ids(uuid[]) to anon, authenticated;

do $$
begin
  begin alter publication supabase_realtime add table public.moderation_notices; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.support_cases; exception when duplicate_object then null; end;
end $$;

-- ============================================================================
-- 4. Retention (service role / scheduled job only — scheduling is a production step)
-- ============================================================================
-- Policy: moderation_events and admin_audit_log are kept (they are the accountability trail). Resolved/closed
-- support cases (with their messages and appeals) are deleted after p_older_than (default 24 months), and
-- notices the seller already read after 12 months.
create or replace function public.purge_old_support_data(p_older_than interval default interval '24 months')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cases int;
  v_notices int;
begin
  delete from public.support_cases where status in ('resolved', 'closed') and resolved_at < now() - p_older_than;
  get diagnostics v_cases = row_count;
  delete from public.moderation_notices where read_at is not null and read_at < now() - interval '12 months';
  get diagnostics v_notices = row_count;
  return jsonb_build_object('cases_deleted', v_cases, 'notices_deleted', v_notices);
end;
$$;
revoke execute on function public.purge_old_support_data(interval) from public, anon, authenticated;
