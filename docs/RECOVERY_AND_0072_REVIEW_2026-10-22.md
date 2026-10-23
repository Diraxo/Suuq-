# Source recovery + 0072/0073 review — 2026-10-22

Scope: steps 1–4 of the execution order (preserve, recover, baseline, review). **Nothing was applied to any database; the migration ledger was not touched.**

## 1. Preservation
Everything is in `C:\Users\abdir\Desktop\suuqplus-preserve-2026-10-22\` (outside OneDrive):
`uncommitted.diff` (git diff --binary, 1.2 MB), `status.txt`, `untracked/` (all 196 untracked files, paths preserved) + `untracked-list.txt`,
`*.CORRUPT-NUL*` copies of the three damaged files, `saved-searches.HEAD.tsx`, and the baseline outputs.

## 2. Damage found (larger than reported)
The "blank" file is not zero-byte — it is **all NUL bytes** at its old length (OneDrive/sync corruption signature). A NUL scan of every modified/untracked file found **three**:

| file | corrupt size | HEAD size | uncommitted work lost? |
| --- | --- | --- | --- |
| app/saved-searches.tsx | 3986 | 3920 | +66 bytes of edits |
| app/post/details.tsx | 14905 | 13682 | +1223 bytes (sell-usability work) |
| app/post/price.tsx | 7529 | 6902 | +627 bytes (rental rent label/hint) |

No other NUL/empty files in the 407-entry tree. Claude Code file-history held no snapshot of any of them; no other copy exists on disk.
**Stopgap applied:** all three restored from HEAD (backups above). The pre-corruption versions are only recoverable from **OneDrive version history** (onedrive.live.com → file → Version history, or right-click in Explorer). Restore those over the stopgap if available.
Evidence the HEAD copies are not equivalent: `tests/sellFlowUsability.test.ts` expects `titlePlaceholderText(t, category, subcategory)` in `details.tsx`, which exists only in the lost version.

## 3. Baseline (with HEAD stopgaps)
- `tsc --noEmit` root: clean. `web` tsc: clean.
- `npm test`: 733/734 pass; sole failure = the lost `details.tsx` edit above.
- Database suites (PGlite, real migration chain): **33/33 pass**.
- Not run: `next build`, lint, device/hosted checks.

## 4. Review — 0072 (private phone)
Good: private table with RLS and no grants; numbers moved then public column nulled; BEFORE trigger diverts every legacy write path; NULL writes ignored (old builds can't erase numbers); reads only via authenticated, security-definer functions; blocked/inactive denied; anon has no execute. Realtime is covered by design — `profiles` IS in `supabase_realtime`, and the row now carries NULL.

Findings to resolve before applying:
1. **Harvesting via `personal_profile` context.** Any signed-in account can fetch any user's personal number given only a user id (ids are public), 200/hour/account, accounts are free. Better than today (anonymous bulk read) but not "authorization". Recommend: drop `personal_profile`, or require a relationship (live listing → already the `listing` context), and lower the cap (e.g. 30–60/h). **Needs owner decision.**
2. **The "never an error" header claim is false**: `enforce_rate_limit` raises when exceeded. Clients must handle the error, not only NULL.
3. **Staff alert regression (0060):** phone changes no longer differ in `profiles` (always NULL), so "profile edited: phone" alerts stop firing.
4. **Old builds:** `details.tsx`/`listing/edit` read `profile.phone`; on old builds that is now NULL, so every listing re-asks for the phone (works, stored privately on publish). Acceptable, but expect support questions.
5. **Backups/PITR/WAL retain the old numbers**; dead tuples persist until vacuum. Not API-reachable; state it honestly in any privacy statement.
6. `admin_listing_detail` (0041) now returns NULL phone for staff — matches the note, no admin screen uses it.
7. Rollback exists (`supabase/rollback/0072_…_ROLLBACK.sql`, copies numbers back) — requires the private table to still exist, so rollback must precede any cleanup.

Hosted verification still required (none done): `private` schema not in PostgREST exposed schemas; `REPLICA IDENTITY` of `profiles` is still default (FULL would put old-row values in Realtime for the migrating UPDATE); anon/authenticated cannot `select` private.profile_phones; `get_contact_phone` as anon → 401/403; live Realtime frame shows no phone.

## 5. Review — 0073 (image hashes)
Additive, idempotent, NOT VALID check, metadata-only column default. But: **unrelated to privacy — do not bundle with 0072**; **no dedicated test suite** (only incidental mentions in `image_scans.test.mjs`; the 33 suites do not exercise 0073's trigger/constraint); no `begin/commit` (idempotent, so a partial failure is re-runnable); it must be applied before any build that sends `image_hashes`, otherwise publishing fails. Hold until a test is written.

## D3 — emails
`profiles.email` is populated by the signup trigger (0001, 0059) and is publicly readable. Same class of problem as phone; not fixed by 0072. A separate migration (same divert-to-private pattern, or column-limited view) and an audit of every client that selects `*` from `profiles` is needed; staff screens (`coalesce(sp.full_name, sp.email)` in 0041) must be preserved. Not started.

## Held / unchanged
0054, 0055, 0057–0059, 0062, 0071 remain on hold. No `db push`. Notification-function drift still needs its own migration plan.
