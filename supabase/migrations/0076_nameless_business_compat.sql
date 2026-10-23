-- 0076 — Compatibility for business mode WITHOUT a business name (follow-up to 0075).
--
-- STATUS: written and tested on PGlite only. NOT applied to any database. Needs 0066, 0068 and 0075.
--
-- Why
--   0075 lets an account switch to business mode with a blank profiles.business_name (the name, photo and bio are the account's own).
--   Two earlier functions still demanded a business name and so contradicted that:
--     * 0068 guard_listing_seller_presentation(): refused seller_presentation = 'business' unless the owner's business_name was non-blank.
--       A nameless business-mode owner could not publish a business-presented listing (single, upsert or bulk: they all INSERT into
--       public.listings, so this one trigger is the only database gate).
--     * 0066 start_business_conversation(): refused a target whose business_name was blank, so a nameless business-mode account could
--       not be messaged directly.
--
-- Decisions (explicit, reviewable)
--   1. Listings. 'business' presentation is allowed when the owner has a business identity, meaning EITHER
--        a. profiles.active_mode = 'business'  (new: the only evidence a post-0075 business account has), OR
--        b. a non-blank legacy business_name     (unchanged, so today's behaviour for named accounts is preserved exactly).
--      A personal-mode account with a blank name is still refused. A blank name alone never grants anything.
--      The check still runs only on INSERT or when seller_presentation changes, so editing an existing listing is unaffected, and
--      switching modes never rewrites or revokes already-published listings (unchanged 0068 rule).
--      Everything else that gates a listing write is untouched and still applies on top: the suspended/banned-seller block (0039), the
--      owner/column guards (0038), the sell-validation triggers (0049), rate limits, RLS (user_id = auth.uid()).
--      The mode itself cannot be forged: active_mode is changed only by set_active_mode() (client writes are refused by the 0064/0075
--      guard) and is forced back to personal when a suspended storefront / withdrawn legacy business is mirrored (0075).
--   2. Direct business chat. A nameless business-mode account CAN be messaged directly: the target test becomes active_mode = 'business'
--      alone. Reasons: chat shows the stable account identity (full_name), not a business name, so nothing is missing; a nameless
--      account could already START direct conversations (the buyer side never had a mode or name requirement), so refusing to RECEIVE
--      them was an accidental asymmetry. Unchanged and still enforced: signed-in caller, not yourself, the target must be in business
--      mode (a personal-mode account is "Business not found"), the 0044 two-way block trigger on the conversation insert, participant rows
--      for exactly the two parties, one direct thread per pair, RLS on conversations/messages, execute granted to authenticated only.
--      The function does not check account_status (it did not before); parity with named accounts is pinned by a test, nothing was relaxed.
--
-- Not changed here (deliberately): 0072 get_contact_phone(..., 'business_profile') still returns NULL when business_name is blank. That is
-- the fail-closed direction (a nameless business profile's phone is not shown there even with business_phone_public on). Changing it
-- alters phone exposure and needs its own decision; it is listed in the review notes.
--
-- 0075's forward SQL is not edited. Rollback: supabase/rollback/0076_nameless_business_compat_ROLLBACK.sql (run it BEFORE the 0075 rollback).

begin;

create or replace function public.guard_listing_seller_presentation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.seller_presentation = 'business'
     and (tg_op = 'INSERT' or new.seller_presentation is distinct from old.seller_presentation) then
    if not exists (
      select 1 from public.profiles p
      where p.id = new.user_id
        and (p.active_mode = 'business' or nullif(btrim(p.business_name), '') is not null)
    ) then
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
    where p.id = p_business_id and p.active_mode = 'business'
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
