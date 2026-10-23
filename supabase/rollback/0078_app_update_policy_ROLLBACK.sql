-- Rollback for 0078. Apps already fall back to "unverified, allow" when the table is missing, so this is safe at any time.
drop table if exists public.app_update_policy;
