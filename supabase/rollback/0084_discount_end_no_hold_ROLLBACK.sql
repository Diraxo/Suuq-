-- Rollback for 0084: ending/expiring a discount starts the 3-day hold again (the 0081 functions).
create or replace function public.settle_expired_discounts(p_owner uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  with s as (
    update public.listings l
       set price = l.discount_original_price,
           discount_original_price = null, discount_started_at = null, discount_ends_at = null, discount_note = null,
           updated_at = now()
     where l.discount_original_price is not null and not l.discount_permanent and l.discount_ends_at <= now()
       and (p_owner is null or l.user_id = p_owner)
    returning 1)
  select count(*) into v_n from s;
  return v_n;
end;
$$;
revoke all on function public.settle_expired_discounts(uuid) from public, anon, authenticated;
create or replace function public.end_listing_discount(p_listing uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  l public.listings;
begin
  if v_uid is null then raise exception 'Sign in to end a discount' using errcode = '42501'; end if;
  select * into l from public.listings where id = p_listing for update;
  if not found or l.user_id <> v_uid then raise exception 'Listing not found' using errcode = '42501'; end if;
  if l.discount_original_price is null then
    return jsonb_build_object('price', l.price, 'ended', false);
  end if;
  update public.listings
     set price = discount_original_price,
         discount_original_price = null, discount_started_at = null, discount_ends_at = null, discount_note = null,
         discount_permanent = false, updated_at = now()
   where id = l.id;
  return jsonb_build_object('price', l.discount_original_price, 'ended', true);
end;
$$;
revoke all on function public.end_listing_discount(uuid) from public, anon;
grant execute on function public.end_listing_discount(uuid) to authenticated;
