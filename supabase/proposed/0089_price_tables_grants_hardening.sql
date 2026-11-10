-- ============================================================================
-- 0089_price_tables_grants_hardening.sql  —  PROPOSED. NOT APPLIED. Do not run without the owner's approval.
--
-- Least-privilege cleanup around the price / offer / price-drop path. Found by a read-only look at production on 2026-10-26:
--   * anon and authenticated hold ALL table privileges (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER) on
--     public.listings, public.offers and public.price_drops. That is Supabase's default for new tables (pg_default_acl), not something this
--     project chose. Row-level security stops row reads/writes (offers and price_drops have no write policy at all), but RLS does NOT
--     apply to TRUNCATE, and TRIGGER / REFERENCES have no business being held by API roles.
--   * public.trg_listings_record_price_drop() is SECURITY DEFINER (runs as postgres, bypasses RLS to write price_drops) and EXECUTE is granted
--     to PUBLIC, anon and authenticated. It cannot be called directly (PostgreSQL refuses: "trigger functions can only be called as
--     triggers"; proven in the test), and trigger firing does not check the firing user's EXECUTE right, so that grant protects nothing and is
--     only needed at CREATE TRIGGER time, which the API roles never do. Its search_path is "public" without pg_temp; the sibling 0086 functions use
--     "public, pg_temp".
--
-- What this does (nothing here changes what a signed-in user can do through the app; the app only SELECTs price_drops and writes offers through
-- the create_offer / respond_to_offer / cancel_offer RPCs):
--   1. revoke TRUNCATE, TRIGGER, REFERENCES on listings, offers, price_drops from anon, authenticated
--      and, on PostgreSQL 17+ (production is 17.6, ACL string arwdDxtm), also MAINTAIN (VACUUM / ANALYZE / REINDEX / CLUSTER / LOCK TABLE rights)
--   2. revoke INSERT, UPDATE, DELETE on offers and price_drops from anon, authenticated   (already denied by RLS; this makes it two locks)
--   3. revoke EXECUTE on the price-drop trigger function from PUBLIC, anon, authenticated; pin its search_path to "public, pg_temp"
--
-- Deliberately NOT done here: revoking INSERT / UPDATE / DELETE on public.listings from anon. RLS already requires auth.uid() = user_id, which is NULL
-- for anon, but removing the grant touches the public listing write path and deserves its own test pass. New tables will again be created with the
-- broad default grants unless "alter default privileges ... revoke" is added; that is a project-wide decision, not part of this file.
--
-- Live state compared against this file (read-only snapshot 2026-10-27, PG 17.6): anon/authenticated/service_role each hold arwdDxtm on all three tables,
-- granted by postgres; no column-level ACLs; RLS on, not forced; the only writers of offers / price_drops are SECURITY DEFINER functions owned by postgres
-- (create_offer, respond_to_offer, cancel_offer, expire_stale_offers, mark_listing_sold, trg_listings_record_price_drop); the clients only SELECT them.
-- service_role (bypassrls) and postgres (owner, member of anon/authenticated/service_role) are not touched.
--
-- Atomic: one transaction. Run with `supabase db query --linked -f`; a failure rolls the whole file back.
--
-- Rollback: 0089_price_tables_grants_hardening_ROLLBACK.sql (re-grants exactly what was revoked).
-- ============================================================================

begin;
set local lock_timeout = '10s';

revoke truncate, trigger, references on public.listings, public.offers, public.price_drops from anon, authenticated;
revoke insert, update, delete on public.offers, public.price_drops from anon, authenticated;

revoke execute on function public.trg_listings_record_price_drop() from public, anon, authenticated;
alter function public.trg_listings_record_price_drop() set search_path = public, pg_temp;

-- MAINTAIN exists only on PostgreSQL 17+; the version guard keeps the file runnable on older local images.
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on public.listings, public.offers, public.price_drops from anon, authenticated';
  end if;
end $$;

commit;
