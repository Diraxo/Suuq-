-- 0071 — Admin Businesses directory + no self-moderation of a storefront.
--
-- STATUS: written and tested on PGlite only. NOT applied to any database. Needs 0054 (storefronts, staff_can('business_review'), the admin RPCs).
-- Reads reports (0003/0047) and listings; it does not need 0064 or 0068.
--
-- Why
--   0054's staff RPCs only list businesses that submitted verification documents. Staff could not see a business that is published but never
--   asked for verification, a draft, or a suspended one, and had no single view of owner account, publication, verification, active listings and
--   reports. admin_list_businesses() is that read-only view. It never returns contact data (phone, email) or document paths.
--   Publication (storefronts.status, owner-driven plus staff suspend/reinstate) and verification (storefronts.verification_status, staff-only) stay
--   two separate columns and two separate sets of actions; nothing here changes either.
--
--   0054 already refuses admin_decide_storefront_verification for the staff member's OWN storefront. admin_set_storefront_status and
--   admin_revoke_storefront_verification had no such check, so an admin could reinstate their own suspended storefront or strip the effect of
--   another admin's review. Both now refuse when the storefront is the caller's own. Everything else in them is the 0054 body, unchanged.
--
-- Authorization: staff_can('business_review') = ADMIN ONLY (0054). EXECUTE is revoked from anon/public.
-- Rollback: supabase/rollback/0071_admin_business_directory_ROLLBACK.sql

begin;

create or replace function public.admin_list_businesses(
  p_status text default null,
  p_verification text default null,
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not public.staff_can('business_review') then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_status is not null and p_status not in ('draft', 'published', 'suspended') then raise exception 'Unknown status' using errcode = '22023'; end if;
  if p_verification is not null and p_verification not in ('not_requested', 'pending', 'verified', 'rejected') then
    raise exception 'Unknown verification status' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(q.x order by q.not_pending, q.updated_at desc, q.id) from (
      select jsonb_build_object(
               'storefrontId', s.id, 'ownerId', s.owner_id, 'ownerName', nullif(btrim(o.full_name), ''), 'ownerAccountStatus', o.account_status,
               'businessName', s.name, 'status', s.status, 'verificationStatus', s.verification_status,
               'publishedAt', s.published_at, 'verifiedAt', s.verified_at, 'suspendedAt', s.suspended_at, 'updatedAt', s.updated_at,
               'activeListings', (select count(*) from public.listings l where l.user_id = s.owner_id and l.status in ('available', 'reserved')),
               'openUserReports', (select count(*) from public.reports r where r.target_type = 'user' and r.target_id = s.owner_id::text and r.status = 'pending'),
               'openListingReports', (select count(*) from public.reports r join public.listings l2 on l2.id::text = r.target_id
                                       where r.target_type = 'listing' and l2.user_id = s.owner_id and r.status = 'pending'),
               'pendingRequestId', (select v.id from public.storefront_verification_requests v where v.storefront_id = s.id and v.status = 'pending' limit 1)
             ) x,
             (s.verification_status <> 'pending') not_pending, s.updated_at, s.id
        from public.storefronts s join public.profiles o on o.id = s.owner_id
       where (p_status is null or s.status = p_status)
         and (p_verification is null or s.verification_status = p_verification)
         and (v_search is null
              or position(lower(v_search) in lower(coalesce(s.name, ''))) > 0
              or position(lower(v_search) in lower(coalesce(o.full_name, ''))) > 0
              or s.owner_id::text = lower(v_search))
       order by (s.verification_status <> 'pending'), s.updated_at desc, s.id
       limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) q), '[]'::jsonb);
end;
$$;

revoke execute on function public.admin_list_businesses(text, text, text, int, int) from public, anon;
grant execute on function public.admin_list_businesses(text, text, text, int, int) to authenticated;

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
  if s.owner_id = auth.uid() then raise exception 'You cannot moderate your own storefront' using errcode = '42501'; end if;
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
  if s.owner_id = auth.uid() then raise exception 'You cannot moderate your own storefront' using errcode = '42501'; end if;

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

commit;
