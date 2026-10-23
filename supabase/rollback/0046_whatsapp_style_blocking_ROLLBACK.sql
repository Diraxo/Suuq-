-- Rollback for supabase/migrations/0046_whatsapp_style_blocking.sql. Re-runnable. Restores the 0044 behaviour (a blocked pair
-- cannot message each other) and the 0023/0037 chat definitions. Messages sent by blocked users while 0046 was live become
-- visible to their recipients again (the suppression table is dropped) — they were never delivered, so announce that before rolling back.
drop trigger if exists blocked_users_log_event on public.blocked_users;
drop function if exists private.log_block_event();
drop table if exists public.block_events;

drop trigger if exists reactions_block_guard on public.message_reactions;
drop function if exists private.guard_reaction_block();

create or replace function public.delete_message(p_message_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_msg public.messages;
  v_is_latest boolean;
begin
  update public.messages
  set deleted_at = now(), text = null, images = '{}', image_keys = '{}'
  where id = p_message_id and sender_id = auth.uid() and deleted_at is null
  returning * into v_msg;

  if not found then
    raise exception 'Message not found or not deletable';
  end if;

  select (m.id = v_msg.id) into v_is_latest
  from public.messages m
  where m.conversation_id = v_msg.conversation_id
  order by m.created_at desc, m.id desc
  limit 1;

  if v_is_latest then
    update public.conversations
    set last_message = public.message_preview(v_msg.text, v_msg.images, v_msg.deleted_at)
    where id = v_msg.conversation_id;
  end if;
end;
$$;
revoke execute on function public.delete_message(uuid) from public, anon;
grant execute on function public.delete_message(uuid) to authenticated;

create or replace function public.edit_message(p_message_id uuid, p_text text)
returns public.messages
language plpgsql
security definer set search_path = public
as $$
declare
  v_msg public.messages;
  v_is_latest boolean;
begin
  if p_text is null or char_length(btrim(p_text)) = 0 then
    raise exception 'Message text cannot be empty';
  end if;
  if char_length(p_text) > 4000 then
    raise exception 'Message too long';
  end if;

  update public.messages
  set text = p_text, edited_at = now()
  where id = p_message_id and sender_id = auth.uid() and deleted_at is null
  returning * into v_msg;

  if not found then
    raise exception 'Message not found or not editable';
  end if;

  select (m.id = v_msg.id) into v_is_latest
  from public.messages m
  where m.conversation_id = v_msg.conversation_id
  order by m.created_at desc, m.id desc
  limit 1;

  if v_is_latest then
    update public.conversations
    set last_message = public.message_preview(v_msg.text, v_msg.images, v_msg.deleted_at)
    where id = v_msg.conversation_id;
  end if;

  return v_msg;
end;
$$;
grant execute on function public.edit_message(uuid, text) to authenticated;

create or replace function public.handle_new_message()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_recipient_id uuid;
  v_listing_id uuid;
  v_sender_name text;
  v_listing_title text;
  v_preview text;
begin
  v_preview := public.message_preview(new.text, new.images, null);

  update public.conversations
  set last_message = v_preview, last_message_at = new.created_at
  where id = new.conversation_id
  returning (case when buyer_id = new.sender_id then seller_id else buyer_id end), listing_id
  into v_recipient_id, v_listing_id;

  perform set_config('suuqplus.skip_rate_limit', 'true', true);
  update public.profiles set last_seen_at = now() where id = new.sender_id;

  select title into v_listing_title from public.listings where id = v_listing_id;
  select coalesce(full_name, 'Someone') into v_sender_name from public.profiles where id = new.sender_id;

  if v_recipient_id is not null then
    insert into public.notifications (user_id, title, body, type, data)
    values (
      v_recipient_id,
      v_sender_name || ' sent you a message',
      coalesce(v_listing_title, v_preview),
      'message',
      jsonb_build_object('conversationId', new.conversation_id)
    );
  end if;

  return new;
end;
$$;

create or replace function public.get_conversation_unread_counts()
returns table (conversation_id uuid, unread_count bigint)
language sql stable security definer set search_path = public
as $$
  select m.conversation_id, count(*)
  from public.messages m
  join public.conversation_participants cp
    on cp.conversation_id = m.conversation_id and cp.user_id = auth.uid()
  where m.sender_id <> auth.uid()
    and m.deleted_at is null
    and m.created_at > coalesce(cp.last_read_at, 'epoch'::timestamptz)
  group by m.conversation_id;
$$;
grant execute on function public.get_conversation_unread_counts() to authenticated;

drop policy if exists "participants can read conversation membership" on public.conversation_participants;
create policy "participants can read conversation membership" on public.conversation_participants
  for select using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (auth.uid() = c.buyer_id or auth.uid() = c.seller_id)
    )
  );

drop policy if exists "participants can read conversation messages" on public.messages;
create policy "participants can read conversation messages" on public.messages
  for select using (
    exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = messages.conversation_id and cp.user_id = auth.uid()
    )
  );

-- 0044's guard: a blocked pair cannot message each other at all.
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

drop function if exists private.message_hidden_from_me(uuid);
drop function if exists private.message_is_suppressed(uuid);
drop table if exists private.suppressed_messages;
