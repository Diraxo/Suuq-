-- Production security hardening pass. Fixes, in order:
--   1. send-push-notification had zero caller authentication (any request
--      with a guessed/known function URL could push arbitrary FCM
--      notifications to any user). Now the DB trigger sends a shared secret
--      header that only Postgres can read, and the function (updated
--      separately) rejects requests that don't present it.
--   2. reviews could be UPDATEd to retarget seller_id/reviewer_id onto an
--      arbitrary other profile — now blocked by a trigger, and a
--      reviewer/seller pair is limited to one review (edit it instead of
--      spamming new ones — mirrors "one review per transaction").
--   3. listings.views / listings.favorites_count were directly writable by
--      the listing owner via a normal UPDATE — both are meant to be
--      maintained only by increment_listing_views()/handle_favorite_change().
--   4. notifications had a single "for all" policy, so a client could INSERT
--      arbitrary fake notification rows for themselves and UPDATE any
--      column, not just `read`. Notifications are only ever written
--      server-side (service-role / SECURITY DEFINER functions, which bypass
--      RLS) — client access is now read + mark-as-read + delete-own only.
--   5. Server-side rate limiting for the write paths named in the hardening
--      brief (listings, offers, reviews, favorites, follows, profile
--      updates) — previously nothing enforced this anywhere.
--   6. Defensive max-length CHECK constraints on free-text columns that
--      previously had none (added NOT VALID so this migration can't fail
--      against unknown existing data — see note at the bottom).
--
-- MANUAL STEP REQUIRED after this migration runs — the push notification fix
-- is fail-closed (rejects everything) until you complete it:
--   1. In the Supabase SQL editor, run:
--        select value from private.settings where key = 'push_webhook_secret';
--   2. supabase secrets set PUSH_WEBHOOK_SECRET=<that value>
--   3. Redeploy send-push-notification (the code change lives in this same commit).

-- ============================================================================
-- 1. Authenticated push-notification webhook
-- ============================================================================
create schema if not exists private;

