-- 0054 — Storefronts (Phase 1: data model only). NOT APPLIED to any real database by this commit. No UI uses it yet.
-- Tested on PGlite (real PostgreSQL) by supabase/tests/storefronts.test.mjs. Needs 0039 (staff_can, is_client_write) and
-- 0001..0053. Runs in one transaction; it is NOT designed to be re-run (it would fail on the first `create table`).
-- Rollback: the commented block at the bottom of this file.
--
-- What it adds
--   * storefronts                        one per person (unique owner_id -> profiles). The seller's public business page.
--                                        status: draft | published | suspended.  verification_status (separate axis):
--                                        not_requested | pending | verified | rejected.
--   * public_storefronts (VIEW)          the ONLY public read path: published, non-suspended, owner not suspended/banned,
--                                        public columns only. anon/authenticated have no table access to storefronts.
--   * storefront_media_hosts             operator-managed allowlist of hosts for logo/banner URLs (EMPTY: fail closed until filled).
--   * storefront_legacy_snapshot         service-only copy of the pre-migration profiles.business_* values (reversibility).
--   * storefront_verification_requests   STAFF-ONLY: document paths, owner note, decision, internal reason.
--   * storage bucket storefront-verification (private)  owner may upload into <uid>/…, staff read ONLY via the audited verification-document Edge Function (no direct Storage read).
--   * staff_can('business_review')       new permission: ADMIN ONLY (admin is implicitly all). moderator and support are excluded.
--   * RPCs: owner  storefront_publish / storefront_unpublish / request_storefront_verification / my_storefront_verification
--                  storefront_sync_from_legacy_profile (called by the legacy-compat trigger; harmless to call)
--           staff  admin_list_storefront_reviews / admin_get_storefront_review / admin_decide_storefront_verification /
--                  admin_revoke_storefront_verification / admin_set_storefront_status
--
-- Two-sources-of-truth policy (profiles.business_* are KEPT, never dropped/renamed)
--   After this migration storefronts is the source of truth. profiles.business_* becomes a DERIVED compatibility mirror:
--     published storefront AND owner in good standing  ->  profiles.business_* = the storefront's values
--     anything else (draft, unpublished, suspended storefront, suspended/banned account)  ->  profiles.business_* is CLEARED
--   Draft means private: profiles is publicly readable (policy "profiles are publicly readable" using (true)) and is in the
--   Realtime publication, so a value left in profiles.business_* is public. The mirror therefore never leaves draft data there.
--   1. Backfill: a draft storefront is created for every profile with meaningful business_* data; nothing is published or
--      verified. The ORIGINAL legacy values are first copied to storefront_legacy_snapshot (service-only), then the mirror clears
--      them from profiles. ROLLOUT CONSEQUENCE: until an owner publishes, deployed clients that read profiles.business_* show no
--      business section for that owner. Do not apply to production before a client that can publish exists (see docs).
--   2. OLD apps still write profiles.business_* directly. A trigger copies those writes into the user's storefront
--      ADDITIVELY (non-empty values overwrite, empty never erases), then the mirror re-derives the profile. A pending
--      verification freezes name/address (old-app values for them are ignored, not an error). Invalid images are ignored.
--   3. Account suspension/ban/reinstatement (profiles.account_status, suspended_until) re-runs the mirror. A TIMED suspension
--      that merely expires does not write to profiles, so the data stays hidden until the next storefront/account write (fail closed).
--   4. profiles.verified_at (personal verification, 0038) is untouched and unrelated to storefront verification.
--
-- Security notes
--   * Supabase grants every public table to the API roles by default, which makes column REVOKEs inert (see 0038). So this
--     file REVOKEs ALL first and then GRANTs the minimum, including column-level INSERT/UPDATE grants for owners, and ALSO
--     guards the protected columns with a trigger keyed on current_user (is_client_write()).
--   * Every SECURITY DEFINER function pins search_path to public, pg_temp, checks authorization first, and has EXECUTE
--     revoked from anon/public.
--   * public_storefronts is a deliberate OWNER-PRIVILEGE view (it reads storefronts, which anon/authenticated cannot). It is the
--     only way to publish a column subset of an RLS table without exposing private columns of other users' published rows to
--     every signed-in user. It is security_barrier so user-supplied functions cannot see rows before the filters run.
--     Supabase's Security Advisor flags such views ("security_definer_view"); that finding is expected and must be reviewed in staging.
--   * Logo/banner: only https URLs on a host listed in storefront_media_hosts whose path IS the owner's own upload key
--     (business/<uid>/(logo|banner)/<uuid>.jpg). Nothing in the database fetches a URL. The allowlist is NOT a content scan:
--     business images are not yet routed through the image-safety Worker (launch gate, see docs).
--   * Verification documents: private bucket with a size limit and MIME allowlist (Storage enforces them, not SQL), an upload path
--     shape policy and a per-user cap on unreferenced uploads. Nothing here deletes any file. See docs/STOREFRONTS_0054_HARDENING.md.

begin;

-- ============================================================================
-- 1. Permission: business_review.  Matrix copied from 0039 UNCHANGED; business_review is reachable only through the admin
--    branch (admin: everything). Moderators and support get NO access to identity documents or storefront moderation.
--    If a narrower permission is ever approved, add the string to the relevant role list here.
-- ============================================================================
create or replace function public.staff_can(p_action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case public.staff_role()
    when 'admin' then true
    when 'moderator' then p_action in ('read', 'report_status', 'moderate_listing', 'warn', 'suspend', 'support', 'decide_appeal_listing', 'decide_appeal_suspension')
    when 'support' then p_action in ('read', 'support')
    else false
  end
$$;

-- ============================================================================
-- 2. storefronts
-- ============================================================================
create table public.storefronts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles (id) on delete cascade,
  name text,
  description text,
  address text,
  website text,
  hours jsonb not null default '{}'::jsonb,
  logo_url text,
  banner_url text,
  logo_public_id text,
  banner_public_id text,
  status text not null default 'draft',
  verification_status text not null default 'not_requested',
  published_at timestamptz,
  verified_at timestamptz,
  suspended_at timestamptz,
  status_before_suspension text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint storefronts_status_check check (status in ('draft', 'published', 'suspended')),
  constraint storefronts_verification_check check (verification_status in ('not_requested', 'pending', 'verified', 'rejected')),
  constraint storefronts_before_suspension_check check (status_before_suspension is null or status_before_suspension in ('draft', 'published')),
  constraint storefronts_name_check check (name is null or (btrim(name) <> '' and char_length(name) <= 150)),
  constraint storefronts_published_needs_name check (status <> 'published' or name is not null),
  constraint storefronts_description_check check (description is null or char_length(description) <= 2000),
  constraint storefronts_address_check check (address is null or char_length(address) <= 300),
  constraint storefronts_website_check check (website is null or (char_length(website) <= 300 and website ~* '^https?://[^[:space:]]+$')),
  constraint storefronts_hours_check check (jsonb_typeof(hours) = 'object' and octet_length(hours::text) <= 4000),
  constraint storefronts_image_check check (
    (logo_url is null or char_length(logo_url) <= 2048) and (banner_url is null or char_length(banner_url) <= 2048)
    and (logo_public_id is null or char_length(logo_public_id) <= 300) and (banner_public_id is null or char_length(banner_public_id) <= 300)
  ),
  constraint storefronts_image_pair_check check ((logo_url is null) = (logo_public_id is null) and (banner_url is null) = (banner_public_id is null)),
  constraint storefronts_verified_consistent check ((verification_status = 'verified') = (verified_at is not null))
);
-- Image URL VALIDITY (managed host + owner key) cannot be a CHECK (it reads storefront_media_hosts); it is enforced by the
-- storefronts_b_validate trigger below. The CHECKs here are only the length and pairing limits. Nothing is ever truncated.

