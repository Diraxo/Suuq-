# Production verification evidence — migrations 0046, 0047, 0052, 0056, 0060

**Read-only. Nothing was repaired, applied, deployed or changed.** This is evidence for a later, separately approved decision; it does not authorise the ledger repair.

| | |
|---|---|
| Project ref | `waksddinkjbrggxkfofk` (from `supabase/.temp/project-ref`) |
| Production snapshot | 2026-10-21 18:30:29 UTC (`now()` in the result), database `postgres`, PostgreSQL 17.6 |
| Ledger listing | `supabase migration list --linked`, same session, ~18:30 UTC |
| Expected-state build | 2026-10-21 18:31 UTC, PGlite (PostgreSQL 16.4) from `supabase/migrations`: 0001-0035, 0037-0045, then **only** 0046, 0047, 0052, 0056, 0060 |
| Method | `supabase db query --linked -f supabase/diagnostics/ledger_repair_effects_catalog_READONLY.sql`. A single `SELECT` over system catalogs plus 9 count queries. A keyword scan found no INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/GRANT/REVOKE/TRUNCATE in the file. One earlier run failed on a SQL type error before returning anything; it changed nothing. |

## Result

407 rows compared (prod vs expected). **375 identical, 0 present on only one side, 32 differ — every difference explained below.**

Compared and matching: **142 columns** (type, nullability, default), **77 constraints** (definition and validated flag), **46 indexes**, **33 policies** (command, roles, USING, WITH CHECK), **43 triggers** (definition and enabled state), **34 functions** (security-definer flag, `search_path`, ACL), **15 tables** (RLS on/off), **7 Realtime publication memberships**. No expected function is missing, and no trigger from these migrations exists on a table outside the compared set.

### The 32 differences — all explained, none a schema discrepancy

| Count | Difference | Explanation | Resolved? |
|---|---|---|---|
| 11 | Function body hash (0046 ×9 incl. `handle_new_message`, `edit_message`, `delete_message`; 0056 ×2) | Full text diffed: **identical apart from carriage returns**. Prod bodies contain `\r` (applied from the CRLF files); the PGlite copy has none. | Yes — verified by text diff, not assumed |
| 15 | Table ACL | Prod PostgreSQL 17 shows the extra `m` (MAINTAIN) privilege; the PostgreSQL 16 expected build cannot. Same grantees otherwise. | Yes (version artefact) |
| 1 | Index `listings_title_trgm_idx` | `gin_trgm_ops` vs `extensions.gin_trgm_ops` (schema qualification of the extension). | Yes |
| 1 | Snapshot meta | Different database/version/time, by design. | Yes |
| 4 | Row counts | Real production data (below), not schema. | n/a |

Note on the earlier audit: it said function bodies matched. This run confirms that **and** that the non-function effects (columns, `notifications` 4 new columns + `notifications_push_status_check` + `notifications_dedupe_idx`, policy replacement on `notifications`/`messages`/`conversation_participants`, 0056's NOT VALID checks `profiles_{business_name,business_description,business_address,business_website,city}_length`, all triggers, grants) are present.

### Backfill and data observations (prod)

- `reports` 4, `report_admin` 4, reports without a `report_admin` row **0** → the 0047 backfill is complete.
- `block_events` 5, `suppressed_messages` 0, `report_notes` 0, `web_push_subscriptions` 0, `notifications` with a dedupe key 1.
- Profiles violating the 0056 length limits: **0** (so VALIDATE would pass today; not done).
- Ledger: remote versions end at **0045** (44 versions; 0036 absent by design). Local-only: 0046-0064.

## What this does and does not establish

Established (as of 18:30 UTC): for these five versions, the production schema matches what the local files produce on a fresh database, for everything in the compared scope.

**Not established:**
- Anything outside the compared tables/functions (e.g. an extra, unrelated production object is not shown — the scope was the objects these migrations touch).
- That the local files equal what was originally run; only that the resulting state is equivalent.
- Row *content* beyond the counts above (e.g. contents of the policies' effect on real sessions, grants through PostgREST, Realtime delivery).
- Time after 18:30 UTC. A re-run (about a minute) is advised immediately before any repair.
- A `MAINTAIN`-privilege or PG-version difference was treated as benign; it was not tested further.

## New findings during this run (outside the five migrations)

1. **A migration 0064 now exists locally** (`0064_profile_active_mode.sql`, created 2026-10-21 ~21:28 local time during this session). It was not in the sequencing review. It adds `profiles.active_mode`, `set_active_mode()` and a guard trigger; says it needs 0038 only; is unapplied. **Not reviewed here** — the dependency graph and trigger-order analysis do not yet include it.
2. **Migrations 0054-0063 are untracked in git** (`git status` shows `??`). They exist only on this machine/OneDrive. If the working tree is lost, the migration chain is lost. Committing them (on a branch) is a low-risk protective step, separate from any production action.

## Decision this evidence supports (still requires explicit approval)

If approved, ledger repair for 0046, 0047, 0052, 0056, 0060 is **justified by the evidence for schema state** and would be metadata-only. Order: 0052 before 0060. Re-run the query immediately beforehand, and take the Stage-0 backup/PITR confirmation first.
