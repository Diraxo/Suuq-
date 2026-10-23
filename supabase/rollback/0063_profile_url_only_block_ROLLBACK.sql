-- ROLLBACK for 0063 (refuse new URL-only avatar / logo / banner values). Run as ONE transaction (SQL editor, or psql --single-transaction).
--
-- Removes only the URL-only block. It touches NO data and NO other trigger: the 0056 shape rules, the 0062 host pin and the 0057/0059 scan
-- layer (and any rollback freeze from the 0056/0057/0059 rollbacks) stay exactly as they are. After this, the URL-only carve-out is back:
-- a client can again save a Google / Cloudinary / picsum URL with no key (docs/MEDIA_LAUNCH_POLICY.md). Re-applying migrations/0063 restores the block.
drop trigger if exists profiles_c_url_only_block on public.profiles;
drop function if exists public.trg_profile_url_only_block();
drop function if exists public._uob_check_slot(text, boolean, boolean, text, text, text);
