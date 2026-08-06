-- Phone number redesign: the phone number is now a profile-level concept
-- (see 0015_profile_extended_fields.sql's phone_country column and
-- store/auth.ts) collected once and reused on every listing via
-- profileToSeller(). The "Show phone publicly" per-listing toggle is
-- removed — every listing's Call button just uses profiles.phone. Run once
-- after 0015, and only after the app build that stops reading/writing these
-- columns (store/myListings.ts) has shipped.

alter table public.listings
  drop column if exists phone,
  drop column if exists phone_public;
