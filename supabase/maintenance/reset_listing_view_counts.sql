-- OPTIONAL, DESTRUCTIVE, run by hand after 0069 is applied. Not a migration.
-- Old counts include owner views and repeat views and cannot be attributed to people, so they cannot be repaired.
-- This sets every listing back to 0 views and clears the windowed event log; real unique views accumulate from here.
begin;
update public.listings set views = 0 where views <> 0;
delete from public.listing_view_events;
commit;
