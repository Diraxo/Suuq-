-- ============================================================================
-- Fix: chat message send fails with
--   P0001 trg_enforce_rate_limit: unknown action create_message
--
-- Root cause: 0023_chat_supabase_native.sql added a `create_message` branch
-- (and a `suuqplus.skip_rate_limit` bypass used by touch_last_seen /
-- handle_new_message) to public.trg_enforce_rate_limit(). 0027_admin_foundation.sql
-- later did its own `create or replace function public.trg_enforce_rate_limit()`
-- based on the earlier 0019 version, to add the admin-write bypass and
-- suspension enforcement — but it was branched off 0019, not 0023, so it
-- silently dropped the `create_message` case and the skip_rate_limit bypass
-- when it replaced the function body. The `rate_limit_messages` trigger on
-- public.messages (created in 0023) still calls this function with
-- tg_argv[0] = 'create_message', which now falls through to the `else raise
-- exception` branch on every insert (text or image — both go through the
-- same messages insert).
--
-- Fix: re-create the function combining both: keep 0027's admin-write bypass
-- and suspension enforcement, restore 0023's skip_rate_limit bypass and
-- create_message rate-limit case. No trigger changes needed — the triggers
-- created in earlier migrations already point at this function by name.
-- ============================================================================
create or replace function public.trg_enforce_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('fursad.admin_write', true), '') = 'true' then
    return new;
  end if;

  if current_setting('suuqplus.skip_rate_limit', true) = 'true' then
    return new;
  end if;

  if tg_argv[0] <> 'update_profile' and exists (
    select 1 from public.profiles where id = auth.uid() and account_status = 'suspended'
  ) then
    raise exception 'Account suspended' using errcode = '42501';
  end if;

  case tg_argv[0]
    when 'create_listing' then perform public.enforce_rate_limit('create_listing', 10, interval '1 hour');
    when 'create_offer' then perform public.enforce_rate_limit('create_offer', 20, interval '1 hour');
    when 'create_review' then perform public.enforce_rate_limit('create_review', 10, interval '1 day');
    when 'create_favorite' then perform public.enforce_rate_limit('create_favorite', 60, interval '1 minute');
    when 'create_follow' then perform public.enforce_rate_limit('create_follow', 30, interval '1 minute');
    when 'update_profile' then perform public.enforce_rate_limit('update_profile', 20, interval '1 hour');
    when 'create_message' then perform public.enforce_rate_limit('create_message', 60, interval '1 minute');
    else raise exception 'trg_enforce_rate_limit: unknown action %', tg_argv[0];
  end case;
  return new;
end;
$$;
-- Existing triggers (rate_limit_listings, rate_limit_offers, rate_limit_reviews,
-- rate_limit_favorites, rate_limit_followers, rate_limit_profile_updates,
-- rate_limit_messages) already point at this function by name; `create or
-- replace` updates their behavior in place, no re-creation needed.
