-- Suuq+ follow-up schema: Stream Chat cutover.
-- Run once in the Supabase SQL Editor after 0001-0012.
--
-- Message storage/read-state moves to Stream Chat (see lib/stream.ts,
-- supabase/functions/stream-token, supabase/functions/stream-webhook).
-- `public.conversations` / `conversation_participants` /
-- find_or_create_conversation() are NOT touched here — they remain the
-- source of the Stream channel id and are still directly depended on by
-- public.offers (0006_offers.sql) and every "open chat" entry point in the
-- app, none of which change.
--
-- The push-notification pipeline that used to run off `on_message_insert`
-- (handle_new_message(), redefined in 0012_push_notifications.sql) is
-- replaced by the stream-webhook edge function, which inserts the same
-- shape of `public.notifications` row directly in response to Stream's
-- `message.new` webhook event — the existing on_notification_insert_push
-- trigger -> send-push-notification -> FCM pipeline is unaffected.

drop trigger if exists on_message_insert on public.messages;
drop function if exists public.handle_new_message();
drop function if exists public.mark_conversation_read(uuid);
drop table if exists public.messages;
