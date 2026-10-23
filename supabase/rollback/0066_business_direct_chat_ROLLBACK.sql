-- ROLLBACK for 0066 (direct business chat). Run as ONE transaction.
-- Direct conversations have no listing, so they cannot survive listing_id NOT NULL: they are deleted first (their messages and
-- participant rows go with them through ON DELETE CASCADE). Conversations tied to a listing are untouched.
drop function if exists public.start_business_conversation(uuid);
drop index if exists public.conversations_direct_unique;
delete from public.conversations where listing_id is null;
alter table public.conversations alter column listing_id set not null;
