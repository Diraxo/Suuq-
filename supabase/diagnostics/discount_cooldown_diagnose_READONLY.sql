-- READ-ONLY. Why does set_listing_discount() say "The price was changed recently"? Run in the Supabase SQL editor.
-- It only SELECTs. Replace the id below (or remove the filter to see the 20 most recent listings).
--
-- How to read it:
--   * hold_ends_at = price_changed_at + 3 days. While now() < hold_ends_at the discount is refused (0080).
--   * price_changed_at is set by: (a) the 0080 backfill = updated_at (ANY edit, not only a price edit), (b) the insert default now()
--     (a new listing starts its own 3-day hold), (c) the price/currency trigger on a real change.
--   * source_guess:  'created'      price_changed_at = created_at          -> the listing is new; the hold started at publish.
--                    'backfill'     price_changed_at = updated_at, no price_drops row -> 0080 stamped it from the last edit; the price may never have changed.
--                    'price_drop'   a price_drops row exists at that instant -> a real price decrease.
--                    'price_edit'   none of the above -> a real price/currency change (an increase leaves no row).
select l.id, l.title, l.status, l.price, l.currency,
       l.created_at, l.updated_at, l.price_changed_at,
       l.price_changed_at + interval '3 days'                      as hold_ends_at,
       (l.price_changed_at + interval '3 days') > now()            as still_in_hold,
       case
         when l.price_changed_at = l.created_at then 'created'
         when exists (select 1 from public.price_drops d where d.listing_id = l.id and abs(extract(epoch from d.created_at - l.price_changed_at)) < 2) then 'price_drop'
         when l.price_changed_at = l.updated_at then 'backfill_or_last_edit'
         else 'price_edit'
       end                                                         as source_guess,
       l.discount_original_price, l.discount_started_at, l.discount_ends_at,
       current_setting('TimeZone')                                 as db_timezone
  from public.listings l
 -- where l.id = '00000000-0000-0000-0000-000000000000'
 order by l.updated_at desc
 limit 20;

-- Every price decrease ever recorded for the same listings (price increases are not recorded anywhere).
select d.listing_id, d.old_price, d.new_price, d.created_at
  from public.price_drops d
 order by d.created_at desc
 limit 20;
