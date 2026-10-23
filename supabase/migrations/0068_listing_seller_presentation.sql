-- 0068 — One account identity: each listing states how it presents its seller, and the account phone has an explicit business opt-in.
--
-- STATUS: written and tested on PGlite only. NOT applied to any database. Needs 0064 (profiles.active_mode) for the backfill rule.
--
-- Why
--   One person = one account id. Personal name/photo/phone/email live on the account (profiles.full_name, avatar_url, phone, ...).
--   The business (name, logo, ...) is a second PRESENTATION attached to that same account, never a second person. Until now a
--   listing's seller block followed whichever mode the owner had active, so flipping the switch silently re-branded every listing
--   and chat. After this migration:
--     * listings.seller_presentation ('personal' | 'business') is the listing's own explicit, stored choice. Switching modes
--       never rewrites it. 'business' is accepted only while the owner has a business name.
--     * profiles.business_phone_public (default false) is the owner's opt-in to publish the ACCOUNT phone under the business
--       profile and business-branded listings. Having a phone on the account is not consent to publish it under a business.
--       It is a presentation preference only: it is not phone verification and does not change who owns the number.
--   Chat, offers, reviews and followers keep showing the stable personal account identity (client rule, lib/profileIdentity.ts).
--
-- Backfill (documented rule, reviewable): a listing whose owner currently shows the business identity keeps showing it, i.e. the
-- owner has a non-blank business_name AND active_mode = 'business'. Everything else stays 'personal'. Rows are updated one by one
-- so a row that fails some other trigger/check is skipped (stays 'personal') instead of aborting the migration.
-- Nothing is deleted, no business or personal value is copied between identities, no verification state is touched.
-- Rollback: supabase/rollback/0068_listing_seller_presentation_ROLLBACK.sql

begin;

alter table public.profiles
  add column if not exists business_phone_public boolean not null default false;

alter table public.listings
  add column if not exists seller_presentation text not null default 'personal';
alter table public.listings
  drop constraint if exists listings_seller_presentation_check;
alter table public.listings
  add constraint listings_seller_presentation_check check (seller_presentation in ('personal', 'business'));

do $$
declare r record;
begin
  for r in
    select l.id from public.listings l join public.profiles p on p.id = l.user_id
     where p.active_mode = 'business' and nullif(btrim(p.business_name), '') is not null
  loop
    begin
      update public.listings set seller_presentation = 'business' where id = r.id;
    exception when others then
      raise notice '0068 backfill skipped listing %: %', r.id, sqlerrm;
    end;
  end loop;
end $$;

-- A business-branded listing needs a business to brand it with. Enforced for every writer, so a client cannot publish a
-- "business" listing for an account that has no business name (which would show an empty/unknown name).
create or replace function public.guard_listing_seller_presentation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.seller_presentation = 'business'
     and (tg_op = 'INSERT' or new.seller_presentation is distinct from old.seller_presentation) then
    if not exists (select 1 from public.profiles p where p.id = new.user_id and nullif(btrim(p.business_name), '') is not null) then
      raise exception 'Add a business name before presenting a listing as your business' using errcode = '22023', hint = 'business_profile_incomplete';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_listing_seller_presentation() from public, anon, authenticated;

drop trigger if exists listings_d_guard_seller_presentation on public.listings;
create trigger listings_d_guard_seller_presentation
  before insert or update of seller_presentation on public.listings
  for each row execute function public.guard_listing_seller_presentation();

commit;
