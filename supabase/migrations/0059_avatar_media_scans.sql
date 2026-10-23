-- 0059 — profile avatars join the media scan: server-side proof that a new avatar was checked before it can be saved.
--
-- STATUS: written and tested on PGlite only. NOT applied to any database. Rides the SAME switch as 0057 (business_media_config.enforce):
-- 0057 seeds it EXPLICITLY OFF (owner decision 2026-10-21, direct upload until the scan Worker exists) and reads a missing/NULL value as ON.
-- While OFF, the avatar check below is inert and only 0056 applies (any https host whose URL ends with the user's own key; legacy
-- Google/Cloudinary/picsum URLs). The signup hardening at the bottom is unconditional and applies in either mode.
--
-- Why: avatars were presigned straight into the PUBLIC bucket (no content check) and 0056 accepts ANY https host as long as the URL
-- ends with the key. While ENFORCED (not the shipped state), a CLIENT write that sets a new avatar must reference an 'approved' scan row of that user
-- (kind 'avatar', key avatars/{uid}/{uuid}.jpg) and the URL must be exactly https://<managed host>/<key> (storefront_media_hosts,
-- same allowlist as 0057; EMPTY = fail closed, so this inherits the 0054 hold).
--
-- Grandfathering, as in 0057: the avatar a user ALREADY holds (including a legacy external URL) may be re-saved unchanged and keeps
-- displaying; only a NEW value needs a scan. A new URL-only avatar is ALWAYS refused on update. There is no Google-photo exception any
-- more: a Google (or any external) photo is untrusted and is never copied into the profile. On a client INSERT (the app's first-login
-- fallback for the signup trigger) a URL-only avatar is silently dropped (set to NULL) rather than raising, so an old app build that
-- still sends the Google photo cannot lock a new user out of sign-in.
-- Non-client writers (the signup trigger, backfills, operator SQL) are not checked by the client trigger.
--
-- Interaction with later migrations (2026-10-21, written + PGlite-tested, NOT applied). The 'A new URL-only avatar is ALWAYS refused on update'
-- sentence above holds only while ENFORCED. While OFF (shipped) a new URL-only avatar on Google / Cloudinary / picsum is accepted by this
-- migration + 0056; migration 0063 closes that for updates (first-login INSERT of an lh3.googleusercontent.com avatar is the single tolerated
-- case while OFF; ON still drops it to NULL here first). 0062 pins the host of a key-bearing avatar and needs a storefront_media_hosts row first.
-- Direct-upload avatars remain UNSCANNED while the switch is OFF. Apply order: ... -> 0059 -> insert host -> 0062 -> 0063; rollback in reverse.

alter table public.business_media_scans drop constraint if exists business_media_scans_kind_check;
alter table public.business_media_scans add constraint business_media_scans_kind_check check (kind in ('logo', 'banner', 'avatar'));

alter table public.business_media_scans drop constraint if exists business_media_key_shape;
alter table public.business_media_scans add constraint business_media_key_shape check (
  public_key is null
  or (kind <> 'avatar' and public_key ~ ('^business/' || user_id::text || '/' || kind || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'))
  or (kind = 'avatar' and public_key ~ ('^avatars/' || user_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'))
);

-- Kind-aware: a business key can never authorise an avatar slot (or the reverse) through the "already held" clauses.
create or replace function public._bm_key_ok(p_owner uuid, p_kind text, p_key text)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.business_media_scans s where s.user_id = p_owner and s.kind = p_kind and s.public_key = p_key and s.status = 'approved')
      or (p_kind = 'avatar' and exists (select 1 from public.profiles p where p.id = p_owner and p.avatar_public_id = p_key))
      or (p_kind <> 'avatar' and (
            exists (select 1 from public.profiles p where p.id = p_owner and p_key in (p.business_logo_public_id, p.business_banner_public_id))
         or exists (select 1 from public.storefronts f where f.owner_id = p_owner and p_key in (f.logo_public_id, f.banner_public_id))));
$$;

create or replace function public._bm_check_avatar(p_owner uuid, p_is_insert boolean, p_old_url text, p_old_key text, p_new_url text, p_new_key text)
returns void language plpgsql stable security invoker set search_path = public, pg_temp
as $$
begin
  if not p_is_insert and p_new_url is not distinct from p_old_url and p_new_key is not distinct from p_old_key then return; end if;
  if p_new_key is not null then
    if (p_is_insert or p_new_key is distinct from p_old_key) and not public._bm_key_ok(p_owner, 'avatar', p_new_key) then
      raise exception 'This photo has not been checked. Upload it again.' using errcode = '22023', hint = 'image_not_verified';
    end if;
    if not public._bm_url_ok(p_new_url, p_new_key) then
      raise exception 'This photo has not been checked. Upload it again.' using errcode = '22023', hint = 'image_not_verified';
    end if;
  elsif p_new_url is not null and (p_is_insert or p_new_url is distinct from p_old_url) then
    raise exception 'This photo has not been checked. Upload it again.' using errcode = '22023', hint = 'image_not_verified';
  end if;
end;
$$;
revoke execute on function public._bm_check_avatar(uuid, boolean, text, text, text, text) from public, anon;
grant execute on function public._bm_check_avatar(uuid, boolean, text, text, text, text) to authenticated;

create or replace function public.trg_profile_business_media_scan()
returns trigger language plpgsql
as $$
begin
  if not public.is_client_write() or not public.business_media_enforced() then return new; end if;
  if tg_op = 'INSERT' then
    if new.avatar_public_id is null then new.avatar_url := null; end if;   -- external/URL-only photo on first login: dropped, never trusted
    perform public._bm_check_slot(new.id, 'logo', true, null, null, new.business_logo_url, new.business_logo_public_id);
    perform public._bm_check_slot(new.id, 'banner', true, null, null, new.business_banner_url, new.business_banner_public_id);
    perform public._bm_check_avatar(new.id, true, null, null, new.avatar_url, new.avatar_public_id);
  else
    perform public._bm_check_slot(new.id, 'logo', false, old.business_logo_url, old.business_logo_public_id, new.business_logo_url, new.business_logo_public_id);
    perform public._bm_check_slot(new.id, 'banner', false, old.business_banner_url, old.business_banner_public_id, new.business_banner_url, new.business_banner_public_id);
    perform public._bm_check_avatar(new.id, false, old.avatar_url, old.avatar_public_id, new.avatar_url, new.avatar_public_id);
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_profile_business_media_scan() from public, anon, authenticated;

-- Signup hardening (unconditional). raw_user_meta_data is editable by the user (auth.updateUser / signUp options.data), and this
-- SECURITY DEFINER trigger is not a "client write", so any URL in it became a public avatar. No external photo is trusted: the new
-- profile starts without an avatar (the app shows initials/placeholder) and the user adds one through the scan pipeline.
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
    null,
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
