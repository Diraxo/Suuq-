-- 0060 — Staff activity alerts, part 2: everything a user does that staff should know about.
--
-- 0045/0040 already alert staff to reports and support, 0052 to a NEW listing and a NEW user. This adds the rest, so no
-- user activity is silent:
--   * listing edited (title / description / price / images / category / city)  -> admins + moderators, type 'listing_staff'
--   * listing deleted by its owner                                              -> admins + moderators, type 'listing_staff'
--   * new review, profile edited (name / photo / phone / city), user blocked,
--     account deleted                                                           -> type 'activity_staff'
--       (account deleted + profile edited -> admins only; review + block -> admins + moderators)
-- A burst of the same kind of event from one person collapses into ONE unread row (so ten edits are one push, not ten).
-- A failure to notify must never block the user's own action, so every body swallows its own errors.
-- Needs 0039 (admin_users.role) and 0052 (which owns the new-listing / new-user alerts and is left unchanged).
-- Rollback: supabase/rollback/0060_staff_activity_alerts_v2_ROLLBACK.sql.

-- ============================================================================
-- 1. One shared writer: fan out to staff, fold bursts per (type, kind, actor) while unread
-- ============================================================================
create or replace function public._staff_alert(
  p_roles text[], p_type text, p_kind text, p_actor uuid, p_title text, p_body text, p_data jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff record;
  v_existing record;
  v_count int;
begin
  for v_staff in
    select a.user_id from public.admin_users a where a.role = any (p_roles) and a.user_id is distinct from p_actor
  loop
    select id, coalesce((data ->> 'count')::int, 1) as n into v_existing
      from public.notifications
     where user_id = v_staff.user_id and type = p_type and read = false
       and data ->> 'kind' = p_kind and data ->> 'actorId' = p_actor::text
       and created_at > now() - interval '10 minutes'
     order by created_at desc limit 1;

    if found then
      v_count := v_existing.n + 1;
      update public.notifications
         set title = v_count || ' × ' || lower(p_title), body = p_body, created_at = now(),
             data = p_data || jsonb_build_object('kind', p_kind, 'actorId', p_actor, 'count', v_count)
       where id = v_existing.id;
    else
      insert into public.notifications (user_id, title, body, type, data)
      values (v_staff.user_id, p_title, p_body, p_type,
              p_data || jsonb_build_object('kind', p_kind, 'actorId', p_actor, 'count', 1));
    end if;
  end loop;
end;
$$;
revoke execute on function public._staff_alert(text[], text, text, uuid, text, text, jsonb) from public, anon, authenticated;

create or replace function public._staff_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(btrim(full_name), ''), 'A user') from public.profiles where id = p_user
  union all select 'A user' limit 1;
$$;
revoke execute on function public._staff_name(uuid) from public, anon, authenticated;

