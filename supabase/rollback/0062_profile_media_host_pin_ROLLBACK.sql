-- ROLLBACK for 0062 (profile media host pin). Run as ONE transaction (SQL editor, or psql --single-transaction).
--
-- Removes only the host pin. It touches NO data and NO other trigger: the 0056 shape rules, the 0057/0059 scan layer (and any rollback
-- freeze from the 0056/0057/0059 rollbacks) stay exactly as they are. After this, while scan enforcement is OFF, the pre-0062 gap is back:
-- a client can again save an own-key avatar/logo/banner whose URL is on ANY https host (docs/MEDIA_LAUNCH_POLICY.md). Rolling back is
-- the correct emergency step if a missing/mistyped storefront_media_hosts row is refusing every image save; the better first fix is to
-- insert the correct host row. Re-applying migrations/0062 restores the pin.
drop trigger if exists profiles_c_media_host_pin on public.profiles;
drop function if exists public.trg_profile_media_host_pin();
drop function if exists public._pmh_check_slot(text, boolean, text, text, text, text);
drop function if exists public._pmh_url_ok(text, text);
