-- Suuq+ Stream Chat -> Supabase-native chat cutover.
-- Run once after 0022. Full cutover, no feature flag.
--
-- public.conversations / conversation_participants / find_or_create_conversation()
-- (0005_chat.sql) are NOT touched — they remain the identity layer everything
-- else (offers, every "message seller" entry point) already depends on.
--
-- public.messages was dropped in 0013_chat_stream_cutover.sql when Stream took
-- over message storage. This migration recreates it (extended with images,
-- edit, soft-delete, reply-to) plus message_reactions, and restores the
-- notification-insert trigger stream-webhook was standing in for — same
-- public.notifications shape (type='message', data.conversationId), so
-- lib/push.ts's navigateForPush() needs no changes.
--
-- MANUAL STEPS after this migration runs:
--   1. supabase functions delete stream-token stream-webhook
--   2. supabase secrets unset STREAM_API_SECRET
--   3. Remove EXPO_PUBLIC_STREAM_API_KEY from your .env

-- ============================================================================
-- 0. profiles: coarse last-seen heartbeat.
-- ============================================================================
alter table public.profiles add column if not exists last_seen_at timestamptz;

-- ============================================================================
-- 1. conversation_participants: index for user_id-only lookups (chat list /
--    unread-count queries) — the existing unique index is
--    (conversation_id, user_id), which doesn't help a bare user_id filter.
-- ============================================================================
create index if not exists conversation_participants_user_idx
  on public.conversation_participants (user_id);

-- ============================================================================
-- 2. messages (recreated + extended: images, edit, soft-delete, reply-to)
-- ============================================================================
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  text text,
  images text[] not null default '{}',
  reply_to_id uuid references public.messages (id) on delete set null,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  check (text is null or char_length(text) <= 4000),
  check (coalesce(array_length(images, 1), 0) <= 10),
  check (
    deleted_at is not null
    or char_length(btrim(coalesce(text, ''))) > 0
    or coalesce(array_length(images, 1), 0) > 0
  )
);

create index messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc, id desc);

alter table public.messages enable row level security;

create policy "participants can read conversation messages" on public.messages
  for select using (
    exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = messages.conversation_id and cp.user_id = auth.uid()
    )
  );

create policy "participants can send messages" on public.messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = messages.conversation_id and cp.user_id = auth.uid()
    )
  );

-- No client update/delete policy — text edits/soft-deletes only via
-- edit_message()/delete_message() below (SECURITY DEFINER), same
-- "RPC is the only door" philosophy as the original 0005 schema.

create or replace function public.validate_message_reply()
returns trigger
language plpgsql
as $$
begin
  if new.reply_to_id is not null and not exists (
    select 1 from public.messages where id = new.reply_to_id and conversation_id = new.conversation_id
  ) then
    raise exception 'reply_to_id must reference a message in the same conversation';
  end if;
  return new;
end;
$$;

create trigger validate_message_reply_trg
  before insert on public.messages
  for each row execute function public.validate_message_reply();

-- ============================================================================
-- 3. message_reactions — one reaction per user per message (tapback-style).
-- ============================================================================
create table public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  reaction text not null check (reaction in ('like', 'love', 'haha', 'wow', 'sad', 'clap')),
  created_at timestamptz not null default now(),
  unique (message_id, user_id)
);

alter table public.message_reactions enable row level security;

create policy "participants can read reactions" on public.message_reactions
  for select using (
    exists (
      select 1 from public.messages m
      join public.conversation_participants cp on cp.conversation_id = m.conversation_id and cp.user_id = auth.uid()
      where m.id = message_reactions.message_id
    )
  );

create policy "participants can react" on public.message_reactions
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      join public.conversation_participants cp on cp.conversation_id = m.conversation_id and cp.user_id = auth.uid()
      where m.id = message_id
    )
  );

create policy "users can change their own reaction" on public.message_reactions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "users can remove their own reaction" on public.message_reactions
  for delete using (user_id = auth.uid());

-- ============================================================================
-- 4. Realtime publication — messages/conversation_participants need (re-)adding
--    (messages fell out of the publication when the table was dropped in
--    0013; conversation_participants was never added). conversations is
--    already a member since 0005 — adding it again would error.
-- ============================================================================
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.message_reactions;
alter publication supabase_realtime add table public.conversation_participants;

-- ============================================================================
-- 5. mark_conversation_read — cursor-only now (no more messages.read_at).
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
end;
$$;

grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- ============================================================================
-- 6. Unread-count helper — one round trip for every conversation the caller
--    is in (chat list rows). Global tab badge is derived client-side by
--    summing this, not a separate query (see store/chatConversations.ts).
-- ============================================================================
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

-- ============================================================================
-- 7. message_preview — shared preview-text derivation (trigger + edit/delete
--    RPCs), matching the exact copy the old Stream-based chats.tsx used.
-- ============================================================================
create or replace function public.message_preview(p_text text, p_images text[], p_deleted_at timestamptz)
returns text
language sql immutable
as $$
  select case
    when p_deleted_at is not null then 'This message was deleted'
    when p_text is not null and btrim(p_text) <> '' then p_text
    when coalesce(array_length(p_images, 1), 0) > 0 then 'Sent a photo'
    else ''
  end
$$;

-- ============================================================================
-- 8. edit_message / delete_message — the only ways a message can be mutated.
-- ============================================================================
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
  set deleted_at = now(), text = null, images = '{}'
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

grant execute on function public.delete_message(uuid) to authenticated;

-- ============================================================================
-- 9. handle_new_message — restores 0005's notification trigger, extended to
--    also bump the sender's last_seen_at for free (0.3). The last_seen_at
--    update below deliberately sets the same skip-rate-limit flag
--    touch_last_seen() uses (see 10) — without it, every chat message would
--    also burn into the unrelated 20/hour "update_profile" rate-limit
--    bucket via the pre-existing unscoped rate_limit_profile_updates
--    trigger on public.profiles, since that trigger fires on ANY update to
--    the row regardless of which column changed or who performed it.
-- ============================================================================
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

create trigger on_message_insert
  after insert on public.messages
  for each row execute function public.handle_new_message();

-- ============================================================================
-- 10. touch_last_seen — client-called heartbeat RPC (hooks/useLastSeenHeartbeat.ts).
--     Sets the same transaction-local skip flag as (9) so the heartbeat never
--     competes with real profile edits for the update_profile rate-limit
--     bucket (see comment on (9)).
-- ============================================================================
create or replace function public.touch_last_seen()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  perform set_config('suuqplus.skip_rate_limit', 'true', true);
  update public.profiles set last_seen_at = now() where id = auth.uid();
end;
$$;

grant execute on function public.touch_last_seen() to authenticated;

-- ============================================================================
-- 11. Rate limiting — plug "create_message" into 0019's existing dispatcher
--     (60/minute) rather than building a new mechanism. Also honors the
--     suuqplus.skip_rate_limit flag set by (9)/(10) above.
-- ============================================================================
create or replace function public.trg_enforce_rate_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if current_setting('suuqplus.skip_rate_limit', true) = 'true' then
    return new;
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

drop trigger if exists rate_limit_messages on public.messages;
create trigger rate_limit_messages
  before insert on public.messages
  for each row execute function public.trg_enforce_rate_limit('create_message');
