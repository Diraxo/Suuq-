# Identity, listing ownership and admin Businesses — finalization (2026-10-22)

Local work only. Nothing here was committed, deployed or applied; no migration was run against any real database and no migration-ledger entry was touched. Two new migrations (0070, 0071) were added **unapplied**; migrations 0054–0069 and every untracked file were left as they were.

## 1. What changed

| Area | Change |
|---|---|
| `supabase/migrations/0070_owner_mark_sold_guard.sql` (+ rollback) | `mark_listing_sold` no longer works on a staff-**removed/deactivated** listing or for a suspended/banned owner. Independent of 0054–0069 (needs only 0029/0039). |
| `supabase/migrations/0071_admin_business_directory.sql` (+ rollback) | `admin_list_businesses()` read-only directory RPC (admin only) and a **no self-moderation** check on `admin_set_storefront_status` / `admin_revoke_storefront_verification`. Needs 0054. |
| `web/src/components/AdminBusinessDirectory.tsx`, `web/src/app/admin/businesses/page.tsx`, `web/src/lib/storefrontAdmin.ts`, `web/src/services/storefrontAdmin.ts` | The Businesses tab now has **All businesses** (new) and **Verification requests** (the existing queue, unchanged behaviour). |
| `lib/profileIdentity.ts` (+ identical web copy) | `rowPresentation()` for bulk rows; a business-presented listing whose business is no longer public no longer falls back to the **personal phone**. |
| `app/business/bulk-upload.tsx`, `components/BulkQueuePanel.tsx`, `web/.../bulk-upload/page.tsx`, `web/src/components/BulkQueuePanel.tsx` | A bulk batch keeps the presentation it was queued with (stored in each row's payload). |
| 11 files (chat, offers, reviews, followers, blocked, mobile + web) | Removed `active_mode, business_name, business_logo_url` from the joined `profiles(...)` selects (see 6.3). |
| Tests | `supabase/tests/owner_listing_business_admin.test.mjs` (new DB suite, in `run-all.mjs`), `tests/ownerListingBusinessAdmin.test.ts` (new), `tests/webTranslation.test.ts` (staff-only list). |

## 2. Identity audit (Task 1)

Verified against the real migration chain (not assumed):

* **One account.** Mode switching only calls `set_active_mode()`, which updates one column. Account count, storefront count, listing `user_id`, `seller_presentation`, chat, reviews and follows are byte-identical after five switches (suite check 1).
* **Business tools in Personal mode.** Neither the mobile menu (`app/(tabs)/profile.tsx`) nor the business dashboard, storefront editor, My Listings or listing edit (mobile and web) read the active mode (source test).
* **No auto-publication.** A draft storefront stays draft; `set_active_mode('business')` is refused while the profile has no business name, and with 0054 the profile only has one while the storefront is **published and in good standing**. A suspended storefront flips the account back to personal, cannot be re-entered by switching, and cannot be republished by the owner. Reinstating restores the exact previous state (a draft stays a draft). (checks 2–4)
* **Publication ≠ verification ≠ account restriction.** Three different columns: `storefronts.status`, `storefronts.verification_status`, `profiles.account_status`. Publishing does not verify; approving verification does not publish; owners cannot write either (check 5).
* **Business branding only where explicit.** Listing seller blocks follow `listings.seller_presentation`; chat, offers, reviews, followers and blocked lists use `accountPerson` (personal name/photo) only.

Defects found and fixed:

1. **Privacy fallback.** A listing published as the business, whose business later became non-public (unpublished/suspended), fell back to the personal identity **including the personal phone**, although the owner never opted in. The fallback keeps name/photo (the accountable person) but only shows the phone if `business_phone_public` is on.
2. **Bulk batches could split.** The queue panel read the *current* mode when each row was published, so switching mode while photos were being processed produced a mixed batch. The presentation is now written into every row when the batch is queued; rows queued by an older build fall back to the current mode (previous behaviour).
3. **Client broken before 0064.** The person-centred joins selected `profiles.active_mode`. On a database without 0064 (production today) PostgREST rejects an unknown column and the whole list fails (chat, offers, reviews, followers, blocked). `accountPerson` needs only name and photo, so the extra columns were dropped. Pinned by a test.

Not changed (decision needed, see 8): a listing's presentation cannot be edited after publishing (no UI); `start_business_conversation` (0066) still requires the business to exist.

## 3. Listing management and removal (Task 2)

### What exists (verified)
* Authorization is **server-side**: RLS `for update/delete using (auth.uid() = user_id)`, with-check on insert; staff-only `removed`/`deactivated` transitions and a freeze on removed listings for client writes (0027/0039); suspended/banned owners cannot write (0039). Edit, mark sold and delete work identically from either mode (suite check 9); other users and anonymous callers can edit, delete, sell, reassign or forge nothing (check 10); removing one listing leaves the account, storefront, verification and other listings (check 11).
* "Sold" is the only closing state (`mark_listing_sold` RPC, which also closes pending offers). There is **no "rented" state**; a rental is closed with the same action. A "Mark as rented" label for property-for-rent listings would be a copy change on top of `sold`; not done, awaiting your decision.
* There is **no owner archive**. "Remove/Delete" is a hard `DELETE` (best-effort R2 cleanup first). Staff removal uses `status = 'removed'` and keeps the row.

### Defect fixed: `mark_listing_sold` bypassed moderation (0070)
It is `SECURITY DEFINER`, so the `current_user`-keyed guards (`is_client_write()`) never fire inside it. An owner could call it on a listing staff had **removed** and turn it into a publicly visible **sold** listing; a suspended owner could also use it. Reproduced on the old body (rollback SQL applied: status `removed → sold`), refused after 0070.

### Known gap, NOT changed: owner delete destroys chat history
`conversations.listing_id` is `ON DELETE CASCADE` (0005), `messages.conversation_id` too. Deleting a listing therefore deletes every conversation and message about it, for the **buyer as well** — contrary to "removing a listing cannot delete conversation history". The confirm dialog only says "This can't be undone." Reports are unaffected (`target_id` is text and 0047 snapshots evidence at report time), offers and favourites cascade. Pinned by suite check 12 so a fix has to update it.

**Proposed safe implementation (needs your decision; not built):**
1. Add an owner-writable `archived` status (available ⇄ archived), hidden from the public read policy and from feeds, visible to the owner. The app's "Remove" becomes archive; nothing cascades.
2. Keep a permanent delete only through a `SECURITY DEFINER` RPC that refuses when the listing has any conversation, offer or open report, or after a retention window decided by you.
3. Do **not** simply switch the FK to `ON DELETE SET NULL`: 0066's partial unique index `(buyer_id, seller_id) where listing_id is null` would make the delete fail as soon as one buyer has talked to one seller about two deleted listings.
4. Account deletion keeps its own ledger-based flow (0055); unaffected.

## 4. Business contact privacy (Task 4)

**Finding: the toggle protects nothing at the API level.** `profiles` has the policy `"profiles are publicly readable" using (true)` (0001) and no column restriction; Supabase grants the API roles every column. Anonymous callers and any signed-in user can read `profiles.phone` **and `profiles.email`** of any account whatever `business_phone_public` says, and the feed loaders do `profiles.select('*')` for every seller. `business_phone_public` only controls what **our UI chooses to show**. This is pinned by suite check 15 (as anon and as another user, including `select *`). The privacy-policy and settings copy should not describe the toggle as protection until this is fixed. The pre-existing sign-in email exposure is wider than the phone question and predates this work.

**Not implemented**, because a safe fix cannot be validated locally without breaking the shipped clients (every `select('*')` on `profiles` would start failing with "permission denied for column"). Exact change needed:

1. `revoke select on public.profiles from anon, authenticated;` then `grant select (<every column except email, phone, phone_country and other private columns>) on public.profiles to anon, authenticated;` (0038 explains why a plain column REVOKE is inert on Supabase).
2. Own private data through `get_my_private_profile()` (or a `security_invoker` view filtered to `auth.uid()`), used by the edit-profile screens and auth bootstrap.
3. `contact_phone_for_listing(p_listing uuid)` / `contact_phone_for_conversation(p_conversation uuid)`, `SECURITY DEFINER`, signed-in only, not blocked either way, rate-limited, returning the phone only when the listing is personal (today's behaviour) or `business_phone_public` is true; the chat and listing "Call" buttons call it instead of reading the column.
4. Replace `select('*')` on `profiles` with an explicit public column list in `lib/homeFeedApi.ts`, `lib/listingsApi.ts`, `lib/searchApi.ts`, `web/src/services/listings.ts`, `web/src/services/profile.ts`, `web/src/services/admin.ts` (staff email through a staff RPC).
5. `profiles` is in the Realtime publication (0064 relies on it): it would broadcast the full row to subscribers; use a publication column list (Postgres 15+) or move the private columns to a `profile_private` table.
6. Ship the client release **first**, apply the migration after, because the old clients break the moment the grant changes.

## 5. Admin Businesses tab (Task 3)

* The tab already existed for verification requests (0054). It could not show a business that never asked for verification, a draft or a suspended one, nor owner, listings or reports. **All businesses** (default) now lists every storefront, newest activity first, pending verification first; filters for publication state, verification state and name / owner name / **owner account id**. Each row: business name, publication badge, verification badge (separate words: "Published" vs "Verified"), owner name and stable account ID, owner account status, active listing count, open reports (on the account and on the owner's listings) with links to the account and reports pages. No phone, email or documents.
* Actions reuse the existing authorized RPCs through the existing reason + confirm dialog (`AdminActionModal`): Suspend / Reinstate (publication), Remove verification, and **Review verification request**, which opens the existing audited review where documents are viewed (via the verification-document function) and Approve/Reject happen. Approval of verification stays only in that flow.
* Authorization is in Postgres: `staff_can('business_review')` = admin only; moderator, support, owners and anonymous callers are refused (check 7). The layout gate and the UI are UX only.
* **No self-moderation:** `decide` already refused the owner (0054); 0071 adds the same refusal to suspend, reinstate and remove-verification. The UI shows no action buttons on your own business.
* Audit and ownership: nothing here writes or reads other than through the existing audited RPCs; the directory is read-only and creates no account or storefront (check 8).
* Everything depends on 0054 + 0071 being applied and on `STOREFRONTS_ENABLED`; before 0071 the tab says it is not available and the request queue keeps working.
* Not built: a staff **publication-approval** step. Publication is owner-driven by design (0054); staff can suspend and reinstate. If you want "awaiting review before going public", that is a new state machine and a product decision.

## 6. Migration readiness (Task 5)

### 6.1 What each one does
| | Changes | Existing data touched |
|---|---|---|
| **0054** | Creates `storefronts` (+ view `public_storefronts`, verification tables/bucket, RPCs, mirror triggers). `storefronts` becomes the source of truth; `profiles.business_*` becomes a mirror that is **cleared** unless the storefront is published and the owner in good standing. | Every profile with meaningful `business_*` data gets a **draft** storefront; original values copied to `storefront_legacy_snapshot`; then cleared from `profiles` (so they stop being public). Nothing is published or verified. |
| **0064** | `profiles.active_mode`, `set_active_mode()`, guard trigger (a blank business name forces `personal`). Backfill: profiles with a business name → `business`. | Existing business owners. |
| **0068** | `listings.seller_presentation`, `profiles.business_phone_public`, guard trigger. Backfill: listings of owners with `active_mode='business'` **and** a business name → `business`. | Listings of business owners. |
| 0070 | `mark_listing_sold` hardened. | None. |
| 0071 | Directory RPC; self-moderation checks. | None. |

### 6.2 Order matters — measured, not assumed
Experiment on the real files (PGlite, from the 0053 state, one business owner with 2 listings, one personal user):

| Order | Owner's `active_mode` | Listings' stored presentation | Storefront / profile name |
|---|---|---|---|
| 0054 → 0064 → 0068 (numeric) | personal | **personal ×2 (business presentation lost)** | draft kept; `business_name` cleared; snapshot kept. After the owner publishes: name back, listings stay personal |
| **0064 → 0068 → 0054** | personal (mirror clears name, guard flips) | **business ×2 kept** | draft kept; snapshot kept. After the owner publishes: name back and the two listings show the business again; the owner picks Business mode themselves |
| 0064 → 0068 (no 0054) | business | business ×2 | none |

So **the 0068 backfill is correct only if it runs while `profiles.business_name` still holds the legacy value** (before 0054). In numeric order it silently matches nobody, and the loss is permanent unless repaired by hand. Unpublished storefronts are preserved in every order (draft row + snapshot); what 0054 changes is that they are no longer public until the owner publishes. 0064's own header ("business owners keep showing business") is true only without 0054 (already recorded as decision E).

### 6.3 Client compatibility (new client vs database state)
| Database lacks | What happens |
|---|---|
| 0064 | `set_active_mode` missing → the switch fails and rolls back; display falls back to "business if it has a business name". Joined lists were **broken** by explicit `active_mode` selects; fixed this session. |
| 0068 | Reads fine (`select('*')`). Personal publishing works (column only sent for business). **Publishing a business-presented listing fails** (unknown column); the phone toggle write fails with a generic error. |
| 0054 | Storefront UI is behind `STOREFRONTS_ENABLED`; no gold badge; admin tab hidden. |
| 0071 | Directory shows "not available"; queue unaffected. |
| 0070 | The `mark_listing_sold` bypass remains. |

### 6.4 Recommended sequence
1. **0070** alone, any time (needs only 0029/0039, independent of the chain; closes a live moderation bypass).
2. **0064 → 0068** (in this order, back to back, **before** 0054) with the shipped client that has the switch.
3. **0054** with the storefront client live and the media-host allowlist filled (existing launch gates, unchanged). Existing business owners then see "draft" and must publish; tell them in advance.
4. **0071** after 0054.
5. Not before the ledger question is settled: production's ledger is at 0045 with 0046/0047/0052/0056/0060 present but un-ledgered (see `docs/MIGRATION_VERIFICATION_EVIDENCE_2026-10-21.md`); 0054–0069 are also still untracked in git. I did not touch either.

### 6.5 Verification plan (read-only first)
Before: counts of profiles with a business name; listings per such owner; `select count(*)` of profiles with `business_name` and not `active_mode`. After each step on staging: same counts; `count(*) filter (where seller_presentation='business')` must equal the listings of owners that were showing business; zero storefronts with `status<>'draft'` right after 0054; `storefront_legacy_snapshot` count = storefronts count; mode-switch smoke test as a business owner; as a personal user the feeds, chat and offers load. Then 0070: removed listing → `mark_listing_sold` refused.

### 6.6 Rollback limits
* 0054: `rollback/0054_rollback_restore.sql` restores only owners who were **never published**; published storefront edits since are exported, not merged.
* 0064: dropping `active_mode` loses who was in which mode (harmless; defaults to business-if-named).
* **0068: dropping `seller_presentation` permanently loses every listing's stored business/personal choice.** Export `(id, seller_presentation)` before running it.
* 0070 rollback re-opens the bypass. 0071 rollback drops the directory and the self-moderation checks; no data.

## 7. Tests and checks (actual results)

| Check | Result |
|---|---|
| `npm test` (703 existing + new) | **704 tests, 704 pass** |
| DB suites `run-all.mjs`, 32 suites incl. new `owner_listing_business_admin` (15 checks) | **32 of 32 suites pass** |
| `tsc --noEmit` mobile (root) | clean |
| `tsc --noEmit` web | clean |
| `next lint` on the touched web files | one pre-existing warning (`BulkQueuePanel` hook deps) |
| `eslint` touched mobile files | one **pre-existing** error (`app/chat/[id].tsx` set-state-in-effect); none new |

**Coverage added:** mode switching with a stable account id and unchanged chat/review/follow history; presentation persistence across switches; edit/sell/delete from both modes; cross-user and anonymous denial; removed-listing and suspended-owner bypass; publication vs verification; self-verification and self-moderation refused; admin directory authorization (owner, user, moderator, support, anonymous), contents and read-only behaviour; bulk presentation frozen per batch (pure + mobile/web source parity); person-centred selects free of post-migration columns; contact exposure characterization; two intentional "known gap" tests (chat cascade, profile exposure).

**Visual testing was not done.** No browser session or device was driven; the admin directory, the bulk queue and the profile switch have not been looked at on screen. Everything above is type-checked, unit-tested and DB-tested only.

## 8. Needs your decision / approval
1. Apply order and timing in 6.4 (nothing was applied).
2. Safe-removal design in section 3 (archive status, permanent-delete conditions, retention window) — and whether the confirm text must warn about chats meanwhile.
3. Privacy fix in section 4 (breaking change for old clients; needs a coordinated release) and whether to say anything in the policy/UI in the meantime.
4. "Mark as rented" wording for property-for-rent listings.
5. Whether business listings should be editable between personal and business after publishing.
6. Whether publication needs a staff approval step.
7. Whether 0068's backfill should be made order-independent (read `storefront_legacy_snapshot`) instead of fixing the order.
8. Pre-existing: `app/chat/[id].tsx` lint error, `BulkQueuePanel` hook-deps warning.

## 9. Confirmation
No migration was applied or repaired, no ledger entry changed, no remote write or deployment, no commit, no release. The only database used was the in-memory PGlite harness. The 0054–0069 files and all untracked work are as they were; the only existing migration-adjacent edit is adding the new suite to `supabase/tests/run-all.mjs`.
