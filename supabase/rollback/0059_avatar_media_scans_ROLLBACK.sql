-- ROLLBACK for 0059 (avatar media scans). Run BEFORE rolling back 0057 / 0058. Run as ONE transaction (SQL editor, or psql --single-transaction).
--
-- SECURITY: this rollback does NOT return avatars to the weaker 0056 rule (any https host whose path ends with the caller's own key).
-- It restores 0057's logo/banner scan trigger and adds an unconditional AVATAR FREEZE: while this rollback is in force a CLIENT write
-- (authenticated/anon) cannot set an avatar to a new value at all -- not a key, not a URL, not a Google photo. Clearing an avatar and
-- re-saving the value the user already holds still work, so nobody loses or is locked out of their existing photo. The freeze ignores
-- business_media_config.enforce on purpose: turning enforcement off must not reopen avatars. Re-applying migrations/0059 replaces the
-- freeze with the real scan check (same trigger, create or replace).
--
-- The signup trigger is deliberately NOT restored to the 0001 body (which trusted any URL in user-editable metadata): profiles are still
-- created WITHOUT an avatar. Scan rows of kind 'avatar' are deleted first (the old constraints cannot hold them). Avatars already saved
-- are NOT touched. Writers that are not clients (service role, definer RPCs, operator SQL) are unaffected, as before.
delete from public.business_media_scans where kind = 'avatar';
alter table public.business_media_scans drop constraint if exists business_media_scans_kind_check;
alter table public.business_media_scans add constraint business_media_scans_kind_check check (kind in ('logo', 'banner'));
alter table public.business_media_scans drop constraint if exists business_media_key_shape;
alter table public.business_media_scans add constraint business_media_key_shape check (
  public_key is null or public_key ~ ('^business/' || user_id::text || '/' || kind || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
);

create or replace function public.trg_profile_business_media_scan()
returns trigger language plpgsql
as $$
begin
  if not public.is_client_write() then return new; end if;
  -- AVATAR FREEZE (unconditional)
  if tg_op = 'INSERT' then
    new.avatar_url := null;
    new.avatar_public_id := null;
  elsif (new.avatar_url is distinct from old.avatar_url or new.avatar_public_id is distinct from old.avatar_public_id)
        and (new.avatar_url is not null or new.avatar_public_id is not null) then
    raise exception 'This photo has not been checked. Photo changes are paused.' using errcode = '22023', hint = 'image_not_verified';
  end if;
  if not public.business_media_enforced() then return new; end if;
  if tg_op = 'INSERT' then
    perform public._bm_check_slot(new.id, 'logo', true, null, null, new.business_logo_url, new.business_logo_public_id);
    perform public._bm_check_slot(new.id, 'banner', true, null, null, new.business_banner_url, new.business_banner_public_id);
  else
    perform public._bm_check_slot(new.id, 'logo', false, old.business_logo_url, old.business_logo_public_id, new.business_logo_url, new.business_logo_public_id);
    perform public._bm_check_slot(new.id, 'banner', false, old.business_banner_url, old.business_banner_public_id, new.business_banner_url, new.business_banner_public_id);
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_profile_business_media_scan() from public, anon, authenticated;
drop function if exists public._bm_check_avatar(uuid, boolean, text, text, text, text);

create or replace function public._bm_key_ok(p_owner uuid, p_kind text, p_key text)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.business_media_scans s where s.user_id = p_owner and s.kind = p_kind and s.public_key = p_key and s.status = 'approved')
      or exists (select 1 from public.profiles p where p.id = p_owner and p_key in (p.business_logo_public_id, p.business_banner_public_id))
      or exists (select 1 from public.storefronts f where f.owner_id = p_owner and p_key in (f.logo_public_id, f.banner_public_id));
$$;

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
    null,   -- never trust avatar_url/picture from user-editable metadata (see 0059)
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
