-- Rollback for 0038_search_discovery.sql. DESTRUCTIVE for data created by 0038 only:
-- verification grants/events, boosts, and the denormalised price-drop columns are dropped.
-- Pre-existing data (listings, profiles, price_drops rows) is untouched.
-- pg_trgm is left installed (harmless, may be used elsewhere).

drop function if exists public.search_listings(text, text, uuid, boolean, boolean, boolean, boolean, boolean, int, timestamptz, uuid);
drop function if exists public.locations_in_scope(uuid);
drop index if exists public.listings_title_trgm_idx;
drop index if exists public.listings_feed_idx;
drop index if exists public.listings_category_feed_idx;
drop index if exists public.listings_location_feed_idx;
drop index if exists public.listings_negotiable_feed_idx;
drop index if exists public.listings_user_created_idx;

-- price drops: restore the original owner-insert policy (0001) and stop recording from the trigger.
drop trigger if exists listings_b_record_price_drop on public.listings;
drop function if exists public.trg_listings_record_price_drop();
drop function if exists public.price_reduced_window();
drop index if exists public.listings_price_drop_idx;
drop index if exists public.price_drops_listing_created_idx;
create policy "listing owners can record price drops" on public.price_drops
  for insert with check (
    exists (select 1 from public.listings l where l.id = listing_id and l.user_id = auth.uid())
  );

-- boosts
drop function if exists public.admin_revoke_boost(uuid, text);
drop function if exists public.admin_grant_boost(uuid, int, text);
drop table if exists public.listing_boosts;
drop trigger if exists listings_a_guard_protected on public.listings;
drop function if exists public.guard_listing_protected_columns();
drop index if exists public.listings_boosted_idx;
alter table public.listings drop column if exists boosted_until;
alter table public.listings drop column if exists last_price_drop_at;
alter table public.listings drop column if exists last_price_drop_from;
drop function if exists public.marketplace_day_start(timestamptz);

-- verification
drop function if exists public.admin_set_verified(uuid, boolean, text);
drop table if exists public.profile_verification_events;
drop trigger if exists profiles_a_guard_protected on public.profiles;
drop function if exists public.guard_profile_protected_columns();
drop index if exists public.profiles_verified_idx;
alter table public.profiles drop column if exists verified_at;

drop function if exists public.is_client_write();
