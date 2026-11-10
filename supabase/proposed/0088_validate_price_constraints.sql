-- ============================================================================
-- 0088_validate_price_constraints.sql  —  PROPOSED. NOT APPLIED. Do not run without the owner's approval.
--
-- Validates the two NOT VALID price constraints that 0085 and 0086 left on public.listings:
--   listings_price_range            (price > 0 and <= 999999999999)  OR  contact-price shape
--   listings_price_zero_needs_mode  (price <> 0  OR  is_contact_price_listing(...))
-- Both were created NOT VALID, so since 0085/0086 they already guard every insert and every update. Validation only adds "and every OLD row
-- also satisfies it", which then lets the planner trust the rule and makes the guarantee unconditional (a later UPDATE of an old row that
-- skips these columns can no longer hide a bad value).
--
-- When it is safe: only when no row violates either rule. Read-only check against production on 2026-10-26: 8 listings, 0 with price = 0,
-- 0 with price < 0, 0 above the cap, 0 NULL, 0 services listings. VALIDATE CONSTRAINT takes SHARE UPDATE EXCLUSIVE (reads and writes continue;
-- only other DDL waits) and scans the table once, so on a table this size it is instant. The block below re-checks inside the same transaction
-- and refuses to continue if a violating row has appeared since.
--
-- ATOMICITY: the file is one explicit transaction (begin ... commit). Execution method is `supabase db query --linked -f <file>` (Management API,
-- the same runner used for 0085/0086); the explicit begin/commit was probed read-only against production on 2026-10-27 and is accepted by that
-- runner. If the preflight block or either VALIDATE fails, the transaction is aborted and rolled back as a whole: both constraints stay NOT VALID.
-- Under psql -f (no ON_ERROR_STOP) a failure leaves the session in an aborted transaction, so the trailing COMMIT acts as ROLLBACK; the same
-- holds for `psql -1`. `set local lock_timeout` makes the migration give up (and roll back) instead of queueing behind a long DDL lock.
--
-- Not reversible by itself (a validated constraint cannot be "un-validated"): rollback = 0088_validate_price_constraints_ROLLBACK.sql, which
-- drops and re-adds the two constraints NOT VALID with identical definitions.
-- ============================================================================

begin;
set local lock_timeout = '10s';

do $$
declare
  bad bigint;
begin
  select count(*) into bad from public.listings
   where not ((price > 0 and price <= 999999999999)
              or (price = 0 and category = 'services' and attributes ->> 'priceMode' = 'Contact for price'))
      or not (price <> 0 or public.is_contact_price_listing(category, price, attributes));
  if bad > 0 then
    raise exception '0088 refused: % listing row(s) violate the price rules; fix or review them before validating', bad using errcode = 'P0001';
  end if;
end $$;

alter table public.listings validate constraint listings_price_range;
alter table public.listings validate constraint listings_price_zero_needs_mode;

commit;
