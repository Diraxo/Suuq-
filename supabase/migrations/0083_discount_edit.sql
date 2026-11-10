-- 0083 — edit a running discount. set_listing_discount() gains p_replace (default false): with it, a discount must already be running
--   and is REPLACED in one step - new percent/price, new length (restarting from now), new note - measured against the original price,
--   which stays the original. No hold applies (it is not a new price), the 3-day hold clock is untouched, and every other rule (owner,
--   available only, 1%..90%, 1..365 days or Forever, note limits) is the same. Calls without p_replace behave exactly as in 0082, so
--   apps already installed keep working. Replaces one function (the 5-argument form is dropped); no table change. Depends on 0082.
drop function if exists public.set_listing_discount(uuid, numeric, int, text, boolean);
create or replace function public.set_listing_discount(
  p_listing uuid, p_new_price numeric, p_days int default null, p_note text default null, p_forever boolean default false,
  p_replace boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  l public.listings;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_forever boolean := coalesce(p_forever, false);
  v_replace boolean := coalesce(p_replace, false);
  v_base numeric;
  v_held_since timestamptz;
  v_hold_until timestamptz;
  v_ends timestamptz;
begin
  if v_uid is null then raise exception 'Sign in to set a discount' using errcode = '42501'; end if;
  if public.account_effective_status(v_uid) in ('suspended', 'banned') then
    raise exception 'Your account cannot set discounts' using errcode = '42501';
  end if;
  perform public.settle_expired_discounts(v_uid);
  select * into l from public.listings where id = p_listing for update;
  if not found or l.user_id <> v_uid then raise exception 'Listing not found' using errcode = '42501'; end if;
  if l.status <> 'available' then raise exception 'Only an available listing can be discounted' using errcode = 'P0001'; end if;
  if v_replace then
    -- Editing: a discount must be running; the new price is measured against the ORIGINAL price, which stays the original.
    if l.discount_original_price is null then raise exception 'No discount is running on this listing' using errcode = 'P0001'; end if;
    v_base := l.discount_original_price;
  else
    if l.discount_original_price is not null then raise exception 'A discount is already running on this listing' using errcode = 'P0001'; end if;
    v_base := l.price;
  end if;
  if not v_forever and (p_days is null or p_days < 1 or p_days > 365) then
    raise exception 'A discount runs for 1 to 365 days, or until you end it' using errcode = 'P0001';
  end if;
  -- A listing whose price was never changed (price_changed_at is still its creation instant) has nothing to hold.
  -- Editing a running discount is not a new price: no hold.
  v_hold_until := case when not v_replace and l.price_changed_at > l.created_at then l.price_changed_at + interval '3 days' else null end;
  if v_hold_until is not null and v_hold_until > now() then
    -- The exact instant (UTC), so the app can show it in the seller's own time zone. Begins with the date, as in 0080.
    raise exception 'The price was changed recently. You can set a discount from %', to_char(v_hold_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      using errcode = 'P0001';
  end if;
  if p_new_price is null or p_new_price <= 0 or p_new_price <> trunc(p_new_price) then raise exception 'Enter a whole number for the new price' using errcode = 'P0001'; end if;
  if p_new_price >= v_base then raise exception 'The new price must be lower than the current price' using errcode = 'P0001'; end if;
  if (v_base - p_new_price) * 100 < v_base then raise exception 'A discount must be at least 1%%' using errcode = 'P0001'; end if;
  if p_new_price * 10 < v_base then raise exception 'A discount can be at most 90%%' using errcode = 'P0001'; end if;
  if v_note is not null and (char_length(v_note) > 60 or v_note ~ '[[:cntrl:]]') then
    raise exception 'The note must be at most 60 characters, without special characters' using errcode = 'P0001';
  end if;

  v_held_since := l.price_changed_at;
  v_ends := case when v_forever then null else now() + make_interval(hours => p_days * 24) end;
  update public.listings
     set price = p_new_price, discount_original_price = v_base, discount_started_at = now(),
         discount_ends_at = v_ends, discount_permanent = v_forever, discount_note = v_note, updated_at = now()
   where id = l.id;
  -- Starting a discount does not restart the "price held" clock for the original price.
  update public.listings set price_changed_at = v_held_since where id = l.id;
  return jsonb_build_object('price', p_new_price, 'original_price', v_base, 'ends_at', v_ends, 'permanent', v_forever, 'note', v_note,
                            'started_at', (select discount_started_at from public.listings where id = l.id));
end;
$$;
revoke all on function public.set_listing_discount(uuid, numeric, int, text, boolean, boolean) from public, anon;
grant execute on function public.set_listing_discount(uuid, numeric, int, text, boolean, boolean) to authenticated;