-- Hosts that serve Suuqiye-managed uploads (the host of R2_PUBLIC_URL). OPERATOR-MANAGED: empty after this migration, so until a
-- host is inserted no logo/banner is accepted (fail closed). Not reachable through the API.
create table public.storefront_media_hosts (
  host text primary key check (host = lower(host) and host ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$')
);
alter table public.storefront_media_hosts enable row level security;
revoke all on public.storefront_media_hosts from public, anon, authenticated;

-- One-time copy of the legacy profiles.business_* values taken BEFORE the mirror clears them, so the clearing is reversible and
-- nothing an owner typed is lost. Contains personal data: it is deleted with the account (cascade). Not reachable through the API.
create table public.storefront_legacy_snapshot (
  owner_id uuid primary key references public.profiles (id) on delete cascade,
  captured_at timestamptz not null default now(),
  business jsonb not null
);
alter table public.storefront_legacy_snapshot enable row level security;
revoke all on public.storefront_legacy_snapshot from public, anon, authenticated;
create index storefronts_published_idx on public.storefronts (published_at desc) where status = 'published';
create index storefronts_verification_idx on public.storefronts (verification_status) where verification_status = 'pending';

alter table public.storefronts enable row level security;

-- API roles get nothing by default; then exactly what an owner may do. No DELETE (deleting would be a way to shed a
-- suspension; account deletion cascades through the FK instead).
revoke all on public.storefronts from public, anon, authenticated;
grant select on public.storefronts to authenticated;
grant insert (owner_id, name, description, address, website, hours, logo_url, banner_url, logo_public_id, banner_public_id)
  on public.storefronts to authenticated;
grant update (name, description, address, website, hours, logo_url, banner_url, logo_public_id, banner_public_id)
  on public.storefronts to authenticated;

create policy "owner or staff read storefront" on public.storefronts
  for select to authenticated using (owner_id = auth.uid() or public.staff_can('business_review'));
create policy "owner creates own storefront" on public.storefronts
  for insert to authenticated with check (owner_id = auth.uid() and coalesce(public.account_effective_status(auth.uid()), 'active') = 'active');
create policy "owner edits own storefront" on public.storefronts
  for update to authenticated
  using (owner_id = auth.uid() and status <> 'suspended')
  with check (owner_id = auth.uid() and status <> 'suspended');

-- ----------------------------------------------------------------------------
-- helpers (internal; not callable by API roles)
-- ----------------------------------------------------------------------------
create or replace function public._sf_clean(p_text text, p_max int)
returns text language sql immutable set search_path = public, pg_temp
as $$ select nullif(left(btrim(p_text), p_max), '') $$;

create or replace function public._sf_clean_url(p_text text)
returns text language sql immutable set search_path = public, pg_temp
as $$ select case when btrim(coalesce(p_text, '')) ~* '^https?://[^[:space:]]+$' and char_length(btrim(p_text)) <= 300 then btrim(p_text) else null end $$;

-- True only for an https URL on a managed host whose path is EXACTLY the owner's own upload key for this kind. Everything else
-- (other hosts, http, ports, userinfo, query strings, whitespace, other users' keys, over-long values) is false — never trimmed.
create or replace function public._sf_image_ok(p_owner uuid, p_kind text, p_url text, p_public_id text)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_host text;
begin
  if p_url is null or p_public_id is null or p_kind not in ('logo', 'banner') then return false; end if;
  if char_length(p_url) > 2048 or char_length(p_public_id) > 300 then return false; end if;
  if p_public_id !~ ('^business/' || p_owner::text || '/' || p_kind || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$') then return false; end if;
  v_host := substring(p_url from '^https://([A-Za-z0-9.-]+)/');
  if v_host is null or p_url <> 'https://' || v_host || '/' || p_public_id then return false; end if;
  return exists (select 1 from public.storefront_media_hosts h where h.host = lower(v_host));
end;
$$;

create or replace function public._sf_owner_in_good_standing(p_owner uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select not exists (select 1 from public.profiles o where o.id = p_owner
                          and (o.account_status = 'banned' or (o.account_status = 'suspended' and (o.suspended_until is null or o.suspended_until > now())))) $$;

create or replace function public._sf_clean_hours(p_hours jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp
as $$ select case when jsonb_typeof(p_hours) = 'object' and p_hours <> '{}'::jsonb and octet_length(p_hours::text) <= 4000 then p_hours else null end $$;

create or replace function public._sf_audit(p_actor uuid, p_action text, p_storefront uuid, p_reason text, p_meta jsonb)
returns void language sql security definer set search_path = public, pg_temp
as $$ insert into public.admin_audit_log (admin_id, action, target_type, target_id, reason, metadata) values (p_actor, p_action, 'storefront', p_storefront::text, p_reason, coalesce(p_meta, '{}'::jsonb)) $$;

create or replace function public._sf_notify(p_user uuid, p_title text, p_body text, p_kind text)
returns void language sql security definer set search_path = public, pg_temp
as $$ insert into public.notifications (user_id, title, body, type, data) values (p_user, p_title, p_body, 'storefront', jsonb_build_object('kind', p_kind)) $$;

-- Derive profiles.business_* (the legacy mirror). See header: copied only while the storefront is published AND the owner is in
-- good standing; otherwise cleared. A profile without a storefront is not touched here.
create or replace function public._sf_mirror_to_profile(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.storefronts%rowtype;
  v_prev text;
  v_copy boolean;
begin
  select * into s from public.storefronts where owner_id = p_owner;
  if not found then return; end if;
  v_copy := s.status = 'published' and public._sf_owner_in_good_standing(p_owner);

  v_prev := current_setting('suuqplus.skip_rate_limit', true);
  perform set_config('suuqplus.skip_rate_limit', 'true', true); -- a derived write is not a user action
  update public.profiles p set
    business_name = case when v_copy then s.name end,
    business_description = case when v_copy then s.description end,
    business_address = case when v_copy then s.address end,
    business_website = case when v_copy then s.website end,
    business_hours = case when v_copy then s.hours else '{}'::jsonb end,
    business_logo_url = case when v_copy then s.logo_url end,
    business_banner_url = case when v_copy then s.banner_url end,
    business_logo_public_id = case when v_copy then s.logo_public_id end,
    business_banner_public_id = case when v_copy then s.banner_public_id end
  where p.id = p_owner
    and (p.business_name, p.business_description, p.business_address, p.business_website, p.business_hours, p.business_logo_url, p.business_banner_url, p.business_logo_public_id, p.business_banner_public_id)
        is distinct from
        (case when v_copy then s.name end, case when v_copy then s.description end, case when v_copy then s.address end, case when v_copy then s.website end,
         case when v_copy then s.hours else '{}'::jsonb end, case when v_copy then s.logo_url end, case when v_copy then s.banner_url end,
         case when v_copy then s.logo_public_id end, case when v_copy then s.banner_public_id end);
  perform set_config('suuqplus.skip_rate_limit', coalesce(v_prev, ''), true);
end;
$$;

-- For a profile that has NO storefront (legacy junk that is not meaningful business data): clear the public columns.
create or replace function public._sf_clear_profile_business(p_owner uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_prev text;
begin
  v_prev := current_setting('suuqplus.skip_rate_limit', true);
  perform set_config('suuqplus.skip_rate_limit', 'true', true);
  update public.profiles set business_name = null, business_description = null, business_address = null, business_website = null,
         business_hours = '{}'::jsonb, business_logo_url = null, business_banner_url = null, business_logo_public_id = null, business_banner_public_id = null
   where id = p_owner;
  perform set_config('suuqplus.skip_rate_limit', coalesce(v_prev, ''), true);
end;
$$;

-- OPERATOR TOOL (SQL editor / service role only): after storefront_media_hosts has been filled in, re-attach legacy logos/banners
-- from the snapshot where they now validate. Returns the number of images attached. Owners can also simply upload again.
create or replace function public._sf_reattach_legacy_images()
returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record; n int := 0; lu text; lp text; bu text; bp text;
begin
  for r in select sn.owner_id, sn.business, s.logo_url l0, s.banner_url b0 from public.storefront_legacy_snapshot sn join public.storefronts s on s.owner_id = sn.owner_id loop
    lu := btrim(r.business ->> 'logo_url'); lp := btrim(r.business ->> 'logo_public_id');
    bu := btrim(r.business ->> 'banner_url'); bp := btrim(r.business ->> 'banner_public_id');
    if r.l0 is null and public._sf_image_ok(r.owner_id, 'logo', lu, lp) then
      update public.storefronts set logo_url = lu, logo_public_id = lp where owner_id = r.owner_id; n := n + 1;
    end if;
    if r.b0 is null and public._sf_image_ok(r.owner_id, 'banner', bu, bp) then
      update public.storefronts set banner_url = bu, banner_public_id = bp where owner_id = r.owner_id; n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public._sf_clean(text, int), public._sf_clean_url(text), public._sf_clean_hours(jsonb), public._sf_image_ok(uuid, text, text, text),
  public._sf_owner_in_good_standing(uuid), public._sf_audit(uuid, text, uuid, text, jsonb), public._sf_notify(uuid, text, text, text),
  public._sf_mirror_to_profile(uuid), public._sf_clear_profile_business(uuid), public._sf_reattach_legacy_images()
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- guard trigger (INVOKER on purpose: is_client_write() looks at current_user)
-- ----------------------------------------------------------------------------
create or replace function public.trg_storefront_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if public.is_client_write() then
      new.status := 'draft'; new.verification_status := 'not_requested';
      new.published_at := null; new.verified_at := null; new.suspended_at := null; new.status_before_suspension := null;
    end if;
    new.updated_at := now();
    return new;
  end if;

  if new.owner_id is distinct from old.owner_id then
    raise exception 'A storefront cannot change owner' using errcode = '42501';
  end if;
  if public.is_client_write() and (
       new.status is distinct from old.status or new.verification_status is distinct from old.verification_status
       or new.published_at is distinct from old.published_at or new.verified_at is distinct from old.verified_at
       or new.suspended_at is distinct from old.suspended_at or new.status_before_suspension is distinct from old.status_before_suspension) then
    raise exception 'Storefront status and verification are managed by the server' using errcode = '42501';
  end if;

  -- state machines, enforced for every writer
  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status in ('published', 'suspended')) or (old.status = 'published' and new.status in ('draft', 'suspended'))
       or (old.status = 'suspended' and new.status in ('draft', 'published'))) then
    raise exception 'Invalid storefront status change % -> %', old.status, new.status using errcode = '23514';
  end if;
  if new.verification_status is distinct from old.verification_status and not (
       (old.verification_status = 'not_requested' and new.verification_status = 'pending') or (old.verification_status = 'rejected' and new.verification_status = 'pending')
       or (old.verification_status = 'pending' and new.verification_status in ('verified', 'rejected'))
       or (old.verification_status = 'verified' and new.verification_status = 'not_requested')) then
    raise exception 'Invalid verification change % -> %', old.verification_status, new.verification_status using errcode = '23514';
  end if;

  -- Identity = name + address (what the documents are checked against). While a request is pending it is FROZEN for every writer:
  -- the approval must apply to the identity that was actually reviewed. After approval, changing it voids the verification.
  if old.verification_status = 'pending' and new.verification_status = 'pending'
     and (new.name is distinct from old.name or new.address is distinct from old.address) then
    raise exception 'Business name and address are locked while verification is pending' using errcode = '55006';
  end if;
  if old.verification_status = 'verified' and new.verification_status = old.verification_status
     and (new.name is distinct from old.name or new.address is distinct from old.address) then
    new.verification_status := 'not_requested';
    new.verified_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger storefronts_a_guard before insert or update on public.storefronts
  for each row execute function public.trg_storefront_guard();

create or replace function public.trg_storefront_after_write()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$ begin perform public._sf_mirror_to_profile(new.owner_id); return null; end; $$;
create trigger storefronts_z_mirror after insert or update on public.storefronts
  for each row execute function public.trg_storefront_after_write();

-- Logo/banner validity for EVERY writer (client, old-app sync, backfill, operator SQL). DEFINER because it reads the host allowlist
-- (the guard trigger above is INVOKER on purpose). Checked only when the value changes, so an unrelated edit is never blocked by
-- an allowlist change; a value that no longer validates is simply not accepted again.
create or replace function public.trg_storefront_validate()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT' or new.logo_url is distinct from old.logo_url or new.logo_public_id is distinct from old.logo_public_id)
     and (new.logo_url is not null or new.logo_public_id is not null)
     and not public._sf_image_ok(new.owner_id, 'logo', new.logo_url, new.logo_public_id) then
    raise exception 'Invalid logo: it must be an image uploaded through Suuqiye (https, managed host, your own file)' using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' or new.banner_url is distinct from old.banner_url or new.banner_public_id is distinct from old.banner_public_id)
     and (new.banner_url is not null or new.banner_public_id is not null)
     and not public._sf_image_ok(new.owner_id, 'banner', new.banner_url, new.banner_public_id) then
    raise exception 'Invalid banner: it must be an image uploaded through Suuqiye (https, managed host, your own file)' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger storefronts_b_validate before insert or update on public.storefronts
  for each row execute function public.trg_storefront_validate();

-- Account suspension / ban / reinstatement changes whether the legacy columns may hold the data.
create or replace function public.trg_profile_account_status_mirror()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if (new.account_status, new.suspended_until) is distinct from (old.account_status, old.suspended_until) then
    perform public._sf_mirror_to_profile(new.id);
  end if;
  return null;
end;
$$;
create trigger profiles_z_account_status_mirror
  after update of account_status, suspended_until on public.profiles
  for each row execute function public.trg_profile_account_status_mirror();

-- ============================================================================
-- 3. Public read path
-- ============================================================================
-- DELIBERATELY an owner-privilege view (not security_invoker): anon and authenticated have no privilege on public.storefronts,
-- so this view is the ONLY way for them to read it, and it can expose nothing but the columns and rows below. Not exposed:
-- status, verification_status, verified_at, suspended_at, status_before_suspension, timestamps other than published_at,
-- the *_public_id storage keys. security_barrier stops a caller-supplied function in WHERE from seeing rows the filters would hide.
-- Eligibility: published AND owner not banned and not (suspended with no end date or an end date still in the future).
-- The condition is inlined rather than calling _sf_owner_in_good_standing(): EXECUTE on functions used in a view is checked
-- against the CALLER, and those helpers are closed to anon.
create view public.public_storefronts with (security_barrier = true) as
  select s.id, s.owner_id, s.name, s.description, s.address, s.website, s.hours,
         s.logo_url, s.banner_url,
         (s.verification_status = 'verified') as verified, s.published_at
    from public.storefronts s
   where s.status = 'published'
     and not exists (select 1 from public.profiles o where o.id = s.owner_id
                      and (o.account_status = 'banned' or (o.account_status = 'suspended' and (o.suspended_until is null or o.suspended_until > now()))));
revoke all on public.public_storefronts from public, anon, authenticated;
grant select on public.public_storefronts to anon, authenticated;

-- ============================================================================
-- 4. Staff-only verification structure
-- ============================================================================
create table public.storefront_verification_requests (
  id uuid primary key default gen_random_uuid(),
  storefront_id uuid not null references public.storefronts (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  document_paths text[] not null check (array_length(document_paths, 1) between 1 and 5),
  owner_note text check (owner_note is null or char_length(owner_note) <= 1000),
  submitted_at timestamptz not null default now(),
  submitted_name text not null,    -- the identity the documents were submitted for; approval is only valid for exactly this
  submitted_address text,
  -- RESTRICT (explicit): a staff account that decided a request cannot be hard-deleted and silently drop who approved a business.
  -- Same behaviour as admin_audit_log.admin_id (0027, no ON DELETE action). Deactivate staff instead of deleting them.
  reviewed_by uuid references public.profiles (id) on delete restrict,
  reviewed_at timestamptz,
  decision_reason text,           -- INTERNAL
  owner_message text check (owner_message is null or char_length(owner_message) <= 1000)  -- the only text the owner ever sees
);
create unique index storefront_verification_one_pending on public.storefront_verification_requests (storefront_id) where status = 'pending';
create index storefront_verification_queue_idx on public.storefront_verification_requests (status, submitted_at);
alter table public.storefront_verification_requests enable row level security;
revoke all on public.storefront_verification_requests from public, anon, authenticated;
grant select on public.storefront_verification_requests to authenticated;
create policy "staff read verification requests" on public.storefront_verification_requests
  for select to authenticated using (public.staff_can('business_review'));

-- Private bucket with deliberate limits. file_size_limit / allowed_mime_types are Supabase Storage bucket settings enforced by the
-- Storage API at upload time (not by RLS, and not provable on the local PGlite stub): 10 MiB, JPEG/PNG/WebP images and PDF only.
-- The migration refuses to run on a Storage schema that lacks the columns rather than silently creating an unrestricted bucket.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit')
     or not exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    raise exception 'storage.buckets has no file_size_limit/allowed_mime_types: upgrade Supabase Storage before applying 0054';
  end if;
end $$;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('storefront-verification', 'storefront-verification', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

-- How many of the caller's uploads are not (yet) attached to any request. Used by the upload policy to bound abandoned files.
create or replace function public.verification_upload_slots_used()
returns int
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare v_n int;
begin
  -- Serialise this user's uploads: concurrent inserts queue on the lock (held to the end of the inserting transaction), so the
  -- second one counts AFTER the first has committed (READ COMMITTED takes a fresh snapshot per statement). Without it two
  -- parallel uploads at 9 files could both pass. Per-user key: other users are never blocked.
  perform pg_advisory_xact_lock(hashtextextended('sf-verif-upload:' || coalesce(auth.uid()::text, ''), 0));
  select count(*)::int into v_n from storage.objects o
   where o.bucket_id = 'storefront-verification' and (storage.foldername(o.name))[1] = auth.uid()::text
     and not exists (select 1 from public.storefront_verification_requests r where o.name = any (r.document_paths));
  return v_n;
end;
$$;
revoke execute on function public.verification_upload_slots_used() from public, anon;
grant execute on function public.verification_upload_slots_used() to authenticated;

-- Owners can upload into their own folder only: exactly <uid>/<file>.<jpg|jpeg|png|webp|pdf> (no nesting, no other extensions), at
-- most 10 files not yet attached to a request. No update/delete: a submitted document cannot be swapped or removed by the owner.
-- Only staff with business_review (and the uploader) can read.
create policy "owner uploads own verification files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'storefront-verification'
              and (storage.foldername(name))[1] = auth.uid()::text
              and array_length(storage.foldername(name), 1) = 1
              and name ~* ('^' || auth.uid()::text || '/[A-Za-z0-9._-]{1,100}\.(jpg|jpeg|png|webp|pdf)$')
              and public.verification_upload_slots_used() < 10);
-- Staff have NO direct Storage read: a client-side signed URL would bypass the audit trail. Staff reach document bytes only through
-- the `verification-document` Edge Function, which calls admin_authorize_verification_document() (audits, then returns the path)
-- and signs a short-lived URL with the service role.
create policy "owner reads own verification files" on storage.objects
  for select to authenticated
  using (bucket_id = 'storefront-verification' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.admin_authorize_verification_document(p_request uuid, p_path text)
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r public.storefront_verification_requests%rowtype;
begin
  if not public.staff_can('business_review') then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into r from public.storefront_verification_requests where id = p_request;
  if not found or p_path is null or not (p_path = any (r.document_paths)) then raise exception 'Document not found' using errcode = 'P0002'; end if;
  perform public._sf_audit(auth.uid(), 'view_storefront_verification_document', r.storefront_id, 'Opened one verification document', jsonb_build_object('request_id', r.id, 'path', p_path));
  return p_path;
end;
$$;
revoke execute on function public.admin_authorize_verification_document(uuid, text) from public, anon;
grant execute on function public.admin_authorize_verification_document(uuid, text) to authenticated;

-- READ-ONLY lifecycle report (counts only; deletes nothing). Lets the owner decide retention with real numbers. Orphaned = the
-- uploader's profile no longer exists (account deleted): those files are still in the bucket because deleting an account does not
-- touch Supabase Storage (see docs/STOREFRONTS_0054_HARDENING.md, launch blocker B1).
create or replace function public.admin_verification_files_report(p_older_than interval default interval '7 days')
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.staff_can('business_review') then raise exception 'Not authorized' using errcode = '42501'; end if;
  return (
    with f as (
      select o.name, o.created_at,
             (select max(case r.status when 'pending' then 3 when 'approved' then 2 else 1 end) from public.storefront_verification_requests r where o.name = any (r.document_paths)) as rank,
             exists (select 1 from public.profiles p where p.id::text = (storage.foldername(o.name))[1]) as owner_exists
        from storage.objects o where o.bucket_id = 'storefront-verification')
    select jsonb_build_object(
      'total', count(*),
      'unattached', count(*) filter (where rank is null),
      'unattachedOlderThan', count(*) filter (where rank is null and created_at < now() - p_older_than),
      'attachedPending', count(*) filter (where rank = 3),
      'attachedApproved', count(*) filter (where rank = 2),
      'attachedRejectedOnly', count(*) filter (where rank = 1),
      'ownerAccountDeleted', count(*) filter (where not owner_exists))
    from f);
end;
$$;
revoke execute on function public.admin_verification_files_report(interval) from public, anon;
grant execute on function public.admin_verification_files_report(interval) to authenticated;

-- ============================================================================
-- 5. Legacy compatibility: old apps write profiles.business_*  ->  storefront (additive)
-- ============================================================================
create or replace function public.storefront_sync_from_legacy_profile()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.profiles%rowtype;
  s public.storefronts%rowtype;
  n text; d text; a text; w text; h jsonb; lu text; bu text; lp text; bp text;
begin
  if auth.uid() is null then return; end if;
  select * into p from public.profiles where id = auth.uid();
  if not found then return; end if;
  n := public._sf_clean(p.business_name, 150);
  d := public._sf_clean(p.business_description, 2000);
  a := public._sf_clean(p.business_address, 300);
  w := public._sf_clean_url(p.business_website);
  h := public._sf_clean_hours(p.business_hours);
  -- images: accepted whole or ignored, never trimmed (a value that is not a managed upload of this user is simply not carried over)
  if public._sf_image_ok(p.id, 'logo', btrim(p.business_logo_url), btrim(p.business_logo_public_id)) then lu := btrim(p.business_logo_url); lp := btrim(p.business_logo_public_id); end if;
  if public._sf_image_ok(p.id, 'banner', btrim(p.business_banner_url), btrim(p.business_banner_public_id)) then bu := btrim(p.business_banner_url); bp := btrim(p.business_banner_public_id); end if;

  select * into s from public.storefronts where owner_id = p.id for update;
  if not found then
    if n is null and d is null and a is null and w is null and h is null and lu is null and bu is null then
      perform public._sf_clear_profile_business(p.id); -- nothing meaningful: do not leave junk in a public table
      return;
    end if;
    insert into public.storefronts (owner_id, name, description, address, website, hours, logo_url, banner_url, logo_public_id, banner_public_id)
    values (p.id, n, d, a, w, coalesce(h, '{}'::jsonb), lu, bu, lp, bp);
    return;
  end if;
  if s.status = 'suspended' then
    perform public._sf_mirror_to_profile(p.id); -- put the legacy columns back to cleared
    return;
  end if;
  if s.verification_status = 'pending' then n := null; a := null; end if; -- identity is frozen while the documents are being reviewed
  -- empty legacy values never erase storefront data; the storefront's after-trigger re-derives the profile columns
  update public.storefronts set
    name = coalesce(n, name), description = coalesce(d, description), address = coalesce(a, address),
    website = coalesce(w, website), hours = coalesce(h, hours),
    logo_url = coalesce(lu, logo_url), logo_public_id = coalesce(lp, logo_public_id),
    banner_url = coalesce(bu, banner_url), banner_public_id = coalesce(bp, banner_public_id)
  where id = s.id;
  perform public._sf_mirror_to_profile(p.id); -- covers the case where nothing in the storefront changed but the profile did
end;
$$;
revoke execute on function public.storefront_sync_from_legacy_profile() from public, anon;
grant execute on function public.storefront_sync_from_legacy_profile() to authenticated;

-- INVOKER trigger function: only DIRECT client writes (old apps) are synced; our own definer writes are not.
create or replace function public.trg_profile_business_legacy_sync()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if public.is_client_write() and (
       new.business_name, new.business_description, new.business_address, new.business_website, new.business_hours,
       new.business_logo_url, new.business_banner_url, new.business_logo_public_id, new.business_banner_public_id)
     is distinct from (
       old.business_name, old.business_description, old.business_address, old.business_website, old.business_hours,
       old.business_logo_url, old.business_banner_url, old.business_logo_public_id, old.business_banner_public_id) then
    perform public.storefront_sync_from_legacy_profile();
  end if;
  return null;
end;
$$;
create trigger profiles_z_business_legacy_sync
  after update of business_name, business_description, business_address, business_website, business_hours,
                  business_logo_url, business_banner_url, business_logo_public_id, business_banner_public_id
  on public.profiles for each row execute function public.trg_profile_business_legacy_sync();

-- Trigger functions are never called by API roles (EXECUTE is not checked when a trigger fires).
revoke execute on function public.trg_storefront_guard(), public.trg_storefront_after_write(), public.trg_profile_business_legacy_sync(),
  public.trg_storefront_validate(), public.trg_profile_account_status_mirror() from public, anon, authenticated;

-- ============================================================================
-- 6. Backfill: draft storefronts only, only where there is meaningful business data. Nothing published/verified.
--    Order matters: (a) snapshot the original legacy values, (b) create the drafts (their after-insert trigger runs the mirror,
--    which CLEARS the now-private values from profiles), (c) clear leftover junk on profiles that got no storefront.
--    Images are carried over only if they already validate; storefront_media_hosts is empty at this point, so none are. The
--    snapshot keeps them: fill storefront_media_hosts, then run  select public._sf_reattach_legacy_images();
-- ============================================================================
create temp table _sf_legacy_raw on commit drop as
select p.id,
       p.business_name, p.business_description, p.business_address, p.business_website, p.business_hours,
       p.business_logo_url, p.business_banner_url, p.business_logo_public_id, p.business_banner_public_id
  from public.profiles p
 where coalesce(btrim(p.business_name), '') <> '' or coalesce(btrim(p.business_description), '') <> '' or coalesce(btrim(p.business_address), '') <> ''
    or coalesce(btrim(p.business_website), '') <> '' or coalesce(btrim(p.business_logo_url), '') <> '' or coalesce(btrim(p.business_banner_url), '') <> ''
    or coalesce(btrim(p.business_logo_public_id), '') <> '' or coalesce(btrim(p.business_banner_public_id), '') <> ''
    or (p.business_hours is not null and p.business_hours <> '{}'::jsonb);

insert into public.storefront_legacy_snapshot (owner_id, business)
select r.id, jsonb_build_object('name', r.business_name, 'description', r.business_description, 'address', r.business_address,
                                'website', r.business_website, 'hours', r.business_hours, 'logo_url', r.business_logo_url,
                                'banner_url', r.business_banner_url, 'logo_public_id', r.business_logo_public_id, 'banner_public_id', r.business_banner_public_id)
  from _sf_legacy_raw r
on conflict (owner_id) do nothing;

insert into public.storefronts (owner_id, name, description, address, website, hours, logo_url, banner_url, logo_public_id, banner_public_id)
select r.id,
       public._sf_clean(r.business_name, 150), public._sf_clean(r.business_description, 2000), public._sf_clean(r.business_address, 300),
       public._sf_clean_url(r.business_website), coalesce(public._sf_clean_hours(r.business_hours), '{}'::jsonb),
       case when r.li then btrim(r.business_logo_url) end, case when r.bi then btrim(r.business_banner_url) end,
       case when r.li then btrim(r.business_logo_public_id) end, case when r.bi then btrim(r.business_banner_public_id) end
  from (select x.*, public._sf_image_ok(x.id, 'logo', btrim(x.business_logo_url), btrim(x.business_logo_public_id)) li,
                    public._sf_image_ok(x.id, 'banner', btrim(x.business_banner_url), btrim(x.business_banner_public_id)) bi from _sf_legacy_raw x) r
 where public._sf_clean(r.business_name, 150) is not null or public._sf_clean(r.business_description, 2000) is not null
    or public._sf_clean(r.business_address, 300) is not null or public._sf_clean_url(r.business_website) is not null
    or public._sf_clean_hours(r.business_hours) is not null or r.li or r.bi
on conflict (owner_id) do nothing;

select public._sf_clear_profile_business(r.id) from _sf_legacy_raw r
 where not exists (select 1 from public.storefronts s where s.owner_id = r.id);

-- ============================================================================
-- 7. Owner RPCs
-- ============================================================================
create or replace function public.storefront_publish()
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare s public.storefronts%rowtype;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if public.account_effective_status(auth.uid()) in ('suspended', 'banned') then raise exception 'Account suspended' using errcode = '42501'; end if;
  select * into s from public.storefronts where owner_id = auth.uid() for update;
  if not found then raise exception 'Create your storefront first' using errcode = 'P0002'; end if;
  if s.status = 'suspended' then raise exception 'This storefront is suspended' using errcode = '42501'; end if;
  if s.status = 'published' then return; end if;
  if s.name is null then raise exception 'A storefront needs a name before it can be published' using errcode = '23514'; end if;
  update public.storefronts set status = 'published', published_at = coalesce(published_at, now()) where id = s.id;
end;
$$;

create or replace function public.storefront_unpublish()
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare s public.storefronts%rowtype;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into s from public.storefronts where owner_id = auth.uid() for update;
  if not found then raise exception 'No storefront' using errcode = 'P0002'; end if;
  if s.status = 'suspended' then raise exception 'This storefront is suspended' using errcode = '42501'; end if;
  if s.status = 'published' then update public.storefronts set status = 'draft' where id = s.id; end if;
end;
$$;

create or replace function public.request_storefront_verification(p_document_paths text[], p_note text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare s public.storefronts%rowtype; v_path text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if public.account_effective_status(auth.uid()) in ('suspended', 'banned') then raise exception 'Account suspended' using errcode = '42501'; end if;
  select * into s from public.storefronts where owner_id = auth.uid() for update;
  if not found then raise exception 'Create your storefront first' using errcode = 'P0002'; end if;
  if s.status = 'suspended' then raise exception 'This storefront is suspended' using errcode = '42501'; end if;
  if s.name is null then raise exception 'Add a business name first' using errcode = '23514'; end if;
  if s.verification_status not in ('not_requested', 'rejected') then
    raise exception 'A verification request is already %', s.verification_status using errcode = '23505';
  end if;
  if p_document_paths is null or coalesce(array_length(p_document_paths, 1), 0) not between 1 and 5 then
    raise exception 'Attach 1 to 5 documents' using errcode = '22023';
  end if;
  if p_note is not null and char_length(p_note) > 1000 then raise exception 'The note is too long' using errcode = '22023'; end if;
  if (select count(distinct x) from unnest(p_document_paths) x) <> array_length(p_document_paths, 1) then
    raise exception 'Each document can be attached once' using errcode = '22023';
  end if;
  foreach v_path in array p_document_paths loop
    if v_path is null or v_path !~* ('^' || auth.uid()::text || '/[A-Za-z0-9._-]{1,100}\.(jpg|jpeg|png|webp|pdf)$')
       or not exists (select 1 from storage.objects o where o.bucket_id = 'storefront-verification' and o.name = v_path) then
      raise exception 'Unknown document' using errcode = '22023'; -- deliberately says nothing about other users' files
    end if;
  end loop;
  perform public.enforce_rate_limit('storefront_verification', 5, interval '1 day');
  insert into public.storefront_verification_requests (storefront_id, owner_id, document_paths, owner_note, submitted_name, submitted_address)
  values (s.id, s.owner_id, p_document_paths, nullif(btrim(coalesce(p_note, '')), ''), s.name, s.address) returning id into v_id;
  update public.storefronts set verification_status = 'pending' where id = s.id;
  return v_id;
end;
$$;

-- What the owner may know about their verification: status and the message staff chose to send. Never documents,
-- never the internal reason.
create or replace function public.my_storefront_verification()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare s public.storefronts%rowtype; r public.storefront_verification_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into s from public.storefronts where owner_id = auth.uid();
  if not found then return null; end if;
  select * into r from public.storefront_verification_requests where storefront_id = s.id order by submitted_at desc limit 1;
  return jsonb_build_object('status', s.verification_status, 'submittedAt', r.submitted_at, 'decidedAt', r.reviewed_at,
                            'message', case when r.status in ('approved', 'rejected') then r.owner_message end);
end;
$$;

revoke execute on function public.storefront_publish(), public.storefront_unpublish(), public.request_storefront_verification(text[], text),
  public.my_storefront_verification() from public, anon;
grant execute on function public.storefront_publish(), public.storefront_unpublish(), public.request_storefront_verification(text[], text),
  public.my_storefront_verification() to authenticated;

-- ============================================================================
-- 8. Staff RPCs (business_review). Consequential decisions need a reason (>= 10 chars) and are audited:
--    admin_audit_log (actor, action, target, reason, timestamp) in the same transaction as the change.
-- ============================================================================
create or replace function public.admin_list_storefront_reviews(p_status text default 'pending', p_limit int default 50, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.staff_can('business_review') then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_status not in ('pending', 'approved', 'rejected') then raise exception 'Unknown status' using errcode = '22023'; end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'submittedAt') from (
      select jsonb_build_object('requestId', r.id, 'storefrontId', r.storefront_id, 'ownerId', r.owner_id, 'businessName', s.name,
                                'status', r.status, 'documentCount', array_length(r.document_paths, 1), 'submittedAt', r.submitted_at) x
        from public.storefront_verification_requests r join public.storefronts s on s.id = r.storefront_id
       where r.status = p_status order by r.submitted_at limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)) q), '[]'::jsonb);
end;
$$;

-- Opening the documents is itself audited.
create or replace function public.admin_get_storefront_review(p_request uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r public.storefront_verification_requests%rowtype; s public.storefronts%rowtype;
begin
  if not public.staff_can('business_review') then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into r from public.storefront_verification_requests where id = p_request;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  select * into s from public.storefronts where id = r.storefront_id;
  perform public._sf_audit(auth.uid(), 'view_storefront_verification', r.storefront_id, 'Opened verification documents', jsonb_build_object('request_id', r.id));
  return jsonb_build_object('requestId', r.id, 'status', r.status, 'documentPaths', to_jsonb(r.document_paths), 'ownerNote', r.owner_note,
                            'submittedAt', r.submitted_at, 'submittedName', r.submitted_name, 'submittedAddress', r.submitted_address, 'decisionReason', r.decision_reason, 'reviewedBy', r.reviewed_by, 'reviewedAt', r.reviewed_at,
                            'storefront', jsonb_build_object('id', s.id, 'ownerId', s.owner_id, 'name', s.name, 'description', s.description,
                                                             'address', s.address, 'website', s.website, 'status', s.status, 'verificationStatus', s.verification_status));
end;
$$;

create or replace function public.admin_decide_storefront_verification(p_request uuid, p_decision text, p_reason text, p_message text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r public.storefront_verification_requests%rowtype; s public.storefronts%rowtype; v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if not public.staff_can('business_review') then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'Decision must be approve or reject' using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then raise exception 'A reason of at least 10 characters is required' using errcode = '22023'; end if;
  if v_msg is not null and char_length(v_msg) > 1000 then raise exception 'The message is too long' using errcode = '22023'; end if;
  select * into r from public.storefront_verification_requests where id = p_request for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'This request was already decided' using errcode = '23505'; end if;
  select * into s from public.storefronts where id = r.storefront_id for update;
  if s.owner_id = auth.uid() then raise exception 'You cannot review your own storefront' using errcode = '42501'; end if;
  if s.verification_status <> 'pending' then raise exception 'Storefront is not awaiting verification' using errcode = '23514'; end if;
  if p_decision = 'approve' and s.status = 'suspended' then raise exception 'Reinstate the suspended storefront first' using errcode = '23514'; end if;
  if p_decision = 'approve' and (s.name is distinct from r.submitted_name or s.address is distinct from r.submitted_address) then
    raise exception 'The business identity changed after submission; ask the owner to resubmit' using errcode = '23514';
  end if;

  update public.storefront_verification_requests
     set status = case p_decision when 'approve' then 'approved' else 'rejected' end,
         reviewed_by = auth.uid(), reviewed_at = now(), decision_reason = btrim(p_reason), owner_message = v_msg
   where id = r.id;
  update public.storefronts
     set verification_status = case p_decision when 'approve' then 'verified' else 'rejected' end,
         verified_at = case p_decision when 'approve' then now() end
   where id = s.id;
  perform public._sf_audit(auth.uid(), case p_decision when 'approve' then 'approve_storefront_verification' else 'reject_storefront_verification' end,
                           s.id, btrim(p_reason), jsonb_build_object('request_id', r.id, 'owner_id', s.owner_id));
  perform public._sf_notify(s.owner_id, 'Suuqiye Support Team',
    case p_decision when 'approve' then 'Your business has been verified.' else 'Your business verification was not approved.' end
      || coalesce(E'\n\n' || v_msg, ''), 'verification_' || p_decision);
end;
$$;

create or replace function public.admin_revoke_storefront_verification(p_storefront uuid, p_reason text, p_message text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare s public.storefronts%rowtype; v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if not public.staff_can('business_review') then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then raise exception 'A reason of at least 10 characters is required' using errcode = '22023'; end if;
  if v_msg is not null and char_length(v_msg) > 1000 then raise exception 'The message is too long' using errcode = '22023'; end if;
  select * into s from public.storefronts where id = p_storefront for update;
  if not found then raise exception 'Storefront not found' using errcode = 'P0002'; end if;
  if s.verification_status <> 'verified' then raise exception 'Storefront is not verified' using errcode = '23514'; end if;
  update public.storefronts set verification_status = 'not_requested', verified_at = null where id = s.id;
  perform public._sf_audit(auth.uid(), 'revoke_storefront_verification', s.id, btrim(p_reason), jsonb_build_object('owner_id', s.owner_id));
  perform public._sf_notify(s.owner_id, 'Suuqiye Support Team', 'Your business verification was removed.' || coalesce(E'\n\n' || v_msg, ''), 'verification_revoked');
end;
$$;

create or replace function public.admin_set_storefront_status(p_storefront uuid, p_action text, p_reason text, p_message text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare s public.storefronts%rowtype; v_msg text := nullif(btrim(coalesce(p_message, '')), ''); v_to text;
begin
  if not public.staff_can('business_review') then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_action not in ('suspend', 'reinstate') then raise exception 'Unknown action' using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then raise exception 'A reason of at least 10 characters is required' using errcode = '22023'; end if;
  if v_msg is not null and char_length(v_msg) > 1000 then raise exception 'The message is too long' using errcode = '22023'; end if;
  select * into s from public.storefronts where id = p_storefront for update;
  if not found then raise exception 'Storefront not found' using errcode = 'P0002'; end if;

  if p_action = 'suspend' then
    if s.status = 'suspended' then raise exception 'Already suspended' using errcode = '23505'; end if;
    update public.storefronts set status = 'suspended', suspended_at = now(), status_before_suspension = s.status where id = s.id;
    v_to := 'suspended';
  else
    if s.status <> 'suspended' then raise exception 'Storefront is not suspended' using errcode = '23514'; end if;
    v_to := coalesce(s.status_before_suspension, 'draft');
    update public.storefronts set status = v_to, suspended_at = null, status_before_suspension = null where id = s.id;
  end if;
  perform public._sf_audit(auth.uid(), p_action || '_storefront', s.id, btrim(p_reason),
                           jsonb_build_object('owner_id', s.owner_id, 'from', s.status, 'to', v_to));
  perform public._sf_notify(s.owner_id, 'Suuqiye Support Team',
    case p_action when 'suspend' then 'Your storefront has been suspended.' else 'Your storefront has been reinstated.' end || coalesce(E'\n\n' || v_msg, ''),
    'storefront_' || p_action);
end;
$$;

revoke execute on function public.admin_list_storefront_reviews(text, int, int), public.admin_get_storefront_review(uuid),
  public.admin_decide_storefront_verification(uuid, text, text, text), public.admin_revoke_storefront_verification(uuid, text, text),
  public.admin_set_storefront_status(uuid, text, text, text) from public, anon;
grant execute on function public.admin_list_storefront_reviews(text, int, int), public.admin_get_storefront_review(uuid),
  public.admin_decide_storefront_verification(uuid, text, text, text), public.admin_revoke_storefront_verification(uuid, text, text),
  public.admin_set_storefront_status(uuid, text, text, text) to authenticated;

commit;

-- ============================================================================
-- ROLLBACK (manual; run only if nothing depends on storefronts).
-- profiles.business_* was CLEARED by the mirror for every non-published storefront. Restore BEFORE dropping anything:
--   update profiles p set business_name = sn.business->>'name', business_description = sn.business->>'description',
--     business_address = sn.business->>'address', business_website = sn.business->>'website',
--     business_hours = coalesce(sn.business->'hours', '{}'::jsonb), business_logo_url = sn.business->>'logo_url',
--     business_banner_url = sn.business->>'banner_url', business_logo_public_id = sn.business->>'logo_public_id',
--     business_banner_public_id = sn.business->>'banner_public_id'
--     from storefront_legacy_snapshot sn where sn.owner_id = p.id;            -- the original legacy values
--   >>> Use supabase/rollback/0054_rollback_restore.sql instead of the hand-written update here: it exports every storefront first,
--   >>> restores only owners who were never published, and is covered by supabase/tests/storefronts.test.mjs.
--   begin;
--   drop trigger if exists profiles_z_business_legacy_sync on public.profiles;
--   drop trigger if exists profiles_z_account_status_mirror on public.profiles;
--   drop function if exists public.trg_profile_business_legacy_sync(), public.trg_profile_account_status_mirror(),
--     public.storefront_sync_from_legacy_profile();
--   drop view if exists public.public_storefronts;
--   drop table if exists public.storefront_verification_requests, public.storefront_legacy_snapshot,
--     public.storefront_media_hosts, public.storefronts;
--   drop function if exists public.trg_storefront_guard(), public.trg_storefront_validate(), public.trg_storefront_after_write(),
--     public._sf_mirror_to_profile(uuid), public._sf_clear_profile_business(uuid), public._sf_reattach_legacy_images(),
--     public._sf_image_ok(uuid,text,text,text), public._sf_owner_in_good_standing(uuid),
--     public._sf_clean(text,int), public._sf_clean_url(text), public._sf_clean_hours(jsonb), public._sf_audit(uuid,text,uuid,text,jsonb),
--     public._sf_notify(uuid,text,text,text), public.storefront_publish(), public.storefront_unpublish(),
--     public.request_storefront_verification(text[],text), public.my_storefront_verification(), public.admin_list_storefront_reviews(text,int,int),
--     public.admin_get_storefront_review(uuid), public.admin_decide_storefront_verification(uuid,text,text,text),
--     public.admin_revoke_storefront_verification(uuid,text,text), public.admin_set_storefront_status(uuid,text,text,text),
--     public.verification_upload_slots_used(), public.admin_verification_files_report(interval);
--   drop policy if exists "owner uploads own verification files" on storage.objects;
--   drop policy if exists "owner reads own verification files" on storage.objects;
--   drop function if exists public.admin_authorize_verification_document(uuid, text);
--   -- bucket: DO NOT delete it or its files until the retention rules in docs/STOREFRONTS_0054_HARDENING.md allow it
--   --   (identity documents may be under a hold). Leaving the private bucket in place is harmless.
--   -- staff_can(): re-run the create-or-replace from 0039 (moderator list without 'business_review').
--   commit;
