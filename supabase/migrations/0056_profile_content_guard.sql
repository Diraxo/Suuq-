-- 0056 — server-side guard for personal + business profile content (the trusted half of lib/profileRules.ts).
--
-- Why: the mobile app and the website both write public.profiles straight from the client, so every rule enforced only in
-- the UI is advisory. A hand-written request could store `javascript:` as a website, point a "Facebook" button at any site,
-- or set avatar_url to a tracking pixel / someone else's image. This migration rejects those at the database.
--
-- Design:
--   * One BEFORE INSERT/UPDATE trigger, active only for direct client writes (public.is_client_write(), 0038); staff RPCs,
--     the service role and migrations are unaffected.
--   * It validates a column ONLY when that column is being CHANGED, so a legacy row with an old/odd value never blocks an
--     unrelated edit (e.g. changing the bio). It is not retroactive: nothing existing is rewritten or rejected.
--   * Length limits use NOT VALID check constraints for the same reason (apply to new writes, never scan old rows).
--   * Image columns: a managed upload must carry its R2 key (`*_public_id`), the key must be in the caller's OWN folder
--     (same shape r2-presign issues: avatars/{uid}/{uuid}.jpg, business/{uid}/logo|banner/{uuid}.jpg) and the URL must end
--     with that key. Without a key only the legacy hosts the app already used (Google avatars, Cloudinary, picsum) are allowed.
--
-- Not covered here (stated, not hidden): whether the bytes at that URL are really an image is r2-verify-images' job; this
-- only proves the URL/key pair is the caller's own upload slot. The R2 public host is a Edge Function secret, so the host
-- of a managed upload is not pinned in SQL.
--
-- UPDATE 2026-10-21 -- this migration ALONE still has two gaps; both are closed by LATER migrations that are written and PGlite-tested but
-- NOT applied to any database (apply order: this file -> 0057 -> 0058 -> 0059 -> insert the R2_PUBLIC_URL host into storefront_media_hosts -> 0062 -> 0063):
--   * 0062 pins the HOST of a key-bearing avatar/logo/banner (before it, `https://<any host>/<own key>` was accepted). 0062 REQUIRES the host row
--     first, otherwise every image save fails.
--   * 0063 refuses a NEW URL-only value (Google / Cloudinary / picsum, any account on them), which this migration accepts. First-login INSERT of an
--     avatar on lh3.googleusercontent.com is the only tolerated case; unchanged legacy values still pass.
-- Neither scans content: bytes in our own public bucket remain UNSCANNED while 0057's enforce stays OFF (direct-upload policy, see
-- docs/MEDIA_LAUNCH_POLICY.md). Rolling THIS migration back installs the media freeze (0056 rollback), not the weaker pre-0056 behaviour.
--
-- Rollback: drop trigger profiles_b_guard_content on public.profiles; drop function public.guard_profile_content();
--           drop function public.profile_social_ok(jsonb); alter table public.profiles drop constraint ... (names below).

alter table public.profiles
  add constraint profiles_business_description_length check (business_description is null or char_length(business_description) <= 1000) not valid,
  add constraint profiles_business_address_length check (business_address is null or char_length(business_address) <= 250) not valid,
  add constraint profiles_business_website_length check (business_website is null or char_length(business_website) <= 250) not valid,
  add constraint profiles_city_length check (city is null or char_length(city) <= 80) not valid;

