# Image safety — staging execution plan

Status: **PLAN ONLY. Nothing in this document has been executed.** No deploy, no migration, no billing, no vendor contact, no commit. Every step below that creates a resource, spends money, or touches real data is marked **[APPROVAL]** and waits for a written yes to *that step*.

Scope: staging verification only. **Production enforcement stays OFF** (`image_scan_config.enforce = false`, `EXPO_PUBLIC_IMAGE_SCAN_URL` unset in every production build). Passing staging does **not** approve production deployment; that is a separate decision (see §9).

Companion docs: `docs/IMAGE_SAFETY.md` (design, cost table, CSAM section, decision register), `docs/COUNSEL_BRIEFING_IMAGE_SAFETY.md`.

---

## 0. Diagnosis this plan rests on (verified in code, 2026-10-17)

| Finding | Evidence |
|---|---|
| New listings use the legacy public path, bypassing scan + watermark | `lib/storage.ts:51` uploads to `listings/{uid}/{draft}` via `r2-presign`; the scan call in `app/post/preview.tsx` is inert unless `EXPO_PUBLIC_IMAGE_SCAN_URL` is set |
| `r2-presign` still issues public `listings/…` PUT URLs | `supabase/functions/_shared/uploadPaths.ts` `isAllowedFolder` |
| Four upload routes exist, only one has scan wiring (flag-gated) | mobile Sell `app/post/preview.tsx:193`; mobile edit `app/listing/edit/[id].tsx:254`; web Sell `web/src/app/sell/page.tsx:301`; web edit `web/src/app/listing/edit/[id]/page.tsx:206`; bulk upload `app/business/bulk-upload.tsx` / `lib/bulkUpload.ts` (confirm route in P1-C) |
| Display code has no derivative awareness | `lib/r2.ts` `imageUrl()` only rewrites Cloudinary URLs; cards/detail/gallery render `listing.images[]` as stored |
| The Worker has never run against real Cloudflare | `IMAGE_SAFETY.md` §6 table; `cloudflare.ts`/`index.ts` typecheck only |

**Important nuance on P0.** Two separate bypasses exist and they close differently:

1. **Database bypass** — a client writing `listings.images`. Migration 0048's trigger `listings_z_image_scan` already rejects any photo URL without a finished scan by the same user for the same listing, *when `enforce = true`*. So the DB side closes by flipping one flag — but doing so immediately breaks every old app build (they cannot publish at all).
2. **Storage bypass** — `r2-presign` hands any signed-in user a PUT URL into the **public** bucket. Unmarked originals can be uploaded and are served publicly by URL whether or not a listing references them. The DB trigger does not touch this. Only removing `listings/` from `isAllowedFolder` closes it (also breaks old apps).

Hence P0 needs a **transition ladder**, not a flag flip (§3).

---

## 1. Principles and hard constraints

- Isolated staging: separate Supabase project, separate Cloudflare R2 buckets, separate Worker name, separate Google Cloud project. **No shared keys, buckets, or databases with production.** Staging service-role keys never touch a prod-pointing environment.
- Test accounts only; no real user photos; no production data copied in.
- Test images: lawful, owned/licensed, non-sensitive only. **No illegal imagery in any form, no content that could be mistaken for minors in a sexual context, no adult/violent content.** Therefore the staging run measures false positives, watermark fidelity, plumbing and cost — **not** SafeSearch recall (stated limitation, not a gap to close by collecting such images).
- Staging does not validate any CSAM control. A staging pass is never evidence of CSAM protection.
- Rejected-photo auto-deletion (`pipeline.ts`: `prohibited_content` / `weapon`) **is disabled in the staging deploy** via a `STAGING_NO_DELETE` guard (small code change, **[APPROVAL]** to make) so staging behaviour does not set a precedent or destroy evidence of what the pipeline did. The real deletion/quarantine policy is a counsel decision (§8, decision 2).
- Secrets live only in `wrangler secret put` and Supabase function secrets. Never in repo, `app.json`, `EXPO_PUBLIC_*`, `NEXT_PUBLIC_*`, or logs.

---

