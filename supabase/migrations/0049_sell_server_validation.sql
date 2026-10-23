-- 0049 — Sell-flow server-side validation (was supabase/proposed/0036). NOT YET APPLIED.
-- Needs 0038-0048 applied first. See docs/SELL_AUDIT.md §6 for the reasoning behind every statement.
--
-- Goal: make the database itself refuse the invalid listings the UI already
-- refuses, so a hand-written PostgREST request can't bypass the Sell flow.
--
-- Photo cap: the apps allow 5 photos (data/sellRules.ts MAX_LISTING_PHOTOS), but this CHECK stays at 8 so that
-- older listings with 6-8 photos can still be edited / marked sold (a NOT VALID check is still evaluated on every
-- UPDATE of an existing row). Tighten to 5 once no listing has more.
--
-- Safety design:
--   * Every CHECK is added NOT VALID: it is enforced for new/changed rows
--     immediately but does NOT scan or reject existing rows, so applying it
--     cannot break any currently published listing. After reviewing the
--     existing data (queries at the bottom) run the VALIDATE statements.
--   * RLS is not touched. No policy is weakened or replaced.
--   * Limits mirror data/sellRules.ts exactly (price, text lengths, photo
--     count, condition values). If you change one, change the other.
-- ============================================================================

-- ── 1. Column-level rules ───────────────────────────────────────────────────
alter table public.listings
  -- price: positive, finite, whole currency units are the product rule but the
  -- column is numeric, so only bound it (fractions are not rejected here).
  add constraint listings_price_range check (price > 0 and price <= 999999999999) not valid,
  -- 0019 already caps title (<= 200) and description (<= 5000); these add the
  -- "not blank" side.
  add constraint listings_title_not_blank check (char_length(btrim(title)) >= 1) not valid,
  add constraint listings_description_not_blank check (description is null or char_length(btrim(description)) >= 1) not valid,
  add constraint listings_condition_valid check (condition is null or condition in ('new', 'like-new', 'used', 'for-parts')) not valid,
  add constraint listings_currency_format check (currency ~ '^[A-Z]{3}$') not valid,
  add constraint listings_images_count check (coalesce(array_length(images, 1), 0) between 1 and 8) not valid,
  add constraint listings_attributes_shape check (jsonb_typeof(attributes) = 'object' and pg_column_size(attributes) <= 8192) not valid,
  add constraint listings_features_count check (coalesce(array_length(features, 1), 0) <= 30) not valid,
  add constraint listings_seller_notes_count check (coalesce(array_length(seller_notes, 1), 0) <= 20) not valid;

-- ── 2. Numeric specification ranges (mirror NUMERIC_RULES in data/sellRules.ts) ─
-- Only keys that mean the same thing in every category are checked here.
-- `size` ("Size (sqm)" vs clothing "M") and `resolution` ("Resolution (MP)" vs
-- the HD/4K selector) are label-dependent in the app schema, so the database
-- cannot judge them by key alone and they stay app-validated.
create or replace function public.validate_listing_attributes()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  -- key, min, max, whole_number_only
  rules constant jsonb := '{
    "battery":        [0, 100, true],
    "mileage":        [0, 2000000, true],
    "engineCC":       [50, 20000, true],
    "quantity":       [1, 1000000, true],
    "gears":          [1, 30, true],
    "setPieces":      [1, 1000, true],
    "lengthMeters":   [0.1, 500, false],
    "ceilingHeight":  [1, 20, false],
    "voltage":        [0.1, 100000, false],
    "weightCapacity": [0.1, 10000000, false]
  }';
  k text;
  v text;
  r jsonb;
  n numeric;
begin
  if coalesce(current_setting('fursad.admin_write', true), '') = 'true' then
    return new;
  end if;

  for k, r in select * from jsonb_each(rules) loop
    v := btrim(coalesce(new.attributes ->> k, ''));
    if v = '' then
      continue;
    end if;
    -- The CASE is parenthesised: PL/pgSQL ends an IF condition at the first THEN token, including the one inside a CASE.
    if v !~ (case when (r ->> 2)::boolean then '^[0-9]{1,16}$' else '^[0-9]{1,16}(\.[0-9]+)?$' end) then
      raise exception 'Invalid value for %: digits only' , k using errcode = '23514';
    end if;
    n := v::numeric;
    if n < (r ->> 0)::numeric or n > (r ->> 1)::numeric then
      raise exception 'Value for % is out of range', k using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists listings_validate_attributes on public.listings;
create trigger listings_validate_attributes
  before insert or update of attributes on public.listings
  for each row execute function public.validate_listing_attributes();

-- ── 3. Server-owned columns can't be forged on INSERT ───────────────────────
-- 0019 revoked UPDATE on views / favorites_count, but INSERT still accepts
-- them, so a hand-written insert could publish a listing that already shows
-- a million views, a backdated created_at (ranking), or status 'sold'.
create or replace function public.sanitize_new_listing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('fursad.admin_write', true), '') = 'true'
     or coalesce(current_setting('suuqplus.skip_rate_limit', true), '') = 'true' then
    return new;
  end if;
  -- An idempotent publish retry (upsert with a stable client id) fires this
  -- BEFORE INSERT trigger even though it resolves to an UPDATE (see 0031) —
  -- leave those alone so a retry can't reset a live listing's counters.
  if exists (select 1 from public.listings where id = new.id) then
    return new;
  end if;
  new.views := 0;
  new.favorites_count := 0;
  new.created_at := now();
  new.updated_at := now();
  new.sold_at := null;
  new.status := 'available';
  return new;
end;
$$;

-- Name sorts before rate_limit_listings / other triggers on purpose (BEFORE
-- INSERT triggers fire in alphabetical order).
drop trigger if exists a_listings_sanitize_new on public.listings;
create trigger a_listings_sanitize_new
  before insert on public.listings
  for each row execute function public.sanitize_new_listing();

-- ── 4. After reviewing existing rows, enforce the constraints on them too ───
-- Find rows that would fail first:
--   select id, title, price, condition, currency, array_length(images,1) as photos
--   from public.listings
--   where not (price > 0 and price <= 999999999999)
--      or char_length(btrim(title)) < 1
--      or (description is not null and char_length(btrim(description)) < 1)
--      or (condition is not null and condition not in ('new','like-new','used','for-parts'))
--      or currency !~ '^[A-Z]{3}$'
--      or coalesce(array_length(images,1),0) not between 1 and 8;
-- Fix or remove those, then:
--   alter table public.listings validate constraint listings_price_range;
--   alter table public.listings validate constraint listings_title_not_blank;
--   alter table public.listings validate constraint listings_description_not_blank;
--   alter table public.listings validate constraint listings_condition_valid;
--   alter table public.listings validate constraint listings_currency_format;
--   alter table public.listings validate constraint listings_images_count;
--   alter table public.listings validate constraint listings_attributes_shape;
--   alter table public.listings validate constraint listings_features_count;
--   alter table public.listings validate constraint listings_seller_notes_count;
--   alter table public.listings validate constraint listings_title_length;        -- from 0019
--   alter table public.listings validate constraint listings_description_length;  -- from 0019
