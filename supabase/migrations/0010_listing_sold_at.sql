-- Suuq+ follow-up schema: a dedicated `sold_at` timestamp for listings.
-- Until now the Seller Dashboard's Weekly/Monthly "Items sold" stat filtered
-- on `updated_at`, which changes on every edit (e.g. a seller tweaking the
-- description of an already-sold listing) — that keeps bumping the listing
-- back into "sold this week", corrupting the sales analytics. `sold_at` is
-- set exactly once, the moment status transitions to 'sold', and never
-- touched again (it's cleared if the listing leaves 'sold', so a later
-- re-sale records a fresh timestamp instead of keeping the old one). Run
-- once after 0001-0009.

alter table public.listings add column if not exists sold_at timestamptz;

create or replace function public.set_listing_sold_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'sold' and old.status is distinct from 'sold' then
    new.sold_at := now();
  elsif new.status is distinct from 'sold' then
    new.sold_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists listings_set_sold_at on public.listings;
create trigger listings_set_sold_at
  before update on public.listings
  for each row execute function public.set_listing_sold_at();

-- Best-effort backfill for listings already marked sold: `updated_at` is the
-- closest approximation we have for their sale date, so use it once here.
-- Nothing depends on it being exact — only rows sold from now on are precise.
update public.listings set sold_at = updated_at where status = 'sold' and sold_at is null;
