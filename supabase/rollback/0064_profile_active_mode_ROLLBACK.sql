-- ROLLBACK for 0064 (active profile identity). Run as ONE transaction (SQL editor, or psql --single-transaction).
-- Drops the switch, its guard and the column. Touches no other column. After this, clients that read active_mode fall back to the
-- rule "an account with a business name shows its business profile" (lib/profileIdentity.ts activeMode()), i.e. the pre-0064 behaviour.
drop trigger if exists profiles_d_guard_active_mode on public.profiles;
drop function if exists public.guard_profile_active_mode();
drop function if exists public.set_active_mode(text);
alter table public.profiles drop constraint if exists profiles_active_mode_check;
alter table public.profiles drop column if exists active_mode;
