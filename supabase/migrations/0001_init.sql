-- Suuq+ initial backend schema: profiles, marketplace tables, RLS, storage bucket.
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query -> paste -> Run).

-- ============================================================================
-- profiles
-- ============================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  email text,
  phone text,
  city text,
  region text,
  country text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles are publicly readable" on public.profiles;
create policy "profiles are publicly readable" on public.profiles
  for select using (true);

drop policy if exists "users can insert their own profile" on public.profiles;
create policy "users can insert their own profile" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile" on public.profiles
  for update using (auth.uid() = id);

-- Auto-create a profile row the moment a new auth user is created (Google
-- sign-in included), so the app never has to race a client-side insert.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- listings
-- ============================================================================
-- FKs below point at public.profiles(id) rather than auth.users(id) — profiles.id
-- is 1:1 with auth.users.id (created by the trigger above), and PostgREST can only
-- auto-embed joins across tables that both live in `public`, so this is what lets
-- e.g. store/follow.ts and the reviews store join straight to profiles.
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  description text,
  category text,
  subcategory text,
  condition text,
  price numeric not null default 0,
  currency text not null default 'USD',
  city text,
  region text,
  images text[] not null default '{}',
  phone text,
  phone_public boolean not null default false,
  negotiable boolean not null default false,
  -- Not part of the requested column list, but required to keep the existing
  -- app UI (types/index.ts Listing.views / favoritesCount / attributes) working unchanged.
  views int not null default 0,
  favorites_count int not null default 0,
  attributes jsonb not null default '{}'::jsonb,
  status text not null default 'available' check (status in ('available', 'reserved', 'sold', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.listings enable row level security;

drop policy if exists "listings are publicly readable" on public.listings;
create policy "listings are publicly readable" on public.listings
  for select using (true);

drop policy if exists "users can insert their own listings" on public.listings;
create policy "users can insert their own listings" on public.listings
  for insert with check (auth.uid() = user_id);

drop policy if exists "users can update their own listings" on public.listings;
create policy "users can update their own listings" on public.listings
  for update using (auth.uid() = user_id);

drop policy if exists "users can delete their own listings" on public.listings;
create policy "users can delete their own listings" on public.listings
  for delete using (auth.uid() = user_id);

-- ============================================================================
-- favorites
-- ============================================================================
-- listing_id is `text`, not a FK to listings.id: the app still shows a static
-- mock catalogue alongside real listings during this migration (see AGENT.md
-- §9), and mock listing ids ('l1', 'l2', ...) are not real rows/valid uuids.
create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  listing_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, listing_id)
);

alter table public.favorites enable row level security;

drop policy if exists "users manage their own favorites" on public.favorites;
create policy "users manage their own favorites" on public.favorites
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- recently_viewed
-- ============================================================================
-- Same reasoning as favorites.listing_id above: plain text, no FK.
create table if not exists public.recently_viewed (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  listing_id text not null,
  viewed_at timestamptz not null default now(),
  unique (user_id, listing_id)
);

alter table public.recently_viewed enable row level security;

drop policy if exists "users manage their own recently viewed" on public.recently_viewed;
create policy "users manage their own recently viewed" on public.recently_viewed
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- followers
-- ============================================================================
create table if not exists public.followers (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (follower_id, following_id),
  check (follower_id <> following_id)
);

alter table public.followers enable row level security;

drop policy if exists "follow relationships are publicly readable" on public.followers;
create policy "follow relationships are publicly readable" on public.followers
  for select using (true);

drop policy if exists "users can follow as themselves" on public.followers;
create policy "users can follow as themselves" on public.followers
  for insert with check (auth.uid() = follower_id);

drop policy if exists "users can unfollow as themselves" on public.followers;
create policy "users can unfollow as themselves" on public.followers
  for delete using (auth.uid() = follower_id);

-- ============================================================================
-- reviews
-- ============================================================================
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  check (reviewer_id <> seller_id)
);

alter table public.reviews enable row level security;

drop policy if exists "reviews are publicly readable" on public.reviews;
create policy "reviews are publicly readable" on public.reviews
  for select using (true);

drop policy if exists "users can leave reviews as themselves" on public.reviews;
create policy "users can leave reviews as themselves" on public.reviews
  for insert with check (auth.uid() = reviewer_id);

drop policy if exists "users can edit their own reviews" on public.reviews;
create policy "users can edit their own reviews" on public.reviews
  for update using (auth.uid() = reviewer_id);

drop policy if exists "users can delete their own reviews" on public.reviews;
create policy "users can delete their own reviews" on public.reviews
  for delete using (auth.uid() = reviewer_id);

-- ============================================================================
-- saved_searches
-- ============================================================================
create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  search_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.saved_searches enable row level security;

drop policy if exists "users manage their own saved searches" on public.saved_searches;
create policy "users manage their own saved searches" on public.saved_searches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- price_drops
-- ============================================================================
create table if not exists public.price_drops (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  old_price numeric not null,
  new_price numeric not null,
  created_at timestamptz not null default now()
);

alter table public.price_drops enable row level security;

drop policy if exists "price drops are publicly readable" on public.price_drops;
create policy "price drops are publicly readable" on public.price_drops
  for select using (true);

drop policy if exists "listing owners can record price drops" on public.price_drops;
create policy "listing owners can record price drops" on public.price_drops
  for insert with check (
    exists (
      select 1 from public.listings l
      where l.id = listing_id and l.user_id = auth.uid()
    )
  );

-- ============================================================================
-- notifications
-- ============================================================================
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

drop policy if exists "users manage their own notifications" on public.notifications;
create policy "users manage their own notifications" on public.notifications
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- Storage: listing-images bucket
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('listing-images', 'listing-images', true)
on conflict (id) do nothing;

drop policy if exists "listing images are publicly readable" on storage.objects;
create policy "listing images are publicly readable" on storage.objects
  for select using (bucket_id = 'listing-images');

drop policy if exists "users can upload their own listing images" on storage.objects;
create policy "users can upload their own listing images" on storage.objects
  for insert with check (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users can update their own listing images" on storage.objects;
create policy "users can update their own listing images" on storage.objects
  for update using (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users can delete their own listing images" on storage.objects;
create policy "users can delete their own listing images" on storage.objects
  for delete using (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
