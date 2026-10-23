-- ROLLBACK for 0071: drops the directory function and restores the 0054 bodies of the two staff RPCs (without the self-moderation check).
-- Idempotent, one transaction. Nothing it removes holds data.
begin;
drop function if exists public.admin_list_businesses(text, text, text, int, int);

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
commit;
