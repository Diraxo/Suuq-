-- 0048 — listing photo scans: server-side proof that every published photo was checked, plus the review path.
--
-- STATUS: written and tested on PGlite only. NOT applied to any database. Enforcement ships OFF
-- (image_scan_config.enforce = false) so applying this alone changes nothing for the live apps; flip it only
-- after the scan Worker is deployed and the apps send scans (docs/IMAGE_SAFETY.md §Rollout).
--
-- Model
--   listing_scans          one row per (user, draft listing id, scan fingerprint) → duplicate jobs collapse
--   listing_scan_images    one row per photo: private source key, public watermarked derivative, verdict, issues
--   image_hashes           64-bit perceptual hashes of published photos, for near-duplicate matching
-- Only the service role (the Worker) writes these. Clients get NO table access; the seller reads a sanitised
-- result through my_scan_result(); staff read evidence under the existing moderator permission.
--
-- Enforcement (when image_scan_config.enforce): a client write that adds a photo to a listing must reference a
-- derivative this user's scan produced for THIS listing. A photo whose verdict is "review" puts the listing in the
-- existing hidden 'deactivated' state (never public) until staff approve; a "reject" can't be published at all.

-- ============================================================================
-- 1. Config (singleton)
-- ============================================================================
create table if not exists public.image_scan_config (
  id boolean primary key default true check (id),
  enforce boolean not null default false,
  evidence_retention_days int not null default 30 check (evidence_retention_days between 1 and 365),
  updated_at timestamptz not null default now()
);
insert into public.image_scan_config (id) values (true) on conflict do nothing;
alter table public.image_scan_config enable row level security;
drop policy if exists "staff read scan config" on public.image_scan_config;
create policy "staff read scan config" on public.image_scan_config for select using (public.staff_can('read'));
revoke insert, update, delete on public.image_scan_config from anon, authenticated;

create or replace function public.image_scan_enforced()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select enforce from public.image_scan_config where id), false) $$;

-- ============================================================================
-- 2. Scans
-- ============================================================================
create table if not exists public.listing_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  listing_id uuid not null,                       -- the client-generated id the listing will be published under
  fingerprint text not null,                      -- lib/imageSafety.ts scanFingerprint(): same photos + context → same scan
  category text not null,
  status text not null default 'processing' check (status in ('processing', 'approved', 'needs_changes', 'pending_review', 'failed')),
  held_listing boolean not null default false,    -- true once enforcement hid a listing because of this scan
  flagged_for_staff boolean not null default false,
  result jsonb,                                   -- the sanitised answer returned to the app (idempotent replays)
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, listing_id, fingerprint)
);
create index if not exists listing_scans_listing_idx on public.listing_scans (listing_id);
create index if not exists listing_scans_review_idx on public.listing_scans (created_at desc) where status = 'pending_review';

create table if not exists public.listing_scan_images (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.listing_scans (id) on delete cascade,
  slot int not null check (slot between 0 and 7),
  source_key text,                                -- PRIVATE original (nulled by retention purge)
  public_key text,                                -- watermarked derivative key (wm/...)
  public_url text,                                -- exactly what listings.images will contain
  sha256 text,
  phash text check (phash is null or phash ~ '^[0-9a-f]{16}$'),
  verdict text not null default 'pass' check (verdict in ('pass', 'review', 'reject')),
  issues text[] not null default '{}',
  internal jsonb not null default '{}'::jsonb,    -- classifier evidence — staff only, never returned to sellers
  review_status text not null default 'not_needed' check (review_status in ('not_needed', 'pending', 'approved', 'rejected', 'replacement_requested')),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_reason text,                             -- INTERNAL
  unique (scan_id, slot)
);
create unique index if not exists listing_scan_images_url_idx on public.listing_scan_images (public_url) where public_url is not null;
create index if not exists listing_scan_images_pending_idx on public.listing_scan_images (scan_id) where review_status = 'pending';

