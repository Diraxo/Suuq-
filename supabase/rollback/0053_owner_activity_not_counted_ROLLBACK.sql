-- Rollback for 0053. Deleted self-favorites are not restored.
drop trigger if exists favorites_prevent_self on public.favorites;
drop function if exists public.prevent_self_favorite();

create or replace function public.increment_listing_views(p_listing_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_seller_id uuid;
begin
  update public.listings set views = views + 1 where id = p_listing_id
  returning user_id into v_seller_id;
  if v_seller_id is not null then
    insert into public.listing_view_events (listing_id, seller_id) values (p_listing_id, v_seller_id);
  end if;
end;
$$;
