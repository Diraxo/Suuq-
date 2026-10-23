-- ROLLBACK for 0042_home_feed.sql.  NOT APPLIED ANYWHERE. Review before use.
--
-- Drops the two feed functions and the two partial indexes 0042 created. Nothing else changes: no table,
-- column, policy or trigger was touched by 0042, so no data is lost. After this, app builds that call
-- home_feed()/home_feed_currencies() (Home, category and city screens) stop loading — roll the apps back too.
-- Re-runnable (idempotent).

drop function if exists public.home_feed_currencies(text[], uuid);
drop function if exists public.home_feed(text, text[], text, uuid, text, uuid, text, text, int, timestamptz, double precision, timestamptz, uuid);
drop index if exists public.listings_home_category_idx;
drop index if exists public.listings_home_feed_idx;
