-- 0058 — backfill/reconciliation of EXISTING business logos and banners. LOCAL ONLY, UNAPPLIED. Depends on 0054 (storefronts, managed hosts)
-- and 0057 (business_media_scans, _bm_url_ok).
--
-- Why: images uploaded before the scanner existed were never checked (docs/STOREFRONTS_0054_OWNER_DECISIONS.md "Not covered"). This is the
-- state machine that rescans them through the SAME Worker pipeline as new uploads. It is a service-role tool, off by default and driven by
-- scripts/business-media-backfill.mjs (dry run unless told otherwise).
--
-- Guarantees (each is tested in supabase/tests/business_media_backfill.test.mjs):
--   * inventory is read-only on profiles/storefronts and idempotent; it records each slot's ORIGINAL url/key so the prior state is recoverable;
--   * a slot already backed by an approved scan is skipped; a third-party URL-only value is parked as 'external' and NEVER fetched (SSRF);
--   * work is claimed once (lease + skip locked); a crashed claim is recovered when its lease expires;
--   * only an APPROVED scan row that matches owner, kind, key and a managed host can be recorded as approved, and only that can be applied;
--   * apply is compare-and-swap: if the owner replaced the image meanwhile the row becomes 'superseded' and nothing is overwritten;
--   * rejected / held / missing / unreadable outcomes are REPORT-ONLY: the slot is not changed and no object is deleted. What to do with
--     them is an owner decision that has not been taken;
--   * nothing here deletes anything. The superseded legacy object stays where it is until the deletion lifecycle (P1/P2, unbuilt) exists.
--
-- Not applied to clients: no grant, no API role can read or write any of it except staff SELECT through RLS.

create table public.business_media_backfill (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('profile', 'storefront')),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('logo', 'banner')),
  original_url text,
  original_key text,
  original_ref text generated always as (coalesce(original_key, original_url)) stored,
  status text not null default 'pending'
    check (status in ('pending', 'scanning', 'approved', 'rejected', 'held', 'unavailable', 'missing', 'unreadable', 'external', 'applied', 'superseded', 'escalated')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  scan_id uuid references public.business_media_scans (id) on delete set null,
  new_key text,
  new_url text,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (source, owner_id, kind, original_ref)
);
create index business_media_backfill_due_idx on public.business_media_backfill (status, next_attempt_at);

alter table public.business_media_backfill enable row level security;
revoke all on public.business_media_backfill from anon;
revoke insert, update, delete on public.business_media_backfill from authenticated;
create policy "staff read business media backfill" on public.business_media_backfill for select using (public.staff_can('moderate_listing'));

-- What the slot holds RIGHT NOW (key if present, else url). null = empty.
create or replace function public._bmb_current_ref(p_source text, p_owner uuid, p_kind text)
returns text language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when p_source = 'profile' and p_kind = 'logo' then (select coalesce(business_logo_public_id, business_logo_url) from public.profiles where id = p_owner)
    when p_source = 'profile' and p_kind = 'banner' then (select coalesce(business_banner_public_id, business_banner_url) from public.profiles where id = p_owner)
    when p_source = 'storefront' and p_kind = 'logo' then (select coalesce(logo_public_id, logo_url) from public.storefronts where owner_id = p_owner)
    when p_source = 'storefront' and p_kind = 'banner' then (select coalesce(banner_public_id, banner_url) from public.storefronts where owner_id = p_owner)
  end;
$$;

