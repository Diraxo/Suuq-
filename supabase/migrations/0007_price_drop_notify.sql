-- Suuq+ follow-up schema: notify everyone who favorited a listing when its
-- price drops. Run once in the Supabase SQL Editor after 0001-0006.
--
-- Reuses the price_drops table from 0001_init.sql (already written to by
-- store/myListings.ts's dropPrice()) as the trigger source, rather than
-- watching listings.price directly, so this fires exactly once per recorded
-- drop and reuses the existing old/new price values instead of recomputing them.

create or replace function public.notify_on_price_drop()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_listing_title text;
  v_owner_id uuid;
begin
  select title, user_id into v_listing_title, v_owner_id from public.listings where id = new.listing_id;

  insert into public.notifications (user_id, title, body)
  select f.user_id,
         'Price dropped on a listing you favorited',
         coalesce(v_listing_title, '') || ': ' || new.old_price || ' -> ' || new.new_price
  from public.favorites f
  where f.listing_id = new.listing_id::text and f.user_id <> v_owner_id;

  return new;
end;
$$;

drop trigger if exists on_price_drop_notify on public.price_drops;
create trigger on_price_drop_notify
  after insert on public.price_drops
  for each row execute function public.notify_on_price_drop();

-- ============================================================================
-- Realtime: notifications wasn't added to the publication in 0001-0004 (they
-- predate the notification screen's realtime requirement) — add it now so
-- store/notifications.ts's subscription actually receives events.
-- ============================================================================
alter publication supabase_realtime add table public.notifications;
