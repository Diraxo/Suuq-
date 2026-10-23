-- 0055 — account-deletion ledger for Supabase Storage objects (blocker B1). LOCAL ONLY, UNAPPLIED. Depends on 0054 (reads
-- storefront_verification_requests). Not designed to be re-run.
--
-- Problem: deleting auth.users cascades away storefront_verification_requests, the only index of the identity documents in the
-- private bucket `storefront-verification`, and Storage has no FK to the user, so the files would be orphaned. This ledger records
-- WHAT to delete BEFORE the cascade, outside the cascade path (no FK to auth.users / profiles), and lets a retryable drain finish
-- the work. Everything is service-role only: no policy and no grant for anon/authenticated.
--
-- Flow (supabase/functions/delete-account + _shared/deletionLedger.ts):
--   collect -> begin (job 'awaiting_account_delete') -> delete the auth user -> re-collect + begin (adds late uploads)
--   -> mark_user_deleted ('pending') -> claim -> remove objects -> record -> finish ('completed' | 'pending' + backoff | 'escalated').
-- If deleting the auth user fails the job is cancelled and nothing is removed. A crash between begin and mark is reconciled by claim().
--
-- NOT DECIDED (docs/STOREFRONTS_0054_OWNER_DECISIONS.md B1.2/B1.3/B1.5): retry cadence + escalation count are PARAMETERS with
-- proposed defaults (5 attempts, 2^n minutes capped at 6 h); who is notified; whether job rows (which keep user_id) are retained or
-- purged and for how long. Nothing here purges job rows. No retention/legal-hold logic (B3) is implemented or assumed.

create table public.account_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,                       -- deliberately NO foreign key: this row must survive the account
  status text not null default 'awaiting_account_delete'
    check (status in ('awaiting_account_delete', 'pending', 'in_progress', 'completed', 'cancelled', 'escalated')),
  attempts int not null default 0,             -- drain attempts (claims)
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,                     -- while in_progress; an expired lease is reclaimable (crashed worker)
  last_error text check (last_error is null or char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  auth_deleted_at timestamptz,
  completed_at timestamptz,
  escalated_at timestamptz
);
-- One OPEN job per user: concurrent or repeated requests converge on the same job instead of duplicating destructive work.
create unique index account_deletion_one_open_job on public.account_deletion_jobs (user_id)
  where status in ('awaiting_account_delete', 'pending', 'in_progress', 'escalated');
create index account_deletion_due_idx on public.account_deletion_jobs (status, next_attempt_at);

create table public.account_deletion_objects (
  job_id uuid not null references public.account_deletion_jobs (id) on delete cascade,
  bucket text not null,
  name text not null,                          -- scrubbed to a sha256 hex digest when the job completes
  state text not null default 'pending' check (state in ('pending', 'deleted', 'failed')),
  attempts int not null default 0,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  scrubbed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (job_id, bucket, name)
);

alter table public.account_deletion_jobs enable row level security;
alter table public.account_deletion_objects enable row level security;
revoke all on public.account_deletion_jobs, public.account_deletion_objects from public, anon, authenticated;
-- (no policies: only the service role, which bypasses RLS, can touch them)

-- Object names this user has in the private verification bucket: what Storage actually holds (covers uploads that were never
-- attached to a request) UNION what requests reference. Only names inside the user's own folder are returned.
create or replace function public.account_deletion_collect_verification_paths(p_user uuid)
returns text[]
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct n order by n), '{}'::text[]) from (
    select o.name as n from storage.objects o
     where o.bucket_id = 'storefront-verification' and o.name like p_user::text || '/%'
    union
    select d from public.storefront_verification_requests r, unnest(r.document_paths) d
     where r.owner_id = p_user and d like p_user::text || '/%'
  ) s;
$$;

