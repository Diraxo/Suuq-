-- Rollback of 0087_contact_price_pending_offers.sql — restores 0086's function body exactly and drops the added trigger.
-- WARNING: this REOPENS the acceptance gap that 0087 closes: a pending offer whose listing has become contact-price can be accepted again
-- (respond_to_offer 'accept' and a direct status update both succeed, with the "accepted your offer" notification). Offers stay refused for
-- new rows / amount / listing changes (0086). Run only if 0087 was applied. Does not touch 0085 / 0086 or any data.

drop trigger if exists offers_contact_price_guard_accept on public.offers;

create or replace function private.guard_offer_contact_price()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  l record;
begin
  -- Status-only updates (reject / cancel / expire / sold) are always allowed.
  if tg_op = 'UPDATE' and new.listing_id is not distinct from old.listing_id and new.amount is not distinct from old.amount then
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
