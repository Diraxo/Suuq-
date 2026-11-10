-- ============================================================================
-- 0087_contact_price_pending_offers.sql  —  PROPOSED. NOT APPLIED. Do not run without the owner's approval.
--
-- Companion to 0085 + 0086 (both live in production). Closes one gap that 0086 leaves for OFFERS THAT ALREADY EXIST when their listing
-- is switched to "Contact for price" (price 0 + attributes.priceMode):
--
--   0086's offers trigger fires on  insert or update of amount, listing_id.  A status-only update never reaches it, so
--   respond_to_offer(..., 'accept') — and a direct UPDATE ... SET status = 'accepted' — still succeeds on a pending offer whose listing has
--   become contact-price. The result is an "accepted" price agreement for an item that no longer has a price, plus an
--   "X accepted your offer of 400" notification. (Proven by supabase/tests/offers_contact_price_0087.test.mjs, part A.)
--
-- Chosen behaviour (same shape as 0044's block rule: new money-bearing moves stop, closing-out moves stay):
--   REFUSED   create_offer, counter-offer (it inserts a row), amount change, listing change      — already refused by 0086
--   REFUSED   moving an offer to 'accepted'                                                       — NEW here
--   ALLOWED   reject, cancel, expire, sold (a pending offer can always be closed out)
--   UNCHANGED the pending offer is not rewritten behind the users' backs: the seller can decline it, the buyer can withdraw it, otherwise it
--             expires on its own (7 days). If the seller returns the listing to a real price, the offer is acceptable again.
--
-- Backward compatible: no existing row, column or function signature changes; rollback = 0087_contact_price_pending_offers_ROLLBACK.sql
-- (restores 0086's function body and drops the one new trigger).
--
-- SECURITY NOTES
--   Authorization: unchanged. respond_to_offer / create_offer / cancel_offer keep their own participant checks; this file adds a trigger-level
--   refusal only and grants nothing. The function stays SECURITY DEFINER with search_path = public, pg_temp and EXECUTE revoked from
--   public/anon/authenticated (same as 0086). Reject, cancel, expire and sold status moves return before any listing lookup.
--   KNOWN RESIDUAL RACE (documented, NOT closed here): the check reads public.listings without locking it. If the seller's transaction that
--   switches the listing to "Contact for price" has not committed yet, a concurrent accept of a pending offer sees the old price, passes the
--   guard and commits. Window = the length of that one transaction (milliseconds); effect = one 'accepted' offer on a listing that just lost its
--   price (accepting does not mark the listing sold, 0029, and no money moves in-app). It is a window, not a bypass: any accept started after the
--   seller's commit is refused.
--   WHY NOT "FOR SHARE" on the listing row inside this trigger: the lock orders would be opposed. respond_to_offer locks the OFFER row first
--   (select ... from offers for update, 0029:50) and the trigger would then lock the LISTING; mark_listing_sold locks the LISTING first
--   (select ... from listings for update, 0070:30) and then updates the pending OFFERS (0070:49). Offer->listing against listing->offer is the
--   classic two-session deadlock, so FOR SHARE is deliberately not used. Closing the window properly needs one agreed lock order (for example
--   respond_to_offer taking the listing lock before the offer lock) and a deadlock test under concurrent sessions; that is a separate change.
--   Rollback of 0087 restores 0086 exactly and therefore REOPENS the acceptance gap described above (a pending offer on a listing that later
--   became contact-price can be accepted again), plus the "X accepted your offer of 400" notification for an item with no price.
-- ============================================================================

create or replace function private.guard_offer_contact_price()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  l record;
  v_accepting boolean := tg_op = 'UPDATE' and new.status = 'accepted' and old.status is distinct from 'accepted';
begin
  -- Other status-only updates (reject / cancel / expire / sold) are always allowed.
  if tg_op = 'UPDATE' and not v_accepting
     and new.listing_id is not distinct from old.listing_id and new.amount is not distinct from old.amount then
    return new;
  end if;
  select category, price, attributes into l from public.listings where id = new.listing_id;
  if found and public.is_contact_price_listing(l.category, l.price, l.attributes) then
    raise exception 'Offers are not available on contact-for-price listings' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_offer_contact_price() from public, anon, authenticated;

-- The existing trigger (insert / amount / listing_id) keeps using the function above; this one adds the status move.
drop trigger if exists offers_contact_price_guard_accept on public.offers;
create trigger offers_contact_price_guard_accept before update of status on public.offers
  for each row execute function private.guard_offer_contact_price();
