-- Fixes silently-dead realtime subscriptions: store/follow.ts, store/reviews.ts,
-- and app/seller/[id].tsx already open postgres_changes channels on
-- followers/reviews, and store/myListings.ts (0020, see below) opens one on
-- listings, but none of these tables were ever added to the
-- supabase_realtime publication, so Postgres never emits change events for
-- them. Only messages, conversations (0005), offers (0006), notifications
-- (0007), and profiles (0015) were previously registered.
--
-- This is the root cause of: follower counts showing 0 after following from
-- another device, review/rating stats not updating live, and sold status /
-- view counts not propagating without a manual refresh.
alter publication supabase_realtime add table public.followers;
alter publication supabase_realtime add table public.reviews;
alter publication supabase_realtime add table public.listings;
