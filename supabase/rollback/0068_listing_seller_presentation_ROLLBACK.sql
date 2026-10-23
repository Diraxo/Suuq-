-- ROLLBACK for 0068. Drops the presentation choice and the phone opt-in; every listing then follows the clients' default (personal).
-- Run as ONE transaction. Idempotent.
begin;
drop trigger if exists listings_d_guard_seller_presentation on public.listings;
drop function if exists public.guard_listing_seller_presentation();
alter table public.listings drop constraint if exists listings_seller_presentation_check;
alter table public.listings drop column if exists seller_presentation;
alter table public.profiles drop column if exists business_phone_public;
commit;
