# delete-account key validation (IMPLEMENTED LOCALLY — NOT deployed)

## Problem
`supabase/functions/delete-account/index.ts` runs with the R2 admin credentials and used to delete,
without any shape or ownership check:

- `profiles.avatar_public_id`, `business_logo_public_id`, `business_banner_public_id`
- every entry of `listings.image_public_ids` for the user's listings

Each of those columns is writable by the owner (profile update / listing insert-update RLS). A user
could store **another user's** object key (e.g. `listings/{victimUid}/{uuid}.jpg`) in their own
profile/listing, then delete their account — the function deleted the victim's object with admin
credentials. (The legacy chat-key path was already protected by a per-user regex.)

## Fix
New pure helper `supabase/functions/_shared/accountKeys.ts` (`isKeyForKind`, `selectOwnedKeys`), used by
`delete-account/index.ts` for every key it deletes. `uid` is the JWT-verified user id.

| Source column | Required key shape |
|---|---|
| `profiles.avatar_public_id` | `avatars/{uid}/{uuid}.jpg` |
| `profiles.business_logo_public_id` | `business/{uid}/logo/{uuid}.jpg` |
| `profiles.business_banner_public_id` | `business/{uid}/banner/{uuid}.jpg` |
| `listings.image_public_ids` (rows with `user_id = uid`) | `listings/{uid}[/{draft}]/{uuid}.jpg` |
| legacy `messages.image_keys` (rows with `sender_id = uid`) | `chat/{conv}/{uid}/{uuid}.jpg` |

- Per-column: a key valid for one column is rejected in another.
- `{draft}` / `{conv}` are single `[A-Za-z0-9_-]{1,64}` segments; the file name is a hex UUID plus a
  literal `.jpg`. No dot-dot, extra slashes, percent-encoding, backslashes, query/fragment, whitespace or URLs.
- Ownership comes only from the verified uid; an owner-writable column value is never trusted.
- Invalid keys are skipped (never deleted, never fatal) and logged as a count only
  (`r2_keys_skipped`, `r2_key_skipped`) — never the key itself. Response contract unchanged.
- The old local `CHAT_KEY_RE` was replaced by the same helper (same strictness).
- Tests: `tests/accountKeys.test.ts` (validator + static wiring checks; JavaScript only, no live R2).
- Bug the tests caught in the first draft: a backslash-dot in a template literal collapses to a
  wildcard `.`, which accepted `…{uuid}Xjpg`. Fixed with `[.]`.

## Compatibility / risk
- Keys written by the current apps (`listings/{uid}[/{draft}]/…`, `avatars/{uid}/…`,
  `business/{uid}/(logo|banner)/…`) all match.
- Cloudinary public_ids and other pre-R2 formats do not match. They deleted nothing before either
  (404 → treated as success). Run `supabase/audit/0037_key_format_audit.sql` Q4/Q5 first and look at the
  `legacy_cloudinary_or_other` buckets: any R2-format key that is valid-but-unusual would now be orphaned.
- Failure mode is "an object is left behind", never "someone else's object is deleted".

## Also recommended (separate work)
A write-time trigger on `profiles` / `listings` rejecting `*_public_id(s)` values that fail the owner
shape (belongs with the 0036 sell-validation work).

## Deploy order
Independent of migration 0037. Deploy only after the Q4/Q5 audit results are reviewed. The function
imports `_shared/accountKeys.ts`, so deploy with the CLI from the repo root
(`supabase functions deploy delete-account`). Keep its in-code JWT auth; do not change `verify_jwt`.
