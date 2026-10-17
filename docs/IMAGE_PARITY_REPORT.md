# Image protection parity — report

Written 2026-10-17. Companion documents: [route audit](IMAGE_PARITY_AUDIT.md), [staging runbook](IMAGE_PARITY_STAGING_RUNBOOK.md), earlier design in [IMAGE_SAFETY.md](IMAGE_SAFETY.md).

**Bottom line.** Mobile and web now share one server-side pipeline and one publication gate, locally implemented and tested. **Parity is not demonstrated against real services**: no staging run has happened (it needs your approval, accounts and a spend cap), so the claims "Cloudflare renders our watermark", "originals are not publicly reachable" and "the Worker, storage and database behave together" are **unproven**. Nothing is committed, deployed, migrated or billed. Production verification is **not started**.

## 1. What changed (all local, uncommitted)

| Area | Change |
|---|---|
| **One decision for every client** | New `image_scan_client_policy()` (0050) + shared pure `lib/imageScanPolicy.ts` (byte-identical web copy). Each client asks the *server* whether to use the legacy upload, the scan service, or stop with "update required". The client never decides safety or watermarking. |
| **Rollout ladder** | Migration **0050**: `mode` = `off` → `shadow` → `enforce`. Shadow blocks nothing but **records** how many photos arrive without a scan (the evidence that old clients are gone). `enforce` needs ≥ `min_shadow_hours` (72) of shadow; one rung at a time; admin-only, reason required, audited. One `UPDATE` rolls everything back (leaving `enforce` re-opens the legacy path and switches bulk off). Rollback script + round-trip tested. |
| **Legacy path closure** | `legacy_presign_closed` (settable only while enforcing) makes `r2-presign` answer 426 `update_required` for `listings/…`. Fail-safe table in `_shared/scanPolicy.ts`. **Disabled** until you approve. |
| **Mobile edit / replace / multi** | Now scanned (was unprotected). New/replaced photos only. |
| **Web create / edit / replace / multi** | Now scanned, same dialog wording as mobile (tests keep the English copy identical to `locales/en`). |
| **Pixel-level watermark** | Worker keeps the SVG overlay and adds a **pre-rendered PNG tile fallback** (`WATERMARK_MODE`, committed asset + generator script). Each result is verified (size unchanged, pixels measurably changed) before anything is published. |
| **Orientation / metadata** | New `lib/jpegMeta.ts`: refuses a derivative that still depends on an EXIF orientation tag, **strips EXIF/GPS/XMP/IPTC from the exact bytes published**, re-reads them, re-checks size. Verified against EXIF written by a real encoder. |
| **Bulk upload** | Migration **0051** + Worker consumer + app progress screen: a real queue with its own limits (below). Inactive. |
| **Legacy viewer fallback** | Web hero + lightbox now draw the same diagonal mark over **legacy** photos (mobile already did). Skipped for `/wm/` photos. Deterrent only. |

## 2. Incidental fixes (flagging because you didn't ask for them)

1. `0049_sell_server_validation.sql` **could not be applied** on any Postgres (an `IF` condition containing a `CASE … THEN`). One-line parenthesis fix. It was untracked and untested; `report_notify` (full chain) had been failing since — its fixture needed one photo URL.
2. **Retry after a provider outage never worked**: the Worker re-served the stored "unavailable" answer for identical photos. Now a retryable stored result is re-scanned. (Unit-tested with fakes; the real adapter path is unrun.)
3. **Rejected originals** were deleted automatically for `prohibited_content`/`weapon`. Default is now **retain** (private, staff-only, normal 30-day purge job — *which is also unscheduled*); deletion is `REJECTED_ORIGINAL_POLICY=delete`. Neither choice is a legal decision I can make — see §6.
4. `r2-delete` now accepts the owner's `wm/listings/{uid}/{listing}/{uuid}.jpg` keys (otherwise derivatives could never be removed). `wm/`, `orig/`, `pending/` remain impossible to *request* from `r2-presign`.

## 3. Bulk upload — queue, limits, status, retry

Today's bulk (mobile only; no web bulk exists) inserts remote CSV URLs directly. The 20-scans/hour interactive limit is deliberately **not** applied to it; instead:

