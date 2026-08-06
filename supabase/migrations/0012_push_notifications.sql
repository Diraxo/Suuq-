-- Suuq+ follow-up schema: Firebase Cloud Messaging push notifications.
-- Run once in the Supabase SQL Editor after 0001-0011.
--
-- Does NOT replace the in-app notifications system (table/Realtime/RLS from
-- 0001 + 0004 stay exactly as they are) — this migration only:
--   1. tags every notification row with a `type` + structured `data` so the
--      client can deep-link and the edge function can respect preferences,
--   2. adds `device_tokens` (one row per signed-in device) and
--      `notification_preferences` (one row per user),
--   3. extends the existing trigger/RPC functions that already insert into
--      `public.notifications` to also set type/data (no new triggers for
--      these — same functions, `create or replace`),
--   4. adds the two notification inserts `cancel_offer`/`expire_stale_offers`
--      never had, and a review-edit notification `reviews` never had,
--   5. adds one new AFTER INSERT trigger on `public.notifications` that calls
--      the send-push-notification edge function via supabase_functions.http_request
--      (the same mechanism the Supabase Dashboard's "Database Webhooks" UI
--      generates) for every notification row, of every type, going forward.
--
-- >>> BEFORE RUNNING: replace <PROJECT_REF> near the bottom with your actual
-- Supabase project ref (Project Settings -> General -> Reference ID). <<<

-- ============================================================================
-- 1. notifications: type + structured data, for deep-linking + preferences
-- ============================================================================
alter table public.notifications add column if not exists type text;
alter table public.notifications add column if not exists data jsonb not null default '{}'::jsonb;

-- ============================================================================
-- 2. device_tokens — one row per (user, device); multiple devices per user
-- ============================================================================
create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  device_id text not null,
  token text not null,
  platform text not null check (platform in ('android', 'ios')),
  updated_at timestamptz not null default now(),
  unique (user_id, device_id),
  unique (token)
);

alter table public.device_tokens enable row level security;

drop policy if exists "users manage their own device tokens" on public.device_tokens;
create policy "users manage their own device tokens" on public.device_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- 3. notification_preferences — one row per user, all categories on by default
-- ============================================================================
create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  chat boolean not null default true,
  offers boolean not null default true,
  reviews boolean not null default true,
  followers boolean not null default true,
  favorites boolean not null default true,
  price_drops boolean not null default true,
  system boolean not null default true,
  marketing boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

drop policy if exists "users manage their own notification preferences" on public.notification_preferences;
create policy "users manage their own notification preferences" on public.notification_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- 4. Extend existing notification-writing functions with type/data
-- ============================================================================

-- favorite (0004)
create or replace function public.notify_on_favorite()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_owner_id uuid;
  v_listing_title text;
  v_actor_name text;
begin
  select user_id, title into v_owner_id, v_listing_title
  from public.listings
  where id::text = new.listing_id;

  if v_owner_id is null or v_owner_id = new.user_id then
    return new;
  end if;

  select coalesce(full_name, 'Someone') into v_actor_name
  from public.profiles where id = new.user_id;

  insert into public.notifications (user_id, title, body, type, data)
  values (
    v_owner_id,
    v_actor_name || ' favorited your listing',
    coalesce(v_listing_title, ''),
    'favorite',
    jsonb_build_object('listingId', new.listing_id)
  );

  return new;
end;
$$;

-- follow (0004)
create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor_name text;
begin
  select coalesce(full_name, 'Someone') into v_actor_name
  from public.profiles where id = new.follower_id;

  insert into public.notifications (user_id, title, body, type, data)
  values (
    new.following_id,
    v_actor_name || ' started following you',
    null,
    'follow',
    jsonb_build_object('followerId', new.follower_id)
  );

  return new;
end;
$$;

-- review (0004)
create or replace function public.notify_on_review()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor_name text;
begin
  select coalesce(full_name, 'Someone') into v_actor_name
  from public.profiles where id = new.reviewer_id;

  insert into public.notifications (user_id, title, body, type, data)
  values (
    new.seller_id,
    v_actor_name || ' left you a ' || new.rating || '-star review',
    coalesce(new.comment, ''),
    'review',
    jsonb_build_object('sellerId', new.seller_id, 'reviewId', new.id)
  );

  return new;
end;
$$;

-- review edit — the update policy on reviews (0001) already lets reviewers
-- edit their own review; nothing ever notified the seller of the edit until now.
create or replace function public.notify_on_review_update()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor_name text;
begin
  if new.rating is not distinct from old.rating and new.comment is not distinct from old.comment then
    return new;
  end if;

  select coalesce(full_name, 'Someone') into v_actor_name
  from public.profiles where id = new.reviewer_id;

  insert into public.notifications (user_id, title, body, type, data)
  values (
    new.seller_id,
    v_actor_name || ' updated their review of you',
    coalesce(new.comment, ''),
    'review',
    jsonb_build_object('sellerId', new.seller_id, 'reviewId', new.id)
  );

  return new;
end;
$$;

