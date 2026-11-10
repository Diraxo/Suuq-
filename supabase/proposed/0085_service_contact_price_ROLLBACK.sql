-- Rolls back 0085_service_contact_price.sql (proposed, not applied).
-- Restores the exact constraint migration 0049 created. FIRST make sure no listing has price = 0:
--   select id, title from public.listings where price = 0;      -- must return no rows, or this would reject their next update
-- Give each of those a real price (or remove it) before running the statements below.

alter table public.listings drop constraint if exists listings_price_range;

alter table public.listings
  add constraint listings_price_range check (price > 0 and price <= 999999999999) not valid;
