-- Rollback for 0040_support_appeals.sql. DESTRUCTIVE: all support cases, messages and appeals are dropped.
-- (Moderation decisions themselves — events, notices, restored listings — live in 0039 and are untouched.)

drop function if exists public.staff_decide_appeal(uuid, text, text);
drop function if exists public.staff_set_case_status(uuid, text, text);
drop function if exists public.staff_support_reply(uuid, text, boolean);
drop function if exists public.support_withdraw_appeal(uuid);
drop function if exists public.support_open_appeal(text, uuid, text);
drop function if exists public.support_reply(uuid, text);
drop function if exists public.support_open_case(text, text, text, uuid, uuid);
drop function if exists public._notify_support_staff(text, uuid);

drop trigger if exists rate_limit_appeals on public.moderation_appeals;
drop trigger if exists rate_limit_support_messages on public.support_messages;
drop trigger if exists rate_limit_support_cases on public.support_cases;
drop function if exists public.trg_support_message_rate_limit();

drop table if exists public.moderation_appeals;
drop table if exists public.support_case_assignments;
drop table if exists public.support_message_staff;
drop table if exists public.support_messages;
drop table if exists public.support_cases;
