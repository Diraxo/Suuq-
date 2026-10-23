-- Admin-verified city coordinates for "Find listings near me".
--
-- A separate table keyed by the directory id (public.locations.id), so matching
-- never depends on a city's name and renames/re-parenting keep the coordinate.
-- Nothing existing is altered: no column on public.locations, no change to the
-- 0032 column grant, no redefinition of any 0032/0035 function. Depends only on
-- 0027 (admin_audit_log), 0032 (locations) and 0039 (is_admin). Verified against
-- 0046-0060: none of them touches public.locations or these names.
--
-- No coordinates are seeded. The app ships a reviewed 38-city fallback list and
-- uses a row from this table instead whenever the city has one. Until this
-- migration is applied the apps simply get an error on the coordinate read and
-- keep using the fallback.

create table if not exists public.location_coordinates (
  location_id uuid primary key references public.locations (id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint location_coordinates_lat_range check (latitude between -90 and 90),
  constraint location_coordinates_lng_range check (longitude between -180 and 180),
  constraint location_coordinates_not_null_island check (not (latitude = 0 and longitude = 0))
);

-- Only cities carry coordinates.
create or replace function public.trg_location_coordinates_city_only()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.locations l where l.id = new.location_id and l.kind = 'city') then
    raise exception 'Coordinates can only be set on a city' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists location_coordinates_city_only on public.location_coordinates;
create trigger location_coordinates_city_only
  before insert or update of location_id on public.location_coordinates
  for each row execute function public.trg_location_coordinates_city_only();

-- RLS / grants: clients read approved cities' coordinates only, never write, and
-- never see who edited them.
alter table public.location_coordinates enable row level security;

drop policy if exists "approved city coordinates are publicly readable" on public.location_coordinates;
create policy "approved city coordinates are publicly readable" on public.location_coordinates
  for select using (
    exists (select 1 from public.locations l where l.id = location_id and l.status = 'approved' and l.kind = 'city')
  );

revoke all on public.location_coordinates from anon, authenticated;
grant select (location_id, latitude, longitude) on public.location_coordinates to anon, authenticated;

-- Admin: every coordinate row, including cities that are not approved yet.
create or replace function public.admin_list_location_coordinates()
returns table (location_id uuid, latitude double precision, longitude double precision, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can list location coordinates' using errcode = '42501';
  end if;
  return query select c.location_id, c.latitude, c.longitude, c.updated_at from public.location_coordinates c;
end;
$$;

revoke all on function public.admin_list_location_coordinates() from public, anon;
grant execute on function public.admin_list_location_coordinates() to authenticated;

-- Admin: set (both values) or clear (both null) a city's coordinate. Audited.
create or replace function public.admin_set_location_coordinates(
  p_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loc public.locations;
  v_lat double precision;
  v_lng double precision;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can edit location coordinates' using errcode = '42501';
  end if;
  select * into v_loc from public.locations where id = p_id for update;
  if not found then raise exception 'Location not found'; end if;
  if v_loc.kind <> 'city' then raise exception 'Coordinates can only be set on a city'; end if;

  if p_latitude is null and p_longitude is null then
    delete from public.location_coordinates where location_id = p_id;
    insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason, metadata)
    values (auth.uid(), 'clear_location_coordinates', 'location', p_id::text, p_reason, jsonb_build_object('name', v_loc.name));
    return;
  end if;

  if p_latitude is null or p_longitude is null
     or p_latitude in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
     or p_longitude in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision) then
    raise exception 'Enter both a latitude and a longitude' using errcode = '22023';
  end if;
  v_lat := round(p_latitude::numeric, 5)::double precision;
  v_lng := round(p_longitude::numeric, 5)::double precision;
  if v_lat not between -90 and 90 or v_lng not between -180 and 180 then
    raise exception 'Latitude must be -90 to 90 and longitude -180 to 180' using errcode = '22023';
  end if;
  if v_lat = 0 and v_lng = 0 then
    raise exception '0, 0 is not a real place' using errcode = '22023';
  end if;

  insert into public.location_coordinates (location_id, latitude, longitude, updated_by, updated_at)
  values (p_id, v_lat, v_lng, auth.uid(), now())
  on conflict (location_id) do update
    set latitude = excluded.latitude, longitude = excluded.longitude,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), 'set_location_coordinates', 'location', p_id::text, p_reason,
          jsonb_build_object('name', v_loc.name, 'latitude', v_lat, 'longitude', v_lng));
end;
$$;

revoke all on function public.admin_set_location_coordinates(uuid, double precision, double precision, text) from public, anon;
grant execute on function public.admin_set_location_coordinates(uuid, double precision, double precision, text) to authenticated;
