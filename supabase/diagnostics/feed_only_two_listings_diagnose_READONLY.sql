-- READ-ONLY. Run in the Supabase SQL editor (production project). Changes nothing (everything is inside one rolled-back transaction).
-- Question: why does a signed-in account see only 2 listings in Home/Search while a guest sees all?
-- Replace BOTH emails below with the two affected accounts.

-- A. What does each role actually get from the feed RPC? (guest vs the signed-in account)
begin;
  set local role anon;
  select 'guest' as viewer, count(*) as feed_rows from public.home_feed('latest', null, null, null, null, null, null, 'asc', 60);
rollback;

begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where lower(email) = lower('abdirahmanug7@gmail.com')), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select 'account one' as viewer, count(*) as feed_rows from public.home_feed('latest', null, null, null, null, null, null, 'asc', 60);
  select 'account one: blocked either way' as what, private.blocked_either_way() as ids;
  select 'account one: can read listings table' as what, count(*) as n from public.listings;
rollback;

begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where lower(email) = lower('garsadstyle@gmail.com')), 'role', 'authenticated')::text, true);
  set local role authenticated;
  select 'account two' as viewer, count(*) as feed_rows from public.home_feed('latest', null, null, null, null, null, null, 'asc', 60);
  select 'account two: blocked either way' as what, private.blocked_either_way() as ids;
rollback;

-- B. Ground truth: who owns the listings, and are there block rows at all?
select l.status, count(*) as n, count(distinct l.user_id) as sellers from public.listings l group by 1 order by 2 desc;
select count(*) as total_block_rows from public.blocked_users;
select u.email, count(*) filter (where b.blocker_id = u.id) as blocks_made, count(*) filter (where b.blocked_id = u.id) as blocked_by_others
  from auth.users u left join public.blocked_users b on u.id in (b.blocker_id, b.blocked_id)
 where lower(u.email) in (lower('ACCOUNT_ONE_EMAIL'), lower('ACCOUNT_TWO_EMAIL')) group by 1;

-- C. Every policy on listings and profiles (a stray restrictive policy would show here).
select tablename, policyname, permissive, roles, cmd, qual from pg_policies where schemaname = 'public' and tablename in ('listings', 'profiles') order by 1, 2;