| Concern | Design (defaults ship **inactive**: `enabled=false`, quota `0`) |
|---|---|
| Unit of work | one CSV row = one listing; rows stored server-side so the app can be closed |
| Enabling | admin only, reason, **only while photo checks are enforced**; leaving `enforce` switches it off |
| Limits (all config, owner to approve) | daily **photo** quota per user (cancel-after-processing does **not** refund it); ≤ 50 rows/batch; ≤ 5 photos/row; 1 open batch/user; ≤ 2 rows per user in flight; claim fair across users |
| Fetching | Worker only: https, port 443, no credentials / IP literals / internal names, **every redirect hop re-validated**, 10 MB cap enforced while streaming, 10 s timeout, nothing from the remote host is ever shown to anyone |
| Scan | same `runScan` as interactive (`source='bulk'`; excluded from the interactive hourly count) |
| Retry | transient (timeouts, 408/425/429/5xx, provider outage) → exponential backoff 1, 2, 4 … 60 min, max 4 attempts → `failed` (seller can retry; quota not re-charged). Dead link/forbidden/not an image/too big/rejected photo → final |
| Crash recovery | row leases (5 min); an expired lease is re-claimed |
| Status | `bulk_batch_status` (counts, per-row state, never source URLs); app polls every 5 s, can be reopened (`bulk_active_batch`) |
| Publication | **unchanged**: when a row is `ready` the app inserts the listing with the watermarked URLs through the same trigger-guarded write, then marks it published. No second publish path. |
| Throughput at defaults | cron every 2 min × 4 rows ≈ **120 rows/hour system-wide** (≈ 600 photos/h at 5 photos/row) |
| Cost framing (estimate only; Google rates read from the pricing page 2026-10-17 and not reconciled in a billing console) | Vision label+SafeSearch+OCR ≈ US$3 per 1,000 photos → a 500-photos/day quota ≈ US$1.50/day ≈ US$45/month per business that uses all of it, **before** Cloudflare and review costs |

