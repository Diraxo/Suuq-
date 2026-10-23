# Migration sequencing review — 2026-10-21

**Status: READ-ONLY REVIEW. Nothing was applied, repaired, deployed or released. No production query was run for this review** (production facts below are quoted from the 2026-10-21 read-only audit recorded in the project memory, not re-checked).

Method: read the local SQL of 0046-0063, their DDL/DML inventory, the rollback files that exist, the header comments, and the Edge Function code that talks to these migrations. Rollback files other than 0053, 0054-restore and 0056 were checked for **existence only, not content** — see "Not verified".

## 1. Production starting point (from the earlier read-only audit)

- Ledger: 0001-0035, 0037-0045 (no 0036 anywhere, intentional).
- Objects present but **not in the ledger**: 0046, 0047, 0052, 0056, 0060.
- Entirely absent: 0048-0051, 0053, 0054, 0055, 0057, 0058, 0059, 0061, 0062, 0063.
- Data: 25 profiles, 2 with business data, 8 listings, 6 self-favourites. `storefront_media_hosts` does not exist. Deployed functions: send-push-notification, cloudinary-delete, delete-account, r2-presign (v10), r2-delete. Not deployed: account-deletion-drain, r2-verify-images, verification-document.

**Conclusion: `supabase db push` of the backlog is unsafe.** It would re-run five migrations and apply 0053/0054 in one go.

## 2. Classification of every pending/unledgered version

| Ver | What it does (verified in SQL) | Class | Client / function coupling | Rollback file |
|---|---|---|---|---|
| 0046 | private.suppressed_messages, block_events; replaces policies on messages + conversation_participants; replaces handle_new_message, edit/delete_message, guard triggers | **Ledger repair candidate** (objects already live) | Chat clients | yes (content not audited) |
| 0047 | notifications: 4 columns, check, unique index, **drops 4 old policies** and recreates 3, 2 triggers; report_admin/report_notes; **backfill INSERT into report_admin for every existing report**; replaces admin_update_report_status, admin_set_verified | **Ledger repair candidate** | Admin web | yes |
| 0052 | 2 notify triggers (listings, profiles insert), web_push_subscriptions + RLS + register_web_push | **Ledger repair candidate** | send-push-notification (web push) | yes |
| 0056 | profiles content guard trigger + NOT VALID checks + 2 functions | **Ledger repair candidate** (see §4: its rollback is not a plain undo) | clients write profiles directly | yes |
| 0060 | _staff_alert + 6 triggers (listing edit/delete, profile edit/delete, reviews, blocks) + staff_alert_health | **Ledger repair candidate**; needs 0052 | none | yes |
| 0048 | image_scan_config + listing_scans/images/hashes tables; **trigger on `listings` (listings_z_image_scan)**; replaces 0039's `trg_block_restricted_listing_writes` | Additive, but a **trigger on the listings hot path**; inert only while mode='off' | r2-presign, scan Worker | **MISSING** |
| 0049 | 9 `NOT VALID` CHECKs on `listings`, 2 triggers (validate_listing_attributes, sanitize_new_listing) | **Behaviour-changing** | Sell flows | **MISSING** |
| 0050 | mode ladder on image_scan_config; **replaces trg_listing_image_scan**; shadow events; admin RPCs; `legacy_presign_closed()` | Additive/behavioural (inert at mode 'off') | r2-presign calls `legacy_presign_closed` | yes |
| 0051 | bulk queue tables + RPCs; adds `listing_scans.source`; **replaces trg_image_scan_config_sync** | Additive | none live | yes |
| 0053 | Replaces increment_listing_views, adds favourites trigger, **DELETEs self-favourites** | **DATA-DELETING** | web/mobile already skip owner views | yes — but "deleted self-favorites are not restored" |
| 0054 | storefronts model; **backfill moves business data off profiles; mirror clears public business_* fields; draft storefronts created; images dropped (host table empty)**; new storage bucket + storage policies; new staff_can (identical matrix to 0039) | **USER-VISIBLE + DATA-CHANGING** | needs a client that can publish; delete-account (storefront images); verification-document function | restore script + commented drop block |
| 0055 | account-deletion ledger tables + RPCs | Additive, but **couples to delete-account deploy** (see §5) | delete-account, drain, DRAIN_SECRET | yes |
| 0057 | business_media_config (seeded explicit OFF), business_media_scans, triggers on profiles **and storefronts** | Additive, inert at OFF | media Worker (absent) | yes |
| 0058 | backfill state machine tables/RPCs | Additive, service-role only | script only | yes |
| 0059 | extends 0057 to avatars; replaces _bm_key_ok, trg_profile_business_media_scan, **handle_new_user** | Behaviour-changing (signup trigger) | signup | yes |
| 0061 | location_coordinates + admin RPCs, no seed | Additive | clients already fall back on error | **MISSING** |
| 0062 | host-pin trigger on profiles | **Behaviour-changing; fails closed if host row missing** | all avatar/logo/banner saves | yes |
| 0063 | rejects NEW URL-only avatar/logo/banner | **Compatibility-affecting** | older clients | yes |

