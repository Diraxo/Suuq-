-- 0069 — Each person counts once per listing, forever.
--
--   listing_unique_viewers records (listing, viewer) the first time a signed-in user opens a listing.
--   increment_listing_views() only bumps listings.views and writes a listing_view_events row when that insert is new,
--   so reopening a listing (today, tomorrow, next year) never adds another view. The owner is never counted (as in 0053).
--   Anonymous visitors cannot be told apart, so they are not counted.
--
-- Existing totals are NOT touched here: past views were never tied to a person, so they cannot be corrected
-- automatically. See supabase/maintenance/reset_listing_view_counts.sql for the optional one-time reset.
-- Rollback: supabase/rollback/0069_unique_listing_viewers_ROLLBACK.sql.

create table if not exists public.listing_unique_viewers (
  listing_id uuid not null references public.listings (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  first_viewed_at timestamptz not null default now(),
  primary key (listing_id, viewer_id)
);

-- Written only by increment_listing_views() (security definer); nobody reads it directly.
alter table public.listing_unique_viewers enable row level security;

create or replace function public.increment_listing_views(p_listing_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_seller_id uuid;
  v_new boolean;
begin
  if auth.uid() is null then
    return;
  end if;

  select user_id into v_seller_id from public.listings where id = p_listing_id;
  if v_seller_id is null or v_seller_id = auth.uid() then
    return;
  end if;

  insert into public.listing_unique_viewers (listing_id, viewer_id)
  values (p_listing_id, auth.uid())
  on conflict do nothing;
  get diagnostics v_new = row_count;
  if not v_new then
    return;
  end if;

  update public.listings set views = views + 1 where id = p_listing_id;
  insert into public.listing_view_events (listing_id, seller_id) values (p_listing_id, v_seller_id);
end;
$$;
