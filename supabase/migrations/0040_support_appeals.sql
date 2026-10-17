-- 0040 — Support cases, seller conversations and appeals (Phase 4).
--
-- NOT applied to any real database by this commit. Tested on PGlite (real PostgreSQL) by
-- supabase/tests/support.test.mjs. Rollback: supabase/rollback/0040_support_appeals_ROLLBACK.sql. Requires 0039.
--
-- Design:
--  * Support is its own channel (cases + messages). It never writes into buyer/seller chat conversations, and
--    staff never start a thread by themselves: a case exists only because the seller opened it (directly or
--    through an appeal). Moderation actions reach the seller as a NOTICE (0039), not as a chat message.
--  * Everything the seller sees from staff is signed "Suuqiye Support Team". Staff identities live in
--    staff-only tables (support_message_staff, support_case_assignments) — never in a seller-readable column.
--  * All writes go through SECURITY DEFINER RPCs; the tables have no client write policies.

-- ============================================================================
-- 1. Tables
-- ============================================================================
create table if not exists public.support_cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  subject text not null check (char_length(btrim(subject)) between 3 and 120),
  category text not null default 'general' check (category in ('general', 'appeal', 'account', 'listing')),
  status text not null default 'awaiting_staff' check (status in ('awaiting_staff', 'awaiting_user', 'resolved', 'closed')),
  listing_id uuid references public.listings (id) on delete set null,
  notice_id uuid references public.moderation_notices (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists support_cases_user_idx on public.support_cases (user_id, last_message_at desc);
create index if not exists support_cases_inbox_idx on public.support_cases (status, last_message_at desc);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_cases (id) on delete cascade,
  author_kind text not null check (author_kind in ('user', 'staff', 'system')),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  internal boolean not null default false,        -- staff-only note, never shown to the seller
  created_at timestamptz not null default clock_timestamp(),
  constraint support_internal_is_staff check (not internal or author_kind = 'staff')
);
create index if not exists support_messages_case_idx on public.support_messages (case_id, created_at);

create table if not exists public.support_message_staff (
  message_id uuid primary key references public.support_messages (id) on delete cascade,
  staff_id uuid not null references public.profiles (id) on delete cascade
);
create table if not exists public.support_case_assignments (
  case_id uuid primary key references public.support_cases (id) on delete cascade,
  staff_id uuid not null references public.profiles (id) on delete cascade,
  assigned_at timestamptz not null default now()
);