**Needs your approval before activation**: the numbers above (I would start staging at 20 photos/day), whether paid capacity/quotas differ per business, whether remote-URL fetching is acceptable at all (third-party images raise a **copyright/terms** question; the privacy policy and terms don't mention it), and Worker cron + Vision spend.

## 4. Old app versions and existing listings

* **Old builds** know nothing of the policy and keep using the legacy path. In `shadow` they are *counted*; in `enforce` their publishes/edits with new photos fail with a generic error (the database says "Photo has not been checked"). Therefore **do not enforce until shadow shows unverified photos ≈ 0** over a window you choose. There is **no forced-update mechanism** in either app, so "old clients are gone" can only be judged from that evidence (or by building one — your call).
* **New builds** with the scan URL use the scan path even in `off` mode (watermarked, same cost/dependence on the Worker). New builds *without* the URL stay legacy until the server turns the check on, then show "update required".
* **Existing listings** are untouched and **unprotected**: their photos are unmarked in the bucket; the viewer overlay is a fallback. They are **not** claimed protected. A backfill (re-process through a queue like §3, update `images`, delete old objects) is a separate decision with its own cost, risk (broken links, caches) and retention questions — **not built, not approved**.

## 5. Evidence — what is proven, and by what

The four classes are kept separate. *Nothing below is "staging" or "production".*

| Class | What | Result |
|---|---|---|
| **A. Automated tests with mocks/fakes** (`npm test`, Node) | 476 tests, **476 pass**. Pipeline control flow (new: orientation, metadata stripping, resize, non-JPEG, retain-by-default, delete opt-in, bulk source, outage recovery), server policy matrix, presign gate, bulk fetch guards (redirect re-validation, size caps, timeouts), bulk row outcomes, URL guard (SSRF cases), mobile↔web byte-identity and wording, "every upload route asks the policy first", "no other file writes listings/uploads to `listings/`/touches `orig/`/`pending/`". | Pass. These prove logic against *fake* storage/imaging/Vision/DB. |
| **B. Local integration** (real codecs, real Postgres engine) | `tests/watermarkPixels.test.ts` (13): the committed PNG tile composited with **sharp/libvips** onto 7 sizes/orientations (320×240 … 1600×1200, portrait, panorama, tall) — dimensions unchanged, mark in every quarter, light and dark photos, double-mark detectable, **real EXIF+GPS** detected and stripped losslessly, EXIF-rotated photo → upright. `scripts/verify-derivative.selftest.mjs`: the independent inspector accepts a correct derivative and rejects unmarked / double-marked / metadata-left / sideways. **PGlite (real Postgres compiled to WASM)**: all **14** DB suites pass, including `image_scans` (27), `image_scan_modes` (29, incl. rollback script round trip), `bulk_queue` (21, incl. rollback). | Pass. Proves the tile asset, the byte checks and the SQL on a real engine. **Does not prove Cloudflare's renderer** (sharp is a stand-in). |
| **C. Real staging** (actual Cloudflare/Supabase/Vision) | **Not run.** Needs approval, accounts, secrets, spend cap, billing alert + kill switch — all in the runbook. | **Open.** No claim is made. |
| **D. Production** | **Not started.** | **Open.** |

Not exercised anywhere: live Vision; Images binding (`draw`, `repeat`, `rgba` output, EXIF autorotate); R2 private-bucket behaviour; SVG `<text>` fonts in Cloudflare; the scheduled handler; `r2-presign`/`r2-delete` under Deno; PostgREST RPC exposure of the new functions; app UI on devices and the web UI in a browser (TypeScript compiles clean; screens were not rendered or clicked).

## 6. Acceptance criteria — honest status

| # | Criterion | Status |
|---|---|---|
| 1 | Every mobile and web upload/publish route accounted for | **Met** — [audit](IMAGE_PARITY_AUDIT.md) (web bulk doesn't exist; avatar/business uploads are out of scope and said so) |
| 2 | Both platforms use the same server-side scan and publication rules | **Implemented**; shared Worker + trigger + byte-identical policy modules. *Not demonstrated end-to-end.* |
| 3 | A bypass attempt cannot publish an unscanned or unwatermarked image through any public route | **Partly proven**: direct DB writes under `enforce` (PGlite), presign closure logic (unit). **Only while enforced and closed**; in `off`/`shadow` the gate is open by design. Not tested against real services. |
| 4 | Real staging output contains a verified pixel-level watermark | **NOT MET** — no staging run. Local stand-in only. |
| 5 | All public display surfaces use the published derivative | **By construction** (they render `listings.images`, which for new listings are derivatives) + static checks. Legacy photos remain unmarked. Not visually verified. |
| 6 | Bulk has an explicit, tested rate-limit and queue strategy | **Met locally** (SQL + fakes), **inactive**, quotas await your approval; real fetch/scan untested |
| 7 | Failure cases are safe, visible and recoverable | **Met locally** (fail closed, specific messages, retry that actually re-scans, backoff, lease recovery). Gap: orphan derivatives from abandoned scans. |
| 8 | Test evidence and remaining gaps documented | **Met** — this file |
| 9 | No production deploy/migration/paid activation/enforcement change without approval | **Met** — none occurred. (Files changed in the working tree; nothing committed.) |

**Therefore parity is not claimed complete.** Criteria 4 (and the real-service halves of 2 and 3) require the staging run.

## 7. Open decisions (unchanged items point at IMAGE_SAFETY.md §10)

* **Legal / CSAM** (decisions 1–6 in IMAGE_SAFETY.md §10): coverage and jurisdictions, quarantine vs deletion, a CSAM detection option that works **before** publication, reporting workflow and person, retention overrides, Vision data-processing terms. *A general moderation API is not a CSAM detector and this work does not present it as one.* No automatic deletion/retention for suspected CSAM was added; the old automatic delete was **removed from the default** (§2.3).
* **Rejected-original policy**: retain (current default) vs delete — counsel.
* **Vendor/spend**: Google Vision billing, Cloudflare Workers Paid/Images/R2 costs (Images transformation pricing not verified), any CSAM vendor — IMAGE_SAFETY.md decision 7; the proposed **US$20 staging ceiling** is awaiting your confirmation.
* **Watermark mode**: SVG vs PNG tile — decided *by the staging test*; the brand font/logo is not used (system sans-serif text only; the approved monogram is unused).
* **Bulk**: quotas, per-business tiers, paid capacity, remote-fetch copyright/terms/privacy text.
* **Old clients**: build a forced-update/min-version mechanism, or accept shadow-evidence cutoffs.
* **Legacy photos**: backfill strategy (or accept overlay-only indefinitely).
* **Orphan derivatives**: server-side sweep of unreferenced `wm/…` objects.
* **Retention job**: `purge_scan_evidence()` still unscheduled — nothing purges anything.
* **Somali/Amharic**: all new `imageScan.errors.*` and `business.bulkUpload.queue.*` strings are my own translations — need native review.
* **Deploy checklist when approved** (each separately): migrations 0048 → 0050 → 0051 (0049 fixed); edge functions `r2-presign`, `r2-delete`; Worker; web build; mobile build.

## 8. Files

New: `lib/jpegMeta.ts`, `lib/imageScanPolicy.ts`, `lib/bulkImageQueue.ts`, `lib/bulkQueueClient.ts`, `components/BulkQueuePanel.tsx`, `web/src/{lib/{imageSafety,imageScanState,imageScanPolicy,jpegMeta,imageScanCopy}.ts, services/imageScan.ts, components/{ImageScanDialog,WatermarkOverlay}.tsx}`, `workers/image-scan/src/{bulk.ts,tile.generated.ts}`, `workers/image-scan/assets/watermark-tile.png`, `supabase/functions/_shared/scanPolicy.ts`, `supabase/migrations/{0050,0051}_*.sql` (+ rollbacks), `scripts/{build-watermark-tile,verify-derivative,verify-derivative.selftest}.mjs`, and tests: `imageScanPolicy`, `imageParity`, `scanPolicy`, `bulkImageQueue`, `imageScanBulk`, `watermarkPixels`, `supabase/tests/{image_scan_modes,bulk_queue}.test.mjs`.
Changed: `workers/image-scan/src/{pipeline,cloudflare,index}.ts`, `wrangler.toml`, `supabase/functions/{r2-presign/index.ts,_shared/uploadPaths.ts}`, `app/post/preview.tsx`, `app/listing/edit/[id].tsx`, `app/business/bulk-upload.tsx`, `components/ImageScanSheet.tsx`, `lib/{imageScan,r2}.ts`, web `sell` / `listing/edit` / `listing/[id]` pages and `services/r2.ts`, locales (en/so/am), `0049` (bug fix), `report_notify` fixture, existing pipeline tests.
