-- Rollback for 0060. Re-runnable. Restores the 0052 listing/user triggers by dropping only what 0060 added; re-apply
-- 0052 afterwards to put its original listing trigger body back.
drop function if exists public.staff_alert_health();
drop trigger if exists blocked_users_z_notify_staff on public.blocked_users;
drop function if exists public.trg_blocks_notify_staff();
drop trigger if exists reviews_z_notify_staff on public.reviews;
drop function if exists public.trg_reviews_notify_staff();
drop trigger if exists profiles_z_delete_notify_staff on public.profiles;
drop function if exists public.trg_profiles_delete_notify_staff();
drop trigger if exists profiles_z_edit_notify_staff on public.profiles;
drop function if exists public.trg_profiles_edit_notify_staff();
drop trigger if exists listings_z_delete_notify_staff on public.listings;
drop function if exists public.trg_listings_delete_notify_staff();
drop trigger if exists listings_z_edit_notify_staff on public.listings;
drop function if exists public.trg_listings_edit_notify_staff();
drop function if exists public._staff_alert(text[], text, text, uuid, text, text, jsonb);
drop function if exists public._staff_name(uuid);
