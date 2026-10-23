-- ROLLBACK for 0056 (profile content guard). Run as ONE transaction (SQL editor, or psql --single-transaction).
-- Removes the website / social / hours / length checks. It must NOT remove the only guard on image columns, so:
--   * if the 0057 scan triggers (or a rollback freeze) are installed on profiles, they are left exactly as they are;
--   * otherwise (0056 was the only image guard) a profile MEDIA FREEZE is installed first: a CLIENT write cannot set an avatar, logo or banner
--     to a new value (clearing and re-saving the held value still work). Re-applying 0056 does not lift it; only migrations 0057 + 0059 do
--     (they replace the same trigger). Dropping `profiles_c_business_media_scan` to get the pre-0056 behaviour is a separate, owner-approved
--     operator step, never part of a rollback.
create or replace function public.profile_media_freeze()
returns trigger language plpgsql
as $$
begin
  if not public.is_client_write() then return new; end if;
  if tg_op = 'INSERT' then
    new.avatar_url := null;
    new.avatar_public_id := null;
    if new.business_logo_url is not null or new.business_logo_public_id is not null
       or new.business_banner_url is not null or new.business_banner_public_id is not null then
      raise exception 'This image has not been checked. Image changes are paused.' using errcode = '22023', hint = 'image_not_verified';
    end if;
    return new;
  end if;
  if ((new.avatar_url is distinct from old.avatar_url or new.avatar_public_id is distinct from old.avatar_public_id)
        and (new.avatar_url is not null or new.avatar_public_id is not null))
     or ((new.business_logo_url is distinct from old.business_logo_url or new.business_logo_public_id is distinct from old.business_logo_public_id)
        and (new.business_logo_url is not null or new.business_logo_public_id is not null))
     or ((new.business_banner_url is distinct from old.business_banner_url or new.business_banner_public_id is distinct from old.business_banner_public_id)
        and (new.business_banner_url is not null or new.business_banner_public_id is not null)) then
    raise exception 'This image has not been checked. Image changes are paused.' using errcode = '22023', hint = 'image_not_verified';
  end if;
  return new;
end;
$$;
revoke execute on function public.profile_media_freeze() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_c_business_media_scan' and not tgisinternal) then
    create trigger profiles_c_business_media_scan before insert or update on public.profiles
      for each row execute function public.profile_media_freeze();
  end if;
end $$;

drop trigger if exists profiles_b_guard_content on public.profiles;
drop function if exists public.guard_profile_content();
drop function if exists public.profile_social_ok(jsonb);
alter table public.profiles
  drop constraint if exists profiles_business_description_length,
  drop constraint if exists profiles_business_address_length,
  drop constraint if exists profiles_business_website_length,
  drop constraint if exists profiles_city_length;
