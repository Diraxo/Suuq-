-- 0066 — Message a business without picking one of its listings.
--
-- STATUS: written and tested on PGlite only. NOT applied to any database. Needs 0044 (conversation block guard) and 0064 (active_mode).
--
-- Chat used to need a listing: conversations.listing_id was NOT NULL, so a business with no active listings could not be messaged.
--   * conversations.listing_id becomes nullable. A NULL listing means a direct inquiry to the business. Every existing row keeps its listing.
--   * One direct conversation per (buyer, seller): a partial unique index (the old unique (listing_id, buyer, seller) never matched NULLs).
--   * start_business_conversation(p_business_id) is the ONLY way to open one. It needs a signed-in caller who is not the business,
--     and a target whose ACTIVE identity is business. The block guard trigger from 0044 still fires, so a blocked pair cannot start one.
-- Message notifications already fall back to the message preview when there is no listing title (0046), so nothing else changes.
-- Rollback: supabase/rollback/0066_business_direct_chat_ROLLBACK.sql

begin;

alter table public.conversations alter column listing_id drop not null;

create unique index if not exists conversations_direct_unique
  on public.conversations (buyer_id, seller_id)
  where listing_id is null;

create or replace function public.start_business_conversation(p_business_id uuid)
returns public.conversations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_buyer uuid := auth.uid();
  v_conversation public.conversations;
begin
  if v_buyer is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if v_buyer = p_business_id then
    raise exception 'Cannot start a conversation with yourself';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_business_id and p.active_mode = 'business' and nullif(btrim(p.business_name), '') is not null
  ) then
    raise exception 'Business not found' using errcode = 'P0002';
  end if;

  select * into v_conversation from public.conversations
  where listing_id is null and buyer_id = v_buyer and seller_id = p_business_id;
  if found then
    return v_conversation;
  end if;

  insert into public.conversations (listing_id, buyer_id, seller_id)
  values (null, v_buyer, p_business_id)
  returning * into v_conversation;

  insert into public.conversation_participants (conversation_id, user_id)
  values (v_conversation.id, v_buyer), (v_conversation.id, p_business_id)
  on conflict (conversation_id, user_id) do nothing;

  return v_conversation;
end;
$$;

revoke all on function public.start_business_conversation(uuid) from public, anon;
grant execute on function public.start_business_conversation(uuid) to authenticated;

commit;
