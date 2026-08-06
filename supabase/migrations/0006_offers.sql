-- Suuq+ follow-up schema: offers (buyer/seller price negotiation per listing).
-- Run once in the Supabase SQL Editor after 0001-0005 (needs
-- find_or_create_conversation() from 0005_chat.sql).
--
-- Model: an offer "thread" for a given (listing, buyer) is a chain of rows
-- linked by parent_offer_id. Only one row in a thread is ever 'pending' at a
-- time (the proposal currently awaiting a response); every prior row in the
-- thread is left in a terminal status ('countered', 'accepted', 'rejected',
-- 'cancelled', 'expired', 'sold') once superseded. from_user_id is whoever
-- proposed that specific amount, so "the other party" (buyer or seller,
-- whichever isn't from_user_id) is always the one who may accept/reject/counter
-- next — this is what makes it turn-based.
--
-- All writes go through the SECURITY DEFINER functions below (never direct
-- client insert/update), the same pattern 0001/0002/0004/0005 already use for
-- anything that must write a row the actor doesn't themselves own (e.g.
-- notifying the other party) or that needs an atomic check-then-write.

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  from_user_id uuid not null references public.profiles (id),
  amount numeric not null check (amount > 0),
  message text,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'countered', 'cancelled', 'expired', 'sold')),
  parent_offer_id uuid references public.offers (id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (buyer_id <> seller_id),
  check (from_user_id = buyer_id or from_user_id = seller_id)
);

create index if not exists offers_listing_idx on public.offers (listing_id, created_at desc);

-- Only one open proposal per (listing, buyer) thread at a time — this is the
-- "prevent duplicate active offers from the same buyer" rule.
create unique index if not exists offers_one_pending_per_thread
  on public.offers (listing_id, buyer_id)
  where status = 'pending';

alter table public.offers enable row level security;

drop policy if exists "participants can read their offers" on public.offers;
create policy "participants can read their offers" on public.offers
  for select using (auth.uid() = buyer_id or auth.uid() = seller_id);

-- No direct insert/update policy: all writes go through the functions below.

alter publication supabase_realtime add table public.offers;

-- ============================================================================
-- create_offer — buyer opens (or reopens) a negotiation on a listing
-- ============================================================================
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
  insert into public.notifications (user_id, title, body)
  values (v_seller_id, v_buyer_name || ' made an offer of ' || p_amount, coalesce(v_listing_title, ''));

  return v_offer;
end;
$$;

grant execute on function public.create_offer(uuid, numeric, text) to authenticated;

-- ============================================================================
-- respond_to_offer — the other party accepts / rejects / counters
-- ============================================================================
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

    -- Every other still-open thread on this listing lost the item to this buyer.
    update public.offers
    set status = 'sold', updated_at = now()
    where listing_id = v_offer.listing_id and id <> p_offer_id and status = 'pending';

    insert into public.notifications (user_id, title, body)
    values (v_offer.from_user_id, v_actor_name || ' accepted your offer of ' || v_offer.amount, coalesce(v_listing_title, ''));

    insert into public.notifications (user_id, title, body)
    values (v_offer.seller_id, 'Your listing is now marked as sold', coalesce(v_listing_title, ''));

  elsif p_action = 'reject' then
    update public.offers set status = 'rejected', updated_at = now() where id = p_offer_id returning * into v_result;

    insert into public.notifications (user_id, title, body)
    values (v_offer.from_user_id, v_actor_name || ' rejected your offer of ' || v_offer.amount, coalesce(v_listing_title, ''));

  else -- counter
    if p_counter_amount is null or p_counter_amount <= 0 then
      raise exception 'Counter offer amount must be greater than zero';
    end if;

    update public.offers set status = 'countered', updated_at = now() where id = p_offer_id;

    insert into public.offers (listing_id, conversation_id, buyer_id, seller_id, from_user_id, amount, message, parent_offer_id)
    values (v_offer.listing_id, v_offer.conversation_id, v_offer.buyer_id, v_offer.seller_id, v_actor_id, p_counter_amount, p_message, p_offer_id)
    returning * into v_result;

    insert into public.notifications (user_id, title, body)
    values (v_offer.from_user_id, v_actor_name || ' countered with ' || p_counter_amount, coalesce(v_listing_title, ''));
  end if;

  return v_result;
end;
$$;

grant execute on function public.respond_to_offer(uuid, text, numeric, text) to authenticated;

-- ============================================================================
-- cancel_offer — the proposer retracts their own still-pending proposal
-- ============================================================================
create or replace function public.cancel_offer(p_offer_id uuid)
returns public.offers
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_offer public.offers;
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
  return v_offer;
end;
$$;

grant execute on function public.cancel_offer(uuid) to authenticated;

-- ============================================================================
-- expire_stale_offers — lazy expiry, called by the client when loading offers
-- (no pg_cron dependency; "expired" only needs to be accurate when viewed)
-- ============================================================================
create or replace function public.expire_stale_offers()
returns void
language sql
security definer set search_path = public
as $$
  update public.offers
  set status = 'expired', updated_at = now()
  where status = 'pending'
    and expires_at < now()
    and (buyer_id = auth.uid() or seller_id = auth.uid());
$$;

grant execute on function public.expire_stale_offers() to authenticated;
