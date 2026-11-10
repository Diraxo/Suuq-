-- Rolls back 0086_contact_price_safeguards.sql (proposed, not applied). Safe at any time; touches no data.
-- After this, offers and discounts on contact-price listings are no longer refused by the database (the app still hides them),
-- so roll back only together with turning CONTACT_PRICE_ENABLED off and, if 0085 is live, before/with removing price = 0 rows.

alter table public.listings drop constraint if exists listings_price_zero_needs_mode;
drop trigger if exists offers_contact_price_guard on public.offers;
drop trigger if exists listings_y_contact_price_guard on public.listings;
drop function if exists private.guard_offer_contact_price();
drop function if exists private.guard_listing_contact_price();

-- Restore 0080's price trigger body exactly.
create or replace function public.trg_listings_record_price_drop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.price is distinct from old.price or new.currency is distinct from old.currency then
    new.price_changed_at := now();
  end if;
  if new.currency is distinct from old.currency then
    new.last_price_drop_at := null;
    new.last_price_drop_from := null;
  elsif new.price < old.price then
    insert into public.price_drops (listing_id, old_price, new_price) values (new.id, old.price, new.price);
    new.last_price_drop_at := now();
    new.last_price_drop_from := old.price;
  elsif new.price > old.price and new.last_price_drop_from is not null and new.price >= new.last_price_drop_from then
    new.last_price_drop_at := null;
    new.last_price_drop_from := null;
  end if;
  return new;
end;
$$;

-- Last, because nothing else depends on it once the triggers are gone.
drop function if exists public.is_contact_price_listing(text, numeric, jsonb);