## 2. Resource inventory (to be created, all staging, none exist yet)

| # | Resource | Name (proposed) | Why | Created in step |
|---|---|---|---|---|
| R1 | Supabase project (staging) | `suuqiye-staging` | Apply migrations 0001–0048 from scratch, real Postgres + Auth + Edge Functions | S2 |
| R2 | Supabase Edge Functions (staging) | `r2-presign`, `r2-delete`, `r2-verify-images` | Same code as prod, staging secrets | S2 |
| R3 | R2 public bucket (staging) | `suuqiye-staging-images` | Receives `wm/…` derivatives; public dev URL only | S3 |
| R4 | R2 private bucket (staging) | `suuqiye-staging-private` | Originals/held derivatives; **no public access, no r2.dev, no custom domain** | S3 |
| R5 | R2 API token (staging, scoped to R3+R4) | — | Edge function presigning | S3 |
| R6 | Cloudflare Worker (staging) | `suuqiye-image-scan-staging` | The scan pipeline | S3 |
| R7 | Images binding | `IMAGES` | Watermark rendering | S3 |
| R8 | Google Cloud project + Vision API key | `suuqiye-vision-staging` | General screen | S4 |
| R9 | Budget + alert on R8 | hard cap per §4 | Cost control | S4 |
| R10 | Staging app build(s) | EAS `staging` profile + web preview | Exercise all upload routes | S6 |
| R11 | Test accounts (user ×3, moderator, admin) | `*+stg@…` | Isolation | S2 |

Not created in this plan: any CSAM vendor account, any production resource.

Pre-flight to confirm before S1 (answers change the plan): is there already a Cloudflare account on Workers **Paid**? Is there an existing staging Supabase? (Unknown to me — repo only shows production config.)

---

## 3. P0 design — closing the unmarked-publication bypass without breaking old apps

**Proposed (needs design approval, then build + test locally before any staging step):**

1. **Server-side mode, not a boolean.** Extend `image_scan_config` with `mode in ('off','shadow','enforce')` (keep `enforce` as derived for backwards compatibility). *Shadow* = allow the write but record an `unscanned_photo_write` row (user, listing, app version if sent, route) so we **measure** how many writes still bypass. Tested in the PGlite suite.
2. **Minimum app version signal.** Client sends `x-app-version` (or a function arg); `r2-presign` and the trigger can tell old from new. Old builds get a clear "please update" error (`hint = 'update_required'`) instead of a generic failure; add a matching string (en + so/am, native review required).
3. **Storage side:** `r2-presign` gains a `scan_required` response mode: for `listings/` folder under `shadow` it still issues the URL but logs; under `enforce` it returns 426 with `update_required`. New clients upload photos **only to the Worker** (`/v1/scans`), never `listings/` directly.
4. **Order of closure (all later, all production, all separately approved — see §9):**
   a. ship scan-aware clients (all four routes) with enforcement OFF;
   b. turn on `shadow`, watch unscanned-write rate fall;
   c. force-update / minimum-version gate;
   d. `enforce`; e. remove `listings/` from `isAllowedFolder`; f. sweep existing `listings/` objects.
5. **Legacy listings** (already published, unmarked) are out of scope for enforcement; a separate backfill decision (re-derive watermarked copies?) is listed in §8.

Staging validates steps 1–3 only.

---

## 4. Costs (estimates — every figure is **unverified** unless a source is named)

| Item | Estimate | Basis / caveat |
|---|---|---|
| Google Vision (Label + SafeSearch + OCR) | ≈ $0 for the first 1,000 images; ≈ $3 / 1,000 after (SafeSearch assumed free with Label — **not confirmed**) | Google pricing page read 2026-10-17, not console-reconciled. Object Localization $2.25/1,000 extra only when ambiguous |
| Planned staging test set | **~300 images ⇒ well inside the free 1,000/feature** if billing works as read; worst case (no free tier honoured) ≈ $1–2 | Budget cap below makes this moot |
| Cloudflare Workers Paid | ≈ $5/month minimum (recalled; **verify on the Cloudflare pricing page**) | Likely required (free plan CPU limit). Cancel/downgrade after staging if not proceeding |
| Cloudflare Images binding transforms | **Unknown** — free allowance for the binding not found | Check dashboard billing after the first 50-image run before running the full set |
| R2 storage/ops | ≈ pennies at <1 GB (free tier covers 10 GB-month, recalled; **verify**) | Delete both staging buckets in teardown |
| Supabase staging | Free tier project, or Pro ≈ $25/month if free limits/Edge Function features block (recalled; **verify**) | Pause/delete after |
| Review/engineering labour | Not priced | |
| **Proposed hard ceiling for the whole staging phase** | **US$20 total**, Google budget alert at $5, hard cap/disable key at $10 | Owner to confirm or change at [APPROVAL] gate S4 |

