-- ============================================================================
-- Fix: website publish eventually fails with
--   P0001  Rate limit exceeded for "create_listing": try again later.
--
-- Root cause: `rate_limit_listings` (0019_security_hardening.sql) is a
-- BEFORE INSERT ... FOR EACH ROW trigger on public.listings that records one
-- `create_listing` rate_limit_events row per proposed insert, capping a user
-- at 10 per hour.
--
-- Part 2 made the web createListing() (web/src/services/listings.ts) retry
-- safe: it now sends an idempotent `INSERT ... ON CONFLICT (id) DO UPDATE`
-- (supabase-js .upsert) keyed by a stable client-generated UUID, so a lost
-- network response on a publish that actually committed cannot create a
-- duplicate listing on retry.
--
-- But PostgreSQL fires BEFORE INSERT triggers for the proposed row *before*
-- it detects the ON CONFLICT and switches to the UPDATE path. So every retry
-- of an already-committed publish still fires this trigger and still records
-- a `create_listing` event even though it resolves to an UPDATE, not a new
-- listing. A seller who retries a flaky publish a few times silently burns
-- the whole 10/hour quota and then cannot publish at all.
--
-- Same class of bug as 0028_fix_rate_limit_create_message.sql: a rate-limit
-- trigger firing on a write that isn't the end-user action it's meant to be
-- limiting.
--
-- Fix: in trg_enforce_rate_limit(), enforce/record the create_listing limit
-- only when the row is genuinely new -- i.e. no listings row with this id
-- already exists. Column defaults (id := gen_random_uuid()) are applied
-- before this BEFORE INSERT trigger sees NEW, so NEW.id is always populated
-- and the existence check is exact. A brand-new listing (fresh uuid, client-
-- or server-generated) still counts; an idempotent retry that resolves to the
-- UPDATE half of the upsert does not.
--
-- Safety / non-goals:
--   * Genuine new-listing creation is unchanged: still 10/hour, 11th still
--     rejected with P0001. Each new listing needs a new uuid, and each new
--     uuid passes `not exists` and is counted. Reusing an existing id can
--     only ever UPDATE that one row, never create a listing.
--   * RLS is untouched. The upsert's UPDATE half is still gated by
--     "users can update their own listings" USING (auth.uid() = user_id),
--     evaluated against the existing row -- a client passing another user's
--     id gets an RLS no-op (PGRST116), not a silent takeover. This change
--     does not widen that.
--   * No trigger re-creation -- rate_limit_listings and the other
--     rate_limit_* triggers already call this function by name; `create or
--     replace` swaps the body in place.
--   * All other 0028 behavior preserved verbatim: fursad.admin_write bypass,
--     suspension enforcement, suuqplus.skip_rate_limit bypass, create_message.
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
    when 'create_listing' then
      -- Only a genuinely new listing counts toward the limit. An
      -- `INSERT ... ON CONFLICT (id) DO UPDATE` retry (an idempotent publish
      -- re-send with a stable client id) fires this BEFORE INSERT trigger
      -- even though it resolves to an UPDATE -- don't let that burn the
      -- seller's hourly quota. See migration header.
      if not exists (select 1 from public.listings where id = new.id) then
        perform public.enforce_rate_limit('create_listing', 10, interval '1 hour');
      end if;
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
