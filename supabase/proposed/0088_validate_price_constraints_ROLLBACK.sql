-- Rollback of 0088: returns both constraints to NOT VALID (definitions identical to 0085 / 0086). No data is touched.
-- Not needed for safety; only if validation must be undone (for example before a bulk import that has to bypass old-row checks).
begin;
set local lock_timeout = '10s';

alter table public.listings drop constraint if exists listings_price_range;
alter table public.listings
  add constraint listings_price_range check (
    (price > 0 and price <= 999999999999)
    or (price = 0 and category = 'services' and attributes ->> 'priceMode' = 'Contact for price')
  ) not valid;

alter table public.listings drop constraint if exists listings_price_zero_needs_mode;
alter table public.listings
  add constraint listings_price_zero_needs_mode check (price <> 0 or public.is_contact_price_listing(category, price, attributes)) not valid;

commit;