drop trigger if exists on_review_update_notify on public.reviews;
create trigger on_review_update_notify
  after update on public.reviews
  for each row execute function public.notify_on_review_update();

-- price drop (0007)
create or replace function public.notify_on_price_drop()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_listing_title text;
  v_owner_id uuid;
begin
  select title, user_id into v_listing_title, v_owner_id from public.listings where id = new.listing_id;

  insert into public.notifications (user_id, title, body, type, data)
  select f.user_id,
         'Price dropped on a listing you favorited',
         coalesce(v_listing_title, '') || ': ' || new.old_price || ' -> ' || new.new_price,
         'price_drop',
         jsonb_build_object('listingId', new.listing_id)
  from public.favorites f
  where f.listing_id = new.listing_id::text and f.user_id <> v_owner_id;

  return new;
end;
$$;

-- new message (0005)
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
begin
  update public.conversations
  set last_message = new.text, last_message_at = new.created_at
  where id = new.conversation_id
  returning (case when buyer_id = new.sender_id then seller_id else buyer_id end), listing_id
  into v_recipient_id, v_listing_id;

  select title into v_listing_title from public.listings where id = v_listing_id;

  select coalesce(full_name, 'Someone') into v_sender_name
  from public.profiles where id = new.sender_id;

  if v_recipient_id is not null then
    insert into public.notifications (user_id, title, body, type, data)
    values (
      v_recipient_id,
      v_sender_name || ' sent you a message',
      coalesce(v_listing_title, new.text),
      'message',
      jsonb_build_object('conversationId', new.conversation_id)
    );
  end if;

  return new;
end;
$$;

-- create_offer (0006)
create or replace function public.create_offer(p_listing_id uuid, p_amount numeric, p_message text default null)
returns public.offers
language plpgsql
security definer set search_path = public
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_seller_id uuid;
  v_listing_title text;
  v_conversation public.conversations;
  v_buyer_name text;
  v_offer public.offers;
begin
  if v_buyer_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Offer amount must be greater than zero';
  end if;

  select user_id, title into v_seller_id, v_listing_title from public.listings where id = p_listing_id;
  if v_seller_id is null then
    raise exception 'Listing not found';
  end if;
  if v_seller_id = v_buyer_id then
    raise exception 'Cannot make an offer on your own listing';
  end if;

  if exists (select 1 from public.offers where listing_id = p_listing_id and buyer_id = v_buyer_id and status = 'pending') then
    raise exception 'You already have an active offer on this listing';
  end if;

  v_conversation := public.find_or_create_conversation(p_listing_id);

  insert into public.offers (listing_id, conversation_id, buyer_id, seller_id, from_user_id, amount, message)
  values (p_listing_id, v_conversation.id, v_buyer_id, v_seller_id, v_buyer_id, p_amount, p_message)
  returning * into v_offer;

  select coalesce(full_name, 'Someone') into v_buyer_name from public.profiles where id = v_buyer_id;
  insert into public.notifications (user_id, title, body, type, data)
  values (
    v_seller_id,
    v_buyer_name || ' made an offer of ' || p_amount,
    coalesce(v_listing_title, ''),
    'offer_new',
    jsonb_build_object('offerId', v_offer.id, 'listingId', p_listing_id)
  );

  return v_offer;
end;
$$;

grant execute on function public.create_offer(uuid, numeric, text) to authenticated;

-- respond_to_offer (0006)
create or replace function public.respond_to_offer(
  p_offer_id uuid,
  p_action text,
  p_counter_amount numeric default null,
  p_message text default null
)
returns public.offers
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_offer public.offers;
  v_listing_title text;
  v_actor_name text;
  v_result public.offers;
