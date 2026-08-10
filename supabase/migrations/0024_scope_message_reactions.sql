-- Scope message_reactions realtime events to their conversation.
--
-- Before this, message_reactions had no conversation_id, so
-- hooks/useConversationChannel.ts subscribed to postgres_changes on the
-- whole table with no filter — every open chat received every reaction
-- event in the app and filtered it out client-side. Adding conversation_id
-- lets the subscription filter server-side (`conversation_id=eq.<id>`).

alter table public.message_reactions
  add column conversation_id uuid references public.conversations (id) on delete cascade;

update public.message_reactions mr
set conversation_id = m.conversation_id
from public.messages m
where m.id = mr.message_id and mr.conversation_id is null;

alter table public.message_reactions
  alter column conversation_id set not null;

create index message_reactions_conversation_idx
  on public.message_reactions (conversation_id);

-- Server-derived, not client-supplied: conversation_id is always taken from
-- the referenced message, so a caller can neither omit it nor spoof it to a
-- conversation they're not in (existing RLS is unaffected — it already
-- checks message_id -> conversation_participants and doesn't need to change).
create or replace function public.set_message_reaction_conversation()
returns trigger
language plpgsql
as $$
begin
  select conversation_id into new.conversation_id
  from public.messages where id = new.message_id;
  return new;
end;
$$;

drop trigger if exists set_message_reaction_conversation_trg on public.message_reactions;
create trigger set_message_reaction_conversation_trg
  before insert or update on public.message_reactions
  for each row execute function public.set_message_reaction_conversation();

-- Default replica identity only puts primary-key columns in a DELETE's `old`
-- record, so a `conversation_id=eq.<id>` realtime filter (and the client's
-- own message_id-based lookup) would never match on delete. Full identity
-- puts every column in old/new so deletes filter and resolve correctly too.
alter table public.message_reactions replica identity full;
