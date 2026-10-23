-- 0057 — business logo / banner scans: server-side proof that a new business image was checked before it can be saved.
--
-- STATUS: written and tested on PGlite only. NOT applied to any database.
--
-- POLICY (owner decision 2026-10-21, "direct upload for now"): the scan Worker is not deployed, so clients upload straight to the public
-- bucket through a presigned PUT and no scan row can exist. Therefore this migration SHIPS WITH ENFORCEMENT OFF, as an explicit seeded row
-- (business_media_config: id=true, enforce=false). While it is OFF the scan triggers below are inert and only the 0056 rules apply
-- (own key shape; the URL merely has to END with that key on ANY https host). Unscanned images are NOT checked for content and the
-- foreign-host URL gap is open: see docs/MEDIA_LAUNCH_POLICY.md. OFF is a deliberate, visible operator statement, not a safe default.
--
-- FAIL CLOSED where it is not explicit: the column default is ON, and business_media_enforced() reads a missing row or a NULL as ON.
-- So deleting or blanking the config row can never silently relax enforcement; only the seeded/explicit enforce=false does. Clients cannot
-- write the table. Turning enforcement ON (update public.business_media_config set enforce = true) makes EVERY avatar/logo/banner save fail
-- until a scanned path exists, because today's clients and r2-presign only know the direct presigned PUT (no scan row is ever written).
-- So switch it ON only after the Worker's /v1/business-media route, storefront_media_hosts, a client that calls the Worker and a
-- presign gate that refuses avatars/ and business/ are all deployed and staging-verified (docs/MEDIA_LAUNCH_POLICY.md,
-- docs/MEDIA_STAGING_RUNBOOK.md). Record who changed it and why.
--
-- Why: logos and banners (old business-profile screen AND storefronts, 0054) were uploaded with a presigned PUT straight into the
-- PUBLIC bucket — no content check, no metadata strip. The scanned path (Worker business-media route, scanPolicy.ts gates) exists in the
-- repo but is NOT deployed and is not wired into r2-presign or the clients (2026-10-21). This migration is the database half of that path:
-- while enforced, a CLIENT write that sets a new business image key must reference an 'approved' scan row of that same user, kind and key.
-- While OFF (the shipped state) it does nothing.
--
-- Interaction with later migrations (2026-10-21, written + PGlite-tested, NOT applied): while this switch is OFF the profile slots are still
-- covered by 0062 (host pin for key-bearing values; REQUIRES a storefront_media_hosts row first) and 0063 (no NEW URL-only values), which are
-- independent of this switch. They close the foreign-host and URL-only gaps; they do NOT make an unscanned image safe. Direct-upload images
-- stay UNSCANNED until the Worker route exists and enforce is turned ON deliberately. Apply order: 0054 -> 0055 -> 0056 -> THIS -> 0058 -> 0059 ->
-- insert host -> 0062 -> 0063; rollback in reverse. Note the sentence above 'ANY https host' describes 0056 alone; with 0062 applied the host is pinned.
--
-- Model
--   business_media_scans   one row per upload attempt (processing → approved | rejected | held | unavailable). Service role writes;
--                          clients get no table access. Staff may read (moderation).
-- Grandfathering: a key the owner ALREADY holds on profiles or storefronts (legacy, pre-scan) may be re-saved or copied between the
-- two — only a NEW value needs a scan. Non-client writers (the 0054 mirror RPCs, backfills, operator SQL) are not checked.

create table if not exists public.business_media_config (
  id boolean primary key default true check (id),
  enforce boolean not null default true,      -- fail closed: only an EXPLICIT false relaxes enforcement
  updated_at timestamptz not null default now()
);
-- If an EARLIER draft of this table (default OFF) was ever applied somewhere, create-if-not-exists above would keep that default: force the
-- column default to ON. The seeded row is explicit OFF (direct-upload policy, see the header). An existing row is NOT touched (that would
-- silently override an operator decision) -- the preflight in docs/MEDIA_STAGING_RUNBOOK.md reads `select enforce from business_media_config`
-- and must match the intended mode before release.
alter table public.business_media_config alter column enforce set default true;
insert into public.business_media_config (id, enforce) values (true, false) on conflict do nothing;
alter table public.business_media_config enable row level security;
drop policy if exists "staff read business media config" on public.business_media_config;
create policy "staff read business media config" on public.business_media_config for select using (public.staff_can('read'));
revoke insert, update, delete on public.business_media_config from anon, authenticated;

create or replace function public.business_media_enforced()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select enforce from public.business_media_config where id), true) $$;

create table if not exists public.business_media_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('logo', 'banner')),
  sha256 text not null,
  status text not null default 'processing' check (status in ('processing', 'approved', 'rejected', 'held', 'unavailable')),
  issues text[] not null default '{}',
  source_key text,                       -- PRIVATE original (orig-media/…); never exposed to clients
  public_key text,                       -- business/{uid}/{kind}/{uuid}.jpg, set only when approved
  internal jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint business_media_key_shape check (
    public_key is null or public_key ~ ('^business/' || user_id::text || '/' || kind || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
  ),
  constraint business_media_approved_has_key check ((status = 'approved') = (public_key is not null))
);
create unique index if not exists business_media_scans_public_key_uq on public.business_media_scans (public_key) where public_key is not null;
create index if not exists business_media_scans_user_idx on public.business_media_scans (user_id, created_at desc);

alter table public.business_media_scans enable row level security;
drop policy if exists "staff read business media scans" on public.business_media_scans;
create policy "staff read business media scans" on public.business_media_scans for select using (public.staff_can('moderate_listing'));
revoke all on public.business_media_scans from anon;
revoke insert, update, delete on public.business_media_scans from authenticated;