-- Registers (or extends) the single open job for the user. p_objects = [{"bucket":..,"name":..}, ...]. Every name must sit inside
-- the user's own folder (<uid>/...) with no traversal, so a bug upstream can never queue someone else's files for deletion.
create or replace function public.account_deletion_begin(p_user uuid, p_objects jsonb)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_job uuid; v_o jsonb;
begin
  if p_user is null then raise exception 'user required' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_objects, '[]'::jsonb)) <> 'array' then raise exception 'objects must be an array' using errcode = '22023'; end if;
  for v_o in select * from jsonb_array_elements(coalesce(p_objects, '[]'::jsonb)) loop
    if coalesce(v_o ->> 'bucket', '') = '' or coalesce(v_o ->> 'name', '') = ''
       or (v_o ->> 'name') not like p_user::text || '/%' or (v_o ->> 'name') like '%..%' or (v_o ->> 'name') like '%//%' then
      raise exception 'object outside the user folder' using errcode = '22023';
    end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('account_deletion:' || p_user::text, 0));
  select id into v_job from public.account_deletion_jobs
   where user_id = p_user and status in ('awaiting_account_delete', 'pending', 'in_progress', 'escalated');
  if v_job is null then
    insert into public.account_deletion_jobs (user_id) values (p_user) returning id into v_job;
  end if;
  insert into public.account_deletion_objects (job_id, bucket, name)
    select v_job, e ->> 'bucket', e ->> 'name' from jsonb_array_elements(coalesce(p_objects, '[]'::jsonb)) e
    on conflict do nothing;
  return v_job;
end;
$$;

-- The auth user is gone: make the job drainable.
create or replace function public.account_deletion_mark_user_deleted(p_job uuid)
returns void
language sql security definer set search_path = public, pg_temp
as $$
  update public.account_deletion_jobs set status = 'pending', auth_deleted_at = coalesce(auth_deleted_at, now()), next_attempt_at = now()
   where id = p_job and status = 'awaiting_account_delete';
$$;

