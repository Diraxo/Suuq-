-- 0070 — mark_listing_sold may not be used to get around moderation.
--
-- STATUS: written and tested on PGlite only. NOT applied to any database. Needs 0029 (mark_listing_sold) and 0039 (account_effective_status).
-- Independent of 0054..0069: it can be applied on its own, before them.
--
-- Why
--   mark_listing_sold (0029) is SECURITY DEFINER, so the triggers that key on current_user (is_client_write(): guard_listing_removed_transition and
--   trg_block_restricted_listing_writes, 0039) do not fire inside it. Any owner could therefore call it on a listing staff had REMOVED or DEACTIVATED:
--   it set the status to 'sold', which the public read policy does not hide, i.e. it un-removed the listing. A suspended or banned owner could also use it.
--   Direct UPDATE/DELETE of such a listing is already refused; this closes the RPC path with the same two rules and the same error wording.
--
-- Unchanged: the owner check, idempotence for an already-sold listing, and flipping other pending offers to 'sold'.
-- Rollback: supabase/rollback/0070_owner_mark_sold_guard_ROLLBACK.sql (restores the 0029 body).

begin;

create or replace function public.mark_listing_sold(p_listing_id uuid)
returns public.listings
language plpgsql
security definer set search_path = public
as $$
declare
  v_seller_id uuid := auth.uid();
  v_listing public.listings;
begin
  if v_seller_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_listing from public.listings where id = p_listing_id for update;
  if v_listing is null then
    raise exception 'Listing not found';
  end if;
  if v_listing.user_id <> v_seller_id then
    raise exception 'Not the owner of this listing';
  end if;
  if public.account_effective_status(v_seller_id) in ('suspended', 'banned') then
    raise exception 'Account suspended' using errcode = '42501';
  end if;
  if v_listing.status in ('removed', 'deactivated') then
    raise exception 'This listing is under review and cannot be changed' using errcode = '42501';
  end if;
  if v_listing.status = 'sold' then
    return v_listing;
  end if;

  update public.listings set status = 'sold', updated_at = now() where id = p_listing_id returning * into v_listing;

  update public.offers
  set status = 'sold', updated_at = now()
  where listing_id = p_listing_id and status = 'pending';

  return v_listing;
end;
$$;

grant execute on function public.mark_listing_sold(uuid) to authenticated;

commit;
