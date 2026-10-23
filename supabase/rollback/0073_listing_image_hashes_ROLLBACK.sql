-- Rollback for 0073. Drops the blur-hash column; listings and photos are untouched. Apps then show the card background while loading.
drop trigger if exists listings_sync_image_hashes on public.listings;
drop function if exists public.trg_listings_sync_image_hashes();
alter table public.listings drop constraint if exists listings_image_hashes_shape;
alter table public.listings drop column if exists image_hashes;
