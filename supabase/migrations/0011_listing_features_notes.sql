-- Adds the "Features" checklist (e.g. Face ID, Reverse camera) and scannable
-- "Seller Notes" highlights (e.g. "Battery health 77%") shown on the listing
-- detail page, alongside the existing free-form attributes/description.
alter table public.listings
  add column if not exists features text[] not null default '{}',
  add column if not exists seller_notes text[] not null default '{}';
