-- Suuq+ follow-up schema: auto-insert a notification row whenever someone
-- favorites your listing, follows you, or reviews you. Run once in the
-- Supabase SQL Editor after 0001_init.sql, 0002_search_history_and_view_counts.sql,
-- and 0003_reports.sql.
--
-- Each trigger runs as its definer (same pattern as handle_favorite_change in
-- 0002) so it can insert a notification for the *recipient*, not the actor —
-- the recipient's own RLS policy on notifications only allows auth.uid() = user_id,
-- which the acting user is not.

-- ============================================================================
-- Notify a listing's owner when someone favorites it
-- ============================================================================
create or replace function public.notify_on_favorite()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_owner_id uuid;
  v_listing_title text;
  v_actor_name text;
begin
  select user_id, title into v_owner_id, v_listing_title
  from public.listings
  where id::text = new.listing_id;

  -- No matching row (static mock listing id) or self-favorite: nothing to notify.
  if v_owner_id is null or v_owner_id = new.user_id then
    return new;
  end if;

  select coalesce(full_name, 'Someone') into v_actor_name
  from public.profiles where id = new.user_id;

  insert into public.notifications (user_id, title, body)
  values (v_owner_id, v_actor_name || ' favorited your listing', coalesce(v_listing_title, ''));

  return new;
end;
$$;

drop trigger if exists on_favorite_notify on public.favorites;
create trigger on_favorite_notify
  after insert on public.favorites
  for each row execute function public.notify_on_favorite();

-- ============================================================================
-- Notify a user when someone follows them
-- ============================================================================
create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor_name text;
begin
  select coalesce(full_name, 'Someone') into v_actor_name
  from public.profiles where id = new.follower_id;

  insert into public.notifications (user_id, title, body)
  values (new.following_id, v_actor_name || ' started following you', null);

  return new;
end;
$$;

drop trigger if exists on_follow_notify on public.followers;
create trigger on_follow_notify
  after insert on public.followers
  for each row execute function public.notify_on_follow();

-- ============================================================================
-- Notify a seller when someone reviews them
-- ============================================================================
create or replace function public.notify_on_review()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor_name text;
begin
  select coalesce(full_name, 'Someone') into v_actor_name
  from public.profiles where id = new.reviewer_id;

  insert into public.notifications (user_id, title, body)
  values (new.seller_id, v_actor_name || ' left you a ' || new.rating || '-star review', coalesce(new.comment, ''));

  return new;
end;
$$;

drop trigger if exists on_review_notify on public.reviews;
create trigger on_review_notify
  after insert on public.reviews
  for each row execute function public.notify_on_review();

-- ============================================================================
-- Let notification recipients delete their own rows (screen needs this;
-- 0001's "users manage their own notifications" policy already covers select
-- + update, "for all" includes delete too, so no policy change is needed —
-- this statement is a no-op safety net in case that policy is ever narrowed).
-- ============================================================================
drop policy if exists "users manage their own notifications" on public.notifications;
create policy "users manage their own notifications" on public.notifications
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
