-- Suuq+ follow-up schema: chat (conversations, conversation_participants, messages).
-- Run once in the Supabase SQL Editor after 0001-0004.
--
-- Design notes:
-- * One conversation per (listing, buyer, seller) — enforced by the unique
--   constraint below and by find_or_create_conversation(), which is the only
--   way conversations/participants get created (SECURITY DEFINER, so it can
--   insert the *other* participant's row too, which a plain RLS insert policy
--   scoped to auth.uid() could never allow).
-- * Text messages only (message_type is fixed at 'text' for now, per product
--   scope — no voice/image/file/reactions).
-- * "Read" is tracked two ways: messages.read_at (per-message, for the
--   requested schema) and conversation_participants.last_read_at (for a cheap
--   unread-count query). Both are written by mark_conversation_read(), never
--   directly by the client, so a participant can't spoof read receipts on
--   messages they didn't receive.

-- ============================================================================
-- conversations
-- ============================================================================
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  last_message text,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  check (buyer_id <> seller_id),
  unique (listing_id, buyer_id, seller_id)
);

alter table public.conversations enable row level security;

drop policy if exists "participants can read their conversations" on public.conversations;
create policy "participants can read their conversations" on public.conversations
  for select using (auth.uid() = buyer_id or auth.uid() = seller_id);

-- No client insert/update policy: rows are only ever written by the
-- SECURITY DEFINER functions below, which validate membership internally.

-- ============================================================================
-- conversation_participants
-- ============================================================================
create table if not exists public.conversation_participants (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (conversation_id, user_id)
);

alter table public.conversation_participants enable row level security;

drop policy if exists "participants can read conversation membership" on public.conversation_participants;
create policy "participants can read conversation membership" on public.conversation_participants
  for select using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (auth.uid() = c.buyer_id or auth.uid() = c.seller_id)
    )
  );

-- ============================================================================
-- messages
-- ============================================================================
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  text text not null check (char_length(btrim(text)) > 0),
  message_type text not null default 'text' check (message_type = 'text'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at desc);

alter table public.messages enable row level security;

drop policy if exists "participants can read conversation messages" on public.messages;
create policy "participants can read conversation messages" on public.messages
  for select using (
    exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = messages.conversation_id and cp.user_id = auth.uid()
    )
  );

drop policy if exists "participants can send messages" on public.messages;
create policy "participants can send messages" on public.messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = messages.conversation_id and cp.user_id = auth.uid()
    )
  );

-- No update/delete policy for clients — read_at is only ever set by
-- mark_conversation_read() (SECURITY DEFINER), so a sender can't fake a read
-- receipt and a recipient can't rewrite message content after the fact.

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;

-- ============================================================================
-- find_or_create_conversation
-- ============================================================================
-- Called by a prospective buyer opening chat/offer on a listing. Creates the
-- conversation + both participant rows atomically the first time; returns the
-- existing conversation on every subsequent call. Runs as definer specifically
-- so it can insert the seller's participant row too (the seller never takes
-- any client action to "join" — the RLS-scoped alternative would need the
-- seller to insert their own row, which can't happen before they've even
-- seen the conversation).
create or replace function public.find_or_create_conversation(p_listing_id uuid)
returns public.conversations
language plpgsql
security definer set search_path = public
as $$
declare
  v_seller_id uuid;
  v_buyer_id uuid := auth.uid();
  v_conversation public.conversations;
begin
  if v_buyer_id is null then
    raise exception 'Not authenticated';
  end if;

  select user_id into v_seller_id from public.listings where id = p_listing_id;
  if v_seller_id is null then
    raise exception 'Listing not found';
  end if;
  if v_seller_id = v_buyer_id then
    raise exception 'Cannot start a conversation with yourself';
  end if;

  select * into v_conversation from public.conversations
  where listing_id = p_listing_id and buyer_id = v_buyer_id and seller_id = v_seller_id;

  if found then
    return v_conversation;
  end if;

  insert into public.conversations (listing_id, buyer_id, seller_id)
  values (p_listing_id, v_buyer_id, v_seller_id)
  returning * into v_conversation;

  insert into public.conversation_participants (conversation_id, user_id)
  values (v_conversation.id, v_buyer_id), (v_conversation.id, v_seller_id)
  on conflict (conversation_id, user_id) do nothing;

  return v_conversation;
end;
$$;

grant execute on function public.find_or_create_conversation(uuid) to authenticated;

-- ============================================================================
-- mark_conversation_read
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

  update public.messages
  set read_at = now()
  where conversation_id = p_conversation_id and sender_id <> auth.uid() and read_at is null;

  update public.conversation_participants
  set last_read_at = now()
  where conversation_id = p_conversation_id and user_id = auth.uid();
end;
$$;

grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- ============================================================================
-- Keep conversations.last_message / last_message_at in sync, and notify the
-- other participant that a message arrived.
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
begin
  update public.conversations
  set last_message = new.text, last_message_at = new.created_at
  where id = new.conversation_id
  returning (case when buyer_id = new.sender_id then seller_id else buyer_id end), listing_id
  into v_recipient_id, v_listing_id;

  select title into v_listing_title from public.listings where id = v_listing_id;

  select coalesce(full_name, 'Someone') into v_sender_name
  from public.profiles where id = new.sender_id;

  if v_recipient_id is not null then
    insert into public.notifications (user_id, title, body)
    values (v_recipient_id, v_sender_name || ' sent you a message', coalesce(v_listing_title, new.text));
  end if;

  return new;
end;
$$;

drop trigger if exists on_message_insert on public.messages;
create trigger on_message_insert
  after insert on public.messages
  for each row execute function public.handle_new_message();
