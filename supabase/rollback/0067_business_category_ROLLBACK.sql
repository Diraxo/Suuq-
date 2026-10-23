-- ROLLBACK for 0067. Drops the column (and the category choices with it). Run as ONE transaction.
alter table public.profiles drop constraint if exists profiles_business_categories_shape;
alter table public.profiles drop column if exists business_categories;
