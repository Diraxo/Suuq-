-- 0073 — Blur placeholders for listing photos.
--
-- STATUS: written, NOT applied to any database. Additive and safe to apply at any time; the app tolerates the column being absent
-- ONLY until a build that sends it ships (apply this BEFORE releasing that build, or publishing a listing fails).
--
--   listings.image_hashes   one thumbhash (base64, ~28 chars) per photo, same order as images / image_public_ids. Generated on the
--                           device at upload (expo-image generateThumbhashAsync), decoded locally by expo-image as the `placeholder`.
--                           Empty for every listing that exists today: those photos simply show the card background until they load.
--
-- The app only trusts the array while its length equals images' length. This trigger keeps that true for writers that do not know the
-- column (the web editor, bulk upload, SQL): when images changes and image_hashes was not changed in the same statement, the hashes
-- are cleared rather than left pointing at the wrong photos.
-- Rollback: supabase/rollback/0073_listing_image_hashes_ROLLBACK.sql.

alter table public.listings
  add column if not exists image_hashes text[] not null default '{}';

-- A CHECK cannot contain a subquery, so the per-hash length is bounded through the joined text (8 hashes of up to 64 chars + 7 commas).
alter table public.listings
  drop constraint if exists listings_image_hashes_shape,
  add constraint listings_image_hashes_shape check (
    coalesce(array_length(image_hashes, 1), 0) <= 8
    and array_to_string(image_hashes, ',') ~ '^[A-Za-z0-9+/=,]*$'
    and char_length(array_to_string(image_hashes, ',')) <= 519
  ) not valid;
-- not valid: no table scan or lock on existing rows (all are '{}'); new and changed rows are checked.

create or replace function public.trg_listings_sync_image_hashes()
returns trigger language plpgsql
as $$
begin
  if new.images is distinct from old.images and new.image_hashes is not distinct from old.image_hashes then
    new.image_hashes := '{}';
  end if;
  return new;
end;
$$;

drop trigger if exists listings_sync_image_hashes on public.listings;
create trigger listings_sync_image_hashes
  before update of images on public.listings
  for each row execute function public.trg_listings_sync_image_hashes();