## 3. Dependency graph

```
0039 (staff_can, is_client_write) ──┬─> 0046 ─(needs 0043, 0044)
                                    ├─> 0047
                                    ├─> 0052 ──> 0060
                                    └─> 0048 ──> 0050 ──> 0051
                                          └────> 0049   (header: "needs 0038-0048")
0053  independent (touches favorites, increment_listing_views)
0054  needs 0039 + 0001..0053   (one transaction, NOT re-runnable)
  ├─> 0055 (reads storefront_verification_requests)
  ├─> 0057 (creates a trigger ON storefronts) ──> 0058 (uses 0057 + 0054)
  │                                          └──> 0059 (replaces 0057 functions)
  └─> 0062 (needs storefront_media_hosts rows + 0056)
0056 ──> 0063   (0063 does NOT need 0054 or 0062)
0061  independent (needs 0027, 0032, 0039)
```

**Functions redefined by more than one migration — order is load-bearing** (later replaces earlier; a rollback must restore the previous body, not drop):

| Function | Chain |
|---|---|
| trg_listing_image_scan | 0048 → 0050 |
| trg_image_scan_config_sync | 0050 → 0051 |
| trg_block_restricted_listing_writes | 0039 → 0048 |
| _bm_key_ok, trg_profile_business_media_scan | 0057 → 0059 |
| guard_message_block, delete_message | 0044/0037 → 0046 |
| admin_update_report_status, admin_set_verified | 0038/0039 → 0047 |
| staff_can | 0039 → 0054 (identical matrix; no behavioural change) |

Trigger-order naming on `profiles` (BEFORE): b_guard_content (0056) → c_business_media_scan (0057/0059) → c_media_host_pin (0062) → c_url_only_block (0063). Alphabetical firing makes 0059's "null a first-login external avatar" run before 0063. Applying out of order changes which error a client sees, not whether it is blocked.

## 4. Proposed version-by-version plan (nothing here is authorised)

Each step is its own approval. Stop after each step and run its check.

**Stage 0 — Evidence (read-only / backup only)**
1. Confirm a usable backup / PITR point; record its timestamp.
2. Verify the five unledgered migrations' *complete* effects (query pack in §7), not only function bodies. Earlier verification covered functions; it did not (per the record) cover columns, constraints, indexes, policies, triggers, backfilled rows.
3. Export recovery data: the 6 self-favourite rows (0053); both business profiles' full `business_*` values + `storefront_legacy_snapshot` is created by 0054 itself but export beforehand anyway (0054); current policy definitions on `notifications`, `messages`, `conversation_participants`.
4. Write and test the missing rollbacks: 0048, 0049, 0061 (see §6).
5. Compare deployed vs local `r2-presign` (v10) and `delete-account` behaviour (§5).

