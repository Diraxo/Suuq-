-- READ-ONLY. Run in the Supabase SQL editor (production project waksddinkjbrggxkfofk). Changes nothing.
-- Prints no tokens/sessions. Answers: why does abdirahmanug7@gmail.com get denied on /admin?

-- 1. Is migration 0039 applied? (the web console calls staff_role(); if this returns 0 rows -> that is the cause)
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and proname in ('staff_role', 'staff_can', 'is_staff', 'is_admin');

-- 2. Does admin_users have the role column (0039)?
select column_name from information_schema.columns where table_schema = 'public' and table_name = 'admin_users';

-- 3. Does the owner have an auth user + profile, and exactly which id?
select u.id as auth_user_id, u.email, p.id is not null as has_profile
from auth.users u left join public.profiles p on p.id = u.id
where lower(u.email) = 'abdirahmanug7@gmail.com';

-- 4. Is that id in admin_users? (0 rows = missing staff record)
select a.user_id, a.created_at from public.admin_users a
join auth.users u on u.id = a.user_id where lower(u.email) = 'abdirahmanug7@gmail.com';
-- Also: is the signed-in Google account actually this email? Several auth users may exist per person.
select id, email, raw_app_meta_data->>'provider' as provider, created_at from auth.users
where email ilike '%abdirahman%' order by created_at;
