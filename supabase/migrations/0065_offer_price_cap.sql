-- 0065 — an offer (or counter-offer) can never be higher than the listing's asking price, and nothing can be
-- offered on a listing that is already sold. Enforced by a trigger on offers so it covers create_offer AND the
-- counter branch of respond_to_offer (both insert a row), and cannot be bypassed by a modified client.
-- Rollback: drop trigger offers_price_cap on public.offers; drop function private.guard_offer_price_cap();

create or replace function private.guard_offer_price_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_price numeric;
  v_status text;
begin
  select price, status into v_price, v_status from public.listings where id = new.listing_id;
  if v_status = 'sold' then
    raise exception 'This item has already been sold';
  end if;
  if v_price is not null and v_price > 0 and new.amount > v_price then
    raise exception 'Offer cannot be higher than the asking price';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_offer_price_cap() from public, anon, authenticated;

drop trigger if exists offers_price_cap on public.offers;
create trigger offers_price_cap before insert on public.offers
  for each row execute function private.guard_offer_price_cap();
