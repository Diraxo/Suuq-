-- 0054 rollback, STEP 1 of 2: export + restore. Run in ONE transaction, BEFORE dropping anything (the drop block is the commented
-- ROLLBACK section at the end of migrations/0054_storefronts.sql). Does not touch the storefront-verification bucket or its files.
--
-- Policy (decided in code, confirm with the owner):
--   * Every storefront row is first copied to storefront_rollback_export (kept after rollback; fails if it already exists so a
--     second run cannot overwrite the first export).
--   * Published owners in good standing: profiles.business_* already holds their latest (post-migration) values via the mirror. Untouched.
--   * Owners who were NEVER published and have a legacy snapshot: restore the ORIGINAL pre-0054 legacy values (those were public
--     before 0054, so restoring them re-creates exactly the old state). Their draft edits stay private, in the export.
--   * Owners who were published once and later unpublished/suspended, and owners created after 0054 (no snapshot): left cleared.
--     Their data is in the export only; making it public again is a decision for a person, not for a rollback script.
begin;

create table public.storefront_rollback_export as
  select s.*, now() as exported_at from public.storefronts s;
revoke all on public.storefront_rollback_export from public, anon, authenticated;

-- Gate: the export must be complete before anything is changed. Any mismatch aborts the whole transaction.
do $$
declare src bigint; dst bigint; bad bigint;
begin
  select count(*) into src from public.storefronts;
  select count(*) into dst from public.storefront_rollback_export;
  select count(*) into bad from public.storefronts s
    left join public.storefront_rollback_export e on e.id = s.id
    where e.id is null or e.owner_id is distinct from s.owner_id or e.status is distinct from s.status
       or e.published_at is distinct from s.published_at or e.name is distinct from s.name
       or e.description is distinct from s.description or e.hours is distinct from s.hours;
  if src <> dst or bad <> 0 then
    raise exception 'rollback aborted: export incomplete (storefronts=%, exported=%, mismatched=%)', src, dst, bad;
  end if;
  raise notice 'export verified: % storefront rows copied to storefront_rollback_export', dst;
end $$;

-- Per-owner outcome, decided BEFORE the update. Kept after the transaction as storefront_rollback_report (no client access).
create table public.storefront_rollback_report as
select s.owner_id,
  case
    when s.published_at is null and sn.owner_id is not null then 'restored_original_legacy'
    when s.published_at is null then 'left_cleared_created_after_0054'
    when s.status = 'published' then 'preserved_current_values'
    else 'left_cleared_published_then_unpublished'
  end as outcome
from public.storefronts s
left join public.storefront_legacy_snapshot sn on sn.owner_id = s.owner_id;
revoke all on public.storefront_rollback_report from public, anon, authenticated;

-- The sync triggers would copy the restored legacy values back into storefronts and re-clear drafts: remove them first.
drop trigger if exists profiles_z_business_legacy_sync on public.profiles;
drop trigger if exists profiles_z_account_status_mirror on public.profiles;

update public.profiles p set
  business_name = sn.business->>'name',
  business_description = sn.business->>'description',
  business_address = sn.business->>'address',
  business_website = sn.business->>'website',
  business_hours = coalesce(sn.business->'hours', '{}'::jsonb),
  business_logo_url = sn.business->>'logo_url',
  business_banner_url = sn.business->>'banner_url',
  business_logo_public_id = sn.business->>'logo_public_id',
  business_banner_public_id = sn.business->>'banner_public_id'
from public.storefront_legacy_snapshot sn
where sn.owner_id = p.id
  and not exists (select 1 from public.storefronts s where s.owner_id = p.id and s.published_at is not null);

-- Explicit result, one line per outcome. Per-owner detail: select * from public.storefront_rollback_report;
do $$
declare r record;
begin
  for r in select outcome, count(*) n from public.storefront_rollback_report group by outcome order by outcome loop
    raise notice 'rollback outcome %: % owner(s)', r.outcome, r.n;
  end loop;
end $$;

commit;
-- AFTER commit, BEFORE any drop: dump storefront_rollback_export and storefront_rollback_report (pg_dump -t), store the dump
-- outside the database, and restore it into a scratch database to prove it is recoverable. Only then run the drop block.
