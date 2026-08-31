-- ============================================================================
-- Fix: being inside a conversation when a new message arrives didn't clear
-- the matching "<sender> sent you a message" bell notification.
--
-- Root cause: mark_conversation_read() (0023_chat_supabase_native.sql) only
-- ever wrote conversation_participants.last_read_at. It never touched the
-- public.notifications row handle_new_message() inserts on every message
-- (type='message', data.conversationId). Nothing else marks that row read
-- either — there's no client code anywhere (mobile or web) that clears a
-- message notification just because its conversation is open. Both
-- hooks/useConversationChannel.ts (mobile) and
-- web/src/hooks/useConversationChannel.ts (web) already call this same RPC
-- on load and on every realtime message while the conversation screen is
-- mounted, so this is a shared-backend gap affecting both platforms
-- identically, not a web-only regression — fixing it here fixes both at
-- once instead of patching one client to fake it.
--
-- store/notifications.ts (mobile) and web's subscribeToNotifications
-- (web/src/services/notifications.ts) already subscribe to postgres_changes
-- on public.notifications and reload on any event, so the bell/unread count
-- updates immediately once this UPDATE lands — no client changes needed.
-- ============================================================================
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = auth.uid()
  ) then
    raise exception 'Not a participant of this conversation';
  end if;

  update public.conversation_participants
  set last_read_at = now()
  where conversation_id = p_conversation_id and user_id = auth.uid();

  update public.notifications
  set read = true
  where user_id = auth.uid()
    and read = false
    and type = 'message'
    and (data ->> 'conversationId')::uuid = p_conversation_id;
end;
$$;

grant execute on function public.mark_conversation_read(uuid) to authenticated;