Billing is only enabled at S3/S4, only after that step's approval, and the budget alert is created **before** the first paid call.

---

## 5. Execution steps

Each step lists: what, resources, verification (evidence to record), rollback, approval.

### S0 — Local preparation (free, no approval beyond this plan)
- Build the controlled test set (§6) on disk, outside the repo, with a manifest (`expected outcome`, source/licence).
- Implement locally and unit/PGlite-test: §3 mode ladder, `STAGING_NO_DELETE` guard, derivative-aware image URL helper (§7), wiring for edit/web/bulk (§7). Run full `npm test` + PGlite suites.
- Fix `wrangler.toml` into `wrangler.staging.toml` with staging names; **placeholders stay placeholders until S3**.
- **Exit:** all local suites green; diff reviewed by the owner. **Rollback:** discard branch. **No external effect.**

### S1 — Approvals and pre-flight **[APPROVAL: spend ceiling, accounts, scope]**
- Owner confirms: US$20 ceiling; who owns the Cloudflare/Google accounts; staging Supabase choice; that no production resource is touched.
- Confirm counsel has been sent `COUNSEL_BRIEFING_IMAGE_SAFETY.md` (sending is the owner's decision; not required for staging, **required before S9**).
- **Rollback:** n/a.

### S2 — Staging Supabase **[APPROVAL]**
- Create `suuqiye-staging` (R1). Apply migrations 0001→0048 in order via CLI against **staging only**. First verify the CLI is linked to staging (`supabase status` / project ref printed) — abort if the ref equals production.
- Deploy edge functions R2 with staging secrets. Create test accounts R11; grant moderator/admin roles.
- Verify: `select enforce from image_scan_config` → false; `npm run test:db`-equivalent suite pointed at staging passes; non-staff cannot read scan tables.
- **Rollback:** drop the staging project (nothing else depends on it).

### S3 — Cloudflare staging + Worker **[APPROVAL: enable Workers Paid if needed]**
- Create R3, R4, R5, R7, R6. Fill `wrangler.staging.toml`; `wrangler secret put` the staging service key / anon key / Vision key (Vision key from S4).
- Verify **before any image**: R4 object GET by direct URL → 401/403/404 (not 200); no r2.dev/custom domain attached to R4; Worker returns 401 without a JWT, 403 for a non-staff on `/v1/evidence` and `/v1/promote`; CORS rejects an unlisted origin.
- **Rollback:** `wrangler delete` the Worker; delete both buckets (empty first); revoke R5; cancel Workers Paid if not otherwise used.

### S4 — Google Vision staging **[APPROVAL: enable billing]**
- New throw-away project (R8); API key restricted to Vision API; **budget + alert (R9) created first**; confirm in the console where billed units appear.
- Run ~20 benign images first; reconcile billed units against expectation (resolves the SafeSearch-free-with-Label ambiguity, `IMAGE_SAFETY.md` §2) before the full set.
- **Rollback:** delete the key, disable the API, delete the project.

### S5 — Prove the watermark on real bytes (P1) 
Run through the staging Worker with the controlled set. For **each** output, record all of:

| Check | How | Pass |
|---|---|---|
| Real JPEG | download bytes; magic bytes `FF D8 FF`; decode with a library | decodes, `image/jpeg` |
| Mark is in pixels | fetch the derivative **anonymously** (no app, no overlay); compute pixel diff against a locally resized unmarked copy; render a diff heatmap | measurable repeating diagonal pattern across the whole frame, not just a corner |
| Pattern geometry | inspect at 100%: tile spacing, angle ≈ −30°, opacity ≈ 32 %, halo present | matches `watermarkLayout` |
| Readability | view on light, dark, busy, and low-contrast photos; OCR the output with the same Vision call | text legible on all; OCR reads "Suuqiye" (also confirms the own-brand rejection path would trigger on a re-upload) |
| Font | SVG `<text>` actually rendered in Cloudflare's runtime, not a tofu/default box | glyphs correct (this is the known fonts risk; **fallback = pre-rendered PNG tile**) |
| Dimensions | output vs. input aspect ratio and long edge (≤1600) | aspect preserved, no stretch/letterbox |
| Orientation | EXIF-rotated inputs (all 8 orientations) | upright output |
| Metadata | `exiftool`/equivalent on the output | no EXIF/GPS/maker notes; ICC acceptable |
| Alpha / `rgba` | PNG-with-alpha input; transparent regions | no black/odd fill |
| Failure | feed a corrupt file, a 0-byte file, an oversized file, HEIC, a truncated JPEG | clean typed error, **no public write**, private state consistent |
| Idempotence | same photo twice; derivative of a `wm/` key as input | no double mark; second run reuses/rejects per policy |
| Privacy | original absent from public bucket; only `wm/…` public | confirmed by listing both buckets |

Record outputs (byte sizes, hashes, screenshots of diff heatmaps) in `docs/IMAGE_SAFETY_STAGING_RESULTS.md`. **Gate:** if the SVG-text approach fails, stop and decide on the PNG-tile fallback before continuing.
- **Rollback:** delete test objects (staging buckets only).

### S6 — Behaviour across routes and display (P1, staging app/web build) **[APPROVAL: staging EAS build, free tier]**
Build the staging app (`EXPO_PUBLIC_IMAGE_SCAN_URL` = staging Worker) and a web preview (`NEXT_PUBLIC_IMAGE_SCAN_URL`). With the test accounts:

| Scenario | Expect |
|---|---|
| Clean photo, mobile Sell | published with `wm/…` URL; marked pixels visible |
| Same via **mobile edit**, **web Sell**, **web edit**, **bulk upload** | each route scans and publishes derivative only |
| Old-build behaviour (build with env unset) | `shadow`: write allowed + `unscanned_photo_write` row; `enforce` (staging only): "update required" |
| Direct DB insert with a forged `listings/` URL (via test JWT) under `enforce` | rejected `image_not_verified` |
| Direct PUT to `r2-presign` `listings/` under `enforce` | 426 update-required |
| Duplicate, third-party-watermark text, ambiguous category | review → listing hidden, admin card shows, seller notice generic |
| Simulated Vision outage (bad key) | `check_failed`, photo held, never published |
| Admin approve / reject / promote | `/v1/promote` works; note the 404 window (`IMAGE_SAFETY.md` §7.4) and measure its length |
| Rate limit (21 scans/hour) | 21st blocked **before** any Vision call (check billed units) |

**Derivative-everywhere check (P1):** on device and in the browser, confirm the marked image is what is shown on: mobile home card, search card, listing detail, full gallery, compare, favourites, seller page; web card, web detail, web gallery, OG/share image. For each, inspect the network request URL (must be `wm/…`) and the displayed pixels. The `WatermarkOverlay` stays as a **legacy-only** fallback (non-`wm/` URLs) and must be **absent** for `wm/` URLs (no double mark). Overlay never counts as passing.
- **Rollback:** unpublish staging builds; staging data is disposable.

### S7 — Operations checks (staging)
- `purge_scan_evidence()` run manually with a shortened retention on staging; confirm it only nulls keys and returns them; Worker deletes only what is returned. **Not scheduled**; scheduling decision belongs to counsel decision 5.
- Log review of Worker + edge functions: no JWTs, keys, or photo bytes logged.
- Latency and cost: p50/p95 scan time for 1–8 photos; billed units; Images-binding charges — fill §4 with measured values.
- Teardown rehearsal.

### S8 — Staging report + stop
Write `docs/IMAGE_SAFETY_STAGING_RESULTS.md` (verified / failed / still unverified, measured costs, FP rates per category, ambiguity rate). Then **tear down or freeze** staging. **Stop and present to owner.** No production action follows automatically.

---

## 6. Controlled test set (to build in S0)

~300 images, owned/licensed, categorised and manifest-tracked: products across all 18 category ids; toy guns / kitchen knives / tools / sports gear (weapon FP); swimwear/fashion on ordinary clothing (racy FP); packaging with Latin, Somali and Amharic text; screenshots; resized/recompressed duplicates; own-brand and third-party watermark text; EXIF-rotated; PNG-alpha; corrupt/truncated/oversized/HEIC for failure paths. Excluded outright: anything adult, violent, or involving minors in any sensitive context. Stored outside the repo; no real-user content.

---

## 7. Code work required before staging can prove anything (S0 scope, all local, **[APPROVAL]** to start)

1. **Derivative URL helper** — one shared `displayImageUrl()` for app + web that returns the stored URL as-is for `wm/` keys and flags legacy URLs for the overlay fallback; replace direct uses in cards/detail/gallery/compare/OG. Unit-tested.
2. **Wire edit-listing (mobile + web), web Sell, bulk upload** to the scan client (flag-gated like preview.tsx). Bulk upload needs a design decision: per-row scan cost/limits (20 scans/hour/user will be hit by a business uploader) — **open decision**, do not wire silently.
3. **Mode ladder + `unscanned_photo_write` log + update-required error** (§3), PGlite-tested including rollback to `off`.
4. **`STAGING_NO_DELETE` guard** in `pipeline.ts`; test that no original is ever deleted when set.
5. so/am strings for `update_required` etc. — flagged for native review; the repo test requires every en key in so/am.

---

## 8. Approvals and decisions register (what must exist, and when)

| Gate | Needed before | Owner | Status |
|---|---|---|---|
| This plan + US$20 ceiling | S1 | Owner | **Pending** |
| Start S0 code work (§7) | S0 | Owner | **Pending** |
| Staging Supabase project/migrations | S2 | Owner | Pending |
| Workers Paid / Cloudflare resources | S3 | Owner | Pending |
| Google billing | S4 | Owner | Pending |
| Staging EAS build | S6 | Owner | Pending |
| Bulk-upload scan policy (limits/cost) | S0 item 2 | Owner | Open |
| Legacy-listing backfill decision | before production | Owner | Open |
| Counsel: jurisdiction, quarantine vs deletion, retention, reporting, designated person | **before any production workflow** | Counsel + Owner | **Open — not resolved by staging** |
| CSAM detection option chosen, integrated, signed off | **before any production publication via this pipeline** | Owner + Counsel | **Open — not implemented** |
| Google data-processing / privacy policy update | before any real user photo | Counsel + Owner | Open |
| Somali/Amharic native review | before release | Reviewers | Open |

Anything involving suspected illegal material (handling, deletion vs preservation, reporting) is **explicitly out of scope for engineering decisions in this plan**.

---

## 9. What staging does NOT approve

Passing every check above does not authorise: production migration 0048, production Worker deploy, enabling billing for production, shipping scan-aware production clients, flipping `shadow`/`enforce`, closing `listings/`, or scheduling purge. Each is a separate approval, and the production CSAM/legal gates in §8 block the public photo pipeline regardless of staging results. Production sequence (for reference, later, each step separately approved): migration with `mode=off` → Worker → scan-aware client release → `shadow` → minimum-version gate → `enforce` → close `listings/` → sweep.

## 10. Rollback summary

| Layer | Rollback |
|---|---|
| Staging DB | delete project (disposable) |
| Staging Worker/buckets/token | `wrangler delete`, empty+delete buckets, revoke token |
| Google | delete key/API/project; billing account unlinked |
| Staging builds | unpublish / ignore |
| Local code | branch discard; migration has a tested rollback to `enforce=false` |
| Money | hard ceiling + alert set before first paid call; kill switch = delete the Vision key |
