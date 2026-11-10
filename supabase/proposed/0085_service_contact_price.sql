-- ============================================================================
-- 0085_service_contact_price.sql  —  PROPOSED. NOT APPLIED. Do not run without the owner's approval.
--
-- Why: a service can be listed as "Contact for price" (data/serviceConfig.ts, PRICE_MODE_CONTACT). That listing has no amount, but
-- listings.price is NOT NULL and migration 0049 added  listings_price_range  =  price > 0 and price <= 999999999999,  so the
-- database rejects it today. Until this is applied the app keeps CONTACT_PRICE_ENABLED = false and never asks the question.
--
-- What it does (one constraint, nothing else):
--   A price of 0 becomes legal ONLY for a services listing whose attributes say priceMode = 'Contact for price'.
--   Every other listing keeps exactly the old rule, so 0 can never mean "free" anywhere else, and a forged price of 0 without
--   the mode is still refused. The constraint stays NOT VALID, like the one it replaces: it protects every insert/update from
--   now on and does not re-check old rows.
--
-- Why not a NULL price instead: it would be the cleaner meaning, but price is read as a number in every feed, search, sort,
-- price-drop, offer and discount path (app, website and SQL). A NULL would need all of them changed in the same release; a 0
-- paired with an explicit mode needs only the places listed under "Before enabling" below.
--
-- Backward compatible: no existing row, column, index or function changes. Rollback: 0085_service_contact_price_ROLLBACK.sql.
-- ============================================================================

alter table public.listings drop constraint if exists listings_price_range;

alter table public.listings
  add constraint listings_price_range check (
    (price > 0 and price <= 999999999999)
    or (price = 0 and category = 'services' and attributes ->> 'priceMode' = 'Contact for price')
  ) not valid;

-- ── Before enabling CONTACT_PRICE_ENABLED in the app (these read price as a plain number) ──────────────────────────
--  1. Sort by price and the min/max price filters (home_feed 0042, search 0038/0043, lib/searchFilters.ts): a 0-price service
--     sorts first "cheapest" and matches "up to X". Exclude price = 0 rows from price sorts/filters or sort them last.
--  2. Offers (0065 offer cap treats price <= 0 as "no cap"): hide Make offer for these listings (the app already does) and
--     refuse offers on a contact-price listing in the offers table trigger.
--  3. Seller discounts (0079-0084): a contact-price listing must not be discountable (the discount rules need price > 0).
--  4. Price drops / comparable-price statistics: ignore price = 0 rows.
--  5. Bulk upload (lib/bulkUpload.ts) and CSV import still require price > 0; they are not changed by this migration.
-- Each of these is a small, separate change; none is done by this proposal.