**Stage 1 — Ledger repair, metadata only** (after Stage 0.2 shows every effect of that version is present): 0046, 0047, 0052, 0056, 0060. Repair 0052 before 0060. Do **not** mark a version applied if any effect is missing; apply the missing part instead.
Caveat for 0056: marking it applied records the *weaker* production state (any https host ending with the user's own key). That is accurate, and is closed only by 0062+0063.

**Stage 2 — Additive, low client coupling** (each separately): 0061 (after its rollback exists) → 0048 → 0050 → 0051 (listings trigger chain; confirm `image_scan_config.mode='off'` and `enforce=false` afterwards) → 0049 (**only after** the 8 production listings are checked against all nine CHECKs and both triggers; `NOT VALID` still fires on every UPDATE of an existing row, so a violating listing could not be edited or marked sold).

**Stage 3 — Data-deleting: 0053.** Only after the 6 rows are exported. Restore procedure must run **before** re-creating `favorites_prevent_self` or with the trigger disabled, otherwise the restore INSERT is refused by the trigger the migration adds. Note the shipped rollback does not restore rows.

**Stage 4 — Storefront block (0054 → 0055 → 0057 → 0058 → 0059)** — held until all of:
- a client that can publish a storefront is released and verified (or an explicit operator decision to publish the two profiles by service-role SQL after 0054 — a decision, not assumed);
- `storefront_media_hosts` row decision (needed for logos/banners to survive; see 0054 note below);
- delete-account (+ drain, DRAIN_SECRET, verification-document) ready to deploy **immediately after 0055** (§5).

**Stage 5 — 0062 → 0063**, after host verification (§8) and the compatibility decision.

## 5. Function and client deployment coupling

| Function | Needs | Hazard |
|---|---|---|
| `delete-account` (local) | **0055 hard**: it calls `account_deletion_collect_verification_paths` / `account_deletion_begin` first and returns 500 "Could not start account deletion" if they are missing. 0054 soft (storefronts read, error ignored) | Deploying local delete-account before 0055 **breaks account deletion entirely** (an App Store requirement). Deployed old version + 0054 applied leaves storefront images and verification files orphaned. So: 0054 → 0055 → deploy, back-to-back, with 0054 held until the deploy is ready. |
| `r2-presign` (local) | `legacy_presign_closed()` (0050). Missing function is read as "open" (`readClosedFlag`), other errors fail closed (503) | Safe either side of 0050. Local also adds kill switch `R2_PRESIGN_DISABLED` and stops gating avatars/business (owner decision 2026-10-21). Deployed v10 not diffed → unknown which of these it contains. |
| `verification-document` | `admin_authorize_verification_document` (0054) | Not deployed; deploy after 0054. |
| `account-deletion-drain` | 0055 + `DRAIN_SECRET` (absent) | Not deployed. No pg_cron, so something external must call it. |
| `send-push-notification` (local diff) | `web_push_subscriptions` (0052, present) | Local differs from deployed; not diffed. |

## 6. Rollback feasibility

| Ver | Feasibility |
|---|---|
| 0046, 0047, 0050-0052, 0055, 0057-0060, 0062, 0063 | File exists; **content not audited** here. Anything that backfilled (0047 report_admin rows) or logged (0046 suppressed/block events) loses that derived data on rollback. |
| 0048, 0049, 0061 | **No rollback file.** Must be written and tested before applying. 0048/0049 touch `listings`; a rollback of 0048 must restore the 0039 body of `trg_block_restricted_listing_writes`, and of 0050/0051 the previous bodies of the replaced functions. 0049 is simple (drop 9 constraints + 2 triggers + functions). 0061 is drop table/functions. |
| 0053 | **Irreversible for the 6 rows** unless exported first. |
| 0054 | Two-step restore script exists (`rollback/0054_rollback_restore.sql`, exports first, restores legacy values only for never-published owners). Owners published once, or created after 0054, stay cleared by design. The bucket and its files are not touched. |
| 0056 | Rollback **installs a media freeze** (clients cannot set avatar/logo/banner) rather than restoring pre-0056 behaviour, by design. |
| 0059 | Replaces `handle_new_user` (signup). Rollback must restore the exact previous body; confirm the file does. |

## 7. Read-only verification pack for Stage 0 (queries to run, with approval)

For each of 0046/0047/0052/0056/0060, compare the *whole* effect set, not just `pg_get_functiondef`:
- tables/columns: `information_schema.columns` for the migration's tables and the 4 new `notifications` columns (0047);
- constraints & indexes: `pg_constraint`, `pg_indexes` (`notifications_push_status_check`, `notifications_dedupe_idx`, the 0056 NOT VALID checks);
- policies: `pg_policies` on `notifications` (0047 drops 4, creates 3), `messages` and `conversation_participants` (0046), `report_admin`, `report_notes`, `web_push_subscriptions`;
- triggers: `pg_trigger` on `listings`, `profiles`, `reviews`, `blocked_users`, `reports`, `notifications`, `message_reactions`;
- grants: `has_function_privilege` for anon/authenticated on each RPC (many `revoke ... from anon, public`);
- backfills: `count(*)` of `report_admin` vs `reports` (0047).
Also read `select * from image_scan_config`, `select enforce from business_media_config` (table should not exist yet) before any Stage 2 step.

## 8. Items the three advisor concerns map to

1. **Ledger reconciliation** — see Stage 0.2 and Stage 1. Also the 0048-0063 versions must be applied in numeric order *within each dependency chain*, not strictly 0048..0063 (e.g. 0061 and 0063 are independent of 0054).
2. **0053 deletes data** — confirmed in SQL: `delete from favorites ... where listing owner = favoriting user`, fires `on_favorite_change` to lower `favorites_count`.
3. **0054 changes live profiles** — confirmed. Two additional effects the summary did not mention: the mirror also clears `profiles.business_*` for **suspended/banned owners**; and because `storefront_media_hosts` is empty at backfill, **business logos/banners are not carried over** (kept in the snapshot; `_sf_reattach_legacy_images()` restores them once a host row exists). Net: the two businesses lose their public section *and* images until published.
4. **0062 host** — `_pmh_url_ok` requires the URL to be exactly `https://<host>/<key>` with a host row. The host seen in data (`pub-82d788c4a57e4172aecc99a383616935.r2.dev`) is **evidence, not the secret's value**. Verify the secret's origin in the Supabase dashboard (do not paste it into chat). A custom domain on the secret would make every upload fail.
5. **0063 older clients** — only a *changed* URL-only value is refused; unchanged legacy values and clearing pass. Also true of builds already in users' hands: the committed HEAD's first-login fallback upsert still copies the Google photo, but that path is dead because `on_auth_user_created` creates the row. No version gate exists.

## 9. Not verified (stated, not hidden)

- Contents of the rollback files other than 0053, 0054-restore, 0056.
- Whether `supabase db push` / SQL editor wraps each file in one transaction (only 0054 declares its own `begin/commit`).
- Deployed `r2-presign` v10, `delete-account`, `send-push-notification` source vs local (needs `supabase functions download`; read-only but not run).
- Whether the production state of the five unledgered migrations includes every non-function effect.
- Any production data other than what the earlier audit recorded.

## 10. Decisions this review cannot make

A. Publish the two existing businesses by operator SQL after 0054, or wait for the storefront client.
B. What to do with the 6 self-favourites beyond export (delete as designed vs leave).
C. Minimum-app-version stance for 0063.
D. Whether `delete-account` + drain + DRAIN_SECRET + a scheduler exist before 0055.

---

## 11. Addendum — migration 0064 (`profile_active_mode`), reviewed later on 2026-10-21

**Status: local read-only review. Nothing applied, no production access.** Sections 1-10 above are unchanged; this addendum only adds 0064. The 0064 SQL, its rollback and its test were read, not modified. The PGlite suite was **not re-run** for this addendum (the earlier run is not re-claimed).

### 11.1 Schema effects (from the SQL)

| Object | Effect |
|---|---|
| `profiles.active_mode text not null default 'personal'` | Rewrites no rows beyond the default; `add column if not exists` is re-runnable |
| `profiles_active_mode_check` | `check (active_mode in ('personal','business'))`. **Plain `add constraint`, not idempotent** (a second run errors). The file is one `begin/commit`, so a failed run leaves nothing behind |
| Backfill | `update profiles set active_mode='business' where business_name is non-blank`. Runs **before** the guard exists. It is a real UPDATE of every such row, so the row triggers below still run for it |
| `guard_profile_active_mode()` + trigger `profiles_d_guard_active_mode` | BEFORE INSERT OR UPDATE, invoker. For client writes: INSERT forces `personal`; UPDATE that changes `active_mode` raises 42501 (`active_mode_rpc_only`). For **any** writer: `business` with a blank `business_name` becomes `personal` |
| `set_active_mode(text)` | SECURITY DEFINER, `authenticated` only. Validates mode, locks the caller's row, requires a business name for `business`, sets `fursad.admin_write=true` (transaction-local) and flips only the one column |

### 11.2 Dependencies

- Hard: 0038 (`is_client_write()`), 0015 (profiles already in the `supabase_realtime` publication, so a switch reaches viewers), 0019/0028 (`update_profile` rate-limit trigger).
- Not required: 0054. The gold badge is read from `public_storefronts.verified` when that view exists (client rule in `lib/profileIdentity.ts`).
- Clients: `hooks/useActiveMode.ts` and the web copy call `rpc('set_active_mode')`. Types and `activeMode()` tolerate a missing column (test "before migration 0064…"). Without 0064 the **switch itself fails** and the optimistic change is reverted; reading is safe either way.

### 11.3 Trigger ordering on `profiles`

BEFORE (byte order of trigger name): `profiles_a_guard_protected` (0038) → `profiles_b_guard_content` (0056) → `profiles_c_business_media_scan` (0057/0059) → `profiles_c_media_host_pin` (0062) → `profiles_c_url_only_block` (0063) → **`profiles_d_guard_active_mode` (0064)** → `profiles_set_updated_at` (0015) → `rate_limit_profile_updates` (0019).
AFTER: `profiles_z_*` (0052, 0054 x2, 0060 x2).

- 0064 sorts after all of 0056-0063, so the shape/media/host checks reject first and 0064 only normalises the mode; it does not change which error a client sees for any of them.
- `set_active_mode` sets `fursad.admin_write`, which makes `is_client_write()` false for 0056/0057/0062/0063 and **bypasses the `update_profile` rate limit** for that statement. Only `active_mode` changes, so the content guards have nothing to check, but a user can toggle without a rate limit (each toggle bumps `updated_at` and emits a Realtime event). Low risk; worth knowing.
- Existing `NOT VALID` checks on `profiles` (0019: full_name/business_name/bio length; 0056: business_description/address/website, city length) are **still enforced on every UPDATE of an existing row**. Both the 0064 backfill and a later `set_active_mode` therefore fail for a row that violates one. The 0064 backfill would abort the whole migration. Production has 2 business profiles; whether either violates a check has **not been checked**.
- The backfill UPDATE runs as the migration role, so the client-only guards (0038, 0056, 0057, 0062, 0063) return early; `updated_at` is bumped and a Realtime event fires for each backfilled row.

### 11.4 Interaction with 0054-0063 (the main finding)

1. **0054 empties `profiles.business_name` for unpublished storefronts.** `_sf_mirror_to_profile` (and `_sf_clear_profile_business`) set `business_name = null` unless the storefront is published and the owner is in good standing. The 0064 guard then turns `business` into `personal` on that very UPDATE, whatever the order:
   - 0064 **before** 0054: backfill marks the 2 business owners `business`, then 0054's clearing UPDATE flips them back to `personal`.
   - 0064 **after** 0054: the backfill finds no non-blank `business_name`, so nobody is marked `business`.
   Either way the existing business owners end up `personal`, and after they publish they must switch manually. This contradicts the header of 0064 ("accounts that already have a business_name keep showing it"). That promise only holds if 0054 is **not** applied. No test covers 0054 + 0064 together (the 0064 test sets `business_name` by direct UPDATE with no storefront).
2. 0054's `profiles_z_business_legacy_sync` is AFTER UPDATE OF the business_* columns only; an `active_mode`-only update does not fire it. The other direction (mirror -> profiles) is described in item 1.
3. 0057/0059/0062/0063: independent of 0064. They only act on avatar/logo/banner columns and skip non-client writes; 0064 changes no media column. 0059 replaces `handle_new_user` (definer), so new rows get the column default `personal`.
4. 0060: `profiles_z_edit_notify_staff` is `AFTER UPDATE OF full_name, avatar_url, phone, city`; an `active_mode` update does not notify staff, which is correct.
5. 0056 rollback "media freeze" and the 0062/0063 rollbacks do not touch `active_mode`; 0064's rollback drops only its own objects. The two sets can be rolled back in any relative order.

### 11.5 Rollback behaviour

`rollback/0064_profile_active_mode_ROLLBACK.sql` drops the trigger, the two functions, the constraint and the column (all `if exists`, re-runnable; the test runs it twice). It deletes the stored mode: every owner's choice is lost, and clients revert to "has a business name => business" (the pre-0064 rule). It needs no data export beyond optionally recording who was in `business` mode. It does not restore anything else, because 0064 changes nothing else. The test proves this on the **real chain through 0064**, not on production.

### 11.6 Test gaps to close before approval (no change made)

- No 0054+0064 combined case (11.4 item 1).
- The backfill statement is replayed by hand in the test, not run from the migration file against pre-existing rows.
- No row that violates a `NOT VALID` check.
- `fails(bob, update ... alice ...).catch(() => {})` swallows its own result, so it asserts nothing beyond the following mode check.
- PostgREST and Realtime delivery are unproven (the test file says so).

### 11.7 Proposed migration order (proposal only, nothing authorised, no file renumbered)

| Step | Versions | Condition |
|---|---|---|
| 0 | Backup/PITR note; evidence re-run | unchanged from §4 Stage 0 |
| 1 | Ledger repair: 0046, 0047, 0052, 0056, 0060 (0052 before 0060) | needs separate approval |
| 2 | 0061, 0048, 0050, 0051, 0049 | unchanged from §4 Stage 2 |
| 3 | 0053 | rows exported first |
| 4 | 0054 -> 0055 -> deploy delete-account/drain/verification-document -> 0057 -> 0058 -> 0059 | unchanged from §4 Stage 4 |
| **5** | **0064** | **After the 0054 block, and only once decision E below is made.** Not before 0054 (no benefit: 0054 undoes the backfill). Before or together with the first client build that shows the switch |
| 6 | 0062 -> 0063 | unchanged; independent of 0064 |

0064 is technically order-independent of 0055-0063 (it needs only 0038), so applying it earlier is safe for the database; the constraint is the product behaviour in 11.4 item 1, not a dependency.

### 11.8 New risks and decisions

- **R1 (0054 vs 0064 intent).** Decision E: either accept "all business owners start in personal mode after 0054" and have the switch UI explain it, **or** write a revised backfill (a new, reviewed revision of 0064, not an edit in place) that derives the mode from published storefronts / the 0054 snapshot.
- **R2.** The 0064 backfill can abort on a `NOT VALID` violator. Needs a read-only data check (with approval) of the 2 business profiles.
- **R3.** A switch-capable client released before 0064 shows a switch that cannot work (reverts on error).
- **R4.** Untracked state: 0054-0064 and their tests/rollbacks/docs exist only in the working tree (OneDrive-synced, not in git). See the preservation proposal in the chat report.
- **R5.** No rollback file exists for 0061 (unchanged from §6).

### 11.9 Evidence integrity (not modified)

SHA-256 at the time of this addendum, so any later change is detectable:
- `docs/MIGRATION_VERIFICATION_EVIDENCE_2026-10-21.md` `44408c04…6c9c423`
- `supabase/diagnostics/ledger_repair_effects_catalog_READONLY.sql` `668df695…a558a`
- (this review, before this addendum) `9e0ca55a…84`
The evidence file still says 0064 is "not reviewed here"; that is a true statement of its snapshot and was left alone. This addendum is the review it points to.