-- True when `p_key` is an image this owner may put in the given slot: approved by the scanner, or already held (legacy) by them.
-- DEFINER so it can read the scan table; granted to authenticated because the invoker triggers below call it.
create or replace function public._bm_key_ok(p_owner uuid, p_kind text, p_key text)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.business_media_scans s where s.user_id = p_owner and s.kind = p_kind and s.public_key = p_key and s.status = 'approved')
      or exists (select 1 from public.profiles p where p.id = p_owner and p_key in (p.business_logo_public_id, p.business_banner_public_id))
      or exists (select 1 from public.storefronts f where f.owner_id = p_owner and p_key in (f.logo_public_id, f.banner_public_id));
$$;
revoke execute on function public._bm_key_ok(uuid, text, text) from public, anon;
grant execute on function public._bm_key_ok(uuid, text, text) to authenticated;

-- The scan approves a KEY, so the URL stored next to it must be pinned as well; otherwise `https://evil.example/<approved key>` would pass
-- (0056 only checks that the URL ENDS with the key) and a new URL-only value (no key) would skip the scan entirely. The URL must be exactly
-- https://<host>/<key> on an operator-managed host (storefront_media_hosts, the same allowlist 0054 uses for storefronts; EMPTY = fail closed).
create or replace function public._bm_url_ok(p_url text, p_key text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_host text;
begin
  if p_url is null or p_key is null or char_length(p_url) > 2048 then return false; end if;
  v_host := substring(p_url from '^https://([A-Za-z0-9.-]+)/');
  if v_host is null or p_url <> 'https://' || v_host || '/' || p_key then return false; end if;
  return exists (select 1 from public.storefront_media_hosts h where h.host = lower(v_host));
end;
$$;
revoke execute on function public._bm_url_ok(text, text) from public, anon;
grant execute on function public._bm_url_ok(text, text) to authenticated;

-- One slot (logo or banner) of one row. Only a CHANGED slot is checked, so unrelated edits and re-saving a legacy value never fail.
create or replace function public._bm_check_slot(p_owner uuid, p_kind text, p_is_insert boolean, p_old_url text, p_old_key text, p_new_url text, p_new_key text)
returns void language plpgsql stable security invoker set search_path = public, pg_temp
as $$
begin
  if not p_is_insert and p_new_url is not distinct from p_old_url and p_new_key is not distinct from p_old_key then return; end if;
  if p_new_key is not null then
    if (p_is_insert or p_new_key is distinct from p_old_key) and not public._bm_key_ok(p_owner, p_kind, p_new_key) then
      raise exception 'This % has not been checked. Upload it again.', p_kind using errcode = '22023', hint = 'image_not_verified';
    end if;
    if not public._bm_url_ok(p_new_url, p_new_key) then
      raise exception 'This % has not been checked. Upload it again.', p_kind using errcode = '22023', hint = 'image_not_verified';
    end if;
  elsif p_new_url is not null and (p_is_insert or p_new_url is distinct from p_old_url) then
    raise exception 'This % has not been checked. Upload it again.', p_kind using errcode = '22023', hint = 'image_not_verified';
  end if;
end;
$$;
revoke execute on function public._bm_check_slot(uuid, text, boolean, text, text, text, text) from public, anon;
grant execute on function public._bm_check_slot(uuid, text, boolean, text, text, text, text) to authenticated;

-- Invoker on purpose (is_client_write() looks at current_user): the 0054 mirror RPCs run as definer and are therefore not checked.
create or replace function public.trg_profile_business_media_scan()
returns trigger language plpgsql
as $$
begin
  if not public.is_client_write() or not public.business_media_enforced() then return new; end if;
  if tg_op = 'INSERT' then
    perform public._bm_check_slot(new.id, 'logo', true, null, null, new.business_logo_url, new.business_logo_public_id);
    perform public._bm_check_slot(new.id, 'banner', true, null, null, new.business_banner_url, new.business_banner_public_id);
  else
    perform public._bm_check_slot(new.id, 'logo', false, old.business_logo_url, old.business_logo_public_id, new.business_logo_url, new.business_logo_public_id);
    perform public._bm_check_slot(new.id, 'banner', false, old.business_banner_url, old.business_banner_public_id, new.business_banner_url, new.business_banner_public_id);
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_c_business_media_scan on public.profiles;
create trigger profiles_c_business_media_scan before insert or update on public.profiles
  for each row execute function public.trg_profile_business_media_scan();

create or replace function public.trg_storefront_business_media_scan()
returns trigger language plpgsql
as $$
begin
  if not public.is_client_write() or not public.business_media_enforced() then return new; end if;
  if (tg_op = 'INSERT' or new.logo_public_id is distinct from old.logo_public_id)
     and new.logo_public_id is not null and not public._bm_key_ok(new.owner_id, 'logo', new.logo_public_id) then
    raise exception 'This logo has not been checked. Upload it again.' using errcode = '22023', hint = 'image_not_verified';
  end if;
  if (tg_op = 'INSERT' or new.banner_public_id is distinct from old.banner_public_id)
     and new.banner_public_id is not null and not public._bm_key_ok(new.owner_id, 'banner', new.banner_public_id) then
    raise exception 'This banner has not been checked. Upload it again.' using errcode = '22023', hint = 'image_not_verified';
  end if;
  return new;
end;
$$;
drop trigger if exists storefronts_c_business_media_scan on public.storefronts;
create trigger storefronts_c_business_media_scan before insert or update on public.storefronts
  for each row execute function public.trg_storefront_business_media_scan();

revoke execute on function public.trg_profile_business_media_scan() from public, anon, authenticated;
revoke execute on function public.trg_storefront_business_media_scan() from public, anon, authenticated;
