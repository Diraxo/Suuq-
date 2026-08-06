-- Persist Cloudinary public_id alongside every stored image URL so cleanup
-- deletes no longer depend solely on regex-deriving the id from the URL at
-- delete-time (lib/cloudinary.ts's extractPublicId remains as a fallback for
-- rows written before this migration, and for non-Cloudinary URLs).
-- Purely additive/nullable/defaulted — every existing row keeps working
-- unchanged; new uploads populate these columns going forward.

alter table public.profiles
  add column if not exists avatar_public_id text,
  add column if not exists business_logo_public_id text,
  add column if not exists business_banner_public_id text;

-- Index-aligned with listings.images (same "parallel array" pattern already
-- used for e.g. features/seller_notes) rather than changing the shape of
-- images itself, so no read call site needs to change. Old rows default to
-- '{}' and fall back to URL-derived ids until their photos are next replaced.
alter table public.listings
  add column if not exists image_public_ids text[] not null default '{}';