create table if not exists public.moderation_appeals (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.support_cases (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('listing', 'suspension', 'ban')),
  listing_id uuid references public.listings (id) on delete set null,
  event_id uuid references public.moderation_events (id) on delete set null,   -- the decision being appealed
  statement text not null check (char_length(btrim(statement)) between 10 and 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  decision_message text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
-- One open appeal per listing / per account decision.
create unique index if not exists moderation_appeals_one_pending_listing on public.moderation_appeals (listing_id) where status = 'pending' and kind = 'listing';
create unique index if not exists moderation_appeals_one_pending_account on public.moderation_appeals (user_id, kind) where status = 'pending' and kind in ('suspension', 'ban');
create index if not exists moderation_appeals_inbox_idx on public.moderation_appeals (status, created_at desc);

alter table public.support_cases enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_message_staff enable row level security;
alter table public.support_case_assignments enable row level security;
alter table public.moderation_appeals enable row level security;

drop policy if exists "sellers read own cases, staff read all" on public.support_cases;
create policy "sellers read own cases, staff read all" on public.support_cases
  for select using (auth.uid() = user_id or public.staff_can('support'));
drop policy if exists "sellers read public messages of own cases, staff read all" on public.support_messages;
create policy "sellers read public messages of own cases, staff read all" on public.support_messages
  for select using (
    public.staff_can('support')
    or (not internal and exists (select 1 from public.support_cases c where c.id = case_id and c.user_id = auth.uid()))
  );
drop policy if exists "staff read message authors" on public.support_message_staff;
create policy "staff read message authors" on public.support_message_staff for select using (public.staff_can('support'));
drop policy if exists "staff read assignments" on public.support_case_assignments;
create policy "staff read assignments" on public.support_case_assignments for select using (public.staff_can('support'));
drop policy if exists "sellers read own appeals, staff read all" on public.moderation_appeals;
create policy "sellers read own appeals, staff read all" on public.moderation_appeals
  for select using (auth.uid() = user_id or public.staff_can('support'));
-- No insert/update/delete policies anywhere: the RPCs below are the only write path.

-- Rate limits (function from 0039): cases 5/day, messages 30/hour, appeals 5/day. Restricted accounts are exempt
-- from the suspension gate for exactly these actions.
drop trigger if exists rate_limit_support_cases on public.support_cases;
create trigger rate_limit_support_cases before insert on public.support_cases for each row execute function public.trg_enforce_rate_limit('create_support_case');
create or replace function public.trg_support_message_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.author_kind = 'user' then
    perform public.enforce_rate_limit('create_support_message', 30, interval '1 hour');
  end if;
  return new;
end;
$$;
drop trigger if exists rate_limit_support_messages on public.support_messages;
create trigger rate_limit_support_messages before insert on public.support_messages for each row execute function public.trg_support_message_rate_limit();
drop trigger if exists rate_limit_appeals on public.moderation_appeals;
create trigger rate_limit_appeals before insert on public.moderation_appeals for each row execute function public.trg_enforce_rate_limit('create_appeal');

-- ============================================================================
-- 2. Seller-facing RPCs
-- ============================================================================
create or replace function public._notify_support_staff(p_title text, p_case uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, title, body, type, data)
  select a.user_id, 'Support', p_title, 'support_staff', jsonb_build_object('caseId', p_case)
    from public.admin_users a where a.role in ('admin', 'moderator', 'support');
$$;
revoke execute on function public._notify_support_staff(text, uuid) from public, anon, authenticated;

create or replace function public.support_open_case(
  p_subject text, p_body text, p_category text default 'general', p_listing_id uuid default null, p_notice_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_open int;
begin
  if v_uid is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if p_category not in ('general', 'account', 'listing') then
    raise exception 'Invalid category' using errcode = '22023';
  end if;
  if p_body is null or char_length(btrim(p_body)) < 1 or char_length(p_body) > 4000 then
    raise exception 'A message of 1-4000 characters is required' using errcode = '22023';
  end if;
  if p_listing_id is not null and not exists (select 1 from public.listings where id = p_listing_id and user_id = v_uid) then
    raise exception 'That listing is not yours' using errcode = '42501';
  end if;
  if p_notice_id is not null and not exists (select 1 from public.moderation_notices where id = p_notice_id and user_id = v_uid) then
    raise exception 'That notice is not yours' using errcode = '42501';
  end if;
  select count(*) into v_open from public.support_cases where user_id = v_uid and status in ('awaiting_staff', 'awaiting_user');
  if v_open >= 3 then
    raise exception 'You already have 3 open cases; please wait for a reply or add to an existing case' using errcode = 'P0001';
  end if;

  insert into public.support_cases (user_id, subject, category, listing_id, notice_id)
  values (v_uid, btrim(p_subject), p_category, p_listing_id, p_notice_id) returning id into v_id;
  insert into public.support_messages (case_id, author_kind, body) values (v_id, 'user', btrim(p_body));
  perform public._notify_support_staff('New support case', v_id);
  return v_id;
end;
$$;

create or replace function public.support_reply(p_case_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.support_cases%rowtype;
  v_msg uuid;
begin
  select * into v_c from public.support_cases where id = p_case_id and user_id = auth.uid() for update;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002';
  end if;
  if v_c.status = 'closed' or (v_c.status = 'resolved' and v_c.resolved_at < now() - interval '14 days') then
    raise exception 'This case is closed; please open a new one' using errcode = '23514';
  end if;
  if p_body is null or char_length(btrim(p_body)) < 1 or char_length(p_body) > 4000 then
    raise exception 'A message of 1-4000 characters is required' using errcode = '22023';
  end if;
  insert into public.support_messages (case_id, author_kind, body) values (p_case_id, 'user', btrim(p_body)) returning id into v_msg;
  update public.support_cases set status = 'awaiting_staff', resolved_at = null, updated_at = now(), last_message_at = now() where id = p_case_id;
  perform public._notify_support_staff('New reply on a support case', p_case_id);
  return v_msg;
end;
$$;

-- Appeals ---------------------------------------------------------------------------------------------------
create or replace function public.support_open_appeal(p_kind text, p_listing_id uuid, p_statement text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_listing public.listings%rowtype;
  v_event public.moderation_events%rowtype;
  v_notice uuid;
  v_case uuid;
  v_appeal uuid;
  v_subject text;
begin
  if v_uid is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if p_kind not in ('listing', 'suspension', 'ban') then
    raise exception 'Invalid appeal type' using errcode = '22023';
  end if;
  if p_statement is null or char_length(btrim(p_statement)) < 10 or char_length(p_statement) > 2000 then
    raise exception 'Please explain your appeal in 10-2000 characters' using errcode = '22023';
  end if;
  v_status := public.account_effective_status(v_uid);

  if p_kind = 'listing' then
    select * into v_listing from public.listings where id = p_listing_id and user_id = v_uid;
    if not found then
      raise exception 'Listing not found' using errcode = 'P0002';
    end if;
    if v_listing.status not in ('removed', 'deactivated') then
      raise exception 'Only a removed or deactivated listing can be appealed' using errcode = '23514';
    end if;
    select * into v_event from public.moderation_events
     where listing_id = v_listing.id and action in ('listing_removed', 'listing_deactivated') order by created_at desc, id desc limit 1;
    if found and v_event.metadata ->> 'cascade' = 'ban' then
      raise exception 'This listing was hidden because of an account ban; appeal the ban instead' using errcode = '23514';
    end if;
    if (select count(*) from public.moderation_appeals where listing_id = v_listing.id and status <> 'withdrawn') >= 2 then
      raise exception 'This listing has reached the maximum number of appeals' using errcode = '23514';
    end if;
    v_subject := 'Appeal: ' || left(v_listing.title, 90);
  elsif p_kind = 'suspension' then
    if v_status <> 'suspended' then
      raise exception 'Your account is not suspended' using errcode = '23514';
    end if;
    select * into v_event from public.moderation_events where user_id = v_uid and action = 'suspension' order by created_at desc, id desc limit 1;
    v_subject := 'Appeal: account suspension';
  else
    if v_status <> 'banned' then
      raise exception 'Your account is not banned' using errcode = '23514';
    end if;
    select * into v_event from public.moderation_events where user_id = v_uid and action = 'ban' order by created_at desc, id desc limit 1;
    v_subject := 'Appeal: account ban';
  end if;

  select id into v_notice from public.moderation_notices where event_id = v_event.id limit 1;

  insert into public.support_cases (user_id, subject, category, listing_id, notice_id)
  values (v_uid, v_subject, 'appeal', case when p_kind = 'listing' then p_listing_id end, v_notice) returning id into v_case;
  insert into public.support_messages (case_id, author_kind, body) values (v_case, 'user', btrim(p_statement));
  insert into public.moderation_appeals (case_id, user_id, kind, listing_id, event_id, statement)
  values (v_case, v_uid, p_kind, case when p_kind = 'listing' then p_listing_id end, v_event.id, btrim(p_statement)) returning id into v_appeal;
  perform public._notify_support_staff('New appeal', v_case);
  return v_appeal;
end;
$$;

create or replace function public.support_withdraw_appeal(p_appeal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case uuid;
begin
  update public.moderation_appeals set status = 'withdrawn', decided_at = now()
   where id = p_appeal_id and user_id = auth.uid() and status = 'pending' returning case_id into v_case;
  if not found then
    raise exception 'No pending appeal found' using errcode = 'P0002';
  end if;
  update public.support_cases set status = 'resolved', resolved_at = now(), updated_at = now(), last_message_at = now() where id = v_case;
  insert into public.support_messages (case_id, author_kind, body) values (v_case, 'system', 'You withdrew this appeal.');
end;
$$;

-- ============================================================================
-- 3. Staff RPCs
-- ============================================================================
create or replace function public.staff_support_reply(p_case_id uuid, p_body text, p_internal boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.support_cases%rowtype;
  v_msg uuid;
begin
  if not public.staff_can('support') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_c from public.support_cases where id = p_case_id for update;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002';
  end if;
  if v_c.status = 'closed' then
    raise exception 'Case is closed' using errcode = '23514';
  end if;
  if p_body is null or char_length(btrim(p_body)) < 1 or char_length(p_body) > 4000 then
    raise exception 'A message of 1-4000 characters is required' using errcode = '22023';
  end if;
  insert into public.support_messages (case_id, author_kind, body, internal) values (p_case_id, 'staff', btrim(p_body), coalesce(p_internal, false)) returning id into v_msg;
  insert into public.support_message_staff (message_id, staff_id) values (v_msg, auth.uid());
  insert into public.support_case_assignments (case_id, staff_id) values (p_case_id, auth.uid()) on conflict (case_id) do nothing;
  if not coalesce(p_internal, false) then
    update public.support_cases set status = 'awaiting_user', resolved_at = null, updated_at = now(), last_message_at = now() where id = p_case_id;
    insert into public.notifications (user_id, title, body, type, data)
    values (v_c.user_id, 'Suuqiye Support Team', 'Replied to your case', 'support_reply', jsonb_build_object('caseId', p_case_id));
  else
    update public.support_cases set updated_at = now() where id = p_case_id;
  end if;
  return v_msg;
end;
$$;

create or replace function public.staff_set_case_status(p_case_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.staff_can('support') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_status not in ('awaiting_staff', 'awaiting_user', 'resolved', 'closed') then
    raise exception 'Invalid case status' using errcode = '22023';
  end if;
  update public.support_cases
     set status = p_status, updated_at = now(), last_message_at = now(),
         resolved_at = case when p_status in ('resolved', 'closed') then now() else null end
   where id = p_case_id;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002';
  end if;
  if p_status in ('resolved', 'closed') then
    insert into public.support_messages (case_id, author_kind, body)
    values (p_case_id, 'system', case p_status when 'resolved' then 'Suuqiye Support Team marked this case as resolved.' else 'This case was closed.' end);
  end if;
  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason)
  values (auth.uid(), 'support_case_' || p_status, 'support_case', p_case_id::text, p_note);
end;
$$;

create or replace function public.staff_decide_appeal(p_appeal_id uuid, p_decision text, p_message text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a public.moderation_appeals%rowtype;
  v_perm text;
  v_action text;
  v_note text := 'Appeal ' || p_decision || 'd';
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'Decision must be approve or reject' using errcode = '22023';
  end if;
  select * into v_a from public.moderation_appeals where id = p_appeal_id for update;
  if not found then
    raise exception 'Appeal not found' using errcode = 'P0002';
  end if;
  v_perm := case v_a.kind when 'listing' then 'decide_appeal_listing' when 'suspension' then 'decide_appeal_suspension' else 'ban' end;
  if not public.staff_can(v_perm) then
    raise exception 'Not authorized to decide this appeal' using errcode = '42501';
  end if;
  if v_a.status <> 'pending' then
    raise exception 'This appeal was already decided' using errcode = '23505';
  end if;
  if p_message is not null and char_length(p_message) > 1000 then
    raise exception 'The message is too long' using errcode = '22023';
  end if;

  if p_decision = 'approve' then
    -- Reverse the original decision. The reversal itself is recorded but kept quiet: the seller gets ONE notice
    -- ("appeal approved"), not two.
    perform set_config('fursad.suppress_notice', 'true', true);
    if v_a.kind = 'listing' then
      perform public.admin_moderate_listing(v_a.listing_id, 'restore', v_note, null);
    elsif v_a.kind = 'suspension' then
      perform public.admin_moderate_user(v_a.user_id, 'lift_suspension', v_note, null);
    else
      perform public.admin_moderate_user(v_a.user_id, 'unban', v_note, null);
    end if;
    perform set_config('fursad.suppress_notice', '', true);
  end if;

  update public.moderation_appeals
     set status = case p_decision when 'approve' then 'approved' else 'rejected' end,
         decision_message = nullif(btrim(coalesce(p_message, '')), ''), decided_at = now()
   where id = p_appeal_id;

  perform public._moderation_record(auth.uid(), case p_decision when 'approve' then 'appeal_approved' else 'appeal_rejected' end,
                                    v_a.user_id, v_a.listing_id, null, v_note, p_message, null, null, null,
                                    jsonb_build_object('appeal_id', p_appeal_id, 'kind', v_a.kind,
                                                       'title', (select title from public.listings where id = v_a.listing_id)));
  update public.support_cases set status = 'resolved', resolved_at = now(), updated_at = now(), last_message_at = now() where id = v_a.case_id;
  insert into public.support_messages (case_id, author_kind, body)
  values (v_a.case_id, 'system', case p_decision when 'approve' then 'Your appeal was approved.' else 'Your appeal was reviewed and the original decision was kept.' end);
  if nullif(btrim(coalesce(p_message, '')), '') is not null then
    -- Shown in the case thread too; no extra notification (the decision notice already carries this text).
    with m as (insert into public.support_messages (case_id, author_kind, body) values (v_a.case_id, 'staff', btrim(p_message)) returning id)
    insert into public.support_message_staff (message_id, staff_id) select id, auth.uid() from m;
  end if;
end;
$$;

grant execute on function
  public.support_open_case(text, text, text, uuid, uuid), public.support_reply(uuid, text), public.support_open_appeal(text, uuid, text),
  public.support_withdraw_appeal(uuid), public.staff_support_reply(uuid, text, boolean), public.staff_set_case_status(uuid, text, text),
  public.staff_decide_appeal(uuid, text, text)
to authenticated;
revoke execute on function
  public.support_open_case(text, text, text, uuid, uuid), public.support_reply(uuid, text), public.support_open_appeal(text, uuid, text),
  public.support_withdraw_appeal(uuid), public.staff_support_reply(uuid, text, boolean), public.staff_set_case_status(uuid, text, text),
  public.staff_decide_appeal(uuid, text, text)
from anon, public;
