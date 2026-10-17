# Staging verification checklist (image protection)

Written 2026-10-17. **Status: checklist only, nothing run.** Execute only after the gates in [STAGING_COST_AND_RESOURCE_PLAN.md §7](STAGING_COST_AND_RESOURCE_PLAN.md) are ticked. Every item records: *evidence file*, *pass criterion*, *result*, *date*. An item with no recorded evidence is **not passed**.

Test material: lawful, non-sensitive images only. The synthetic set from `node scripts/make-staging-testset.mjs <dir>` plus ordinary product photos the owner took. Never real users' photos, never suspected illegal material, never anything sexual or involving minors. Vision's SafeSearch **recall is not measurable here and is not claimed**; staging measures plumbing, watermark fidelity, false positives and cost.

The inspector `scripts/verify-derivative.mjs` trusts nothing the pipeline reports: it downloads from the **public URL** and decodes with a different codec. Use it for every pixel claim.

## 1. Preconditions (stop if any fails)

- [ ] Plan gates G1–G7 ticked, with dates.
- [ ] `supabase status` (or project ref printout) shows the **staging** ref; Worker config is `wrangler.staging.toml`; its bucket names are the staging ones. (Production-bucket binding risk: cost plan §2.)
- [ ] Vision daily quota capped, budget alerts set (screenshots saved).
- [ ] Secrets present by **name** only.
- [ ] `select mode, enforce, legacy_presign_closed from image_scan_config` = `off, false, false`; `select enabled, daily_photo_quota from bulk_scan_config` = `false, 0`.

## 2. Watermark pixels on the actual published derivative

Run on the **public URL the app actually published**, for each file, via mobile *and* via web:

`node scripts/verify-derivative.mjs <public-url> --original <file> --must-not-be-public <orig-url> --must-not-be-public <pending-url> --json > evidence/<name>.json`

| # | Input (from the staging set) | Must show |
|---|---|---|
| W1 | `landscape-1600x1200`, `portrait-1200x1600`, `medium-800x600`, `panorama-1600x500`, `tall-500x1600` | Dimensions unchanged; mark in all four quarters; single layer; readable |
| W2 | `small-320x240` (direct to Worker) | Mark still readable at the smallest size |
| W3 | `large-4000x3000` | Normalised to 1600×1200, aspect kept, no stretch |
| W4 | `exif-orientation-6/3/8-with-gps` | Derivative **upright**, no orientation tag, no EXIF/GPS/XMP/IPTC |
| W5 | PNG, WebP, flat screenshot-like | Accepted → JPEG; mark measurable on flat areas; PNG alpha has no black fill |
| W6 | `own-brand-text-…` | Rejected (`watermark_own`); no double mark possible |
| W7 | `not-an-image`, `truncated`, 0-byte, oversized, HEIC | Clean typed error; **nothing written publicly**; private state consistent |
| W8 | Same photo twice; a `wm/` derivative fed back as input | No double mark; second run reuses or rejects per policy |

Plus, once per watermark mode: **which mode passed** (`svg-only` first; if it fails use `tile` and re-run the same set; if both fail the pipeline must refuse to publish, never publish unmarked) and side-by-side screenshots of each size. Unverified assumptions to settle here: SVG `<text>` glyphs in Cloudflare's runtime, `draw(overlay, { repeat: true })`, overlay `transform({ width })`, `rgba` output, EXIF autorotate.

**Gate:** if the mark is absent, corner-only, tofu glyphs, or doubled, stop; do not continue to later sections.

## 3. Original and held copies are not publicly reachable

- [ ] Private bucket has **no** `r2.dev` URL and no custom domain (dashboard screenshot).
- [ ] Anonymous GET of a published photo's `orig/…` key → 401/403/404, never 200. (`--must-not-be-public`)
- [ ] Anonymous GET of a held photo's `pending/…` key → not 200.
- [ ] A held photo becomes public **only** after staff approve + `/v1/promote`; measure the window in which the seller's URL 404s (known behaviour, IMAGE_SAFETY.md §7.4).
- [ ] Listing both buckets: public holds only `wm/…` (and legacy `listings/…` from the legacy-path tests); private holds `orig/…` / `pending/…`.
- [ ] Worker: 401 without JWT; 403 for non-staff on `/v1/evidence` and `/v1/promote`; CORS rejects an unlisted origin.

