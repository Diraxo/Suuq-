# Offline release audit (no staging available) — 2026-10-19

Status: **RELEASE BLOCKED.** No staging Supabase project (free-project limit of 2 reached by Suuq+ and "DAwa's Project"), no Cloudflare login/token, no Vision key, no Docker. Nothing was applied, deployed, committed or pushed. Production was only read (migration tracker, function list, function source download).

## Read-only production facts
- Migration tracker: 0001–0045 applied (0036 absent locally too); **0046–0059 not applied**, so the 0057/0059 drafts were never applied there. Other databases ("DAwa's Project") were not inspected.
- Deployed `r2-presign` (v10) is OLDER than the committed file: no listing, business or avatar gates. Redeploying it reopens direct public-bucket uploads. Deployed `delete-account` (v15) equals the committed HEAD (no ledger).

## Migration review (static + PGlite; not real Postgres)
| Migration | Verdict | Notes |
|---|---|---|
| 0054 | BLOCKED by owner decisions B1–B3 | Backfill creates draft storefronts and the mirror CLEARS `profiles.business_*` for existing business owners; deployed clients show no business section until the owner publishes. `staff_can` copy is identical to 0039. Image trigger order a_guard < b_validate < c_media_scan < z_mirror is correct. No defect found. |
| 0055 | BLOCKED by unknown history only | Leave in place; rollback refuses while any job is open. |
| 0056 | BLOCKED by unknown history (needs 0054 order) | Legacy-host avatar branch is superseded by 0059 (`profiles_c_` runs after `profiles_b_`). Not retroactive (NOT VALID checks). No defect found. |
| 0057 / 0059 | BLOCKED by unknown history; also need `storefront_media_hosts` filled first | Fail closed by default; rollbacks install an unconditional freeze. |
| 0058 | BLOCKED by unknown history; apply only after 0057 | Compare-and-swap apply; external URLs never fetched; rollback must run before 0057's. |

## Open gap confirmed from source
`delete-account` removes only public-bucket keys (avatars/, business/, listings/, wm/listings/). Private originals (`orig-media/{uid}/…`, `orig/{uid}/…`) are neither deleted nor ledgered, and the scan rows that name them cascade away with the profile. Fixing it needs the owner's retention decision (how long rejected originals are kept), so it is not implemented.

## Changes made in this pass
- `R2_PRESIGN_DISABLED` kill switch in `r2-presign` (`presignKillSwitchGate`, checked before any DB call) + test. Reason: unsetting `R2_ACCESS_KEY_ID` also breaks `r2-delete` and silently skips R2 cleanup in `delete-account`. Runbook §8.1 updated. Needs staging rehearsal.
- `package-lock.json`: `shell-quote` 1.10.0 -> 1.12.0 (dev-tool dependency via react-devtools-core; clears the one critical audit finding).

## Validation (working tree, after changes)
npm test 591/591; 23/23 PGlite suites; tsc mobile/web/worker exit 0; deno check of the 6 functions exit 0 (`--node-modules-dir=none`); web lint + build exit 0; `expo export --platform android` exit 0 (run before the lockfile bump). `expo lint` exits 2 only because an empty untracked `src/` directory exists; eslint on app/components/hooks/lib/store gives 113 errors / 46 warnings, all `react-hooks/*` compiler rules, none in files changed for this release.
Audit: mobile 41 (13 moderate, 28 high, 0 critical), web 3 (2 high, 1 moderate). Remaining items are Expo/Metro/React Native build tooling plus transitive `@grpc/grpc-js`, `node-forge`, `@xmldom/xmldom`; not reachable from app code paths, and fixing them needs an Expo SDK change (not done).
