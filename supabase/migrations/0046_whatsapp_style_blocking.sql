-- 0046 — WhatsApp-style blocking for chat. Needs 0043 + 0044. Tested in supabase/tests/chat_blocking.test.mjs.
-- Rollback: supabase/rollback/0046_whatsapp_style_blocking_ROLLBACK.sql.
--
-- WHAT CHANGES vs 0044 (which refused every message between a blocked pair, so the blocked person saw "Failed to send"
-- and the blocker lost the conversation). The behaviour now matches WhatsApp:
--
--   * The BLOCKED person sends a message -> it is accepted, the sender sees it with a single tick, and it is NEVER shown
--     to the blocker: no row visible, no unread count, no notification / push, no chat-list preview. It is not delivered
--     later either (unblocking does not release it). The sender is not told anything — they just never get a second tick.
--   * The BLOCKER keeps the conversation and its history. They cannot send while the block is on (the app asks them to
--     unblock first); a direct API call gets the error 'unblock_to_send' (only the blocker can ever see that text).
--   * Read receipts / "seen" for the other side are hidden while blocked (conversation_participants), so a suppressed
--     message can never turn into a double tick because the blocker opened the chat.
--   * Reactions between a blocked pair are silently dropped.
--   * "You blocked X" / "You unblocked X" lines come from a PRIVATE log (block_events) that only its owner can read.
--
-- PRIVACY. blocked_users stays "own rows only". Which messages were suppressed lives in private.suppressed_messages
-- (schema `private`, not exposed by PostgREST, no grants). The only door is private.message_hidden_from_me(id), which
-- answers true only for the RECIPIENT, so the sender can never use it to find out they are blocked.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Suppressed messages (private). The FK is deferred: the row is written by the BEFORE INSERT guard, before the message.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists private.suppressed_messages (
  message_id uuid primary key references public.messages (id) on delete cascade deferrable initially deferred,
  recipient_id uuid not null references public.profiles (id) on delete cascade
);
revoke all on table private.suppressed_messages from public, anon, authenticated;
-- RLS on with no policies = deny-all for API roles even if a grant is ever added by mistake. The SECURITY DEFINER functions
-- below run as the table owner, who bypasses RLS, so they keep working.
alter table private.suppressed_messages enable row level security;

-- Internal (triggers / definer RPCs only): is this message suppressed for anyone?
create or replace function private.message_is_suppressed(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from private.suppressed_messages s where s.message_id = p_id);
$$;
revoke all on function private.message_is_suppressed(uuid) from public, anon, authenticated;

