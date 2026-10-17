-- NOT APPLIED. Needs explicit owner approval, and only after owner_admin_access_diagnose.sql shows the cause.
-- Do NOT run if diagnose step 1 shows staff_role() is missing: the fix then is to apply migrations 0038 -> 0039 (-> 0040/0041),
-- not to touch admin_users.
-- Use only if step 3 shows the user with a profile and step 4 shows no admin_users row. Resolves by auth id, not by trusting a client email.
-- Run on 0039+ schema (has the role column). On a pre-0039 schema, omit the role column.
insert into public.admin_users (user_id, role)
select u.id, 'admin' from auth.users u
join public.profiles p on p.id = u.id
where lower(u.email) = 'abdirahmanug7@gmail.com'
on conflict (user_id) do nothing
returning user_id, role, created_at;
-- Verify afterwards: sign in as the owner on the site; /admin should load.
-- Rollback: delete from public.admin_users where user_id = '<id returned above>';
