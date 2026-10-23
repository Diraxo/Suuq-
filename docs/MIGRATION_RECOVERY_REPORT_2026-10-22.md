# Migration recovery + phone privacy — 2026-10-22

Project `waksddinkjbrggxkfofk` (confirmed from `supabase/.temp/project-ref` and the linked CLI). Production was only ever read (catalog SELECTs via `supabase db query --linked`, `supabase migration list --linked`). Nothing was applied, repaired, deployed, committed, staged or deleted.

## 1. Ledger reconciliation

Method: full catalog fingerprint (columns, constraints, indexes, policies, triggers, functions with body hash + ACL, table/column ACLs, publications; schemas public+private) of production vs a local PGlite build, computed **per migration** (what each file adds/changes) and for the whole expected state. 1013 production objects compared. PG17 `MAINTAIN` ACL letter and PG18-style `*_not_null` constraint rows are ignored (version artefacts).

Ledger (re-queried): `0001–0045` only (no 0036, by design). Everything from 0046 is local-only.

| Version | Class | Evidence |
|---|---|---|
| 0046, 0047, 0052, 0056, 0060 | **Confirmed live, ledger missing** | every delta object present and equal (35/53/23/7/15) |
| 0064, 0065, 0066, 0067, 0068, 0069, 0070 | **Confirmed live, ledger missing** | every delta object present and equal. 0068: `listings.seller_presentation`, `profiles.business_phone_public`, check `listings_seller_presentation_check`, trigger `listings_d_guard_seller_presentation`, fn `guard_listing_seller_presentation` all match. Prod data: 25 profiles, 3 business-mode (all with business_name), 7 listings all `personal`. |
| 0048, 0049, 0050, 0051 | Not applied; **not needed yet** (inert while scan mode is off; 0049 is optional hardening) | 0 of 88/13/35/80 objects present; prod still has the 0039 body of `trg_block_restricted_listing_writes` |
| 0053 | Not applied; optional | trigger `favorites_prevent_self` absent; 6 self-favourites still in prod (the migration deletes them) |
| 0061 | Not applied; optional, additive | 0 of 22 |
| 0054, 0055, 0057, 0058, 0059, 0062, 0063, 0071 | Not applied; **hold** (see §3) | 0 objects present |
| 0072 (new, this session) | Not applied; **needed** (phone privacy) | — |
| 0073 (not mine, appeared 13:12 today) | Not reviewed | `0073_listing_image_hashes.sql`, additive per its header |

### Function-body discrepancies — explained
* **CR characters (34 functions + the ones compared in the earlier audit).** Production function bodies contain `\r` (60 bodies have it) because the files were applied from CRLF sources through the SQL editor. With CR removed, 96 functions are byte-identical and 34 more are identical. No logic difference.
* **NEW, genuine drift, not covered by the earlier audit:** `notify_on_favorite`, `notify_on_follow`, `notify_on_review` in production are the **0004-era bodies** (insert without `type`/`data`), although ledgered 0012 replaces them. Effect in prod: **135 notifications have `type = NULL`** (favourite/follow/review), so they carry no routing data. Pre-existing, unrelated to 0046+. Fix = re-run the three `create or replace function` blocks from `0012_push_notifications.sql` (lines 76–160); proposed as a separate approved step, not written as a migration.
* Harmless extras in prod: leftover `profiles.business_category` + `profiles_business_category_shape` (an earlier variant of 0067 that was run), and `settings.value` nullability differs. Neither blocks anything.

### Proposed ledger repair (NOT executed; needs your approval)
Preconditions (all must hold immediately before):
1. Backup/PITR point confirmed and its timestamp recorded.
2. Re-run `supabase/diagnostics`-style catalog compare (the scripts used here are in the session scratchpad; the earlier `ledger_repair_effects_catalog_READONLY.sql` covers 0046/47/52/56/60) and see zero new differences.
3. `supabase migration list --linked` still shows remote ending at 0045.

Command (metadata only; inserts ledger rows, runs no DDL):
```
supabase migration repair --linked --status applied 0046 0047 0052 0056 0060 0064 0065 0066 0067 0068 0069 0070
```
Post-checks: `supabase migration list --linked` shows 0046–0070 on both sides except 0048–0051, 0053–0055, 0057–0059, 0061–0063 local-only; re-run the catalog compare — unchanged. Rollback of the repair: `supabase migration repair --linked --status reverted <versions>`.
**Never run `supabase db push` while 0048–0063 are un-ledgered**: it would apply 0048–0055 and 0057–0063 in one go (0054 wipes business data, below).

## 2. Phone privacy (0072) — implemented locally, tests pass

Verified problem: `profiles` has public `SELECT` policy `using (true)` and table-wide SELECT for anon+authenticated; `phone` readable by anyone (6 numbers in prod) whatever `business_phone_public` says. Also Realtime broadcasts profile rows, and every feed loader does `select('*')`.

Why not a column REVOKE: it makes every `select('*')` fail ("permission denied") including already-shipped app builds, does not stop Realtime, and needs a GRANT for every future column.

Design (`supabase/migrations/0072_private_profile_phone.sql`, rollback in `supabase/rollback/`):
* Number moves to `private.profile_phones` (no API grants, RLS on, not exposed by PostgREST); `profiles.phone` becomes NULL.
* A BEFORE trigger keeps all old write paths working (a written number is stored privately); a NULL write is ignored so an old build cannot erase a number. Clearing is `clear_my_phone()`.
* `my_phone()` (own number); `get_contact_phone(owner, context, ref)` for contexts `listing`, `chat`, `business_profile`, `personal_profile`. Returns NULL (never an error) for: anonymous, blocked either way, suspended/banned viewer or owner, unknown context/owner/ref, closed/removed listing. Business-presented listing, direct business inquiry and business profile require `business_phone_public`; personal context does not. Chat: only the buyer can ask for the seller's number. Rate limit 200/hour.
* Old builds degrade safely: they read NULL, so no Call button.