-- Used by RLS and the unread counter: true only when the CALLER is the recipient the message is hidden from.
create or replace function private.message_hidden_from_me(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from private.suppressed_messages s where s.message_id = p_id and s.recipient_id = auth.uid());
$$;
revoke all on function private.message_hidden_from_me(uuid) from public;
grant execute on function private.message_hidden_from_me(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. The send guard (replaces 0044's, same trigger).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function private.guard_message_block()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_buyer uuid;
  v_seller uuid;
  v_recipient uuid;
begin
  select c.buyer_id, c.seller_id into v_buyer, v_seller from public.conversations c where c.id = new.conversation_id;
  if v_buyer is null then
    return new;
  end if;
  v_recipient := case when new.sender_id = v_buyer then v_seller else v_buyer end;

  -- The sender blocked the recipient: like WhatsApp, they must unblock before writing.
  if exists (select 1 from public.blocked_users x where x.blocker_id = new.sender_id and x.blocked_id = v_recipient) then
    raise exception 'unblock_to_send' using errcode = 'P0001';
  end if;

  -- The recipient blocked the sender: accept it (one tick for the sender) but never deliver it.
  if exists (select 1 from public.blocked_users x where x.blocker_id = v_recipient and x.blocked_id = new.sender_id) then
    insert into private.suppressed_messages (message_id, recipient_id) values (new.id, v_recipient);
  end if;
  return new;
end;
$$;
revoke all on function private.guard_message_block() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Read side: the recipient never sees a suppressed message; unread counts skip it.
-- ---------------------------------------------------------------------------------------------------------------------
drop policy if exists "participants can read conversation messages" on public.messages;
create policy "participants can read conversation messages" on public.messages
  for select using (
    exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = messages.conversation_id and cp.user_id = auth.uid()
    )
    and (messages.sender_id = auth.uid() or not private.message_hidden_from_me(messages.id))
  );

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
    and not private.message_is_suppressed(m.id)
  group by m.conversation_id;
$$;
grant execute on function public.get_conversation_unread_counts() to authenticated;

-- Read receipts: while blocked, each side stops seeing the other's membership row (and so their last_read_at).
drop policy if exists "participants can read conversation membership" on public.conversation_participants;
create policy "participants can read conversation membership" on public.conversation_participants
  for select using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (auth.uid() = c.buyer_id or auth.uid() = c.seller_id)
    )
    and (user_id = auth.uid() or user_id <> all((select private.blocked_either_way())::uuid[]))
  );

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. A suppressed message must not touch the conversation preview or notify anyone (bodies = 0023 / 0037, plus the guard).
-- ---------------------------------------------------------------------------------------------------------------------
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
  perform set_config('suuqplus.skip_rate_limit', 'true', true);
  update public.profiles set last_seen_at = now() where id = new.sender_id;

  if private.message_is_suppressed(new.id) then
    return new; -- blocked sender: no preview bump, no notification, no push
  end if;

  v_preview := public.message_preview(new.text, new.images, null);

  update public.conversations
  set last_message = v_preview, last_message_at = new.created_at
  where id = new.conversation_id
  returning (case when buyer_id = new.sender_id then seller_id else buyer_id end), listing_id
  into v_recipient_id, v_listing_id;

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

  if v_is_latest and not private.message_is_suppressed(v_msg.id) then
    update public.conversations
    set last_message = public.message_preview(v_msg.text, v_msg.images, v_msg.deleted_at)
    where id = v_msg.conversation_id;
  end if;

  return v_msg;
end;
$$;
grant execute on function public.edit_message(uuid, text) to authenticated;

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

  if v_is_latest and not private.message_is_suppressed(v_msg.id) then
    update public.conversations
    set last_message = public.message_preview(v_msg.text, v_msg.images, v_msg.deleted_at)
    where id = v_msg.conversation_id;
  end if;
end;
$$;
revoke execute on function public.delete_message(uuid) from public, anon;
grant execute on function public.delete_message(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Reactions between a blocked pair are dropped silently (a BEFORE trigger returning NULL skips the row, no error).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function private.guard_reaction_block()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_buyer uuid;
  v_seller uuid;
begin
  select c.buyer_id, c.seller_id into v_buyer, v_seller
    from public.messages m join public.conversations c on c.id = m.conversation_id
   where m.id = new.message_id;
  if v_buyer is not null and private.users_blocked(v_buyer, v_seller) then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_reaction_block() from public, anon, authenticated;
drop trigger if exists reactions_block_guard on public.message_reactions;
create trigger reactions_block_guard before insert or update on public.message_reactions
  for each row execute function private.guard_reaction_block();

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. block_events: the private "You blocked / unblocked X" log. Written only by the trigger below; each user reads only
--    the rows they authored, so the blocked person can never see them.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.block_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  other_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('blocked', 'unblocked')),
  created_at timestamptz not null default now()
);
create index if not exists block_events_pair_idx on public.block_events (user_id, other_id, created_at desc);
alter table public.block_events enable row level security;
drop policy if exists "users read their own block events" on public.block_events;
create policy "users read their own block events" on public.block_events for select using (user_id = auth.uid());
revoke insert, update, delete on public.block_events from anon, authenticated;

create or replace function private.log_block_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.block_events (user_id, other_id, kind) values (new.blocker_id, new.blocked_id, 'blocked');
  else
    -- Skip when the blocker's account itself is being deleted (cascade): the log rows go with the profile.
    if exists (select 1 from public.profiles p where p.id = old.blocker_id) and exists (select 1 from public.profiles p where p.id = old.blocked_id) then
      insert into public.block_events (user_id, other_id, kind) values (old.blocker_id, old.blocked_id, 'unblocked');
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.log_block_event() from public, anon, authenticated;
drop trigger if exists blocked_users_log_event on public.blocked_users;
create trigger blocked_users_log_event after insert or delete on public.blocked_users
  for each row execute function private.log_block_event();
