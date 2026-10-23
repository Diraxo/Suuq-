-- Rollback for supabase/migrations/0044_block_enforcement.sql. Re-runnable. Restores the 0039 listings policy.
drop trigger if exists messages_block_guard on public.messages;
drop trigger if exists offers_block_guard_accept on public.offers;
drop trigger if exists offers_block_guard_insert on public.offers;
drop trigger if exists conversations_block_guard on public.conversations;
drop function if exists private.guard_message_block();
drop function if exists private.guard_offer_block();
drop function if exists private.guard_conversation_block();
drop function if exists private.users_blocked(uuid, uuid);

drop policy if exists "listings are publicly readable" on public.listings;
create policy "listings are publicly readable" on public.listings
  for select using (status not in ('removed', 'deactivated') or auth.uid() = user_id or public.is_staff());
