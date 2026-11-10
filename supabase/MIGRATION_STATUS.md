# Migration status (production project waksddinkjbrggxkfofk)

Last verified read-only against production: 2026-10-23. The ledger (`supabase migration list`) stops at 0045 because migrations
are applied by hand; judge state by objects, not by the ledger.

## Live in production
0001-0045, 0046, 0047, 0052, 0056, 0060, 0064-0070, 0073, 0074, 0077, 0075, 0076 (applied 2026-10-23, see note), 0049 (applied 2026-10-23, constraints NOT VALID by design), 0061 (applied 2026-10-23, no coordinates seeded; app uses its 38-city fallback).
(0077 lives in `supabase/proposed/`; it was run from there on 2026-10-23.)

## Release set: apply together with the next app build (in this order)
| Order | Migration | When | Why |
|---|---|---|---|
| 1 | 0073 listing_image_hashes (APPLIED 2026-10-23) | Done, before the new build ships | Additive. The new build sends `image_hashes`; without the column, publishing a listing fails. Safe to apply now. |
| 2 | 0072 private_profile_phone | Same day the new build is live | The new build reads phones through `my_phone()` / `get_contact_phone()`. Applied earlier, the old build's Call buttons show no number. |
| 3 | 0075 unified_identity_name_limit (APPLIED 2026-10-23) | Done | Business mode without a business name; 2 name changes per 7 days. |
| 4 | 0076 nameless_business_compat (APPLIED 2026-10-23) | Done | Needs 0075. Lets nameless business accounts publish business listings and be messaged. |

Rollbacks: `supabase/rollback/00NN_*_ROLLBACK.sql`. Roll back in reverse order: 0076, 0075, 0072, 0073.

## Parked: deliberately NOT applied, not planned for this release
Files stay in `supabase/migrations/` because later local migrations and the PGlite test chain build on them. Do not apply them.
| Migration | Reason |
|---|---|
| 0054, 0055, 0071 (storefronts, deletion ledger, admin directory) | Storefront feature is off. 0054 wipes 3 business profiles and flips business-mode accounts to personal. Needs its own review and the delete-account deploy. |
| 0048, 0050, 0051, 0057, 0058, 0059, 0062, 0063 (image / media scanning) | Needs the scan Worker, which does not exist. Direct upload is the decision until then. |

## Needs a yes/no, then it is closed
| Migration | Effect | Recommendation |
|---|---|---|
| 0053 owner activity not counted | Deletes 6 self-favourites | Apply if you accept losing those rows; otherwise park. |

## Known, not a migration
- Production `notify_on_favorite/follow/review` are 0004-era bodies (135 notifications with NULL type).
- `delete-account` edge function still needs a deploy (it deletes images before the auth user).
- A staff account that decided a storefront verification cannot be deleted (RESTRICT, by design).

## Note 2026-10-23: 0075/0076 and the old build
0075 and 0076 went live while a dry run was being wrapped in begin/rollback; the files contain their own begin/commit, so they committed.
Checked after the fact against the pre-02e0200 client (commit 0909938): that build never calls set_active_mode, start_business_conversation or
seller_presentation, and its only full_name writes are first-set (free) and edit-profile (2 real changes per 7 days allowed), so neither breaks it.
0072 stays HELD: that build reads profiles.phone for Call buttons, chat call, seller page and edit-profile prefill; after 0072 those show no number
(no crash, no data loss: non-null writes are diverted and kept, NULL writes are ignored). NEVER wrap a migration file in an outer begin/rollback to dry-run it.
