-- ROLLBACK for 0050 (photo-scan rollout ladder). Restores 0048's single-boolean behaviour.
-- Safe order: mode goes back to 'off' first (re-opening the legacy upload path), then the objects are removed.
-- The 0048 `enforce` boolean is left exactly as 0048 defines it, set to false.
update public.image_scan_config set mode = 'off', legacy_presign_closed = false;
drop trigger if exists image_scan_config_sync on public.image_scan_config;
update public.image_scan_config set enforce = false;

-- 0048's trigger function, verbatim.
create or replace function public.trg_listing_image_scan()
returns trigger
language plpgsql
as $$
declare
  v_url text;
  v_state record;
  v_hold boolean := false;
  v_scans uuid[] := '{}';
  v_check text[];
begin
  if not public.is_client_write() or not public.image_scan_enforced() then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.images is not distinct from old.images then
    return new;
  end if;

  -- Insert: every photo must be verified. Update: new photos must be; photos that were already on the listing are
  -- re-checked only when the listing is being released from a scan hold.
  v_check := case when tg_op = 'INSERT' then new.images
                  else coalesce(array(select u from unnest(new.images) u where not (u = any (old.images))), '{}') end;
  foreach v_url in array v_check loop
    select * into v_state from public._scan_image_state(v_url, new.user_id, new.id);
    if not found then
      raise exception 'Photo has not been checked' using errcode = '42501', hint = 'image_not_verified';
    end if;
    if v_state.review_status = 'rejected' or (v_state.verdict = 'reject' and v_state.review_status <> 'approved') then
      raise exception 'Photo was not accepted' using errcode = '42501', hint = 'image_rejected';
    end if;
    if v_state.verdict = 'review' and v_state.review_status <> 'approved' then
      v_hold := true;
      v_scans := v_scans || v_state.scan_id;
    end if;
  end loop;

  if v_hold then
    -- Never public while a human has not looked: the existing hidden state, restorable by staff.
    new.status_before_moderation := case when tg_op = 'UPDATE' and old.status not in ('removed', 'deactivated') then old.status else 'available' end;
    new.status := 'deactivated';
    perform public._scan_mark_held(v_scans);
  elsif tg_op = 'UPDATE' and old.status = 'deactivated' and public._listing_awaiting_replacement(old.id)
        and public._scan_unresolved_count(new.images, new.user_id, new.id) = 0 then
    -- Seller replaced the flagged photo with clean ones → the scan hold is lifted.
    new.status := coalesce(nullif(old.status_before_moderation, ''), 'available');
    new.status_before_moderation := null;
  end if;
  return new;
end;
$$;

drop function if exists public.trg_image_scan_config_sync();
drop function if exists public.image_scan_mode();
drop function if exists public.image_scan_client_policy();
drop function if exists public.admin_image_scan_rollout_status();
drop function if exists public.admin_set_image_scan_mode(text, text);
drop function if exists public.admin_set_legacy_presign_closed(boolean, text);
drop function if exists public.legacy_presign_closed();
drop function if exists public._scan_shadow_record(uuid, uuid, text, int, int, int, int);
-- The shadow evidence is dropped with its table; export it first if you want to keep it.
drop table if exists public.image_scan_shadow_events;
alter table public.image_scan_config drop constraint if exists image_scan_config_closure_needs_enforce;
alter table public.image_scan_config drop constraint if exists image_scan_config_mode_check;
alter table public.image_scan_config drop column if exists min_shadow_hours, drop column if exists shadow_started_at,
  drop column if exists legacy_presign_closed, drop column if exists mode;