begin
  if v_actor_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_action not in ('accept', 'reject', 'counter') then
    raise exception 'Invalid action';
  end if;

  select * into v_offer from public.offers where id = p_offer_id for update;
  if v_offer is null then
    raise exception 'Offer not found';
  end if;
  if v_actor_id not in (v_offer.buyer_id, v_offer.seller_id) then
    raise exception 'Not a participant of this offer';
  end if;
  if v_actor_id = v_offer.from_user_id then
    raise exception 'Waiting on the other party to respond';
  end if;
  if v_offer.status <> 'pending' then
    raise exception 'This offer is no longer active';
  end if;

  select title into v_listing_title from public.listings where id = v_offer.listing_id;
  select coalesce(full_name, 'Someone') into v_actor_name from public.profiles where id = v_actor_id;

  if p_action = 'accept' then
    update public.offers set status = 'accepted', updated_at = now() where id = p_offer_id returning * into v_result;

    update public.listings set status = 'sold', updated_at = now() where id = v_offer.listing_id;

    update public.offers
    set status = 'sold', updated_at = now()
    where listing_id = v_offer.listing_id and id <> p_offer_id and status = 'pending';

    insert into public.notifications (user_id, title, body, type, data)
    values (
      v_offer.from_user_id,
      v_actor_name || ' accepted your offer of ' || v_offer.amount,
      coalesce(v_listing_title, ''),
      'offer_accepted',
      jsonb_build_object('offerId', v_offer.id, 'listingId', v_offer.listing_id)
    );

    insert into public.notifications (user_id, title, body, type, data)
    values (
      v_offer.seller_id,
      'Your listing is now marked as sold',
      coalesce(v_listing_title, ''),
      'listing_sold',
      jsonb_build_object('listingId', v_offer.listing_id)
    );

  elsif p_action = 'reject' then
    update public.offers set status = 'rejected', updated_at = now() where id = p_offer_id returning * into v_result;

    insert into public.notifications (user_id, title, body, type, data)
    values (
      v_offer.from_user_id,
      v_actor_name || ' rejected your offer of ' || v_offer.amount,
      coalesce(v_listing_title, ''),
      'offer_rejected',
      jsonb_build_object('offerId', v_offer.id, 'listingId', v_offer.listing_id)
    );

  else -- counter
    if p_counter_amount is null or p_counter_amount <= 0 then
      raise exception 'Counter offer amount must be greater than zero';
    end if;

    update public.offers set status = 'countered', updated_at = now() where id = p_offer_id;

    insert into public.offers (listing_id, conversation_id, buyer_id, seller_id, from_user_id, amount, message, parent_offer_id)
    values (v_offer.listing_id, v_offer.conversation_id, v_offer.buyer_id, v_offer.seller_id, v_actor_id, p_counter_amount, p_message, p_offer_id)
    returning * into v_result;

    insert into public.notifications (user_id, title, body, type, data)
    values (
      v_offer.from_user_id,
      v_actor_name || ' countered with ' || p_counter_amount,
      coalesce(v_listing_title, ''),
      'offer_countered',
      jsonb_build_object('offerId', v_result.id, 'listingId', v_offer.listing_id)
    );
  end if;

  return v_result;
end;
$$;

grant execute on function public.respond_to_offer(uuid, text, numeric, text) to authenticated;

-- ============================================================================
-- 5. cancel_offer / expire_stale_offers — never notified anyone before
-- ============================================================================
create or replace function public.cancel_offer(p_offer_id uuid)
returns public.offers
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_offer public.offers;
  v_listing_title text;
  v_actor_name text;
  v_other_id uuid;
begin
  select * into v_offer from public.offers where id = p_offer_id for update;
  if v_offer is null then
    raise exception 'Offer not found';
  end if;
  if v_actor_id <> v_offer.from_user_id then
    raise exception 'Only the person who made this offer can cancel it';
  end if;
  if v_offer.status <> 'pending' then
    raise exception 'This offer is no longer active';
  end if;

  update public.offers set status = 'cancelled', updated_at = now() where id = p_offer_id returning * into v_offer;

  v_other_id := case when v_actor_id = v_offer.buyer_id then v_offer.seller_id else v_offer.buyer_id end;
  select title into v_listing_title from public.listings where id = v_offer.listing_id;
  select coalesce(full_name, 'Someone') into v_actor_name from public.profiles where id = v_actor_id;

  insert into public.notifications (user_id, title, body, type, data)
  values (
    v_other_id,
    v_actor_name || ' cancelled their offer of ' || v_offer.amount,
    coalesce(v_listing_title, ''),
    'offer_cancelled',
    jsonb_build_object('offerId', v_offer.id, 'listingId', v_offer.listing_id)
  );

  return v_offer;
end;
$$;

grant execute on function public.cancel_offer(uuid) to authenticated;

-- expire_stale_offers is called by the client (store/offers.ts) whenever
-- offers for a listing are loaded — turn each row it expires into a
-- notification for whoever had proposed it, same "as auth.uid()" scoping the
-- function already had.
create or replace function public.expire_stale_offers()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_row record;
  v_listing_title text;
begin
  for v_row in
    update public.offers
    set status = 'expired', updated_at = now()
    where status = 'pending'
      and expires_at < now()
      and (buyer_id = auth.uid() or seller_id = auth.uid())
    returning id, listing_id, from_user_id, amount
  loop
    select title into v_listing_title from public.listings where id = v_row.listing_id;
    insert into public.notifications (user_id, title, body, type, data)
    values (
      v_row.from_user_id,
      'Your offer of ' || v_row.amount || ' expired',
      coalesce(v_listing_title, ''),
      'offer_expired',
      jsonb_build_object('offerId', v_row.id, 'listingId', v_row.listing_id)
    );
  end loop;
end;
$$;

grant execute on function public.expire_stale_offers() to authenticated;

-- ============================================================================
-- 6. Push delivery: fire the edge function once per new notification row
-- ============================================================================
-- Uses supabase_functions.http_request(), the same built-in mechanism the
-- Supabase Dashboard's Database Webhooks UI generates — available in every
-- Supabase project without extra extensions to enable.
drop trigger if exists on_notification_insert_push on public.notifications;
create trigger on_notification_insert_push
  after insert on public.notifications
  for each row execute function supabase_functions.http_request(
    'https://waksddinkjbrggxkfofk.functions.supabase.co/send-push-notification',
    'POST',
    '{"Content-Type":"application/json"}',
    '{}',
    '5000'
  );
