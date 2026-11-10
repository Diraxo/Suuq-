-- Rollback of 0089 (restores the 2026-10-27 production snapshot: anon/authenticated = arwdDxtm on all three tables, EXECUTE for PUBLIC/anon/authenticated
-- on the trigger function, search_path = public; service_role and postgres entries were never changed): gives back exactly what 0089 revoked (the Supabase default grants) and the original search_path.
begin;
set local lock_timeout = '10s';

grant truncate, trigger, references on public.listings, public.offers, public.price_drops to anon, authenticated;
grant insert, update, delete on public.offers, public.price_drops to anon, authenticated;
grant execute on function public.trg_listings_record_price_drop() to public, anon, authenticated;
alter function public.trg_listings_record_price_drop() set search_path = public;

do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'grant maintain on public.listings, public.offers, public.price_drops to anon, authenticated';
  end if;
end $$;

commit;
