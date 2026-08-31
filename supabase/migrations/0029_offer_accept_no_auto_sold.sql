-- ============================================================================
-- Fix: accepting an offer was auto-marking the listing 'sold'.
--
-- Root cause: respond_to_offer()'s accept branch (originally 0006_offers.sql,
-- redefined by 0012_push_notifications.sql — that later definition is the one
-- actually installed) did `update public.listings set status = 'sold'`
-- directly, plus flipped every other pending offer on the listing to 'sold'
-- and sent the seller a "your listing is now marked as sold" notification —
-- all inside the same turn where the seller merely agreed on a price.
--
-- Accepting an offer should only mean "we agreed on the price". The listing
-- must stay available until the seller explicitly confirms the sale actually
-- happened (payment received). This migration:
--   1. Strips the listing status update, the "other offers lose" cascade,
--      and the listing_sold notification out of respond_to_offer's accept
--      branch. It now only flips the offer itself to 'accepted' and
--      notifies the buyer that their offer was accepted.
--   2. Adds mark_listing_sold(), a SECURITY DEFINER RPC the seller calls
--      explicitly once payment is received. offers has no direct update
--      policy (see 0006 — "all writes go through the functions below"), so
--      the "other pending offers now lose out" cascade has to run through a
--      function; this does what respond_to_offer used to do to the listing
--      + competing offers, just moved to fire at the right time.
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

    -- Listing status is intentionally left untouched here — accepting an
    -- offer means "we agreed on the price", not "the sale happened". The
    -- seller marks the listing sold explicitly via mark_listing_sold() once
    -- payment is received.

    insert into public.notifications (user_id, title, body, type, data)
    values (
      v_offer.from_user_id,
      v_actor_name || ' accepted your offer of ' || v_offer.amount,
      coalesce(v_listing_title, ''),
      'offer_accepted',
      jsonb_build_object('offerId', v_offer.id, 'listingId', v_offer.listing_id)
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
-- mark_listing_sold — seller's explicit "I received payment" confirmation.
-- Only this (never respond_to_offer) transitions a listing to 'sold'.
-- ============================================================================
create or replace function public.mark_listing_sold(p_listing_id uuid)
returns public.listings
language plpgsql
security definer set search_path = public
as $$
declare
  v_seller_id uuid := auth.uid();
  v_listing public.listings;
begin
  if v_seller_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_listing from public.listings where id = p_listing_id for update;
  if v_listing is null then
    raise exception 'Listing not found';
  end if;
  if v_listing.user_id <> v_seller_id then
    raise exception 'Not the owner of this listing';
  end if;
  if v_listing.status = 'sold' then
    return v_listing;
  end if;

  update public.listings set status = 'sold', updated_at = now() where id = p_listing_id returning * into v_listing;

  -- Any other still-pending offer on this listing lost the item to whoever
  -- the seller actually sold to (mirrors what respond_to_offer's accept
  -- branch used to do at accept-time, moved here to fire when the item is
  -- actually gone).
  update public.offers
  set status = 'sold', updated_at = now()
  where listing_id = p_listing_id and status = 'pending';

  return v_listing;
end;
$$;

grant execute on function public.mark_listing_sold(uuid) to authenticated;
