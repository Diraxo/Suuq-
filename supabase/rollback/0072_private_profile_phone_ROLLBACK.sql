-- ROLLBACK for 0072 (private account phone). One transaction, idempotent.
-- Copies every private number back into profiles.phone FIRST (so no number is lost), then removes the trigger, functions and table.
-- WARNING: rolling back puts every phone number back into the publicly readable profiles row (the exposure 0072 closes).
-- Clients released with 0072 call my_phone()/get_contact_phone(); after this rollback those RPCs are gone, so they show no Call button
-- and an empty phone field until the clients are rolled back too. Run only if 0072 itself is faulty.
begin;

drop trigger if exists profiles_e_divert_phone on public.profiles;

alter table public.profiles disable trigger user;
update public.profiles p set phone = pp.phone from private.profile_phones pp where pp.user_id = p.id;
alter table public.profiles enable trigger user;

drop function if exists public.get_contact_phone(uuid, text, uuid);
drop function if exists public.clear_my_phone();
drop function if exists public.my_phone();
drop function if exists private.divert_profile_phone();
drop table if exists private.profile_phones;

comment on column public.profiles.phone is null;

commit;
