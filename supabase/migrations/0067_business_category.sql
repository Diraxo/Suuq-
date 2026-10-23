-- 0067 — A business can say what it sells: profiles.business_categories (up to 5 marketplace category ids, e.g. {electronics,vehicles}).
--
-- STATUS: written and tested on PGlite only. NOT applied to any database.
-- The column is optional and display-only. The database only checks the shape (1-5 short lowercase ids); the apps pick from the
-- real category list (data/categories.ts), so the list can grow without a migration. Existing rows stay NULL.
-- Rollback: supabase/rollback/0067_business_category_ROLLBACK.sql

begin;

alter table public.profiles add column if not exists business_categories text[];
alter table public.profiles
  add constraint profiles_business_categories_shape check (
    business_categories is null
    or business_categories = '{}'
    or array_to_string(business_categories, ',') ~ '^[a-z][a-z_]{1,29}(,[a-z][a-z_]{1,29}){0,4}$'
  );

commit;
