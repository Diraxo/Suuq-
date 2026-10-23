-- ROLLBACK for 0070: restores the 0029 body of mark_listing_sold (which can be used to un-remove a staff-removed listing). Idempotent, one transaction.
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