-- deleteUser failed: nothing may be removed. Refuses if the auth user no longer exists (then it is not a cancellation).
create or replace function public.account_deletion_cancel(p_job uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid;
begin
  select user_id into v_user from public.account_deletion_jobs where id = p_job and status = 'awaiting_account_delete' for update;
  if not found then return; end if;
  if not exists (select 1 from auth.users where id = v_user) then raise exception 'account already deleted; cannot cancel' using errcode = '55000'; end if;
  update public.account_deletion_jobs set status = 'cancelled', completed_at = now() where id = p_job;
end;
$$;

-- Claims drainable work. p_job = that job only (the delete request draining its own job), null = every due job (scheduled drain).
-- FOR UPDATE SKIP LOCKED + a lease: concurrent callers never get the same job; a crashed worker's lease expires.
-- First reconciles 'awaiting' jobs older than 15 minutes (crash between begin and mark): account still exists -> cancelled, gone -> pending.
create or replace function public.account_deletion_claim(p_job uuid default null, p_limit int default 10, p_lease interval default interval '5 minutes')
returns table (job_id uuid, user_id uuid, bucket text, name text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record;
begin
  for r in select j.id, j.user_id from public.account_deletion_jobs j
            where j.status = 'awaiting_account_delete' and j.created_at < now() - interval '15 minutes' for update skip locked loop
    if exists (select 1 from auth.users u where u.id = r.user_id) then
      update public.account_deletion_jobs set status = 'cancelled', completed_at = now() where id = r.id;
    else
      update public.account_deletion_jobs set status = 'pending', auth_deleted_at = now(), next_attempt_at = now() where id = r.id;
    end if;
  end loop;

  return query
  with picked as (
    select j.id from public.account_deletion_jobs j
     where (p_job is null or j.id = p_job)
       and ((j.status = 'pending' and j.next_attempt_at <= now()) or (j.status = 'in_progress' and j.lease_until < now()))
     order by j.next_attempt_at
     limit greatest(p_limit, 1)
     for update skip locked
  ), claimed as (
    update public.account_deletion_jobs j set status = 'in_progress', attempts = j.attempts + 1, lease_until = now() + p_lease
      from picked where j.id = picked.id
    returning j.id, j.user_id
  )
  select c.id, c.user_id, o.bucket, o.name
    from claimed c join public.account_deletion_objects o on o.job_id = c.id and o.state <> 'deleted';
end;
$$;

-- Per-object results from a drain. p_results = [{"bucket":..,"name":..,"ok":true|false,"error":".."}]. Only for a claimed job.
create or replace function public.account_deletion_record(p_job uuid, p_results jsonb)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.account_deletion_jobs where id = p_job and status = 'in_progress') then
    raise exception 'job is not in progress' using errcode = '55000';
  end if;
  update public.account_deletion_objects o
     set state = case when (e ->> 'ok')::boolean then 'deleted' else 'failed' end,
         attempts = o.attempts + 1,
         last_error = case when (e ->> 'ok')::boolean then null else left(coalesce(e ->> 'error', 'unknown'), 300) end,
         updated_at = now()
    from jsonb_array_elements(p_results) e
   where o.job_id = p_job and o.bucket = e ->> 'bucket' and o.name = e ->> 'name';
end;
$$;

-- Settles a claimed job. Completed ONLY when no object is left undeleted. Otherwise back to pending with exponential backoff, or
-- escalated once the attempt ceiling is hit. Returns the new status.
create or replace function public.account_deletion_finish(p_job uuid, p_max_attempts int default 5)
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare j public.account_deletion_jobs%rowtype; v_left int; v_err text;
begin
  select * into j from public.account_deletion_jobs where id = p_job and status = 'in_progress' for update;
  if not found then raise exception 'job is not in progress' using errcode = '55000'; end if;
  select count(*), max(last_error) into v_left, v_err from public.account_deletion_objects where job_id = p_job and state <> 'deleted';
  if v_left = 0 then
    update public.account_deletion_objects set name = encode(sha256(convert_to(name, 'UTF8')), 'hex'), scrubbed = true where job_id = p_job and not scrubbed;
    update public.account_deletion_jobs set status = 'completed', completed_at = now(), lease_until = null, last_error = null where id = p_job;
    return 'completed';
  elsif j.attempts >= p_max_attempts then
    update public.account_deletion_jobs set status = 'escalated', escalated_at = now(), lease_until = null, last_error = left(v_err, 300) where id = p_job;
    return 'escalated';
  else
    update public.account_deletion_jobs
       set status = 'pending', lease_until = null, last_error = left(v_err, 300),
           next_attempt_at = now() + least(interval '6 hours', power(2, least(j.attempts, 10))::int * interval '1 minute')
     where id = p_job;
    return 'pending';
  end if;
end;
$$;

-- Operator action after fixing the cause of an escalation.
create or replace function public.account_deletion_requeue(p_job uuid)
returns void
language sql security definer set search_path = public, pg_temp
as $$
  update public.account_deletion_jobs set status = 'pending', attempts = 0, escalated_at = null, next_attempt_at = now()
   where id = p_job and status = 'escalated';
$$;

-- Operator view: counts only.
create or replace function public.account_deletion_report()
returns table (status text, jobs bigint, oldest timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  select status, count(*), min(created_at) from public.account_deletion_jobs group by status order by status;
$$;

revoke execute on function
  public.account_deletion_collect_verification_paths(uuid), public.account_deletion_begin(uuid, jsonb),
  public.account_deletion_mark_user_deleted(uuid), public.account_deletion_cancel(uuid),
  public.account_deletion_claim(uuid, int, interval), public.account_deletion_record(uuid, jsonb),
  public.account_deletion_finish(uuid, int), public.account_deletion_requeue(uuid), public.account_deletion_report()
  from public, anon, authenticated;
grant execute on function
  public.account_deletion_collect_verification_paths(uuid), public.account_deletion_begin(uuid, jsonb),
  public.account_deletion_mark_user_deleted(uuid), public.account_deletion_cancel(uuid),
  public.account_deletion_claim(uuid, int, interval), public.account_deletion_record(uuid, jsonb),
  public.account_deletion_finish(uuid, int), public.account_deletion_requeue(uuid), public.account_deletion_report()
  to service_role;

-- Rollback (manual; loses any in-flight cleanup state, so only when no job is pending/escalated):
--   drop table public.account_deletion_objects; drop table public.account_deletion_jobs;
--   drop function public.account_deletion_collect_verification_paths(uuid), ... (all nine above);