## 4. Publish-gate behaviour against real services

Run against the staging DB in `enforce`, then roll back with one statement.

| # | Attempt | Expected |
|---|---|---|
| G1 | Clean photo, normal create | Published with `wm/…` URL |
| G2 | Direct `listings` insert/update with an unscanned URL | refused `image_not_verified` |
| G3 | …with another user's derivative URL | refused |
| G4 | …with a derivative scanned for a different listing id | refused |
| G5 | …with a rejected photo's URL | refused `image_rejected` |
| G6 | `r2-presign` for `listings/{me}` after `legacy_presign_closed` | 426 `update_required`; avatars still 200 |
| G7 | `r2-presign` for `wm/…`, `orig/…`, `pending/…`, another user's folder | 403 |
| G8 | PUT to a presigned URL with wrong Content-Type / after expiry | rejected by R2 (`scripts/r2-presign-probe.ts`) |
| G9 | Re-upload of a downloaded marked photo | rejected by OCR (heuristic; a cropped/blurred copy may pass, **record the result**) |
| G10 | Vision outage simulated by revoking the key | `check_failed`, retry offered; **retry after restoring the key succeeds** (regression for the fixed bug) |
| G11 | Third-party watermark text / duplicate / ambiguous category | review → listing hidden; admin card shows; seller notice is generic |
| G12 | 21st interactive scan within an hour | blocked **before** any Vision call (billed units unchanged) |
| G13 | Bulk attempt while bulk is disabled | refused; no fetch, no scan spend |
| G14 | `enforce` → `shadow` → `off` rollbacks | one statement each; legacy presign re-opens; bulk off |

## 5. Mobile device checks (physical devices, staging build)

Android (a mid/low-end device and a recent one) and iOS (physical). Each: create (clean), create (own-brand text → fix prompt → replace → pass), edit (replace one photo), edit (add photos), duplicate across two users, offline mid-scan, kill app mid-scan then reopen, poor network, camera and gallery sources, large camera photo, permission denied.

- [ ] Photos show the mark on card, search card, detail, full gallery, compare, favourites, seller page, price drops.
- [ ] Network inspector (or proxy) shows the displayed URL is `wm/…` for new listings.
- [ ] Legacy listing shows the **viewer overlay only**; a new listing shows **no** overlay (no double mark).
- [ ] "Update required" sheet appears for a build without the scan URL when the server enforces; wording legible; Somali/Amharic strings flagged for native review (not signed off here).
- [ ] No crash / memory pressure with 8 photos.

## 6. Web-browser checks (staging web build)

Desktop Chrome, Firefox, Safari; mobile Safari and Chrome Android. Create, edit, replace, multi-photo, drag-and-drop, paste, offline, tab closed mid-scan.

- [ ] Same dialog wording as mobile.
- [ ] Card, detail hero, lightbox, OG/share image use the derivative.
- [ ] CORS to the staging Worker works from the staging origin only.
- [ ] No credential in `NEXT_PUBLIC_*` bundle (grep the built output).

## 7. Operations checks

- [ ] Worker and Edge Function logs contain no JWTs, keys, or photo bytes.
- [ ] p50/p95 scan latency for 1, 4 and 8 photos recorded; **billed Vision units reconciled** against the plan (resolves SafeSearch-free-with-Label) before the full set.
- [ ] Images-binding and Workers usage read from the dashboard after the first 50 images and again at the end; plan §3 updated with measured numbers.
- [ ] `purge_scan_evidence()` run manually with shortened retention on staging only: it nulls keys and returns them; confirm nothing is *deleted* by it and record that (retention gap, plan §8). Not scheduled.
- [ ] Access review: who/what can read `orig/…` (bindings, tokens, staff role) written down.

## 8. Compatibility gate: required before production enforcement is even discussed

