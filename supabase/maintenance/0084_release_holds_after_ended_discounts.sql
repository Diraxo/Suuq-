-- ONE-OFF data fix, run once AFTER 0084. Listings whose discount was ended before 0084 were put in a 3-day price hold by the restore.
-- Narrow on purpose: only listings with NO discount running whose current price equals the "old price" of a recorded discount drop
-- made BEFORE the hold started (the price was put back, not edited), and whose hold is still running. The hold is released by
-- setting price_changed_at back to when the listing was created. Run the SELECT first and read the rows; the UPDATE touches only them.

-- 1) Review:
select l.id, l.title, l.price, l.created_at, l.price_changed_at
  from public.listings l
 where l.discount_original_price is null
   and l.price_changed_at > l.created_at and l.price_changed_at + interval '3 days' > now()
   and exists (select 1 from public.price_drops d where d.listing_id = l.id and d.old_price = l.price and d.created_at < l.price_changed_at);

-- 2) Apply (same conditions):
-- update public.listings l set price_changed_at = l.created_at
--  where l.discount_original_price is null
--    and l.price_changed_at > l.created_at and l.price_changed_at + interval '3 days' > now()
--    and exists (select 1 from public.price_drops d where d.listing_id = l.id and d.old_price = l.price and d.created_at < l.price_changed_at);
