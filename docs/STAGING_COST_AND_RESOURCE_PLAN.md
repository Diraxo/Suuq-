# Staging cost and resource plan (image protection)

Written 2026-10-17. **Status: plan only.** Nothing here has been executed: no resource created, no migration applied, no image uploaded, no billing enabled, no vendor contacted, nothing deleted. **Staging spend is US$0** until the owner has reviewed this document and ticked the gates in §7.

Companions: [verification checklist](STAGING_VERIFICATION_CHECKLIST.md), [orphan sweep + backfill design](ORPHAN_SWEEP_AND_BACKFILL_DESIGN.md). Earlier material this refines: [IMAGE_PARITY_STAGING_RUNBOOK.md](IMAGE_PARITY_STAGING_RUNBOOK.md), [IMAGE_SAFETY_STAGING_PLAN.md](IMAGE_SAFETY_STAGING_PLAN.md).

## 0. Three separate milestones

Passing one says nothing about the next.

| Milestone | Question it answers | Status |
|---|---|---|
| **M1 Local** | Does our logic work against fakes, real image codecs (sharp) and real Postgres (PGlite)? | Done: 476 unit tests, 14 PGlite suites. **Does not prove Cloudflare's renderer, private-bucket behaviour, or live Vision.** |
| **M2 Staging** | Do the *real* Cloudflare / Supabase / Vision services produce a correctly watermarked public derivative, keep the original private, and enforce the publish gate? | **Not started. Blocked on this plan's approvals.** |
| **M3 Production readiness** | Can we switch it on for real users without breaking old app versions, with legal items settled? | **Not started.** Blocked on M2 plus the open legal/rollout items (checklist §9). |

## 1. Decisions recorded (owner, 2026-10-17)

| # | Decision | What it means for this work |
|---|---|---|
| 1 | Staging spend **US$0 for now** | No external work until this breakdown is approved. A US$20 ceiling is a *budget target*, not a guaranteed cap: §4 says which services actually have a hard stop. |
| 2 | Prepare accounts/secrets, **don't connect** | Dedicated staging resources, isolated from production. The owner enters secrets directly into the secret manager (§6). |
| 3 | Bulk import **disabled** | Quota stays 0, `BULK_ENABLED=false`, cron stays commented. Synthetic-image bulk testing is a *separate later approval*. |
| 4 | Rejected originals: **private retention with safeguards** | See §8 and the sweep doc §6. Not indefinite by default. |
| 5 | Existing unmarked photos: **plan only** | Backfill design in the third document. Nothing modified, deleted or republished. |
| 6 | Orphaned derivatives: **design a server-side sweep, don't run it** | Third document. Dry-run, grace period, audit log, explicit deletion approval. |
| – | **Production stays unchanged**; don't flip `enforce` just to close the legacy bypass | Compatibility gate in the checklist §8. |

## 2. Exact staging resources (none exist yet)

| # | Resource | Proposed name | Plan / tier | Production-isolation rule |
|---|---|---|---|---|
| R1 | Supabase project | `suuqiye-staging` | Free tier if it supports Edge Functions + pg features used; otherwise paid (**unverified**) | Different project ref. Abort any command if `supabase status` shows the production ref. |
| R2 | R2 **private** bucket | `suuqiye-staging-private` | R2 standard | No public access, no `r2.dev`, no custom domain. Holds `orig/…`, `pending/…`. |
| R3 | R2 **public** bucket | `suuqiye-staging-images` | R2 standard | Staging `r2.dev` URL only. Worker writes `wm/…`; legacy presign writes `listings/…`. |
| R4 | R2 API token | `staging-presign` | n/a | Scoped to R3 only (never R2). Used only by staging Edge Functions. |
| R5 | Cloudflare Worker | `suuqiye-image-scan-staging` | Workers Free CPU limit is 10 ms; the pipeline almost certainly needs **Paid** (**unverified**) | Own config file. See the guard below. |
| R6 | Images binding | `IMAGES` | Bundled with the Worker; per-transform pricing **unverified** | |
| R7 | Google Cloud project | `suuqiye-staging-vision` | Vision API only; needs a billing account attached even to use the free units (**unverified, confirm in console**) | New project; no shared keys. |
| R8 | Test users | seller-1/2/3, admin-1 | n/a | Staging Supabase only. |
| R9 | Staging app/web builds | EAS `staging` profile; web preview | EAS free tier; iOS test installs use the existing Apple developer account (**confirm no new fee**) | Env points at staging Worker/Supabase only. |