-- ============================================================================
-- 2. Listings: edited, deleted (a NEW listing is 0052's trigger, unchanged)
-- ============================================================================
create or replace function public.trg_listings_edit_notify_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new.title is distinct from old.title or new.description is distinct from old.description
       or new.price is distinct from old.price or new.images is distinct from old.images
       or new.category is distinct from old.category or new.city is distinct from old.city then
      perform public._staff_alert(array['admin', 'moderator'], 'listing_staff', 'edited', new.user_id,
        'Listing edited', left(new.title, 120) || ' — ' || public._staff_name(new.user_id),
        jsonb_build_object('listingId', new.id, 'sellerId', new.user_id));
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;
revoke execute on function public.trg_listings_edit_notify_staff() from public, anon, authenticated;
drop trigger if exists listings_z_edit_notify_staff on public.listings;
create trigger listings_z_edit_notify_staff after update of title, description, price, images, category, city on public.listings
  for each row execute function public.trg_listings_edit_notify_staff();

create or replace function public.trg_listings_delete_notify_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    -- No listingId: the row is gone, so the alert opens the listings list instead of a missing page.
    perform public._staff_alert(array['admin', 'moderator'], 'listing_staff', 'deleted', old.user_id,
      'Listing deleted', left(old.title, 120) || ' — ' || public._staff_name(old.user_id),
      jsonb_build_object('sellerId', old.user_id));
  exception when others then
    null;
  end;
  return old;
end;
$$;
revoke execute on function public.trg_listings_delete_notify_staff() from public, anon, authenticated;
drop trigger if exists listings_z_delete_notify_staff on public.listings;
create trigger listings_z_delete_notify_staff after delete on public.listings
  for each row execute function public.trg_listings_delete_notify_staff();

-- ============================================================================
-- 3. Users: profile edited, account deleted (a NEW user is 0052's trigger, unchanged)
-- ============================================================================
create or replace function public.trg_profiles_edit_notify_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new.full_name is distinct from old.full_name or new.avatar_url is distinct from old.avatar_url
       or new.phone is distinct from old.phone or new.city is distinct from old.city then
      perform public._staff_alert(array['admin'], 'activity_staff', 'profile_edited', new.id,
        'Profile updated', coalesce(nullif(btrim(new.full_name), ''), 'A user') || ' changed their profile',
        jsonb_build_object('userId', new.id));
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;
revoke execute on function public.trg_profiles_edit_notify_staff() from public, anon, authenticated;
drop trigger if exists profiles_z_edit_notify_staff on public.profiles;
create trigger profiles_z_edit_notify_staff after update of full_name, avatar_url, phone, city on public.profiles
  for each row execute function public.trg_profiles_edit_notify_staff();

create or replace function public.trg_profiles_delete_notify_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public._staff_alert(array['admin'], 'activity_staff', 'account_deleted', old.id,
      'Account deleted', coalesce(nullif(btrim(old.full_name), ''), 'A user') || ' deleted their account',
      '{}'::jsonb);
  exception when others then
    null;
  end;
  return old;
end;
$$;
revoke execute on function public.trg_profiles_delete_notify_staff() from public, anon, authenticated;
drop trigger if exists profiles_z_delete_notify_staff on public.profiles;
create trigger profiles_z_delete_notify_staff after delete on public.profiles
  for each row execute function public.trg_profiles_delete_notify_staff();

-- ============================================================================
-- 4. Reviews and blocks
-- ============================================================================
create or replace function public.trg_reviews_notify_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public._staff_alert(array['admin', 'moderator'], 'activity_staff', 'review', new.reviewer_id,
      'New review', public._staff_name(new.reviewer_id) || ' rated ' || public._staff_name(new.seller_id) || ' ' || new.rating || '/5',
      jsonb_build_object('userId', new.seller_id));
  exception when others then
    null;
  end;
  return new;
end;
$$;
revoke execute on function public.trg_reviews_notify_staff() from public, anon, authenticated;
drop trigger if exists reviews_z_notify_staff on public.reviews;
create trigger reviews_z_notify_staff after insert on public.reviews
  for each row execute function public.trg_reviews_notify_staff();

create or replace function public.trg_blocks_notify_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public._staff_alert(array['admin', 'moderator'], 'activity_staff', 'block', new.blocker_id,
      'User blocked', public._staff_name(new.blocker_id) || ' blocked ' || public._staff_name(new.blocked_id),
      jsonb_build_object('userId', new.blocked_id));
  exception when others then
    null;
  end;
  return new;
end;
$$;
revoke execute on function public.trg_blocks_notify_staff() from public, anon, authenticated;
drop trigger if exists blocked_users_z_notify_staff on public.blocked_users;
create trigger blocked_users_z_notify_staff after insert on public.blocked_users
  for each row execute function public.trg_blocks_notify_staff();

-- ============================================================================
-- 5. Self-check for the admin: which alert triggers does THIS database actually have?
--    select * from public.staff_alert_health();   (admins only)
-- ============================================================================
create or replace function public.staff_alert_health()
returns table (trigger_name text, table_name text, present boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query
    select w.t, w.tbl, exists (select 1 from pg_trigger g where g.tgname = w.t and not g.tgisinternal)
      from (values
        ('reports_c_notify_staff', 'reports'), ('listings_z_notify_staff', 'listings'),
        ('listings_z_edit_notify_staff', 'listings'), ('listings_z_delete_notify_staff', 'listings'),
        ('profiles_z_notify_staff', 'profiles'), ('profiles_z_edit_notify_staff', 'profiles'),
        ('profiles_z_delete_notify_staff', 'profiles'), ('reviews_z_notify_staff', 'reviews'),
        ('blocked_users_z_notify_staff', 'blocked_users')
      ) as w (t, tbl);
end;
$$;
revoke execute on function public.staff_alert_health() from public, anon;
grant execute on function public.staff_alert_health() to authenticated;
