-- Adds the account-level UI language preference used by the i18n system
-- (lib/i18n.ts, store/language.ts). Nullable with no default so the app can
-- tell "user never explicitly chose a language for this account" (null)
-- apart from an explicit choice of English ('en') — see store/language.ts
-- for how that distinction drives which side wins when a guest's local
-- choice and an account's stored choice disagree.
alter table public.profiles
  add column if not exists language text check (language in ('en', 'so', 'am'));
