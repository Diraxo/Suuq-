-- ROLLBACK for 0058 (business media backfill). Only the bookkeeping is removed. Profile and storefront images that the backfill already
-- swapped to a scanned copy STAY as they are (reverting them is a data decision, not a schema one): before rolling back, export
--   select source, owner_id, kind, original_url, original_key, new_url, new_key from public.business_media_backfill where status = 'applied';
-- That list is the only record of which slot used to point at which legacy object. Nothing in R2 is touched.
drop function if exists public.business_media_backfill_report();
drop function if exists public.business_media_backfill_requeue(text);
drop function if exists public.business_media_backfill_apply(uuid);
drop function if exists public.business_media_backfill_record(uuid, text, uuid, text, text, text, int);
drop function if exists public.business_media_backfill_claim(int, interval, int);
drop function if exists public.business_media_backfill_inventory();
drop function if exists public._bmb_current_ref(text, uuid, text);
drop table if exists public.business_media_backfill;
