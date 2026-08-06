-- Suuq+ follow-up schema: reports (listing/user reports from the Report flow).
-- Run once in the Supabase SQL Editor after 0001_init.sql and 0002_search_history_and_view_counts.sql.

-- ============================================================================
-- reports
-- ============================================================================
-- target_id is `text`, not a FK: it can point at either a real listing uuid or
-- a real user profile uuid depending on target_type, and (same reasoning as
-- favorites.listing_id / recently_viewed.listing_id) the static mock catalogue
-- ('l1', 'l2', ...) can also be reported and isn't a real row.
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('listing', 'user')),
  target_id text not null,
  reason text not null,
  details text,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)
);

alter table public.reports enable row level security;

drop policy if exists "users can view their own reports" on public.reports;
create policy "users can view their own reports" on public.reports
  for select using (auth.uid() = reporter_id);

drop policy if exists "users can file reports as themselves" on public.reports;
create policy "users can file reports as themselves" on public.reports
  for insert with check (auth.uid() = reporter_id);
