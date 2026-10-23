-- Rollback for 0052. Re-runnable.
drop trigger if exists listings_z_notify_staff on public.listings;
drop function if exists public.trg_listings_notify_staff();
drop trigger if exists profiles_z_notify_staff on public.profiles;
drop function if exists public.trg_profiles_notify_staff();
drop function if exists public.register_web_push(text, text, text, text);
drop table if exists public.web_push_subscriptions;