> **Hard guard, found while writing this plan.** [workers/image-scan/wrangler.toml](../workers/image-scan/wrangler.toml) binds `bucket_name = "suuqiye-private"` and `"suuqiye-images"` and its comment says the latter is "the existing public bucket". **Running `wrangler deploy` from that directory unmodified could attach the Worker to production storage.** Staging must use a *separate* config (`wrangler.staging.toml`, or an `[env.staging]` block) with R2/R3 names, and every command must pass `--config` explicitly. Creating that file is application configuration and is deliberately **not** done in this documentation phase; it is the first S0 task once approved.

## 3. Expected usage and estimated charges

Rates below come from pages read in earlier sessions on 2026-10-17 and **were not reconciled in any billing console**. Treat every figure as an estimate to be re-read from the live pricing page / dashboard by the owner before approving (§7 gate G3). Cloudflare Images-transformation pricing and Workers pricing were **not verified at all**.

| Service | Expected staging usage | Estimated charge | Confidence |
|---|---|---|---|
| Google Vision (Label + SafeSearch + OCR) | ≤ ~120 photos (≈ 300 incl. calibration), 3 features each | ≈ US$0 if the monthly free units apply; list price ≈ US$3 / 1,000 photos beyond, so worst realistic ≈ **US$1–2** | Medium. Whether SafeSearch is free alongside Label is **unconfirmed**; first 20 photos exist to settle it |
| Cloudflare Workers | one Worker, a few hundred requests | Paid plan minimum, commonly quoted ≈ US$5/month, **unverified** | Low |
| Cloudflare Images binding | ≈ 150 transforms (watermark draw + resize + EXIF checks) | Unknown | **Unknown**. Check the dashboard's free allowance before the full set |
| Cloudflare R2 | a few hundred small objects, < 1 GB | Within free tier (10 GB-month recalled, **unverified**); Class A/B ops cents | Medium |
| Supabase | one project | Free tier, or paid if free tier blocks a feature | Low |
| EAS builds | 1–2 staging builds | Free tier | Medium |
| Labour | owner + me | Not priced | n/a |
| **Total** | | **Likely US$5–10; plausible worst case ≈ US$20** | A budget target. See §4 for what is capped and what is only alerted |

**What "US$0 for now" costs us:** none of M2 can start. Everything in the checklist that needs a real service waits on the gates in §7.

## 4. Quotas, caps and alerts: what actually stops spending

The honest answer is that only some of these are hard stops. The owner should verify each row in the console and paste a screenshot before the first paid call.

| Service | Hard stop available? | Mechanism (to be verified by owner) |
|---|---|---|
| Google Vision | **Yes (request quota).** Billing *budgets* only notify and do not stop spend. | Console → APIs → Vision → Quotas → lower "Images per day" to a small number (proposed **300**) **before** the first call. Also `gcloud services disable vision.googleapis.com`. |
| Cloudflare Workers / Images / R2 | **Unknown / probably alert-only.** I could not confirm a spend cap for these. | Billing notifications at US$5/10/20; short-lived resources; delete when done. |
| Supabase | Free tier cannot exceed its limits; paid org spend cap exists but is **unverified** | Prefer a free-tier staging project. |
| App-level | **Yes, ours.** | `admin_set_image_scan_mode('off', …)` stops clients calling the Worker (≤ 60 s client cache). Worker's own 20 interactive scans/hour/user limit runs *before* any Vision call. Bulk quota is 0. |

## 5. Kill switch (any one stops paid use; fastest first)

1. **Database:** `select public.admin_set_image_scan_mode('off','kill switch');` (staging DB). Also re-opens the legacy presign path and switches bulk off.
2. **Google:** quota to 0 / disable the Vision API / delete the API key.
3. **Worker:** remove the route or `wrangler delete --config wrangler.staging.toml`; rotate the Worker secrets.
4. **Bulk:** `BULK_ENABLED="false"`, cron stays commented, `admin_set_bulk_scan_config(false, 0, …)`.
5. **Nuclear:** delete the Google project, the Worker and both buckets (teardown order in §9).

## 6. Secrets and permissions: how they are handled

* **The owner enters every secret directly** into `wrangler secret put <NAME>` or the Supabase dashboard/CLI secrets prompt. I never ask to see, paste or echo a value, and none goes into this repo, a prompt, logs, a report, `app.json`, `EXPO_PUBLIC_*` or `NEXT_PUBLIC_*`.
* I can verify *presence* by name only (`wrangler secret list`, `supabase secrets list` show names/digests, not values).
* Separate values per environment; staging keys are never present in a production-pointing shell or CI job.

