-- ROLLBACK for 0051 (bulk photo queue). Drops the queue, its functions and config, and restores 0050's config trigger.
-- Rows still in the queue are discarded: tell any seller with an open bulk upload first (nothing is published by the
-- queue itself — listings are only ever created by the app — so no listing is affected).
drop function if exists public.admin_set_bulk_scan_config(boolean, int, text);
drop function if exists public.fail_bulk_row(uuid, text, boolean);
drop function if exists public.complete_bulk_row(uuid, text, uuid, text[]);
drop function if exists public.claim_bulk_rows(int);
drop function if exists public.bulk_cancel_batch(uuid);
drop function if exists public.bulk_mark_published(uuid);
drop function if exists public.bulk_retry_row(uuid);
drop function if exists public.bulk_batch_status(uuid);
drop function if exists public.bulk_active_batch();
drop function if exists public.enqueue_bulk_import(jsonb);
drop function if exists public.bulk_scan_quota();
drop table if exists public.bulk_import_rows;
drop table if exists public.bulk_import_batches;
drop table if exists public.bulk_scan_config;
alter table public.listing_scans drop constraint if exists listing_scans_source_check;
alter table public.listing_scans drop column if exists source;

-- 0050's config trigger function, verbatim (0051 added "switch bulk off when leaving enforce").
create or replace function public.trg_image_scan_config_sync()
returns trigger language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.enforce is distinct from old.enforce and new.mode is not distinct from old.mode then
    new.mode := case when new.enforce then 'enforce' else case when old.mode = 'enforce' then 'off' else old.mode end end;
  end if;
  new.enforce := (new.mode = 'enforce');
  if new.mode <> 'enforce' then new.legacy_presign_closed := false; end if;
  if new.mode = 'shadow' and (tg_op = 'INSERT' or old.mode is distinct from 'shadow') then new.shadow_started_at := now(); end if;
  if new.mode = 'off' then new.shadow_started_at := null; end if;
  new.updated_at := now();
  return new;
end;
$$;
