-- Restores the 0053 behaviour (owner excluded, every other open counted, anonymous included).
create or replace function public.increment_listing_views(p_listing_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_seller_id uuid;
begin
  select user_id into v_seller_id from public.listings where id = p_listing_id;
  if v_seller_id is null then
    return;
  end if;
  if auth.uid() is not null and auth.uid() = v_seller_id then
    return;
  end if;
  update public.listings set views = views + 1 where id = p_listing_id;
  insert into public.listing_view_events (listing_id, seller_id) values (p_listing_id, v_seller_id);
end;
$$;

drop table if exists public.listing_unique_viewers;
