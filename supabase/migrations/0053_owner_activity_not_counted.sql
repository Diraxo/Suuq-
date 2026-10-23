-- 0053 — A seller's own activity on their own listing is never counted.
--
--   1. increment_listing_views(): a view by the listing's owner no longer bumps listings.views or writes a
--      listing_view_events row (the apps already skipped this client-side, but the web did not, and a client check
--      is not enforcement). Anonymous visitors still count; any other signed-in user counts.
--   2. favorites: the owner cannot favorite their own listing (insert is refused), and any such rows that already
--      exist are removed, which also decrements listings.favorites_count through the existing trigger.
--
-- Self-follow and self-review are already refused by CHECK constraints from 0001, so nothing is needed for them.
-- Past views by owners were never attributed to a viewer, so old totals cannot be corrected automatically.
-- Rollback: supabase/rollback/0053_owner_activity_not_counted_ROLLBACK.sql.

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
  -- The owner looking at their own listing is not a viewer.
  if auth.uid() is not null and auth.uid() = v_seller_id then
    return;
  end if;

  update public.listings set views = views + 1 where id = p_listing_id;
  insert into public.listing_view_events (listing_id, seller_id) values (p_listing_id, v_seller_id);
end;
$$;

create or replace function public.prevent_self_favorite()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if exists (select 1 from public.listings l where l.id::text = new.listing_id and l.user_id = new.user_id) then
    raise exception 'You cannot favorite your own listing' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists favorites_prevent_self on public.favorites;
create trigger favorites_prevent_self
  before insert on public.favorites
  for each row execute function public.prevent_self_favorite();

-- Existing self-favorites: deleting them fires on_favorite_change, which lowers favorites_count to match.
delete from public.favorites f
using public.listings l
where l.id::text = f.listing_id and l.user_id = f.user_id;
