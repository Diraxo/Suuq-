-- 0084 — ending (or letting expire) a discount does not start the 3-day price hold, so a seller can start another one at once.
--   Putting the original price back is not a new price: the listing is at the price it had before the discount. Until now the price
--   trigger counted that restore as a price change and stamped price_changed_at = now(), so a seller who ended a discount was refused
--   a new one for 3 days. end_listing_discount() and settle_expired_discounts() now put price_changed_at back to what it was.
--   A real price EDIT by the seller still holds 3 days, as before. Replaces two functions; no table change. Depends on 0083.
create or replace function public.settle_expired_discounts(p_owner uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_held timestamptz[];
begin
  select array_agg(l.id), array_agg(l.price_changed_at) into v_ids, v_held
    from public.listings l
   where l.discount_original_price is not null and not l.discount_permanent and l.discount_ends_at <= now()
     and (p_owner is null or l.user_id = p_owner);
  if v_ids is null then return 0; end if;
  update public.listings l
     set price = l.discount_original_price,
         discount_original_price = null, discount_started_at = null, discount_ends_at = null, discount_note = null,
         updated_at = now()
   where l.id = any(v_ids);
  -- The price trigger stamped price_changed_at = now() for the restore; put the real value back.
  update public.listings l set price_changed_at = h.held from unnest(v_ids, v_held) as h(id, held) where l.id = h.id;
  return coalesce(array_length(v_ids, 1), 0);
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
  -- Not a new price: keep the hold clock exactly where it was.
  update public.listings set price_changed_at = l.price_changed_at where id = l.id;
  return jsonb_build_object('price', l.discount_original_price, 'ended', true);
end;
$$;
revoke all on function public.end_listing_discount(uuid) from public, anon;
grant execute on function public.end_listing_discount(uuid) to authenticated;
