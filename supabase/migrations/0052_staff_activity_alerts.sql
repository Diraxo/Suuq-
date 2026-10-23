-- 0052 — Staff activity alerts: new listing, new user, and web push subscriptions.
--
-- Reports (0045) and support cases/replies/appeals (0040) already write an in-app notification for staff, and the
-- existing notifications push webhook (0012/0019) turns every notification row into an FCM push for the mobile app.
-- This adds the two events that had no alert at all, plus the table the web app (installed to the home screen) uses
-- to receive the same pushes:
--   * new listing -> admins + moderators   (type 'listing_staff'; a burst from one seller collapses into ONE row so a
--                                           bulk upload is one push, not a hundred)
--   * new user    -> admins                (type 'user_staff')
--   * web_push_subscriptions               (one row per browser/home-screen install, own rows only)
-- A failure to notify must never block a listing or a sign-up, so each trigger body swallows its own errors.
-- Needs 0039 (admin_users.role). Rollback: supabase/rollback/0052_staff_activity_alerts_ROLLBACK.sql.

-- ============================================================================
-- 1. New listing -> admins + moderators
-- ============================================================================
create or replace function public.trg_listings_notify_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff record;
  v_existing record;
  v_seller text;
  v_count int;
begin
  begin
    select coalesce(nullif(btrim(full_name), ''), 'A seller') into v_seller from public.profiles where id = new.user_id;
    v_seller := coalesce(v_seller, 'A seller');

    for v_staff in
      select a.user_id from public.admin_users a
       where a.role in ('admin', 'moderator') and a.user_id <> new.user_id
    loop
      -- Same seller, still unread, within 10 minutes: fold into that row (no new insert => no extra push).
      select id, coalesce((data ->> 'count')::int, 1) as n into v_existing
        from public.notifications
       where user_id = v_staff.user_id and type = 'listing_staff' and read = false
         and data ->> 'sellerId' = new.user_id::text and created_at > now() - interval '10 minutes'
       order by created_at desc limit 1;

      if found then
        v_count := v_existing.n + 1;
        update public.notifications
           set title = v_count || ' new listings from ' || v_seller,
               body = left(new.title, 120),
               created_at = now(),
               data = jsonb_build_object('listingId', new.id, 'sellerId', new.user_id, 'count', v_count)
         where id = v_existing.id;
      else
        insert into public.notifications (user_id, title, body, type, data)
        values (v_staff.user_id, 'New listing', left(new.title, 120) || ' — ' || v_seller, 'listing_staff',
                jsonb_build_object('listingId', new.id, 'sellerId', new.user_id, 'count', 1));
      end if;
    end loop;
  exception when others then
    null;
  end;
  return new;
end;
$$;
revoke execute on function public.trg_listings_notify_staff() from public, anon, authenticated;

drop trigger if exists listings_z_notify_staff on public.listings;
create trigger listings_z_notify_staff after insert on public.listings
  for each row execute function public.trg_listings_notify_staff();

-- ============================================================================
-- 2. New user -> admins
-- ============================================================================
create or replace function public.trg_profiles_notify_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.notifications (user_id, title, body, type, data)
    select a.user_id, 'New user joined', coalesce(nullif(btrim(new.full_name), ''), 'A new account was created'),
           'user_staff', jsonb_build_object('userId', new.id)
      from public.admin_users a
     where a.role = 'admin' and a.user_id <> new.id;
  exception when others then
    null;
  end;
  return new;
end;
$$;
revoke execute on function public.trg_profiles_notify_staff() from public, anon, authenticated;

drop trigger if exists profiles_z_notify_staff on public.profiles;
create trigger profiles_z_notify_staff after insert on public.profiles
  for each row execute function public.trg_profiles_notify_staff();

-- ============================================================================
-- 3. Web push subscriptions (browser / installed home-screen app)
-- ============================================================================
create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  active boolean not null default true,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists web_push_subscriptions_user_idx on public.web_push_subscriptions (user_id) where active;

alter table public.web_push_subscriptions enable row level security;
drop policy if exists "users manage their own web push subscriptions" on public.web_push_subscriptions;
create policy "users manage their own web push subscriptions" on public.web_push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- An endpoint is unique to one browser install: if a different account signs in there, the subscription moves to it.
create or replace function public.register_web_push(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  insert into public.web_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, active = true, updated_at = now();
end;
$$;
revoke execute on function public.register_web_push(text, text, text, text) from public, anon;
grant execute on function public.register_web_push(text, text, text, text) to authenticated;
