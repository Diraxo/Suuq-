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
