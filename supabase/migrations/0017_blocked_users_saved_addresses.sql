-- Suuq+ Settings expansion: Blocked Users and Saved Addresses. Both are
-- purely private to the owning user (unlike followers/reviews, nothing here
-- is publicly readable). Run once after 0016.

create table if not exists public.blocked_users (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocked_users_not_self check (blocker_id <> blocked_id)
);

alter table public.blocked_users enable row level security;

drop policy if exists "users manage their own blocks" on public.blocked_users;
create policy "users manage their own blocks" on public.blocked_users
  for all using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

create table if not exists public.saved_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text not null,
  address text not null,
  city text,
  created_at timestamptz not null default now()
);

alter table public.saved_addresses enable row level security;

drop policy if exists "users manage their own saved addresses" on public.saved_addresses;
create policy "users manage their own saved addresses" on public.saved_addresses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