-- {"facebook": "https://...", ...}: an object, only the five known keys, each an https URL on that network's own host.
create or replace function public.profile_social_ok(p jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  k text;
  v text;
  host text;
  allowed text[];
begin
  if p is null then return true; end if;
  if jsonb_typeof(p) <> 'object' then return false; end if;
  for k in select jsonb_object_keys(p) loop
    allowed := case k
      when 'facebook' then array['facebook.com', 'fb.com', 'fb.me']
      when 'instagram' then array['instagram.com']
      when 'telegram' then array['t.me', 'telegram.me']
      when 'tiktok' then array['tiktok.com']
      when 'whatsapp' then array['wa.me', 'whatsapp.com']
      else null
    end;
    if allowed is null then return false; end if;
    if jsonb_typeof(p -> k) <> 'string' then return false; end if;
    v := p ->> k;
    if char_length(v) > 250 or v ~ '\s' then return false; end if;
    host := lower(substring(v from '^https://([^/?#:@]+)(?:[:/?#]|$)'));
    if host is null then return false; end if;
    host := regexp_replace(host, '^www\.', '');
    if not exists (select 1 from unnest(allowed) a where host = a or host like '%.' || a) then return false; end if;
  end loop;
  return true;
end;
$$;

create or replace function public.guard_profile_content()
returns trigger
language plpgsql
as $$
declare
  uid text := new.id::text;
  uuid_re constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
  if not public.is_client_write() then
    return new;
  end if;

  if (tg_op = 'INSERT' or new.business_website is distinct from old.business_website)
     and new.business_website is not null
     and new.business_website !~* '^https?://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63}(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' then
    raise exception 'Website must be a valid http(s) address' using errcode = '22023';
  end if;

  if (tg_op = 'INSERT' or new.social_links is distinct from old.social_links) and not public.profile_social_ok(new.social_links) then
    raise exception 'Social links must be https links on the matching network' using errcode = '22023';
  end if;

  if (tg_op = 'INSERT' or new.business_hours is distinct from old.business_hours)
     and new.business_hours is not null
     and (jsonb_typeof(new.business_hours) <> 'object' or octet_length(new.business_hours::text) > 4000) then
    raise exception 'Business hours are not valid' using errcode = '22023';
  end if;

  -- Avatar
  if (tg_op = 'INSERT' or new.avatar_url is distinct from old.avatar_url or new.avatar_public_id is distinct from old.avatar_public_id)
     and (new.avatar_url is not null or new.avatar_public_id is not null) then
    if new.avatar_public_id is not null then
      if new.avatar_public_id !~ ('^avatars/' || uid || '/' || uuid_re || '\.jpg$')
         or new.avatar_url is null or new.avatar_url !~ '^https://' or right(new.avatar_url, char_length(new.avatar_public_id) + 1) <> '/' || new.avatar_public_id then
        raise exception 'Avatar must be your own uploaded photo' using errcode = '22023';
      end if;
    elsif new.avatar_url !~* '^https://(lh3\.googleusercontent\.com|res\.cloudinary\.com|picsum\.photos)/' then
      raise exception 'Avatar must be your own uploaded photo' using errcode = '22023';
    end if;
  end if;

  -- Business logo
  if (tg_op = 'INSERT' or new.business_logo_url is distinct from old.business_logo_url or new.business_logo_public_id is distinct from old.business_logo_public_id)
     and (new.business_logo_url is not null or new.business_logo_public_id is not null) then
    if new.business_logo_public_id is not null then
      if new.business_logo_public_id !~ ('^business/' || uid || '/logo/' || uuid_re || '\.jpg$')
         or new.business_logo_url is null or new.business_logo_url !~ '^https://' or right(new.business_logo_url, char_length(new.business_logo_public_id) + 1) <> '/' || new.business_logo_public_id then
        raise exception 'Logo must be your own uploaded image' using errcode = '22023';
      end if;
    elsif new.business_logo_url !~* '^https://(lh3\.googleusercontent\.com|res\.cloudinary\.com|picsum\.photos)/' then
      raise exception 'Logo must be your own uploaded image' using errcode = '22023';
    end if;
  end if;

  -- Business banner
  if (tg_op = 'INSERT' or new.business_banner_url is distinct from old.business_banner_url or new.business_banner_public_id is distinct from old.business_banner_public_id)
     and (new.business_banner_url is not null or new.business_banner_public_id is not null) then
    if new.business_banner_public_id is not null then
      if new.business_banner_public_id !~ ('^business/' || uid || '/banner/' || uuid_re || '\.jpg$')
         or new.business_banner_url is null or new.business_banner_url !~ '^https://' or right(new.business_banner_url, char_length(new.business_banner_public_id) + 1) <> '/' || new.business_banner_public_id then
        raise exception 'Banner must be your own uploaded image' using errcode = '22023';
      end if;
    elsif new.business_banner_url !~* '^https://(lh3\.googleusercontent\.com|res\.cloudinary\.com|picsum\.photos)/' then
      raise exception 'Banner must be your own uploaded image' using errcode = '22023';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_b_guard_content on public.profiles;
create trigger profiles_b_guard_content
  before insert or update on public.profiles
  for each row execute function public.guard_profile_content();

revoke execute on function public.guard_profile_content() from public, anon, authenticated;
