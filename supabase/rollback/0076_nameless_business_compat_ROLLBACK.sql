-- ROLLBACK for 0076. Run as ONE transaction, and BEFORE the 0075 rollback (0076 depends on 0075's mode rules; undo in reverse order).
-- Restores the 0068 listing guard and the 0066 chat function exactly as they were (both require a non-blank business_name).
-- Data is not touched. Consequences to know about:
--   * Listings already published with seller_presentation = 'business' by a nameless business-mode owner keep that value (the guard only
--     runs on INSERT or when the column changes). The count is reported below. Clients then render the account name either way.
--   * Direct conversations already opened with a nameless business-mode account keep working; only NEW ones are refused again.
begin;

do $$
declare v_n int;
begin
  select count(*) into v_n
  from public.listings l join public.profiles p on p.id = l.user_id
  where l.seller_presentation = 'business' and nullif(btrim(p.business_name), '') is null;
  raise notice '0076 rollback: % business-presented listing(s) belong to accounts with no business name; left as they are.', v_n;
end $$;

create or replace function public.guard_listing_seller_presentation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.seller_presentation = 'business'
     and (tg_op = 'INSERT' or new.seller_presentation is distinct from old.seller_presentation) then
    if not exists (select 1 from public.profiles p where p.id = new.user_id and nullif(btrim(p.business_name), '') is not null) then
      raise exception 'Add a business name before presenting a listing as your business' using errcode = '22023', hint = 'business_profile_incomplete';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_listing_seller_presentation() from public, anon, authenticated;

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
