-- 0062 — pin the HOST of a client-written avatar / logo / banner to the operator-managed media host list.
--
-- STATUS: written and tested on PGlite only. NOT applied to any database. Requires 0054 (storefront_media_hosts) and 0056.
-- APPLY ORDER (hard): storefront_media_hosts must already contain the host of the production R2_PUBLIC_URL, otherwise EVERY avatar, logo
-- and banner upload fails (fail closed, same convention as 0054/0057). docs/MEDIA_LAUNCH_POLICY.md and docs/MEDIA_STAGING_RUNBOOK.md
-- carry the preflight query. This migration deliberately seeds NO host: the real value is an Edge Function secret and is not in the repo.
--
-- Why: while scan enforcement is OFF (0057 seeds business_media_config.enforce=false, direct-upload policy 2026-10-21) the only rule on
-- a managed image is 0056's: the key is the caller's own AND the URL merely ENDS with that key. So `https://evil.example/<own key>` was
-- accepted and every viewer's app/browser then loaded an attacker-chosen URL (tracking pixel, hot-linked or swapped content). This
-- trigger closes exactly that hole and nothing else. It is independent of business_media_config.enforce: it applies in both modes.
--
-- Rule (client writes only, i.e. public.is_client_write(); staff RPCs, the 0054 mirror, backfills, the service role and operator SQL
-- are not checked). A slot is examined ONLY when it is changed (INSERT, or url/key differ from the old row):
--   * key present  -> the URL must be EXACTLY  https://<host>/<key>  where <host> is a row of storefront_media_hosts
--                     (lower-cased compare; no port, userinfo, query, fragment, trailing dot, or any other path).
--   * key absent, URL present -> NOT touched here. 0056 limits it to the three legacy hosts (Google, Cloudinary, picsum); migration 0063 (separate,
--                     also unapplied) refuses NEW URL-only values and tolerates only a first-login avatar on lh3.googleusercontent.com.
--   * both null    -> clearing is always allowed.
-- Unchanged slots are never checked, so an existing legacy / foreign-host value does not block an unrelated profile edit, is not
-- rewritten, and is not deleted. Re-saving the SAME url+key pair is a no-change and passes.
--
-- Known remaining gaps (stated, not hidden; also in docs/MEDIA_LAUNCH_POLICY.md):
--   1. A URL-only value on the three legacy hosts (res.cloudinary.com/<any account>/..., lh3.googleusercontent.com/..., picsum.photos/...) is NOT
--      handled by THIS migration. It is handled by 0063, which must be applied for that gap to close (apply 0062 then 0063; each has its own
--      rollback). Applying 0062 alone leaves it open. The compatibility cost of 0063 is an OWNER DECISION (see that file's header).
--   2. A row already holding a foreign-host URL keeps it until the user changes that slot (no backfill, by design).
--   3. This is not a content scan and does not verify what the bytes at the URL are.
--
-- Not a content scan: images uploaded directly stay UNSCANNED while business_media_config.enforce is OFF (docs/MEDIA_LAUNCH_POLICY.md).
--
-- Rollback: supabase/rollback/0062_profile_media_host_pin_ROLLBACK.sql (drops this trigger and its functions; touches no data).

create or replace function public._pmh_url_ok(p_url text, p_key text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_host text;
begin
  if p_url is null or p_key is null or char_length(p_url) > 2048 or char_length(p_key) > 300 then return false; end if;
  v_host := substring(p_url from '^https://([A-Za-z0-9.-]+)/');
  if v_host is null or p_url <> 'https://' || v_host || '/' || p_key then return false; end if;
  return exists (select 1 from public.storefront_media_hosts h where h.host = lower(v_host));
end;
$$;
revoke execute on function public._pmh_url_ok(text, text) from public, anon;
grant execute on function public._pmh_url_ok(text, text) to authenticated;

create or replace function public._pmh_check_slot(p_label text, p_is_insert boolean, p_old_url text, p_old_key text, p_new_url text, p_new_key text)
returns void language plpgsql stable security invoker set search_path = public, pg_temp
as $$
begin
  if not p_is_insert and p_new_url is not distinct from p_old_url and p_new_key is not distinct from p_old_key then return; end if;
  if p_new_key is null then return; end if;      -- cleared, or URL-only (legacy hosts, governed by 0056)
  if not public._pmh_url_ok(p_new_url, p_new_key) then
    raise exception 'This % address is not allowed. Upload it again.', p_label using errcode = '22023', hint = 'image_host_not_allowed';
  end if;
end;
$$;
revoke execute on function public._pmh_check_slot(text, boolean, text, text, text, text) from public, anon;
grant execute on function public._pmh_check_slot(text, boolean, text, text, text, text) to authenticated;

-- Invoker on purpose (is_client_write() reads current_user). Named so it fires AFTER profiles_b_guard_content (0056 shape rules) and AFTER
-- profiles_c_business_media_scan (0057/0059 scan layer, which may null a first-login avatar before this one looks at it).
create or replace function public.trg_profile_media_host_pin()
returns trigger language plpgsql
as $$
begin
  if not public.is_client_write() then return new; end if;
  if tg_op = 'INSERT' then
    perform public._pmh_check_slot('photo', true, null, null, new.avatar_url, new.avatar_public_id);
    perform public._pmh_check_slot('logo', true, null, null, new.business_logo_url, new.business_logo_public_id);
    perform public._pmh_check_slot('banner', true, null, null, new.business_banner_url, new.business_banner_public_id);
  else
    perform public._pmh_check_slot('photo', false, old.avatar_url, old.avatar_public_id, new.avatar_url, new.avatar_public_id);
    perform public._pmh_check_slot('logo', false, old.business_logo_url, old.business_logo_public_id, new.business_logo_url, new.business_logo_public_id);
    perform public._pmh_check_slot('banner', false, old.business_banner_url, old.business_banner_public_id, new.business_banner_url, new.business_banner_public_id);
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_profile_media_host_pin() from public, anon, authenticated;

drop trigger if exists profiles_c_media_host_pin on public.profiles;
create trigger profiles_c_media_host_pin before insert or update on public.profiles
  for each row execute function public.trg_profile_media_host_pin();

do $$
begin
  if not exists (select 1 from public.storefront_media_hosts) then
    raise warning '0062: storefront_media_hosts is EMPTY. Every client avatar/logo/banner save will be refused until the R2_PUBLIC_URL host is inserted (see docs/MEDIA_STAGING_RUNBOOK.md).';
  end if;
end $$;
