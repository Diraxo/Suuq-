# Search, Discovery, Listing Moderation & Support — requirements checklist and runbook

Status legend: **PASS** = proven by a test that actually ran (named below). **BLOCKED** = cannot be proven without real
Supabase / R2 / a device / production; each has the exact next action. **FAIL** = none at the time of writing.

> **Scope note.** This session did not have the text of the *original* brief — only the approval message ("Phase 0
> audit accepted…") and the project memory. The checklist below is built from every requirement in that message. Diff it
> against the original brief before sign-off; anything in the original that is not listed here was not tracked.

Nothing was deployed, committed, built for release, or applied to a real database. All SQL was run against a disposable
in-memory PostgreSQL (PGlite = real PostgreSQL compiled to WASM) with the **real** migration chain 0001→0041.

## How to reproduce every result

```
# unit + contract tests (233)
npm test

# database suites (5 suites, 131 checks) — needs a scratch PGlite install, no network after install
mkdir <scratch> && cd <scratch> && npm init -y && npm i @electric-sql/pglite
PGLITE_DIR=<scratch>/node_modules/@electric-sql/pglite node supabase/tests/run-all.mjs

# type checks (the root tsc also compiles web/ with the wrong alias — filter as below, see AGENT.md/memory)
npx tsc --noEmit -p tsconfig.json | grep -E "^(app|lib|store|components|hooks|types)/"     # expect no output
cd web && npx tsc --noEmit                                                                  # expect no output
cd web && npx next build                                                                    # expect exit 0
```

## Phase results

| Phase | Result | Evidence |
|---|---|---|
| 0 — audit (accepted) | done earlier | — |
| 1a — functional filters & discovery UX | **PASS** (device visuals BLOCKED) | `tests/searchFilters.test.ts`, `supabase/tests/discovery.test.mjs` (36) |
| 1b — scalable server-side search | **PASS** for search (production-scale timing BLOCKED); Home/category feeds are a documented follow-up | discovery #33–34, contract test |
| 2 — moderation dashboard | **PASS** (visual check BLOCKED) | `dashboard.test.mjs` (25), `next build` |
| 3 — enforcement | **PASS** | `moderation.test.mjs` (39), `baseline.test.mjs` (4) |
| 4 — support & appeals | **PASS** | `support.test.mjs` (27) |
| 5 — real-time | logic **PASS**; live Realtime delivery BLOCKED | `tests/moderation.test.ts`, dashboard #15–21 |
| 6 — security / scale / regression | **PASS** with findings below; production checks BLOCKED | all suites |

## Acceptance checklist

### Verified
| # | Requirement | Result | Evidence |
|---|---|---|---|
| V1 | Backed by persisted `profiles.verified_at` | PASS | discovery #3–8; `0038` |
| V2 | Only authorized staff grant/revoke; who/when/reason in an audit trail | PASS | discovery #4–9 (non-admin 42501, reason required, `profile_verification_events` + `admin_audit_log`); moderation #4 (moderators cannot verify) |
| V3 | Existing sellers are never auto-verified | PASS | discovery #3 (count = 0 after migration) |
| V4 | No claim that a phone/ID was checked | PASS (code review) | admin modal copy (`admin/users/[id]`, `admin/listings/[id]`), `verification.status.*` strings in en/so/am. **See finding U-1.** |
| V5 | Filter and badge wired to real data | PASS (filter), PASS-by-wiring (badge) | discovery #23; `profileToSeller` reads `verified_at` (test "filter labels exist…"); badge render on a device BLOCKED |

### Boosted today
| # | Requirement | Result | Evidence |
|---|---|---|---|
| B1 | `listing_boosts`: listing, start, end, source, granting actor | PASS | `0038` table; discovery #17–22 |
| B2 | Admin-granted only, no payment flow | PASS | `source` check allows only `admin_grant`; grant RPC admin-only (moderation #4) |
| B3 | `Africa/Addis_Ababa`; exact meaning defined | PASS | discovery #16 (SQL == TS at the midnight boundary); definition in `0038` header |
| B4 | Must be eligible and publicly visible to appear | PASS | discovery #22 (removed can't be boosted), #30; moderation #18 (removal revokes boost) |
| B5 | Not confused with "posted today" | PASS | unit test "Boosted today and Posted today are distinct"; discovery #23 matrix has both dimensions |

### Price reduced
| # | Requirement | Result | Evidence |
|---|---|---|---|
| P1 | Latest qualifying decrease within 14 days | PASS | discovery #23 (ages 3/13/15 days), unit "14-day window" |
| P2 | Recorded from explicit drop **and** normal edits | PASS | discovery #10 (plain UPDATE), #13; both edit screens now do one atomic update (unit contract) |
| P3 | Unchanged / increase / currency-only change not recorded | PASS | discovery #11, #12 |
| P4 | Uses existing `price_drops`; consumers inspected | PASS | consumers: `notify_on_price_drop` (fires once, discovery #13), Home "Price drops" tab, insights — all read-only; client INSERT policy removed |
| P5 | Mobile and web use the same rule | PASS | one SQL function; byte-identical `searchFilters.ts` (parity test) |

### Negotiable
| # | Requirement | Result | Evidence |
|---|---|---|---|
| N1 | Strictly the persisted `listings.negotiable` | PASS | discovery #23 |

### Filter interaction
| # | Requirement | Result | Evidence |
|---|---|---|---|
| X1 | All start OFF | PASS | unit "all filters start OFF…" |
| X2 | Independent toggles | PASS | same |
| X3 | AND logic | PASS | discovery #23: **all 32 combinations** equal the TS reference set, across pages |
| X4 | Preserve query, category, location | PASS | discovery #27, #29; unit "toRpcParams preserves…" |
| X5 | Debounce | PASS (logic) / BLOCKED (feel on device) | `SEARCH_DEBOUNCE_MS` used by both screens (contract test) |
| X6 | Stale-request protection | PASS | unit "a stale (older-ticket) response never overwrites a newer search", "changing a search keeps old results…" |
| X7 | Pagination | PASS | discovery #33 (130 rows incl. identical timestamps, no dup/gap); unit "load more appends…" |
| X8 | Professional empty states with real, eligible recommendations | PASS (logic) / BLOCKED (visual) | unit "empty-state recovery…"; recommendations come from the same eligible-only RPC |
| X9 | Mobile ≡ web results | PASS | same RPC, byte-identical logic, contract tests |

### Phase 1b — server-side search
| # | Requirement | Result | Evidence |
|---|---|---|---|
| S1 | Indexed server-side filtering + pagination | PASS | discovery #34 (trigram GIN, partial feed / negotiable / price-drop indexes used) |
| S2 | Never fetch-all-and-filter for search | PASS | contract test "both search screens are server-side…" |
| S3 | Uses the existing backend architecture | PASS | Supabase RPC under RLS (`SECURITY INVOKER`) |
| S4 | Scales | PASS at ~6k rows (dashboard INFO line: ≈40 ms/page); **BLOCKED** at production size | Next action: `EXPLAIN (ANALYZE, BUFFERS)` of `search_listings` on the real DB after migrating |

### Phase 2 — dashboard
| # | Requirement | Result | Evidence |
|---|---|---|---|
| D1 | Images + details | PASS (data) / BLOCKED (visual) | dashboard #6, #13; `next build` compiles all pages |
| D2 | Seller profile + ratings | PASS | dashboard #13 (rating avg/count, listing counts, warnings) |
| D3 | Reports, status, moderation history | PASS | dashboard #8, #13 |
| D4 | Efficient for thousands | PASS | dashboard #22: 6,004 listings / ~3,000 reports, pages in tens of ms, 100-row cap, indexed lookups |

### Phase 3 — enforcement (all enforced in the database; tests run as the `authenticated` role)
| # | Requirement | Result | Evidence |
|---|---|---|---|
| E1 | Removal | PASS | moderation #6–9, #13 |
| E2 | Reversible deactivation | PASS | #16 (sold → deactivated → sold) |
| E3 | Warnings | PASS | #19 |
| E4 | Temporary suspension with expiry | PASS | #20–27 (end date required ≤365 d; expiry honoured with no cron; `my_account_state` persists it once) |
| E5 | Permanent ban | PASS | #28–32 (hides all listings, exact restore on unban, earlier removal untouched) |
| E6 | Server-side / RLS / RPC, not UI-only | PASS | #3–5, #13, #21–22, #29; baseline #2–4 proves the old column-REVOKE gap and the fix |
| E7 | Audit records | PASS | #11, #19, #33 |
| E8 | Seller-visible notices | PASS | #9, #31; RLS #10 |

### Phase 4 — support & appeals
| # | Requirement | Result | Evidence |
|---|---|---|---|
| C1 | Persistent cases | PASS | support #3–4 |
| C2 | Seller conversations, replies, status | PASS | #8–10 |
| C3 | Listing-linked appeals | PASS | #15–20 |
| C4 | Authorized restoration | PASS | #16–18 (support role and the seller cannot decide; approval restores the exact status), #22–23 (suspension by a moderator, ban by an admin only) |
| C5 | Public identity "Suuqiye Support Team", never "admin" | PASS | support #8; unit test scans all seller-facing locale strings |
| C6 | No unsolicited message into a conversation | PASS | support #12 (0 chat rows); no staff-initiated RPC exists (unit test) |

### Phase 5 — real-time
| # | Requirement | Result | Evidence |
|---|---|---|---|
| R1 | Changes appear without manual refresh (seller + buyer) | logic PASS / **BLOCKED** (live delivery) | dashboard #15–19 (broadcast payloads emitted), store subscriptions in `store/moderation.ts`, `lib/visibilitySync.ts`. Next action: staging project, two sessions, remove a listing, watch both clients |
| R2 | Stale caches | PASS | `hidden_listing_ids` (dashboard #20) + reconcile on connect/foreground (unit) |
| R3 | Reconnects | PASS | unit "every (re)subscribe reconciles…" |
| R4 | Duplicate / out-of-order events | PASS | unit "gate drops duplicate and out-of-order events" |
| R5 | Removed listing gone from results, feeds, recommendations, deep links | PASS | RLS (moderation #7), explicit exclusion in every public feed query (contract test), search/recs use the same RPC, card + detail hide on events |

### Phase 6 — security, scale, regression
| # | Requirement | Result | Evidence |
|---|---|---|---|
| H1 | Authorization | PASS | every RPC refuses non-staff / wrong role (moderation #3–5, dashboard #3, support #7) |
| H2 | RLS | PASS | notices / cases / events / appeals read-isolated (moderation #10, support #4, #8) |
| H3 | Indexes | PASS | discovery #34, dashboard indexes in `0041` |
| H4 | Query limits | PASS | search ≤60, admin ≤100 (clamped server-side), `hidden_listing_ids` ≤200 |
| H5 | Image loading | PARTIAL | admin lists use lazy `next/image` with `sizes`; mobile uses `imageUrl(width)`. Originals in R2 are not resized server-side. BLOCKED: measure on a device |
| H6 | Report abuse | PASS | moderation #35–36 (own listing/self blocked, 20/day cap, duplicates, bounded text) |
| H7 | Audit history + retention | PASS (policy + function) / BLOCKED (scheduling) | dashboard #23. Next action: schedule `purge_old_support_data()` and `lift_expired_suspensions()` (pg_cron) — correctness does not depend on the latter |
| H8 | Compatibility with existing app versions | PASS (tests) / BLOCKED (old binaries) | see "Compatibility" below; moderation #33 (legacy RPCs), discovery #13 (legacy price-drop flow) |
| H9 | Preserve existing security fixes and uncommitted work | PASS | nothing deleted; every migration is additive; see "Files that already had uncommitted changes" |

## Decisions I made (please confirm)
1. **Boosted today** = a non-revoked admin boost that is live *right now*; grants are whole Addis days (`p_days = 1` ends at the coming Addis midnight).
2. **Price reduced** additionally requires the *current* price to still be below the drop's old price (a seller who raises the price back is not "reduced"). The stated 14-day rule is otherwise unchanged.
3. **Search eligibility** = `available` or `reserved` and publicly visible. **Behaviour change:** sold/expired listings no longer appear in search (the old search returned them).
4. A **"Posted today"** chip was kept (it was a no-op before; now real, Addis day), alongside the new "Boosted today".
5. Roles: `admin` (everything), `moderator` (listings, warn, suspend, reports, support, appeal decisions except bans), `support` (support only). Bans, verification, boosts, locations and the audit log are admin-only.
6. Legacy `admin_set_account_status('suspended')` (no end date) now means a **30-day** suspension.
7. Mock listings (3 demo rows) no longer appear in mobile *search*; Home still merges them as before.

## Findings
**Security**
- **S-1 (high, fixed in 0038/0039):** `REVOKE UPDATE (col)` in 0019/0027 does nothing while the role has a table-level UPDATE grant (Supabase default). Proven on a real engine: a suspended user could set `account_status='active'`; a seller could write `views`/`favorites_count`. Fixed with `BEFORE UPDATE` triggers keyed on `current_user` (baseline #2–4). *BLOCKED:* confirm the grants on the real project: `select grantee, privilege_type from information_schema.role_table_grants where table_name in ('profiles','listings');`
- **S-2:** `profiles` is publicly readable, so `account_status`, `suspended_until` and `verified_at` are public. Ban/suspension status is therefore public. Fix if undesired: move to a private table + view.
- **S-3 (mitigated):** the visibility broadcast topic is public, so any client can publish to it. Clients treat it as a hint and confirm with `hidden_listing_ids()`; unit test "a forged hidden broadcast cannot hide a live listing".
- **S-4:** after removal the listing's R2 images stay reachable by direct URL (public bucket). Deleting them would destroy appeal evidence. Needs a product decision (e.g. private bucket / signed URLs).
- **S-5:** `fursad.admin_write` and `suuqplus.skip_rate_limit` bypass GUCs are safe only because API roles cannot call `set_config`. `skip_rate_limit` also skips the suspension gate. Don't expose any function that sets them.
- **S-6:** `moderation_events` cascade-delete with the account; a banned user who deletes their account erases the trail. Consider a tombstone (hashed email) before deletion.
- **S-7:** price-badge gaming (raise to 1000, drop to 900) is still possible; mitigation options: ignore drops within N days of a raise, or compare to a 30-day max.

**Compatibility (deploy order: migrations first, then clients)**
- Old clients keep working: search/Home/detail unchanged; their `price_drops` INSERT is now refused but they ignore the result (verified in code) and the trigger already recorded the drop; 0027 admin RPCs keep their signatures.
- Old mobile "My Listings" has no tab for `deactivated`, so those listings vanish from the owner's list until they update. Old web `Profile.account_status` type is looser. Both are display-only.
- Suspended/banned users on old clients see the generic "no permission" message (the server still blocks them).

**UX / scope notes**
- **U-1:** `app/verification.tsx` still has a *local-only* "Mark as submitted → Submitted — pending review" flow for phone/ID/business that persists nothing. I added a truthful status card but did not remove it (it is not mine and would be a UI redesign). Recommend removing the fake flow.
- **U-2:** Home / category / city / favorites / dealer pages still read the global "load everything" listings store on mobile and `fetchHomeFeed()` on web. **Search** no longer depends on it. Paginating those is the next scalability step (touches `homeFeed.ts`/`refreshController` and their tests).
- Staff are created manually (`insert into admin_users(user_id, role)`), as in 0027.

## Checks that need real Supabase / R2 / a device (all BLOCKED, with the exact next action)
| # | Check | Next action |
|---|---|---|
| 1 | Migrations 0038→0041 apply on the real project | Apply to a **staging** project, then re-run `supabase/tests/*.test.mjs` logic against it (or run the SQL asserts by hand) |
| 2 | Default grants (finding S-1) | Run the `role_table_grants` query above |
| 3 | Realtime delivery: broadcast on `listings:visibility`, `postgres_changes` for notices/cases/profiles; `realtime.send` available | Two sessions on staging; remove/restore a listing; watch both |
| 4 | Push of moderation/support notifications | Real device with FCM token on staging |
| 5 | pg_cron for `lift_expired_suspensions()` and `purge_old_support_data()` | Schedule on the real project (optional for expiry correctness) |
| 6 | Visual / interaction QA: search chips, empty states, banners, Under-review tab, support screens, admin pages (390 px / desktop, light/dark, so/am) | Device + browser pass |
| 7 | Production-size search performance | `EXPLAIN (ANALYZE, BUFFERS)` on the real DB |
| 8 | R2 image behaviour after removal (S-4) | Product decision + R2 test |
| 9 | First staff account | `insert into public.admin_users(user_id, role) values ('<uuid>', 'admin');` on the real project (manual, as in 0027) |

## Migrations added (apply in order; rollback in reverse)
| File | Purpose | Rollback |
|---|---|---|
| `0038_search_discovery.sql` | verified, boosts, price-drop recording, protected-column guards, indexes, `search_listings()` | `rollback/0038_search_discovery_ROLLBACK.sql` |
| `0039_moderation_enforcement.sql` | staff roles, deactivation, warnings, suspensions with expiry, bans, events + notices, report abuse limits | `rollback/0039_…` |
| `0040_support_appeals.sql` | support cases/messages, appeals, restoration | `rollback/0040_…` |
| `0041_dashboard_realtime.sql` | dashboard read RPCs, visibility broadcast, `hidden_listing_ids`, retention | `rollback/0041_…` |

Each rollback is tested: the schema fingerprint (columns, function bodies with whitespace collapsed, triggers, policies,
indexes, constraints, realtime publication) after *apply → rollback* equals the one before, and the migration re-applies
cleanly afterwards. Rollbacks are destructive for data created by that migration (stated in each header).

## Post-deploy verification (staging first)
```sql
-- 1. objects exist
select proname from pg_proc where proname in ('search_listings','admin_moderate_listing','admin_moderate_user','staff_decide_appeal','hidden_listing_ids');
-- 2. nobody is auto-verified
select count(*) from profiles where verified_at is not null;            -- expect 0
-- 3. clients cannot self-unsuspend (run as a real suspended test user via the API, expect 42501)
-- 4. a removed listing is invisible to a second account and to anon (both web and app)
-- 5. search: a 4-filter query returns in well under 100 ms; check the plan uses the partial indexes
```

## Files that already had uncommitted changes and that I edited (preserved; changes are additive unless noted)
`app/(tabs)/search.tsx` (rewritten around the same layout; places/recent-search UI kept), `app/(tabs)/home.tsx`, `app/(tabs)/profile.tsx`,
`app/listing/edit/[id].tsx`, `app/my-listings.tsx`, `components/ListingCard.tsx`, `lib/push.ts`, `lib/errors.ts`, `lib/sellerStats.ts`,
`store/listings.ts`, `store/myListings.ts`, `types/index.ts`, `locales/{en,so,am}/translation.json`, `web/src/app/search/page.tsx` (rewritten),
`web/src/app/admin/layout.tsx` (rewritten, role-aware), `web/src/app/listing/[id]/page.tsx`, `web/src/app/listing/edit/[id]/page.tsx`,
`web/src/app/my-listings/page.tsx`, `web/src/services/{listings,profile}.ts`, `web/src/lib/{types,errors}.ts`, `web/src/components/ListingCard.tsx`, `web/src/app/layout.tsx`.
Pre-existing admin pages `admin/page.tsx`, `admin/listings/page.tsx`, `admin/users/page.tsx`, `admin/users/[id]/page.tsx` and
`components/AdminActionModal.tsx` were replaced with versions that keep their behaviour and add the new features.
