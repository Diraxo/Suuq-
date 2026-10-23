-- 0044 — block enforcement on the base listings table, chat and offers. Needs 0043. Tested in supabase/tests/block_enforcement.test.mjs.
-- Rollback: supabase/rollback/0044_block_enforcement_ROLLBACK.sql. (Replaces the earlier policy-only proposal.)
--
-- ONE RULE, enforced in the database: when either user has blocked the other,
--   (1) neither can READ the other's listings  (base-table RLS policy; closes direct PostgREST `from('listings')` reads),
--   (2) neither can START anything with the other: new conversation, new offer, counter-offer, accept, new message.
-- Block rows stay private: blocked_users keeps its single "own rows only" policy, and nothing here is callable from the API.
--
-- WHY the chat/offers review changed the design of the earlier proposal. Auditing every workflow that touches listings:
--   * chat list / chat screen / offers inbox embed `listing:listings(...)` (PostgREST LEFT join) and read `row.listing?.x`,
--     so a hidden listing only blanks the title/image of a thread with a blocked person; no thread is dropped and nothing
--     errors. (Clients now show an explicit "listing unavailable" label instead of an empty title / 0 price.)
--   * find_or_create_conversation / create_offer / respond_to_offer are SECURITY DEFINER: they read listings as the owner,
--     so the RLS policy never applied to them — and they never checked blocks at all. A blocked user could still open a
--     chat, send offers and send messages by calling the RPC / inserting into messages directly. (A pure policy change, like
--     the first proposal, would NOT have closed that. Triggers do, and they work for definer functions too.)
--   * Existing, NON-blocked conversations and offers are untouched: the policy only hides a row whose owner is one of the
--     caller's blocked_either_way() counterparties. History between two users stays readable (messages / offers tables);
--     only the listing row is hidden, and decline/cancel/expire of an old offer stay allowed so nobody is trapped.
--
-- Error text is the same one a missing listing gives ('Listing not found'), so a blocked caller cannot tell "blocked" from "gone".

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Base listings policy: block-aware (owner and staff always see the row)
-- ---------------------------------------------------------------------------------------------------------------------
drop policy if exists "listings are publicly readable" on public.listings;
create policy "listings are publicly readable" on public.listings
  for select using (
    (status not in ('removed', 'deactivated') or auth.uid() = user_id or public.is_staff())
    and (auth.uid() = user_id or public.is_staff() or user_id <> all((select private.blocked_either_way())::uuid[]))
  );

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Pair check used only by the triggers below. SECURITY DEFINER (blocked_users is RLS-private), in schema `private`
--    (not exposed by PostgREST), no EXECUTE for API roles -> it cannot be used as an oracle about third parties.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function private.users_blocked(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.blocked_users x
     where (x.blocker_id = p_a and x.blocked_id = p_b) or (x.blocker_id = p_b and x.blocked_id = p_a)
  );
$$;
revoke all on function private.users_blocked(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Write-path guards. Trigger functions run as their owner; the pair is read from the row, never from the caller, so
--    they also hold for service-role / definer inserts (find_or_create_conversation, create_offer, respond_to_offer).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function private.guard_conversation_block()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if private.users_blocked(new.buyer_id, new.seller_id) then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_conversation_block() from public, anon, authenticated;
drop trigger if exists conversations_block_guard on public.conversations;
create trigger conversations_block_guard before insert on public.conversations
  for each row execute function private.guard_conversation_block();

-- New offers (including counters, which insert a row) and the move to 'accepted'. Reject / cancel / expire stay allowed.
create or replace function private.guard_offer_block()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and not (new.status = 'accepted' and old.status is distinct from 'accepted') then
    return new;
  end if;
  if private.users_blocked(new.buyer_id, new.seller_id) then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_offer_block() from public, anon, authenticated;
drop trigger if exists offers_block_guard_insert on public.offers;
create trigger offers_block_guard_insert before insert on public.offers
  for each row execute function private.guard_offer_block();
drop trigger if exists offers_block_guard_accept on public.offers;
create trigger offers_block_guard_accept before update of status on public.offers
  for each row execute function private.guard_offer_block();

create or replace function private.guard_message_block()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_buyer uuid;
  v_seller uuid;
begin
  select c.buyer_id, c.seller_id into v_buyer, v_seller from public.conversations c where c.id = new.conversation_id;
  if v_buyer is not null and private.users_blocked(v_buyer, v_seller) then
    raise exception 'Conversation not available' using errcode = 'P0002';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_message_block() from public, anon, authenticated;
drop trigger if exists messages_block_guard on public.messages;
create trigger messages_block_guard before insert on public.messages
  for each row execute function private.guard_message_block();
