-- Suuq+ follow-up schema: a per-view event log so the Seller Dashboard's
-- Weekly/Monthly toggle can report real "listing views" for a given window.
-- `listings.views` (from 0001_init.sql) stays as-is — a running all-time
-- counter used everywhere else (ListingCard, My Listings) — this table is
-- additive, just for windowed queries. Run once after 0001-0008.

create table if not exists public.listing_view_events (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists listing_view_events_seller_created_idx
  on public.listing_view_events (seller_id, created_at desc);

alter table public.listing_view_events enable row level security;

-- Only the seller needs to read their own view history (Seller Dashboard);
-- writes only ever happen through increment_listing_views() below.
drop policy if exists "sellers can read their own listing view events" on public.listing_view_events;
create policy "sellers can read their own listing view events" on public.listing_view_events
  for select using (auth.uid() = seller_id);

-- Replaces the 0002_search_history_and_view_counts.sql version: still bumps
-- the running counter, and now also logs a timestamped event for the windowed
-- Seller Dashboard queries.
create or replace function public.increment_listing_views(p_listing_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_seller_id uuid;
begin
  update public.listings set views = views + 1 where id = p_listing_id
  returning user_id into v_seller_id;

  if v_seller_id is not null then
    insert into public.listing_view_events (listing_id, seller_id) values (p_listing_id, v_seller_id);
  end if;
end;
$$;