create table if not exists public.image_hashes (
  id uuid primary key default gen_random_uuid(),
  phash text not null check (phash ~ '^[0-9a-f]{16}$'),
  sha256 text,
  user_id uuid not null references public.profiles (id) on delete cascade,
  listing_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists image_hashes_listing_idx on public.image_hashes (listing_id);
create index if not exists image_hashes_sha_idx on public.image_hashes (sha256);

alter table public.listing_scans enable row level security;
alter table public.listing_scan_images enable row level security;
alter table public.image_hashes enable row level security;
drop policy if exists "staff read scans" on public.listing_scans;
create policy "staff read scans" on public.listing_scans for select using (public.staff_can('moderate_listing'));
drop policy if exists "staff read scan images" on public.listing_scan_images;
create policy "staff read scan images" on public.listing_scan_images for select using (public.staff_can('moderate_listing'));
-- image_hashes: no policy at all → invisible to every API role (service role bypasses RLS).
revoke all on public.listing_scans, public.listing_scan_images, public.image_hashes from anon;
revoke insert, update, delete on public.listing_scans, public.listing_scan_images from authenticated;
revoke all on public.image_hashes from authenticated;

-- ============================================================================
-- 3. Reads
-- ============================================================================
-- What the SELLER may see of a scan: per-photo verdict and issue codes only (the client maps codes to friendly
-- text). No keys, hashes, evidence, reviewer or internal notes.
create or replace function public.my_scan_result(p_scan_id uuid)
returns table (scan_status text, slot int, public_url text, verdict text, issues text[], review_status text)
language sql stable security definer set search_path = public
as $$
  select s.status, i.slot, i.public_url, i.verdict, i.issues, i.review_status
    from public.listing_scans s join public.listing_scan_images i on i.scan_id = s.id
   where s.id = p_scan_id and s.user_id = auth.uid()
   order by i.slot
$$;
grant execute on function public.my_scan_result(uuid) to authenticated;
revoke execute on function public.my_scan_result(uuid) from anon, public;

-- Near-duplicate lookup for the Worker. Returns distance + whether the match is the caller's own image — never
-- the other listing's id or owner (the uploader must not learn who else posted a photo).
create or replace function public.find_similar_images(p_phash text, p_user uuid, p_max int default 6, p_exclude_listing uuid default null)
returns table (distance int, same_owner boolean)
language sql stable security definer set search_path = public
as $$
  select bit_count((('x' || h.phash)::bit(64) # ('x' || p_phash)::bit(64)))::int as distance, h.user_id = p_user as same_owner
    from public.image_hashes h
   where (p_exclude_listing is null or h.listing_id <> p_exclude_listing)
     and bit_count((('x' || h.phash)::bit(64) # ('x' || p_phash)::bit(64))) <= p_max
   order by 1
   limit 20
$$;
revoke execute on function public.find_similar_images(text, uuid, int, uuid) from anon, authenticated, public;
grant execute on function public.find_similar_images(text, uuid, int, uuid) to service_role;

-- ============================================================================
-- 4. Enforcement
-- ============================================================================
-- Definer helpers (the trigger itself must stay INVOKER: is_client_write() inspects current_user).
create or replace function public._scan_image_state(p_url text, p_user uuid, p_listing uuid)
returns table (scan_id uuid, verdict text, review_status text)
language sql stable security definer set search_path = public
as $$
  select s.id, i.verdict, i.review_status
    from public.listing_scan_images i join public.listing_scans s on s.id = i.scan_id
   where i.public_url = p_url and s.user_id = p_user and s.listing_id = p_listing and s.status <> 'processing'
   limit 1
$$;
revoke execute on function public._scan_image_state(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public._scan_image_state(text, uuid, uuid) to authenticated;   -- needed by the invoker trigger

-- Photos in `p_urls` that still block a listing (unreviewed, rejected, or flagged for replacement).
create or replace function public._scan_unresolved_count(p_urls text[], p_user uuid, p_listing uuid)
returns int
language sql stable security definer set search_path = public
as $$
  select count(*)::int
    from unnest(p_urls) u
    left join (public.listing_scan_images i join public.listing_scans s on s.id = i.scan_id and s.user_id = p_user and s.listing_id = p_listing) on i.public_url = u
   where i.id is null
      or i.review_status in ('pending', 'rejected', 'replacement_requested')
      or (i.verdict <> 'pass' and i.review_status <> 'approved')
$$;
revoke execute on function public._scan_unresolved_count(text[], uuid, uuid) from public, anon;
grant execute on function public._scan_unresolved_count(text[], uuid, uuid) to authenticated;

create or replace function public._scan_mark_held(p_scan_ids uuid[])
returns void language sql security definer set search_path = public
as $$ update public.listing_scans set held_listing = true where id = any(p_scan_ids) $$;
revoke execute on function public._scan_mark_held(uuid[]) from public, anon, authenticated;
grant execute on function public._scan_mark_held(uuid[]) to authenticated;

create or replace function public._listing_awaiting_replacement(p_listing uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.listing_scans s join public.listing_scan_images i on i.scan_id = s.id
     where s.listing_id = p_listing and s.held_listing and i.review_status = 'replacement_requested')
$$;
revoke execute on function public._listing_awaiting_replacement(uuid) from public, anon;
grant execute on function public._listing_awaiting_replacement(uuid) to authenticated;

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
drop trigger if exists listings_z_image_scan on public.listings;
create trigger listings_z_image_scan
  before insert or update of images on public.listings
  for each row execute function public.trg_listing_image_scan();

-- 0039's lock ("nobody edits a deactivated listing") gets ONE exception: while staff are waiting for a
-- replacement photo, the owner may update (not delete) that listing so they can swap it.
create or replace function public.trg_block_restricted_listing_writes()
returns trigger
language plpgsql
as $$
declare
  v_owner uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
begin
  if public.is_client_write() then
    if public.account_effective_status(v_owner) in ('suspended', 'banned') then
      raise exception 'Account suspended' using errcode = '42501';
    end if;
    if tg_op in ('UPDATE', 'DELETE') and old.status in ('removed', 'deactivated')
       and not (tg_op = 'UPDATE' and old.status = 'deactivated' and public._listing_awaiting_replacement(old.id)) then
      raise exception 'This listing is under review and cannot be changed' using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- ============================================================================
-- 5. Staff review (approve / reject / ask for a replacement)
-- ============================================================================
create or replace function public.admin_review_scan_image(p_image_id uuid, p_decision text, p_reason text, p_message text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_img public.listing_scan_images%rowtype;
  v_scan public.listing_scans%rowtype;
  v_l public.listings%rowtype;
  v_title text;
  v_body text;
  v_kind text;
  v_notice uuid;
  v_open int;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if not public.staff_can('moderate_listing') then
    raise exception 'Not authorized to review photos' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject', 'request_replacement') then
    raise exception 'Unknown decision %', p_decision using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  if v_msg is not null and char_length(v_msg) > 1000 then
    raise exception 'The message to the seller is too long' using errcode = '22023';
  end if;
  select * into v_img from public.listing_scan_images where id = p_image_id for update;
  if not found then raise exception 'Photo not found' using errcode = 'P0002'; end if;
  select * into v_scan from public.listing_scans where id = v_img.scan_id for update;
  -- Overriding an automatic REJECT (clear violation) is an administrator decision, not a moderator's.
  if p_decision = 'approve' and v_img.verdict = 'reject' and public.staff_role() <> 'admin' then
    raise exception 'Only an administrator can override a rejected photo' using errcode = '42501';
  end if;

  update public.listing_scan_images
     set review_status = case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'replacement_requested' end,
         reviewed_by = auth.uid(), reviewed_at = now(), review_reason = btrim(p_reason)
   where id = p_image_id;

  select * into v_l from public.listings where id = v_scan.listing_id for update;

  insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason, metadata)
  values (auth.uid(), 'review_scan_image', 'listing', v_scan.listing_id::text, btrim(p_reason),
          jsonb_build_object('image_id', p_image_id, 'scan_id', v_scan.id, 'decision', p_decision, 'verdict', v_img.verdict, 'issues', to_jsonb(v_img.issues)));

  if p_decision = 'approve' then
    -- Release the hold once nothing else on this scan is waiting.
    select count(*) into v_open from public.listing_scan_images
     where scan_id = v_scan.id and review_status in ('pending', 'rejected', 'replacement_requested');
    if v_open = 0 then
      update public.listing_scans set status = 'approved' where id = v_scan.id;
      if found and v_l.id is not null and v_l.status = 'deactivated' and v_scan.held_listing then
        perform set_config('fursad.admin_write', 'true', true);
        update public.listings set status = coalesce(nullif(status_before_moderation, ''), 'available'), status_before_moderation = null where id = v_l.id;
        v_notice := public._moderation_record(auth.uid(), 'listing_restored', v_l.user_id, v_l.id, null, p_reason, v_msg, 'deactivated', 'available', null,
                                              jsonb_build_object('title', v_l.title));
      end if;
    end if;
    return v_notice;
  end if;

  v_kind := case p_decision when 'reject' then 'image_rejected' else 'image_replacement_requested' end;
  v_title := case p_decision when 'reject' then 'A photo was not approved' else 'Please replace a photo' end;
  v_body := case p_decision
    when 'reject' then format('A photo on your listing “%s” can’t be used on Suuqiye. Please choose a different photo.', coalesce(v_l.title, 'your listing'))
    else format('Please replace one photo on your listing “%s” with a clear, original photo of the item. Your listing stays hidden until you do.', coalesce(v_l.title, 'your listing')) end;
  if v_msg is not null then v_body := v_body || E'\n\n' || v_msg; end if;
  insert into public.moderation_notices (user_id, kind, listing_id, title, body, data, appealable)
  values (v_scan.user_id, v_kind, v_l.id, v_title, v_body, jsonb_build_object('listingTitle', v_l.title), p_decision = 'reject')
  returning id into v_notice;
  insert into public.notifications (user_id, title, body, type, data)
  values (v_scan.user_id, 'Suuqiye Support Team', v_title, 'moderation', jsonb_build_object('kind', v_kind, 'listingId', v_l.id, 'noticeId', v_notice));
  return v_notice;
end;
$$;
grant execute on function public.admin_review_scan_image(uuid, text, text, text) to authenticated;
revoke execute on function public.admin_review_scan_image(uuid, text, text, text) from anon, public;

-- ============================================================================
-- 6. Retention
-- ============================================================================
-- Drops the private source key and classifier evidence for finished scans older than the configured window.
-- Returns the R2 source keys the caller (a scheduled Worker) must now delete from the private bucket. Photos
-- still waiting for review are never purged.
create or replace function public.purge_scan_evidence()
returns table (source_key text)
language plpgsql security definer set search_path = public
as $$
declare
  v_days int := (select evidence_retention_days from public.image_scan_config where id);
begin
  return query
    with due as (
      select i.id, i.source_key as old_key
        from public.listing_scan_images i join public.listing_scans s on s.id = i.scan_id
       where s.created_at < now() - make_interval(days => v_days)
         and i.review_status not in ('pending', 'replacement_requested') and i.source_key is not null
         for update of i
    ), cleared as (
      update public.listing_scan_images i set source_key = null, internal = '{}'::jsonb from due where i.id = due.id returning i.id
    )
    select due.old_key from due join cleared on cleared.id = due.id;
end;
$$;
revoke execute on function public.purge_scan_evidence() from anon, authenticated, public;
grant execute on function public.purge_scan_evidence() to service_role;
