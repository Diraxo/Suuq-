-- Suuq+ follow-up schema: soft-deactivation for device_tokens.
-- Run once in the Supabase SQL Editor after 0001-0013.
--
-- send-push-notification (supabase/functions/send-push-notification) needs to
-- flag a token as dead when FCM returns UNREGISTERED/INVALID_ARGUMENT without
-- losing the row (unique(token) stays reserved, and it gives visibility into
-- delivery health) instead of hard-deleting it as the previous version did.

alter table public.device_tokens add column if not exists active boolean not null default true;

create index if not exists device_tokens_user_active_idx on public.device_tokens (user_id) where active;
