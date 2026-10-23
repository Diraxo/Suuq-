-- 0063 — refuse NEW URL-only (no storage key) avatar / logo / banner values from clients. Closes the "URL-only carve-out" left open by 0062.
--
-- STATUS: written and tested on PGlite only. NOT applied to any database. Requires 0038 (is_client_write) and 0056. It does NOT need 0062 and
-- does NOT depend on storefront_media_hosts, so it has no host-list apply-order hazard (unlike 0062). It is a separate trigger with its own
-- rollback so it can be applied, held back or rolled back independently of 0062.
--
-- Why: 0056 accepts a value with no key when the URL is on one of three legacy hosts (lh3.googleusercontent.com, res.cloudinary.com, picsum.photos).
-- res.cloudinary.com/<ANY account>/... and picsum are attacker-reachable, so a hand-written request can still make every viewer's app load
-- content the operator never uploaded or scanned. No client at repository HEAD writes a URL-only logo or banner, and none writes a URL-only
-- avatar except the first-login fallback upsert (which copied the Google photo; the working copy now sends null).
--
-- Rule (client writes only, public.is_client_write(); staff RPCs, the 0054 mirror, backfills, the service role and operator SQL are not checked).
-- A slot is examined ONLY when its URL is NEW (INSERT, or url differs from the old row) AND no key is sent:
--   * key present            -> not touched here (0056 shape rules, 0062 host pin, 0057/0059 scan layer).
--   * URL null (clearing)    -> always allowed.
--   * URL-only, URL unchanged-> allowed. An existing legacy Google / Cloudinary / picsum / foreign URL never blocks an unrelated edit, is not
--                               rewritten and is not deleted; re-saving it, or dropping only its stale key, introduces nothing new.
--   * URL-only, URL new      -> refused (22023, hint 'url_only_not_allowed'), EXCEPT the single first-login case below.
-- First-login exception: INSERT of an AVATAR whose URL is on lh3.googleusercontent.com (what the app's profile-fallback upsert sent before the
-- working copy stopped copying the Google photo). It is deliberately narrow: avatar only, INSERT only, Google host only. Logo and banner
-- URL-only values are never accepted on insert. NOTE for an existing user: supabase upsert fires the BEFORE INSERT trigger first and then, on
-- conflict, the BEFORE UPDATE trigger with the new URL. The UPDATE step refuses a changed URL-only value, so the exception cannot be used to
-- change an existing profile's photo. (The on_auth_user_created trigger creates the row with the auth user, so the fallback insert is a
-- practical dead path; the exception only keeps an old build's first-login from failing on a genuinely missing row.)
-- With scan enforcement ON, 0059 nulls a first-login external avatar BEFORE this trigger looks at it (trigger order: b_guard_content,
-- c_business_media_scan, c_media_host_pin, c_url_only_block).
--
-- Compatibility cost (stated, not hidden): a hypothetical pre-R2 (Cloudinary-era, repository commit 3975369) build that is still installed
-- would get a refusal when it CHANGES its photo/logo/banner; its other edits are unaffected. No evidence in the repository shows whether any such
-- build was ever distributed or is still in use (no store/EAS build metadata, no version gate, no minimum-version mechanism), so no minimum
-- supported version is assumed. Every build from d22fe4a (R2 uploads) on writes a key and is unaffected.
--
-- Remaining gaps: a row already holding a foreign / URL-only value keeps it until the user changes that slot (no backfill, by design); a
-- key-bearing value is only as strong as 0056 + 0062; this is not a content scan.
--
-- Rollback: supabase/rollback/0063_profile_url_only_block_ROLLBACK.sql (drops this trigger and its functions; touches no data).

create or replace function public._uob_check_slot(p_label text, p_is_insert boolean, p_is_avatar boolean, p_old_url text, p_new_url text, p_new_key text)
returns void language plpgsql immutable security invoker set search_path = public, pg_temp
as $$
begin
  if p_new_url is null or p_new_key is not null then return; end if;          -- cleared, or keyed (other layers)
  if not p_is_insert and p_new_url is not distinct from p_old_url then return; end if; -- existing legacy URL, nothing new
  if p_is_insert and p_is_avatar and char_length(p_new_url) <= 2048 and p_new_url ~* '^https://lh3\.googleusercontent\.com/' then return; end if; -- first-login fallback
  raise exception 'This % must be uploaded again.', p_label using errcode = '22023', hint = 'url_only_not_allowed';
end;
$$;
revoke execute on function public._uob_check_slot(text, boolean, boolean, text, text, text) from public, anon;
grant execute on function public._uob_check_slot(text, boolean, boolean, text, text, text) to authenticated;

-- Invoker on purpose (is_client_write() reads current_user). Named so it fires AFTER profiles_c_media_host_pin.
create or replace function public.trg_profile_url_only_block()
returns trigger language plpgsql
as $$
begin
  if not public.is_client_write() then return new; end if;
  if tg_op = 'INSERT' then
    perform public._uob_check_slot('photo', true, true, null, new.avatar_url, new.avatar_public_id);
    perform public._uob_check_slot('logo', true, false, null, new.business_logo_url, new.business_logo_public_id);
    perform public._uob_check_slot('banner', true, false, null, new.business_banner_url, new.business_banner_public_id);
  else
    perform public._uob_check_slot('photo', false, true, old.avatar_url, new.avatar_url, new.avatar_public_id);
    perform public._uob_check_slot('logo', false, false, old.business_logo_url, new.business_logo_url, new.business_logo_public_id);
    perform public._uob_check_slot('banner', false, false, old.business_banner_url, new.business_banner_url, new.business_banner_public_id);
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_profile_url_only_block() from public, anon, authenticated;

drop trigger if exists profiles_c_url_only_block on public.profiles;
create trigger profiles_c_url_only_block before insert or update on public.profiles
  for each row execute function public.trg_profile_url_only_block();
