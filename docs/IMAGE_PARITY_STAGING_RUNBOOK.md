# Image protection — staging runbook and approval gates

Status: **plan only. Nothing in this document has been run.** Companion: [report](IMAGE_PARITY_REPORT.md), [route audit](IMAGE_PARITY_AUDIT.md). This supersedes the staging section of [IMAGE_SAFETY_STAGING_PLAN.md](IMAGE_SAFETY_STAGING_PLAN.md) for the parity work; that file's Vision calibration steps still apply.

**Ground rules**
* **Staging only.** Separate Supabase project, separate Cloudflare resources, separate Google project. Production migrations, Worker deployment, enforcement, legacy-path closure, paid activation and anything destructive stay disabled until separately approved.
* **Lawful, non-sensitive test images only**: the synthetic set from `node scripts/make-staging-testset.mjs <dir>` plus a handful of ordinary product photos *you* took. Never real users' photos, never suspected illegal material, never anything that could be mistaken for a minor in a sexual context. Vision's SafeSearch recall is **not measurable by us** and is not tested.
* The inspector (`scripts/verify-derivative.mjs`) trusts nothing the pipeline reports: it downloads from the **public URL** and decodes with a different codec.
* Stop immediately on any condition in §9.

## 1. Approvals needed before the first paid call or deployment

Tick each with a date; I will not proceed past a gate that is not ticked.

- [ ] **A1** Staging Supabase project exists, and I may apply migrations 0048, 0049 (fixed), 0050, 0051 to **it only**.
- [ ] **A2** Cloudflare: staging resources may be created (§2) and the Worker deployed to staging.
- [ ] **A3** Google Cloud: throwaway project with billing, Vision API enabled, restricted key (§2).
- [ ] **A4** **Spend ceiling US$20 total across all services for the staging exercise** (proposed — confirm or change).
- [ ] **A5** Billing alert **and** kill switch configured and confirmed by *you* (§3). *I cannot confirm this on your behalf and will ask for a screenshot/confirmation of each before the first Vision call.*
- [ ] **A6** Edge functions `r2-presign` and `r2-delete` may be deployed to the staging project.
- [ ] **A7** Staging mobile build and a staging web deployment may point at the staging project + staging Worker.
- [ ] **A8** Bulk dry-run quota for staging (proposed: **10 photos/day**) approved.
- [ ] **A9** Test accounts (3 sellers + 1 admin) on staging only.

## 2. Exact staging resources and accounts

| Resource | Name (suggested) | Notes |
|---|---|---|
| Supabase project | `suuqiye-staging` | Never the production project. Auth providers as needed for test accounts only. |
| Cloudflare R2 **private** bucket | `suuqiye-staging-private` | **No** public access, no `r2.dev` URL, no custom domain. Holds `orig/…`, `pending/…`. |
| Cloudflare R2 **public** bucket | `suuqiye-staging-images` | Public via the bucket's `r2.dev` URL for staging. The Worker writes only `wm/…`; the legacy presign writes `listings/…` here. |
| Worker | `suuqiye-image-scan-staging` | Bindings: `ORIGINALS`→private, `PUBLIC`→public, `IMAGES`. Workers **Paid** plan likely required (free = 10 ms CPU; unverified for this workload). |
| Google Cloud project | `suuqiye-staging-vision` | Vision API only. |
| Test users | seller-1, seller-2, seller-3, admin-1 | `admin_users` row for admin-1 (role `admin`). seller-2 exists to prove cross-user duplicate and "borrowed scan" cases. |

## 3. Expected and maximum cost; billing alert; kill switch

**Rates** are from the pages read on 2026-10-17 and are **not reconciled in any billing console**; Cloudflare Images-transformation and Workers pricing were **not verified** — check the dashboards before approving.

| Item | Staging usage | Expected | Worst case I can bound |
|---|---|---|---|
| Google Vision (label + SafeSearch + OCR; 1,000 free units/feature/month; ≈ US$3/1,000 photos after) | ≤ ~120 photos total | **US$0** if the free allowance applies as read | ~US$0.40 at list price. A runaway loop is the real risk → capped by the quota below |
| Cloudflare Workers | one Worker | Paid plan fee (**unverified; commonly quoted US$5/month — confirm**) | one month |
| Cloudflare Images binding | ≤ ~150 transforms | not priced here (unverified) | check the dashboard's free allowance first |
| Cloudflare R2 | a few hundred small objects | within the free tier (unverified) | cents |
| Supabase | new project | free tier or your plan (unverified) | depends on your org plan |
| **Total expected** | | **well under US$20** | **ceiling US$20 (A4)** |