-- Outside `public`, no RLS policy grants any role access to it — reachable
-- only by a SECURITY DEFINER function running as the table owner. Never
-- exposed via PostgREST (schema isn't in the exposed-schemas list).
create table if not exists private.settings (
  key text primary key,
  value text not null
);
alter table private.settings enable row level security;

insert into private.settings (key, value)
values (
  'push_webhook_secret',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
on conflict (key) do nothing;

create or replace function public.notify_push_webhook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select value into v_secret from private.settings where key = 'push_webhook_secret';

  perform net.http_post(
    url := 'https://waksddinkjbrggxkfofk.functions.supabase.co/send-push-notification',
    body := jsonb_build_object('record', to_jsonb(new)),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Push-Webhook-Secret', coalesce(v_secret, '')
    ),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;

drop trigger if exists on_notification_insert_push on public.notifications;
create trigger on_notification_insert_push
  after insert on public.notifications
  for each row execute function public.notify_push_webhook();

-- ============================================================================
-- 2. reviews: immutable reviewer/seller, one review per seller relationship
-- ============================================================================
create or replace function public.prevent_review_retarget()
returns trigger
language plpgsql
as $$
begin
  if new.reviewer_id <> old.reviewer_id or new.seller_id <> old.seller_id then
    raise exception 'reviewer_id and seller_id cannot be changed on an existing review';
  end if;
  return new;
end;
$$;

drop trigger if exists reviews_prevent_retarget on public.reviews;
create trigger reviews_prevent_retarget
  before update on public.reviews
  for each row execute function public.prevent_review_retarget();

do $$
begin
  if exists (
      select 1
      from pg_constraint
      where conname = 'reviews_one_per_seller'
  ) then
      raise notice 'reviews_one_per_seller already exists';
  elsif exists (
      select 1
      from public.reviews
      group by reviewer_id, seller_id
      having count(*) > 1
  ) then
      raise notice 'Duplicate reviews exist. Constraint not added.';
  else
      alter table public.reviews
      add constraint reviews_one_per_seller
      unique (reviewer_id, seller_id);
  end if;
end $$;

-- ============================================================================
-- 3. listings: only the counter functions may write views / favorites_count
-- ============================================================================
revoke update (views, favorites_count) on public.listings from authenticated;

-- ============================================================================
-- 4. notifications: read/mark-read/delete-own only, no client insert/spoof
-- ============================================================================
drop policy if exists "users manage their own notifications" on public.notifications;

drop policy if exists "users can read their own notifications" on public.notifications;
drop policy if exists "users can update their own notifications" on public.notifications;
drop policy if exists "users can delete their own notifications" on public.notifications;

create policy "users can read their own notifications"
on public.notifications
for select
using (auth.uid() = user_id);

create policy "users can update their own notifications"
on public.notifications
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "users can delete their own notifications"
on public.notifications
for delete
using (auth.uid() = user_id);

revoke update (id, user_id, title, body, type, data, created_at) on public.notifications from authenticated;
grant update (read) on public.notifications to authenticated;

-- ============================================================================
-- 5. Rate limiting
-- ============================================================================
-- No RLS policies granted here either — same "SECURITY DEFINER function is
-- the only door" pattern as private.settings above, just kept in `public`
-- because it doesn't need to be hidden, just untouchable directly.
create table if not exists public.rate_limit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  action text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_events_lookup_idx
  on public.rate_limit_events (user_id, action, created_at desc);

alter table public.rate_limit_events enable row level security;

create or replace function public.enforce_rate_limit(p_action text, p_max_count int, p_window interval)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  -- No JWT on the connection (service-role / migration-time writes) isn't a
  -- rate-limitable end-user action.
  if auth.uid() is null then
    return;
  end if;

  select count(*) into v_count
    from public.rate_limit_events
   where user_id = auth.uid()
     and action = p_action
     and created_at > now() - p_window;

  if v_count >= p_max_count then
    raise exception 'Rate limit exceeded for "%": try again later.', p_action
      using errcode = 'P0001';
  end if;

  insert into public.rate_limit_events (user_id, action) values (auth.uid(), p_action);

  -- Opportunistic prune instead of a pg_cron job — cheap, bounded table growth.
  if random() < 0.002 then
    delete from public.rate_limit_events where created_at < now() - interval '2 days';
  end if;
end;
$$;

grant execute on function public.enforce_rate_limit(text, int, interval) to authenticated;

create or replace function public.trg_enforce_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  case tg_argv[0]
    when 'create_listing' then perform public.enforce_rate_limit('create_listing', 10, interval '1 hour');
    when 'create_offer' then perform public.enforce_rate_limit('create_offer', 20, interval '1 hour');
    when 'create_review' then perform public.enforce_rate_limit('create_review', 10, interval '1 day');
    when 'create_favorite' then perform public.enforce_rate_limit('create_favorite', 60, interval '1 minute');
    when 'create_follow' then perform public.enforce_rate_limit('create_follow', 30, interval '1 minute');
    when 'update_profile' then perform public.enforce_rate_limit('update_profile', 20, interval '1 hour');
    else raise exception 'trg_enforce_rate_limit: unknown action %', tg_argv[0];
  end case;
  return new;
end;
$$;

drop trigger if exists rate_limit_listings on public.listings;
create trigger rate_limit_listings
  before insert on public.listings
  for each row execute function public.trg_enforce_rate_limit('create_listing');

drop trigger if exists rate_limit_offers on public.offers;
create trigger rate_limit_offers
  before insert on public.offers
  for each row execute function public.trg_enforce_rate_limit('create_offer');

drop trigger if exists rate_limit_reviews on public.reviews;
create trigger rate_limit_reviews
  before insert on public.reviews
  for each row execute function public.trg_enforce_rate_limit('create_review');

drop trigger if exists rate_limit_favorites on public.favorites;
create trigger rate_limit_favorites
  before insert on public.favorites
  for each row execute function public.trg_enforce_rate_limit('create_favorite');

drop trigger if exists rate_limit_followers on public.followers;
create trigger rate_limit_followers
  before insert on public.followers
  for each row execute function public.trg_enforce_rate_limit('create_follow');

drop trigger if exists rate_limit_profile_updates on public.profiles;
create trigger rate_limit_profile_updates
  before update on public.profiles
  for each row execute function public.trg_enforce_rate_limit('update_profile');

-- ============================================================================
-- 6. Defensive max-length constraints (added NOT VALID: applies to all new
--    writes immediately without scanning/failing on existing rows — run
--    `alter table ... validate constraint ...` later once historic data is
--    confirmed clean, e.g. `alter table public.listings validate constraint
--    listings_title_length;`)
-- ============================================================================
alter table public.listings
  add constraint listings_title_length check (char_length(title) <= 200) not valid,
  add constraint listings_description_length check (description is null or char_length(description) <= 5000) not valid;

alter table public.profiles
  add constraint profiles_full_name_length check (full_name is null or char_length(full_name) <= 100) not valid,
  add constraint profiles_business_name_length check (business_name is null or char_length(business_name) <= 150) not valid,
  add constraint profiles_bio_length check (bio is null or char_length(bio) <= 1000) not valid;

alter table public.offers
  add constraint offers_message_length check (message is null or char_length(message) <= 1000) not valid;

alter table public.reviews
  add constraint reviews_comment_length check (comment is null or char_length(comment) <= 2000) not valid;