-- Queues every unscanned slot. Returns how many new rows were queued for scanning and how many were parked as external.
create or replace function public.business_media_backfill_inventory()
returns table (queued int, external int)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  return query
  with slots as (
    select 'profile'::text src, p.id owner, 'logo'::text kind, p.business_logo_url url, p.business_logo_public_id key from public.profiles p
    union all select 'profile', p.id, 'banner', p.business_banner_url, p.business_banner_public_id from public.profiles p
    union all select 'storefront', s.owner_id, 'logo', s.logo_url, s.logo_public_id from public.storefronts s
    union all select 'storefront', s.owner_id, 'banner', s.banner_url, s.banner_public_id from public.storefronts s
  ), todo as (
    select * from slots t
     where (t.key is not null or t.url is not null)
       and not exists (select 1 from public.business_media_scans sc where sc.user_id = t.owner and sc.kind = t.kind and sc.status = 'approved' and sc.public_key = t.key)
  ), ins as (
    insert into public.business_media_backfill (source, owner_id, kind, original_url, original_key, status)
    select t.src, t.owner, t.kind, t.url, t.key,
           case when t.key ~ ('^business/' || t.owner::text || '/' || t.kind || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$') then 'pending' else 'external' end
      from todo t
    on conflict (source, owner_id, kind, original_ref) do nothing
    returning status
  )
  select (count(*) filter (where status = 'pending'))::int, (count(*) filter (where status = 'external'))::int from ins;
end;
$$;

-- Hands out due work. Also settles rows whose slot changed since inventory ('superseded') and rows out of attempts ('escalated').
create or replace function public.business_media_backfill_claim(p_limit int default 10, p_lease interval default interval '10 minutes', p_max_attempts int default 5)
returns table (id uuid, owner_id uuid, kind text, original_key text, source text)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.business_media_backfill b set status = 'superseded', lease_until = null, updated_at = now()
   where b.status in ('pending', 'unavailable', 'scanning') and (b.status <> 'scanning' or b.lease_until < now())
     and public._bmb_current_ref(b.source, b.owner_id, b.kind) is distinct from b.original_ref;
  update public.business_media_backfill b set status = 'escalated', lease_until = null, updated_at = now(),
         last_error = coalesce(b.last_error, 'attempt limit reached')
   where b.status = 'scanning' and b.lease_until < now() and b.attempts >= p_max_attempts;

  return query
  with picked as (
    select b.id from public.business_media_backfill b
     where b.attempts < p_max_attempts
       and ((b.status = 'pending' and b.next_attempt_at <= now())
         or (b.status = 'unavailable' and b.next_attempt_at <= now())
         or (b.status = 'scanning' and b.lease_until < now()))
     order by b.created_at, b.id
     limit greatest(p_limit, 1)
     for update skip locked
  ), claimed as (
    update public.business_media_backfill b set status = 'scanning', attempts = b.attempts + 1, lease_until = now() + p_lease, updated_at = now()
      from picked where b.id = picked.id
    returning b.id, b.owner_id, b.kind, b.original_key, b.source
  )
  select c.id, c.owner_id, c.kind, c.original_key, c.source from claimed c;
end;
$$;

-- The Worker's answer for a claimed row. 'approved' is accepted only for a matching approved scan on a managed host.
create or replace function public.business_media_backfill_record(
  p_id uuid, p_status text, p_scan_id uuid, p_new_key text, p_new_url text, p_error text, p_max_attempts int default 5)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare b public.business_media_backfill%rowtype;
begin
  if p_status not in ('approved', 'rejected', 'held', 'unavailable', 'missing', 'unreadable') then
    raise exception 'unknown outcome' using errcode = '22023';
  end if;
  select * into b from public.business_media_backfill where id = p_id for update;
  if not found or b.status <> 'scanning' then raise exception 'row is not being scanned' using errcode = '55000'; end if;

  if p_status = 'approved' then
    if p_scan_id is null or not exists (
         select 1 from public.business_media_scans s
          where s.id = p_scan_id and s.status = 'approved' and s.user_id = b.owner_id and s.kind = b.kind and s.public_key = p_new_key) then
      raise exception 'approved scan does not match this row' using errcode = '22023';
    end if;
    if not public._bm_url_ok(p_new_url, p_new_key) then raise exception 'new url is not on a managed media host' using errcode = '22023'; end if;
    update public.business_media_backfill set status = 'approved', scan_id = p_scan_id, new_key = p_new_key, new_url = p_new_url,
           lease_until = null, last_error = null, updated_at = now() where id = p_id;
  elsif p_status = 'unavailable' then
    if b.attempts >= p_max_attempts then
      update public.business_media_backfill set status = 'escalated', lease_until = null, last_error = left(coalesce(p_error, 'unavailable'), 300), updated_at = now() where id = p_id;
    else
      update public.business_media_backfill set status = 'unavailable', lease_until = null, last_error = left(coalesce(p_error, 'unavailable'), 300), updated_at = now(),
             next_attempt_at = now() + least(interval '6 hours', power(2, least(b.attempts, 10))::int * interval '1 minute') where id = p_id;
    end if;
  else
    update public.business_media_backfill set status = p_status, lease_until = null, last_error = left(p_error, 300), updated_at = now() where id = p_id;
  end if;
end;
$$;

-- Swaps ONE slot to the scanned copy. Returns: applied | already_applied | not_approved | superseded.
create or replace function public.business_media_backfill_apply(p_id uuid)
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare b public.business_media_backfill%rowtype;
begin
  select * into b from public.business_media_backfill where id = p_id for update;
  if not found then return 'not_approved'; end if;
  if b.status = 'applied' then return 'already_applied'; end if;
  if b.status <> 'approved' then return 'not_approved'; end if;
  -- the approval must still stand and still match
  if not exists (select 1 from public.business_media_scans s where s.id = b.scan_id and s.status = 'approved' and s.user_id = b.owner_id and s.kind = b.kind and s.public_key = b.new_key)
     or not public._bm_url_ok(b.new_url, b.new_key) then
    return 'not_approved';
  end if;
  -- compare-and-swap: only if the owner still holds exactly what we scanned
  if public._bmb_current_ref(b.source, b.owner_id, b.kind) is distinct from b.original_ref then
    update public.business_media_backfill set status = 'superseded', updated_at = now() where id = p_id;
    return 'superseded';
  end if;

  if b.source = 'profile' and b.kind = 'logo' then
    update public.profiles set business_logo_url = b.new_url, business_logo_public_id = b.new_key where id = b.owner_id;
  elsif b.source = 'profile' then
    update public.profiles set business_banner_url = b.new_url, business_banner_public_id = b.new_key where id = b.owner_id;
  elsif b.kind = 'logo' then
    update public.storefronts set logo_url = b.new_url, logo_public_id = b.new_key where owner_id = b.owner_id;
  else
    update public.storefronts set banner_url = b.new_url, banner_public_id = b.new_key where owner_id = b.owner_id;
  end if;
  update public.business_media_backfill set status = 'applied', applied_at = now(), updated_at = now() where id = p_id;
  return 'applied';
end;
$$;

-- Operator: put stuck rows back in the queue after the cause is fixed. Returns how many.
create or replace function public.business_media_backfill_requeue(p_status text)
returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare n int;
begin
  if p_status not in ('escalated', 'unavailable') then raise exception 'only escalated or unavailable rows can be requeued' using errcode = '22023'; end if;
  update public.business_media_backfill set status = 'pending', attempts = 0, next_attempt_at = now(), lease_until = null, updated_at = now() where status = p_status;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Operator view: counts only.
create or replace function public.business_media_backfill_report()
returns table (status text, rows bigint, oldest timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  select status, count(*), min(created_at) from public.business_media_backfill group by status order by status;
$$;

revoke execute on function
  public._bmb_current_ref(text, uuid, text), public.business_media_backfill_inventory(), public.business_media_backfill_claim(int, interval, int),
  public.business_media_backfill_record(uuid, text, uuid, text, text, text, int), public.business_media_backfill_apply(uuid),
  public.business_media_backfill_requeue(text), public.business_media_backfill_report()
  from public, anon, authenticated;
grant execute on function
  public._bmb_current_ref(text, uuid, text), public.business_media_backfill_inventory(), public.business_media_backfill_claim(int, interval, int),
  public.business_media_backfill_record(uuid, text, uuid, text, text, text, int), public.business_media_backfill_apply(uuid),
  public.business_media_backfill_requeue(text), public.business_media_backfill_report()
  to service_role;