| Secret | Lives in | Scope |
|---|---|---|
| `VISION_API_KEY` | Worker secret | Restricted to Vision API, daily quota capped (§4) |
| `SUPABASE_SERVICE_KEY` | Worker secret | **Staging** project only |
| `SUPABASE_ANON_KEY` | Worker secret | Verifies caller JWTs |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` | Staging Supabase Edge Function secrets | Public staging bucket only |
| `r2_delete_webhook_secret` | Staging `private.settings` | Staging only |

Non-secret vars (`PUBLIC_BASE_URL`, `SUPABASE_URL`, `ALLOWED_ORIGINS`, `WATERMARK_MODE`, `REJECTED_ORIGINAL_POLICY=retain`, `BULK_ENABLED=false`) go in the staging config.

## 7. Approval gates (nothing proceeds past an unticked gate)

- [ ] **G1** Owner reviewed this document and confirms the staging ceiling number to use (default: stay at US$0 / no run).
- [ ] **G2** Owner confirms who owns the Cloudflare, Google and (staging) Supabase accounts, and that staging uses its own login scope.
- [ ] **G3** Owner re-read live pricing for Workers, Images binding, R2 and Vision, and corrected §3.
- [ ] **G4** Owner configured the §4 hard stops and budget alerts and confirmed them (screenshot). I will not take this on trust.
- [ ] **G5** `wrangler.staging.toml` exists and was reviewed (no production bucket names). *(S0 code/config task, requires its own go-ahead.)*
- [ ] **G6** Owner entered the staging secrets (§6) and confirmed by name.
- [ ] **G7** Written go-ahead for each individual step in the checklist that creates a resource, applies a migration, uploads an image, or enables billing.

## 8. Rejected originals: retention safeguards (decision 4)

Private retention is not a policy by itself. Current behaviour, from the code:

* Default is `REJECTED_ORIGINAL_POLICY=retain`: the original stays in the private bucket at `orig/{uid}/{listing}/{sha}.bin`.
* [purge_scan_evidence()](../supabase/migrations/0048_listing_image_scans.sql) can null `source_key` after `evidence_retention_days` (default 30), **but it is not scheduled, and nothing deletes the returned objects**. So today retention is effectively **indefinite**, which the owner has said it should not be.
* It does not distinguish an ordinary reject from suspected illegal material, and does not cover `pending/…` held copies or the `image_hashes` table.

Safeguards required before *any* real user photo enters this pipeline (proposed; design in sweep doc §6; windows are for the owner/counsel to approve):

| Safeguard | Proposal |
|---|---|
| Restricted access | Private bucket reachable only via the Worker binding; evidence endpoint staff-only (RLS). No public URL ever. Access-log review step in the checklist. |
| Documented purpose | Written purpose: abuse review, appeals, duplicate detection. Nothing else. |
| Approved retention window | Proposal: ordinary rejects **30 days** (matches existing config), then delete. Owner/counsel confirm. |
| Suspected illegal material | **Out of scope for engineering to decide.** Needs a `legal_hold` mechanism that exempts an item from purge and from any sweep, plus counsel's reporting/preservation process (see [COUNSEL_BRIEFING_IMAGE_SAFETY.md](COUNSEL_BRIEFING_IMAGE_SAFETY.md)). Until that exists, no real-user photos. |
| Deletion is real | A scheduled purge must also delete the R2 objects it nulls, and record that it did. Not built; not scheduled. |

## 9. Rollback and teardown

| Layer | Rollback |
|---|---|
| Any time | Kill switch §5 step 1 |
| Legacy closure | `admin_set_legacy_presign_closed(false, …)` |
| Migrations | `supabase/rollback/0051_…` then `0050_…` (round-trip tested on PGlite); 0048's default is `enforce=false` |
| Worker | redeploy previous version or `wrangler delete --config wrangler.staging.toml` |
| Edge functions | redeploy previous versions |
| Clients | server policy change, no release needed (≤ 60 s cache) |

**Teardown order (after sign-off or abort):** cancel/clear bulk rows → export evidence files → delete synthetic objects in both buckets → delete buckets → revoke R4 token → delete Worker → delete Google API key, disable API, delete project, detach billing → delete staging Supabase project (or pause) → unpublish staging builds. Verify with a final bucket listing = empty and the Google/Cloudflare billing pages showing no active staging items. Synthetic-data inventory is in the checklist §10.
