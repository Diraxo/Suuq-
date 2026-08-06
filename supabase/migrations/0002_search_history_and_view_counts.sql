-- Suuq+ follow-up schema: search history, atomic view increments, and a
-- favorites_count trigger so listings.favorites_count stays in sync with the
-- favorites table automatically. Run once in the Supabase SQL Editor after 0001_init.sql.

-- ============================================================================
-- search_history
-- ============================================================================
create table if not exists public.search_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  query text not null,
  created_at timestamptz not null default now(),
  unique (user_id, query)
);

alter table public.search_history enable row level security;

drop policy if exists "users manage their own search history" on public.search_history;
create policy "users manage their own search history" on public.search_history
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- Atomic listing view counter
-- ============================================================================
-- Plain client-side `update listings set views = views + 1` isn't safe under
-- concurrent viewers (lost updates), and listings' update RLS policy only
-- allows the owner to write anyway — viewers are usually someone else. This
-- function runs as its definer so any authenticated viewer can bump the
-- count without needing a broader update policy.
create or replace function public.increment_listing_views(p_listing_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.listings set views = views + 1 where id = p_listing_id;
end;
$$;

-- ============================================================================
-- Keep listings.favorites_count in sync with the favorites table
-- ============================================================================
create or replace function public.handle_favorite_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.listings set favorites_count = favorites_count + 1 where id::text = new.listing_id;
  elsif tg_op = 'DELETE' then
    update public.listings set favorites_count = greatest(favorites_count - 1, 0) where id::text = old.listing_id;
  end if;
  return null;
end;
$$;

drop trigger if exists on_favorite_change on public.favorites;
create trigger on_favorite_change
  after insert or delete on public.favorites
  for each row execute function public.handle_favorite_change();