Clients: new `lib/contactPhone.ts` (+ web copy). Own profile phone is merged from `my_phone()` in the auth stores (mobile+web), so post flow, edit-profile and listing-edit keep working; both edit-profile screens call `clear_my_phone()` when the field is emptied. Chat Call, listing Call, seller-page Call and business-card Call all use the same function. **Seller page now shows one Call button**: the business card's when the profile has a business section (and only if shared), otherwise the personal header's — previously both rendered the same number and the header one ignored the business toggle.

Tests (all pass): `supabase/tests/phone_privacy.test.mjs` (11 checks: move incl. no staff alerts/updated_at churn/re-run; anon + other user + owner get NULL via `select phone`, `select *`, `to_jsonb`, joins, home_feed; private table closed to anon/authenticated for select/insert/update; functions closed to anon; write paths; full authorised/denied matrix incl. disabled toggle, toggle withdrawal, blocks, suspended/banned, chat direction, rate limit). Source guards in `tests/ownerListingBusinessAdmin.test.ts` (no client selects phone from profiles; every Call link comes from the RPC; one Call per profile). Two older characterization tests that pinned the exposure were updated.

**Not proven:** PostgREST/Realtime behaviour against the hosted project (PGlite only), device/browser UI. The privacy fix is **not live** until 0072 is applied and clients ship.

Decisions for you:
* **D1** personal numbers are revealed only to signed-in viewers (anon web visitors lose the Call button). No personal "share" toggle exists; the profile copy already says buyers can call the saved number. Alternative: add a personal toggle (default on for existing numbers).
* **D2** the buyer's number is never given to the seller in chat (buyer never published it). Previously both sides saw each other's Call icon.
* **D3** `profiles.email` is publicly readable too (13 emails). Same fix pattern; not done.
* Staff: `admin_listing_detail` jsonb `phone` key now reads NULL; no admin screen displays it. A "profile phone changed" staff alert no longer fires (the visible column does not change).

## 3. Pending migrations — measured on a production-shaped database

Base = 0001–0045 + live set, seeded like prod (25 profiles, 3 business, 7 listings, 6 self-favourites). The live set itself applies cleanly in order.

| Migration | Result on prod-shaped DB | Decision |
|---|---|---|
| 0072 | applies; moves 6 phones | **Needed. Approve → apply first.** |
| 0061 | applies, additive, no data change | optional, safe |
| 0053 | applies; **deletes the 6 self-favourites** | optional; export the 6 rows first |
| 0049 | applies; replaying prod's 7 real listings: all 7 re-save, all 11 NOT VALID checks would validate | optional hardening, safe vs current data |
| 0048 → 0050 → 0051 | apply, no data change (inert, scan mode off). 0050 fails without 0048 | not needed until the scan Worker is staged; 0048 puts a trigger on `listings` hot path |
| **0054** | applies but **business_name 3→0, business-mode 3→0, logos 3→0** (guard flips owners to personal) | **HOLD** — conflicts with live 0064 |
| 0055 | fails without 0054; couples to delete-account deploy | HOLD (after 0054 plan) |
| 0057, 0058, 0059 | fail without 0054/0057 | HOLD (scan Worker absent; 0059 replaces `handle_new_user`) |
| 0062 | fails without 0054 (`storefront_media_hosts`); fail-closed on avatar saves | HOLD |
| 0063 | applies alone, but rejects NEW URL-only avatar/logo/banner → older builds | HOLD pending compatibility decision |
| 0071 | fails without 0054 | HOLD until 0054 resolved |

Also: order `0064 → 0068 → 0054` preserves business presentation; numeric order loses it (earlier measurement).

## 4. Rollout (all steps need your approval; nothing below has been run)
1. Confirm backup/PITR. 2. Ledger repair (§1). 3. Apply `0072` in the SQL editor (single transaction; ~6 rows). Verify: `select count(*) from profiles where phone is not null` → 0; `select count(*) from private.profile_phones` → 6; anon `GET /rest/v1/profiles?select=phone` → all null. 4. Ship web + mobile builds (apply 0072 *before* they reach users; builds without it show no Call button). 5. Optional additive: 0061; export then 0053; 0049. Add each to the ledger by `migration repair` after applying by hand (or by `db push` only once local-only versions are limited to the intended one). 6. Separate: notification-function drift fix.
Rollback limits: 0072 rollback copies numbers back (re-exposes them); ledger repair is reversible; 0053's deletion is not (restore from export, with the trigger disabled).

## 5. Verification evidence (this session)
* DB: `run-all.mjs` — **ALL 33 DATABASE SUITES PASSED** (includes `phone_privacy`; run after 0073 appeared).
* Root `tsc --noEmit` / web `tsc --noEmit`: clean until 13:24; see issues below.
* `npm test`: 725/725 before the concurrent edits; now 731/734 (below).

## 6. Outstanding / blockers
* **Another process changed the tree during this session**: `app/saved-searches.tsx` is now 3986 bytes of whitespace (HEAD has 3920 bytes of real code) — breaks root `tsc` and 3 TS tests (also two sell-usability scroll tests). Not touched by me; not restored. Restore with `git show HEAD:app/saved-searches.tsx` if that is unintended (note the file also had uncommitted edits, which would be lost).
* Not run: browser/device checks; hosted PostgREST/Realtime checks; `next build`; 0073 review.
* Production check of 0072's data move on the real 6 rows only happens at apply time.
