-- Admin hard-delete for the location directory: removes a country, region or
-- city together with everything below it, in one audited step.
--
-- Listings are NEVER deleted. listings.location_id is ON DELETE SET NULL, so a
-- listing that used a deleted place stays published and keeps showing its own
-- `city` text; it just no longer matches location filters (Home/Search), which
-- only know places that exist in the directory. The app and the website read the
-- same table, so a deleted place disappears from both at once.
create or replace function public.admin_delete_location(p_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loc public.locations;
  v_depth int;
  v_places int;
  v_listings int;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can delete locations' using errcode = '42501';
  end if;
  select * into v_loc from public.locations where id = p_id for update;
  if not found then raise exception 'Location not found'; end if;

  create temp table _loc_tree on commit drop as
    with recursive t as (
      select id, 0 as depth from public.locations where id = p_id
      union all
      select l.id, t.depth + 1 from public.locations l join t on l.parent_id = t.id
    )
    select id, depth from t;

  select count(*) into v_places from _loc_tree;
  select count(*) into v_listings from public.listings where location_id in (select id from _loc_tree);

  -- parent_id is ON DELETE RESTRICT, so remove the deepest level first.
  for v_depth in select distinct depth from _loc_tree order by depth desc loop
    delete from public.locations where id in (select id from _loc_tree where depth = v_depth);
  end loop;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), 'delete_location', 'location', p_id::text, p_reason,
          jsonb_build_object('name', v_loc.name, 'kind', v_loc.kind, 'places', v_places, 'listingsUnlinked', v_listings));

  return jsonb_build_object('places', v_places, 'listings', v_listings);
end;
$$;

grant execute on function public.admin_delete_location(uuid, text) to authenticated;
