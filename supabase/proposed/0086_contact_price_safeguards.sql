-- ============================================================================
-- 0086_contact_price_safeguards.sql  —  PROPOSED. NOT APPLIED. Do not run without the owner's approval.
--
-- Companion to 0085 (a "Contact for price" service is stored as price = 0 with attributes.priceMode = 'Contact for price').
-- 0085 only makes that row LEGAL. This file makes the rest of the database refuse to treat it as an ordinary priced item.
-- It does not change 0085, its rollback, or any existing row. Apply it WITH 0085 (before 0085 no listing can match, so every rule
-- below is simply dormant, but the extra constraint in 0 below is the one that makes 0085 safe); apply both BEFORE the app's
-- CONTACT_PRICE_ENABLED is switched on.
--
-- What it adds (all enforced in the database, so an app, the website, a modified client or a direct API call are treated alike):
--   0. A hole in 0085's own check, found while testing: 0085 writes  (price = 0 and category = 'services' and attributes ->> 'priceMode'
--      = 'Contact for price').  For a services row with NO priceMode that last comparison is NULL, not false, and a CHECK passes on NULL,
--      so a forged price of 0 WITHOUT the mode is accepted (the opposite of what 0085's header promises). 0085 is left untouched;
--      this file adds a second, additive constraint  price <> 0 OR is_contact_price_listing(...)  that closes it. Until it is applied
--      (with 0085), do not apply 0085 on its own.
--   1. public.is_contact_price_listing(category, price, attributes)  — the single definition of a valid contact-price listing:
--      category 'services' AND price exactly 0 AND priceMode = 'Contact for price'. A priceMode on a listing that has a real
--      price is ignored (it is not a contact-price listing); a 0 price without the mode is not one either (0085 already
--      refuses to store that).
--   2. Offers: no new offer (or counter-offer, which is also an insert) and no change of amount/listing on an offer for a
--      contact-price listing. Declining, cancelling and expiring existing offers stay possible.
--   3. Discounts: a contact-price listing can never carry discount_* columns (covers set_listing_discount, a direct UPDATE by
--      the owner, and the service role). set_listing_discount already refused price 0 ("new price must be lower"), so this adds
--      the explicit, path-independent rule.
--   4. Price drops: a change to price 0 is not a "price drop" (it would record a drop to 0, notify everyone who saved the listing
--      "X -> 0" and flag the listing "Price reduced"). trg_listings_record_price_drop is replaced by 0080's body with one extra
--      condition (new.price > 0) and a contact-price listing never keeps last_price_drop_* values.
--
-- Not changed here (already safe, proven by supabase/tests/contact_price_safeguards.test.mjs): price sort ranks price <= 0 last
-- (home_feed 0042, search 0038/0043), the offer cap (0065) ignores price <= 0, set/end discount RPCs refuse price <= 0.
-- Comparable/market statistics are computed in the app (data/similarListings.ts) and now skip contact-price rows there.
--
-- Rollback: 0086_contact_price_safeguards_ROLLBACK.sql (drops the constraint, 2 triggers and helper functions, restores 0080's price trigger).
-- ============================================================================

-- ── 1. the one definition ──────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.is_contact_price_listing(p_category text, p_price numeric, p_attributes jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(p_category = 'services'
                  and p_price = 0
                  and coalesce(jsonb_typeof(p_attributes), '') = 'object'
                  and p_attributes ->> 'priceMode' = 'Contact for price', false)
$$;

-- A price of exactly 0 is legal only in the contact-price shape. NOT VALID like the 0049/0085 constraints: it guards every insert and
-- update from now on and does not re-check old rows.
alter table public.listings drop constraint if exists listings_price_zero_needs_mode;
alter table public.listings
  add constraint listings_price_zero_needs_mode check (price <> 0 or public.is_contact_price_listing(category, price, attributes)) not valid;

-- ── 2. offers ──────────────────────────────────────────────────────────────────────────────────────────────────────────
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

drop trigger if exists offers_contact_price_guard on public.offers;
create trigger offers_contact_price_guard before insert or update of amount, listing_id on public.offers
  for each row execute function private.guard_offer_contact_price();

-- ── 3 + 4. discounts and stale price-drop data on the listing itself ───────────────────────────────────────────────────
create or replace function private.guard_listing_contact_price()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not public.is_contact_price_listing(new.category, new.price, new.attributes) then
    return new;
  end if;
  if new.discount_original_price is not null or new.discount_started_at is not null or new.discount_ends_at is not null then
    raise exception 'Discounts are not available on contact-for-price listings' using errcode = 'P0001';
  end if;
  -- A listing with no amount has no "reduced" price: drop whatever an earlier priced life left behind.
  new.last_price_drop_at := null;
  new.last_price_drop_from := null;
  return new;
end;
$$;
revoke all on function private.guard_listing_contact_price() from public, anon, authenticated;

-- Runs after the other BEFORE triggers (listings_a_guard_protected, listings_b_record_price_drop) so it has the last word.
drop trigger if exists listings_y_contact_price_guard on public.listings;
create trigger listings_y_contact_price_guard before insert or update on public.listings
  for each row execute function private.guard_listing_contact_price();

-- 0080's trigger body, plus: a price of 0 is "no amount", never a reduction.
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
  elsif new.price > 0 and new.price < old.price then
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
