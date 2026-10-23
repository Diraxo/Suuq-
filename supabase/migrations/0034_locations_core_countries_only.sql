-- SUUQIYE serves Somalia, Somaliland and Ethiopia only. Remove the other
-- countries that the first version of 0033 seeded. Safe by construction: a
-- country is only deleted when nothing references it (no regions/cities below
-- it, no listings linked to it). More countries can be added any time from
-- Admin -> Locations.
delete from public.locations c
where c.kind = 'country'
  and c.normalized_name not in ('ethiopia', 'somalia', 'somaliland')
  and not exists (select 1 from public.locations ch where ch.parent_id = c.id)
  and not exists (select 1 from public.listings li where li.location_id = c.id);