**Billing alert** — Google *budgets only notify; they do not stop spending.* Create budget alerts at US$5 / US$10 / US$20 on `suuqiye-staging-vision` and on the Cloudflare account (billing notifications).
**Kill switch (any one stops paid use immediately)** — in order of speed:
1. Set the database to off: `select public.admin_set_image_scan_mode('off','kill switch');` (clients stop calling the Worker once builds re-read the policy; ≤ 60 s cache).
2. Google: **cap the Vision API quota** (Console → APIs → Vision → Quotas → *Images per day* = 300) **before** the first call, and `gcloud services disable vision.googleapis.com` to stop it.
3. Revoke/delete the Vision API key in Google; rotate the Worker secret.
4. `wrangler delete` (or remove the route) for `suuqiye-image-scan-staging`; `BULK_ENABLED="false"` and leave the cron commented.

## 4. Secrets and permissions

| Secret / permission | Where it lives | Scope |
|---|---|---|
| `VISION_API_KEY` | Worker secret (`wrangler secret put`) | Restricted to the Vision API; daily quota capped (§3) |
| `SUPABASE_SERVICE_KEY` | Worker secret | **Staging** project only; writes scan results, calls the bulk RPCs |
| `SUPABASE_ANON_KEY` | Worker secret/var | Verifies callers' JWTs, and staff JWTs for evidence/promote |
| R2 S3 keys (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`) | Supabase Edge Function secrets (staging project) | Object read/write on the **public staging bucket only** (never the private one) |
| Worker R2 bindings | `wrangler.toml` | private + public staging buckets |
| `PUBLIC_BASE_URL`, `SUPABASE_URL`, `ALLOWED_ORIGINS` | Worker vars | staging values |
| `WATERMARK_MODE`, `REJECTED_ORIGINAL_POLICY`, `BULK_ENABLED` | Worker vars | start `svg-only` / `retain` / `false` |
| App/web env | `EXPO_PUBLIC_IMAGE_SCAN_URL`, `NEXT_PUBLIC_IMAGE_SCAN_URL` | URL of the staging Worker — **non-secret** |

No credential goes into `EXPO_PUBLIC_*`/`NEXT_PUBLIC_*`, the repo, logs or this chat.

## 5. Procedure, with rollback for each stage

Each stage ends with its evidence (§6). Do not start a stage until the previous one's evidence is recorded.

**S1 — Database (staging).** Apply 0048 → 0049 → 0050 → 0051 in order. Check: `select mode, enforce from image_scan_config` = `off,false`; `select enabled, daily_photo_quota from bulk_scan_config` = `false,0`; `select public.image_scan_client_policy()`.
*Rollback:* `supabase/rollback/0051_…`, then `0050_…` (each re-runnable; tested on PGlite). 0048's own rollback is the `enforce=false` default.

**S2 — Storage.** Create the two buckets. Confirm the **private** bucket has no public URL. *Rollback:* delete the buckets (empty, staging).

**S3 — Worker, watermark decision.** Deploy with `WATERMARK_MODE=svg-only`, run the watermark test set (§6-W). If the SVG path fails (missing font, no overlay, resized image), set `WATERMARK_MODE=tile` and re-run **the same set**. Pin whichever passes. *Rollback:* previous Worker version / `wrangler delete`.
> The tile mode relies on `draw(overlay, { repeat: true })` and an overlay `transform({ width })`. Neither has run on Cloudflare — if both modes fail the pipeline refuses to publish (fail closed); it does not fall back to an unmarked image.

**S4 — Vision calibration.** Per IMAGE_SAFETY_STAGING_PLAN.md. Record billed units; reconcile against §3. *Rollback:* kill switch.

**S5 — Edge functions.** Deploy `r2-presign` (new gate) and `r2-delete` (accepts `wm/…`). Check order independence: `r2-presign` with 0050 **not** applied must still issue listing URLs (flag-missing → open); with it applied and `legacy_presign_closed=false` likewise. *Rollback:* redeploy the previous function versions.

**S6 — Mode ladder** (staging DB; admin account):
1. `off`: legacy create works on a build **without** the scan URL.
2. `shadow`: same build still works; `admin_image_scan_rollout_status()` shows the photos as **unverified**; a build **with** the URL shows verified photos. Wait/adjust `min_shadow_hours` only via SQL for the test (document that you did).
3. `enforce`: build without URL → "update required" sheet; direct API insert of an unscanned URL → refused (`image_not_verified`); borrowed scan from another user → refused; scan for another listing id → refused.
4. `admin_set_legacy_presign_closed(true,…)`: `curl` `r2-presign` for `listings/{uid}` → **426 `update_required`**; avatars still 200.
5. Roll back with **one** statement (`admin_set_image_scan_mode('shadow', …)`); confirm legacy presign works again and bulk is off.
*Rollback:* that statement.

**S7 — Mobile and web end to end.** Staging builds with the staging scan URL. For each platform run: create (clean), create (own-brand text → fix prompt → replace → pass), edit (replace one photo), edit (add photos), duplicate across users (review), provider outage simulated by revoking the key (`check_failed`, retry offered, **retry after restoring the key succeeds** — regression test for the fixed bug), offline mid-scan. *Rollback:* mode `off`.

**S8 — Bulk dry run** (admin enables with quota 10 under `enforce`, `BULK_ENABLED=true`, cron uncommented for the test window only):
queue 2 listings × ≤5 photos with: valid https URLs of the synthetic set hosted on a public bucket you control; an `http://` URL; `https://127.0.0.1/…`; a URL that redirects to `http://…` and one to an internal IP; a 404; a > 10 MB file; a 503-then-200 host. Expect: refused/final/retried exactly as in the report; progress screen updates; ready rows publish with `/wm/` URLs; cancel works; quota refusal on the 11th photo; interactive posting still works while a batch runs. *Rollback:* `admin_set_bulk_scan_config(false,…)`, comment the cron, cancel the batch.

**S9 — Sign-off.** Fill the evidence table; keep the downloaded derivatives and JSON reports; list every failure and how it was resolved.

## 6. Evidence checklist

Run the inspector on **the public URL of the derivative the app actually published**, with the original test file:
`node scripts/verify-derivative.mjs <public url> --original <file> --must-not-be-public <private/orig URL> --must-not-be-public <pending URL> --json > evidence/<name>.json`

**§6-W watermark and metadata (per file in the staging set, via mobile and via web)**

| File (from `make-staging-testset.mjs`) | Must show |
|---|---|
| `landscape-1600x1200`, `portrait-1200x1600`, `medium-800x600`, `small-320x240` (direct to Worker), `panorama-1600x500`, `tall-500x1600` | size unchanged, mark in all quarters, **mark readable at the smallest size**, single layer |
| `large-4000x3000` | normalised to 1600×1200, aspect kept |
| `exif-orientation-6/3/8-with-gps` | derivative **upright**, no EXIF/GPS/orientation tag |
| `png-…`, `webp-…`, `flat-screenshot-like-…` | accepted → JPEG; mark measurable on flat areas |
| `own-brand-text-…` | rejected (`watermark_own`) — no double mark possible via re-upload |
| `not-an-image`, `truncated` | refused before storage/provider |
| a published photo's original | **not** publicly readable (`--must-not-be-public`: 401/403/404) |
| a held photo's `pending/…` copy | not publicly readable until staff approve + promote |

Also record: which watermark mode passed and a side-by-side eyeball screenshot of each size; Worker log lines (no secrets); billed Vision units.

**§6-B bypass attempts (each must fail, or be recorded as a gap)**

| Attempt | Expected |
|---|---|
| `r2-presign` `listings/{me}` after closure | 426 `update_required` |
| `r2-presign` for `wm/…`, `orig/…`, `pending/…`, another user's folder | 403 |
| Direct `listings` insert/update with an unscanned URL (`enforce`) | refused `image_not_verified` |
| …with another user's derivative URL | refused |
| …with a derivative made for a different listing id | refused |
| …with a rejected photo's URL | refused `image_rejected` |
| PUT to a presigned URL with a different Content-Type / after expiry | rejected by R2 (existing probe `scripts/r2-presign-probe.ts`) |
| Re-upload of a downloaded marked photo | rejected by OCR (own-brand) — *heuristic; note a cropped/blurred copy may pass: record the result* |
| Bulk with SSRF-style URLs / oversize / redirect to internal | refused, no scan spend |

**§6-D display** — screenshots of: mobile card, detail, gallery; web card, detail hero, lightbox, **for one new (derivative) and one legacy listing** (overlay on legacy only, none doubled on new).

## 7. Rollback summary

| Stage | One-step rollback |
|---|---|
| Any time | `admin_set_image_scan_mode('off', …)` (also re-opens legacy presign and switches bulk off) |
| Legacy closure | `admin_set_legacy_presign_closed(false, …)` |
| Bulk | `admin_set_bulk_scan_config(false, …)`; comment the cron; `BULK_ENABLED=false` |
| Migrations | `supabase/rollback/0051_…`, `0050_…` (round-trip tested) |
| Worker | redeploy previous version or `wrangler delete` |
| Edge functions | redeploy previous versions |
| Clients | server policy change takes effect without a release (≤ 60 s client cache) |

## 8. Treatment of old app versions and existing listings

See report §4. In short: old builds keep the legacy path and are **counted** in shadow; do not enforce until the unverified count is ≈ 0 over the window you pick (no forced-update mechanism exists); existing listings stay unmarked and are **not** claimed protected; the viewer overlay is only a fallback; backfill is a separate, unapproved decision.

## 9. Stop conditions

Any of: a Vision charge above the expected figure; any real user data or photo in a staging path; any attempt that publishes an unscanned/unmarked image **and succeeds** (record, stop, fix); the private bucket reachable publicly; a derivative still carrying GPS; spend approaching US$15; any suspected illegal material encountered (do **not** copy, store or forward it — stop and follow counsel's process).

## 10. Unresolved decisions that block *production* (not staging)

Counsel on suspected-CSAM handling and retention (IMAGE_SAFETY.md §3, decisions 1–6); a pre-publication CSAM detection option; Google Vision data-processing/privacy text; the rejected-original policy (retain/delete); bulk quotas and remote-fetch copyright/terms; forced-update stance; legacy-photo backfill; orphan-derivative sweep; scheduling of `purge_scan_evidence()`; native review of so/am strings.
