-- ROLLBACK for 0057 (business media scans). Run as ONE transaction (SQL editor, or psql --single-transaction).
-- Order: 0059 rollback, then 0058 rollback, then this. 0058 references business_media_scans, so the final DROP TABLE fails (by design) while it
-- exists, and the whole transaction -- including the freeze below -- rolls back with it.
--
-- SECURITY: this rollback does NOT fall back to the 0056 rules (any https host whose path ends with the caller's own key). It replaces the scan
-- triggers with an unconditional MEDIA FREEZE: while it is in force a CLIENT write (authenticated/anon) cannot set a logo, banner or avatar
-- (profiles) or a storefront logo/banner to a new value. Clearing a slot and re-saving the value already held still work, so existing images keep
-- displaying and nothing is deleted. The freeze needs no table and no config row, so it cannot be bypassed by dropping or editing them.
-- Re-applying migrations/0057 (then 0059) replaces the freeze with the real scan checks (same trigger names, create or replace).
-- Writers that are not clients (service role, definer RPCs, operator SQL) are unaffected, as before.
--
-- Private originals (orig-media/...) in the private bucket are NOT touched; their retention is an owner-approved decision
-- (docs/STOREFRONTS_0054_OWNER_DECISIONS.md). Scan rows are deleted with the table.
-- Operational note: rolling back the DATABASE does not roll back r2-presign or the clients. Keep r2-presign refusing avatars/ and business/
-- (a rolled-back presign could issue PUTs into the public bucket; the freeze stops such an object being attached to a profile, but the object
-- itself would be reachable by anyone holding its URL).
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

create or replace function public.storefront_media_freeze()
returns trigger language plpgsql
as $$
begin
  if not public.is_client_write() then return new; end if;
  if ((tg_op = 'INSERT' or new.logo_public_id is distinct from old.logo_public_id) and new.logo_public_id is not null)
     or ((tg_op = 'INSERT' or new.banner_public_id is distinct from old.banner_public_id) and new.banner_public_id is not null) then
    raise exception 'This image has not been checked. Image changes are paused.' using errcode = '22023', hint = 'image_not_verified';
  end if;
  return new;
end;
$$;
revoke execute on function public.storefront_media_freeze() from public, anon, authenticated;

drop trigger if exists profiles_c_business_media_scan on public.profiles;
create trigger profiles_c_business_media_scan before insert or update on public.profiles
  for each row execute function public.profile_media_freeze();
drop trigger if exists storefronts_c_business_media_scan on public.storefronts;
create trigger storefronts_c_business_media_scan before insert or update on public.storefronts
  for each row execute function public.storefront_media_freeze();

drop function if exists public.trg_profile_business_media_scan();
drop function if exists public.trg_storefront_business_media_scan();
drop function if exists public._bm_check_avatar(uuid, boolean, text, text, text, text);
drop function if exists public._bm_check_slot(uuid, text, boolean, text, text, text, text);
drop function if exists public._bm_url_ok(text, text);
drop function if exists public._bm_key_ok(uuid, text, text);
drop table if exists public.business_media_scans;
drop function if exists public.business_media_enforced();
drop table if exists public.business_media_config;