Do **not** switch production to `enforce` merely to close the legacy upload bypass. Today that would make every older build unable to publish new photos with only a generic database error, and old builds cannot be fixed after the fact. Established facts, from the code:

* The bypass has two parts: the DB trigger (closes in `enforce`) and the public `listings/` presign (closes only with `legacy_presign_closed`). They are separate switches.
* There is **no forced-update or minimum-version mechanism** in either app.
* Shadow events record counts only. [image_scan_shadow_events](../supabase/migrations/0050_image_scan_rollout_modes.sql) has **no app-version column**, so unverified writes cannot be attributed to a build.
* A build without the scan code cannot display the "update required" sheet; it gets whatever generic error the failing call produces. Closure that depends on old builds understanding a 426 cannot work.

Prerequisites (all must be true; none is true today):

- [ ] M2 (this checklist §2–§7) passed on real staging.
- [ ] A scan-aware client released to both stores, **including the 426 / update-required handling**.
- [ ] App version recorded with each write (header or argument and a column on shadow events) so adoption is measurable. *(A code/schema change; separate approval.)*
- [ ] An owner-chosen minimum-version or "time-boxed grace" decision, since no forced update exists.
- [ ] In `shadow`: unverified photo count ≈ 0 over an owner-chosen window (the server already requires ≥ `min_shadow_hours`, default 72, before `enforce`).
- [ ] Ordered ladder, each step separately approved: migrations at `mode=off` → Worker → scan-aware release → `shadow` → watch → `enforce` → `legacy_presign_closed` → then sweep/backfill (companion doc).
- [ ] Counsel items resolved or explicitly deferred by the owner: suspected-illegal-material handling, retention overrides, CSAM detection option, Google data-processing text.

**Alternative worth evaluating (not built):** an edge Worker on the public image domain that applies the watermark on read for legacy `listings/` keys. It would protect old-app uploads and legacy photos *without* any client change or forced update. Unknowns: CPU/Images cost per view, cache behaviour, and that it protects only that domain's copy (the stored original remains retrievable by anyone who already has the key). Evaluate in staging after M2.

## 9. Production-readiness (M3) items this checklist does not close

CSAM detection option; counsel decisions; Google DPA/privacy-policy text; so/am native review; bulk quotas and the remote-fetch copyright/terms text; scheduling and enforcement of retention deletion; orphan sweep and backfill approvals; forced-update stance. Passing staging authorises none of: production migrations, Worker deploy, billing, scan-aware production clients, `shadow`/`enforce`, closing `listings/`, scheduling purge, bulk enablement.

## 10. Cleanup of synthetic test data (end of run, and on abort)

Inventory of everything the run creates; each must be removed or explicitly kept with a reason.

| Where | What | Removal |
|---|---|---|
| Public bucket | `wm/…`, `listings/…` test objects | List → delete → re-list = empty |
| Private bucket | `orig/…`, `pending/…` | Same; confirm nothing with real-user shape exists |
| Staging DB | `listings`, `listing_scans`, `listing_scan_images`, **`image_hashes`**, `image_scan_shadow_events`, `bulk_import_*`, reports/notifications from tests | Drop the project, or truncate and re-count = 0 |
| Auth | seller-1/2/3, admin-1 | Delete users |
| Google | Vision key, API, project, billing link | Delete / disable / detach |
| Cloudflare | Worker, buckets, R2 token | Delete / revoke |
| Local | downloaded derivatives, `evidence/*.json` | Keep evidence for the report; confirm none contains secrets or real-user data |
| Builds | staging EAS builds, web preview | Unpublish |

Record: counts before/after, date, and who confirmed. Final report lists verified / failed / still unverified, with measured costs.

## 11. Stop conditions

Any of: a Vision charge above expectation; any real user data or photo in a staging path; an unscanned/unmarked image **published successfully** (record, stop, fix); private bucket reachable publicly; a derivative still carrying GPS; spend approaching the owner's approved figure; **any suspected illegal material** (do not copy, store, forward or describe; stop and follow counsel's process).
