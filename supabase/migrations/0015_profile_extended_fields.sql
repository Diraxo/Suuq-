-- Suuq+ profile system upgrade: Edit Profile + Business Profile fields, an
-- automatic updated_at trigger (previously set manually by every caller —
-- see store/myListings.ts's dbPatch.updated_at for the listings equivalent),
-- and Realtime so profile edits propagate to every open screen instantly
-- (store/auth.ts subscribes to this). Run once after 0001-0014.

alter table public.profiles
  add column if not exists phone_country text,
  add column if not exists gender text,
  add column if not exists birthday date,
  add column if not exists bio text,
  add column if not exists business_name text,
  add column if not exists business_description text,
  add column if not exists business_address text,
  add column if not exists business_website text,
  add column if not exists business_hours jsonb not null default '{}'::jsonb,
  add column if not exists business_logo_url text,
  add column if not exists business_banner_url text,
  add column if not exists delivery_available boolean not null default false,
  add column if not exists social_links jsonb not null default '{}'::jsonb;

create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_profile_updated_at();

alter publication supabase_realtime add table public.profiles;
