# Suuqiye listing photo safety — implementation report

Status: **built and tested locally; nothing committed, deployed, migrated, or billed.** Enforcement ships OFF.

## 1. Architecture and provider decision

Audit of what existed: the phone resizes each photo to a 1600 px JPEG and PUTs it, via an `r2-presign` URL, into the **public** R2 bucket. The public URL is saved straight into `listings.images`. No server ever looked at the pixels, originals were public, there was no watermark, and `lib/imageModeration.ts` only guessed "screenshot" from file name/aspect ratio. No Vision/Workers AI/Worker existed. The moderation system (migrations 0027/0039/0047: `moderation_events`, `moderation_notices`, `admin_audit_log`, `staff_can()`) was reusable and is extended, not replaced.

Chosen design (matches the brief; you approved the Worker + core-first + hold-for-review):

| Concern | Where |
|---|---|
| Auth, scan state, hashes, review, audit, enforcement | Supabase (migration 0048) |
| Original photos (private), held derivatives | Cloudflare R2 **private** bucket |
| Watermarked public derivatives (`wm/…`) | Cloudflare R2 public bucket (existing) |
| Orchestration, normalise, watermark, hash | Cloudflare Worker `workers/image-scan` (Images binding) |
| Labels, SafeSearch, OCR, objects | Google Cloud Vision REST (key in Worker secret) |
| Policy (what each signal means) | `lib/imageSafety.ts` — pure, shared by Worker, app and tests |

Not chosen: Workers AI (no image-safety model verified for this), a GPU host (not needed), image-text similarity (CLIP) — the policy accepts `categoryProbs` when a model is added, but **no similarity model is integrated**; category matching currently uses Vision labels/objects plus the seller's own title/description words.

## 2. Cost assumptions

**Decision:** Google Cloud Vision Label Detection + SafeSearch + OCR is the **initial general image-screening candidate** (nothing is enabled or billed). It is *not* a CSAM control — see section 3.

Source: [Google Cloud Vision pricing](https://cloud.google.com/vision/pricing), page opened and read **2026-10-17** (the page shows no "last updated" date). Rates were **not** reconciled in a billing console; confirm in the console before enabling billing. Older third-party articles quote higher, outdated rates.

| Feature | First units / month | Units 1,001 – 5M | Units 5,000,001+ |
|---|---|---|---|
| Label Detection | 1,000 free | $1.50 / 1,000 | $1.00 / 1,000 |
| Text (OCR) detection | 1,000 free | $1.50 / 1,000 | $0.60 / 1,000 |
| SafeSearch (explicit content) | 1,000 free | "Free with Label Detection, or $1.50" | "Free with Label Detection, or $0.60" |
| Object Localization | 1,000 free | $2.25 / 1,000 — **extra, only when invoked** | $1.50 / 1,000 |

The page's SafeSearch wording is exactly the quoted table cell; it has no explanatory prose. This document assumes SafeSearch is requested together with Label Detection and costs $0 then, but the page does **not** state how "with" is defined (same image, request or month), whether SafeSearch units still count against its own 1,000 free allowance, or the billing-unit rules. **Unverified: confirm with Google billing documentation or a staging billing test.** The table shows free allowances per feature; that they are consumed independently is our reading of the table, not an explicit statement.

Estimates, **Vision feature charges only** (two billable features, Label + OCR, with SafeSearch assumed free alongside Label as above). They are **not** total system operating costs: they exclude Cloudflare Workers/Images/R2, Supabase, review labour, taxes and any CSAM service:

| Setup | /1,000 imgs | 1k | 10k | 100k |
|---|---|---|---|---|
| Label + SafeSearch + OCR (every image) | $3.00 | $0 | ≈$27 | ≈$297 |
| + Object Localization on every image (upper bound) | $5.25 | $0 | ≈$47 | ≈$520 |

Arithmetic: 10k → ((10,000 − 1,000) / 1,000) × $1.50 × 2 = $27; 100k → ((100,000 − 1,000) / 1,000) × $3.00 = $297. With Object Localization on every image ($5.25 per 1,000 images): 10k → 9 × $5.25 ≈ $47; 100k → 99 × $5.25 ≈ $520. Treat these as estimates, not quotes.

Implemented: Object Localization only when labels don't already show the category (and never for lenient categories), so real cost lands between the two rows. Per photo = 1 Vision call, 2 when ambiguous. Plus: Cloudflare Workers **Paid** is likely required (free plan = 10 ms CPU/request); Images-binding transform pricing and R2 storage/ops not priced here (free allowance for the binding not found). Latency: unmeasured. A failed/timed-out provider call retries once (8 s timeout) then holds the photo for review.

## 3. CSAM — separate launch requirement (decision, not yet implemented)

**SafeSearch is not CSAM detection.** It classifies adult/racy/violence likelihood; it does not match known abuse material and does not reliably identify new material involving minors. Nothing in this document or the code may be described as CSAM protection. "Adult" or "racy" results must never be presented as covering it.

**Decisions**
1. CSAM detection is a **launch gate**, tracked separately from the general scan. Public publication of photos must not be enabled for production until a specialist detection option, a written policy and a staff escalation path exist.
2. **Suspicious uploads are not published.** Until that path exists, `EXPO_PUBLIC_IMAGE_SCAN_URL` stays unset and `image_scan_config.enforce` stays OFF in every environment that touches real users' photos — i.e. no new public photo pipeline goes live.
3. **No illegal imagery is collected, generated, stored or circulated for testing** — by us, contractors or tools. Provider integration tests use vendor-supplied test vectors/sandbox mechanisms only, or are mocked and labelled as such.
4. **Conflict to resolve with counsel before launch:** the current, **undeployed** Worker pipeline code (`workers/image-scan/src/pipeline.ts`) *deletes the private original immediately* when a rejected photo carries **either** the `prohibited_content` **or** the `weapon` issue (`prohibited_content` is set by SafeSearch adult/violence VERY_LIKELY; `weapon` by a confident weapon detection). **There is no separate suspected-CSAM branch in this code**: if suspected CSAM were ever classified into either issue, the original would be deleted. *Implementation status:* the behaviour exists in code and is unit-tested with fake storage only (the test asserts deletion for the `prohibited_content` path; the `weapon` path's deletion is read from the code, not separately asserted). The Worker is not deployed, migration 0048 is not applied, and enforcement is OFF with `EXPO_PUBLIC_IMAGE_SCAN_URL` unset (per checks already performed; not re-verified in this edit). **Production storage, actual access controls, log handling and real-world retention have not been verified because the system is not deployed.** Nothing in this document states that suspected-CSAM material has been stored or deleted anywhere. If material that may be apparent CSAM is ever involved, immediate deletion may conflict with legal preservation duties, while broad or indefinite retention carries its own legal and safety risk. Ordinary policy violations and suspected illegal material therefore need **separate handling**: a counsel-reviewed, restricted-access process for suspected illegal material, with no automatic deletion and no staff viewing beyond what counsel approves. **This document does not prescribe a retention period, viewing permissions or a reporting procedure** — those stay open until legally verified and approved. Do not apply a blanket "keep every rejected image for a year" rule.

**Options to research (checked 2026-10-17 against third-party summaries only; no vendor documentation was read and no enquiry was made. Every attribute is unverified unless a Status cell says otherwise; none is confirmed as a suitable pre-publication solution for Suuqiye.)**

| Option | What it is (as reported) | Access / price (as reported) | To confirm | Status |
|---|---|---|---|---|
| Microsoft PhotoDNA Cloud Service | Hash matching against known material | Reported free for vetted organizations; application + approval before keys | Eligibility for a small non-US-based marketplace; terms; API limits | Eligibility, pricing, API fit, pre-publication capability: **unverified** |
| Thorn Safer | Hash matching plus classifier for new material; hosted or self-hosted | Reported paid, custom pricing, vetted | Quote; fit for a ~photo-upload volume; reporting integration | Eligibility, pricing, API fit, pre-publication capability: **unverified** |
| Google Content Safety API / CSAI Match | Classifier (images) / video hash matching | Reported free to qualifying partners by application; one report says an applicant was declined | Whether we qualify | Eligibility **unverified** (one report of a declined applicant); other attributes **unverified** |
| Cloudflare CSAM Scanning Tool | Scans cached content against NCMEC-sourced hashes, notifies the site owner | Reported as offered to Cloudflare customers; no pricing/eligibility found | Whether it covers our R2/Worker path (it scans *served/cached* content, which may be after publication) — a pre-publication check is what we need | **Classified unsuitable as a pre-publication gate** unless official Cloudflare documentation proves otherwise; eligibility and pricing **unverified** |

For each, record: API availability and latency, pricing at our volume, **false-negative limits** (hash matching only finds *known* material; classifiers miss and over-flag; no tool is complete), what image data leaves our systems and where it is processed, the vendor's retention, and onboarding time. Residual risk after any option is non-zero, and the policy must say so.

**Legal / process questions for counsel (not answered here)**
- Which jurisdictions apply to us, our providers (Cloudflare, Supabase, Google) and our users, and whether US duties apply to Suuqiye at all. **Applicability, jurisdiction and operational duties are for qualified counsel; nothing below is legal advice.**
- Statute text read 2026-10-17 at [Cornell LII, 18 U.S.C. § 2258A](https://www.law.cornell.edu/uscode/text/18/2258A) (a secondary reproduction, not the official U.S. Code or Statutes at Large; counsel should work from official text), by type of obligation:
  - *Mandatory reporting:* a "provider" with actual knowledge of facts showing an apparent violation of the listed child-exploitation statutes must report to NCMEC's CyberTipline as soon as reasonably possible (§ 2258A(a)).
  - *Discretionary reporting and report contents:* reporting planned or imminent violations is permitted, and including depictions, identifying data or the full communication is at the provider's option (§ 2258A(b)).
  - *Preservation:* a CyberTipline submission is treated as a request to preserve the reported contents for 1 year (voluntarily longer); preservation is to follow the NIST Cybersecurity Framework within a stated period (per the amendment notes this is § 2258A(h); Pub. L. 118-59, the REPORT Act, 2024, replaced 90 days with 1 year and added the NIST paragraphs). Whether and how this reaches Suuqiye is for counsel.
  - *Penalties:* knowing and willful failure to report: up to $600,000 first / $850,000 subsequent violation for providers under 100M monthly active users ($850,000 / $1,000,000 at or above), per the same source; Pub. L. 118-59 raised these amounts.
  - *Pub. L. 119-60* (div. H, title LXXXII, § 8202(i), Dec. 18, 2025) appears in the Code's source notes as amending § 2258A. Only secondary annotations were found (one reports it added "and all supplemental data included in the report" to a subsection (c) introduction). **Its primary text was not verified; the amendment's content is unverified**, and whether any later law changed § 2258A was not checked.
- Who is the designated, trained person; how reports are filed; secure evidence storage; staff welfare; what the seller is told (generic notice only, no accusation).
- Retention and access rules that override the 30-day `evidence_retention_days` default for any flagged item — to be set by counsel, not engineering.

**Missing today:** no CSAM provider, no quarantine state in migration 0048, no escalation role/runbook, no reporting workflow.

## 4. What was built (all local)

**New**
- `lib/imageSafety.ts` — decisions, thresholds (`POLICY`), per-category keyword policy for all 18 category ids, OCR watermark reading, dHash/Hamming, scan fingerprint, tiled-watermark layout, contain-fit maths.
- `lib/imageScanState.ts`, `lib/imageScan.ts` — cache by content/context, in-flight de-duplication, upload to Worker, result → UI rows. Inactive unless `EXPO_PUBLIC_IMAGE_SCAN_URL` is set.
- `components/ImageScanSheet.tsx` — one "Checking your listing" overlay, then one consolidated result (grouped issues, thumbnails of only affected photos, Replace / Try again / Publish for review).
- `components/WatermarkOverlay.tsx` + `ZoomableImage.tsx` — tiled mark drawn over the image rectangle inside the zoom/pan layer.
- `workers/image-scan/` — `pipeline.ts` (tested), `vision.ts` (mapping tested), `cloudflare.ts`/`index.ts`/`wrangler.toml` (**unverified, not deployed**).
- `supabase/migrations/0048_listing_image_scans.sql` (**unapplied**), `supabase/tests/image_scans.test.mjs`.
- `web/src/services/adminScans.ts`, `web/src/components/PhotoChecksCard.tsx` — staff review on the admin listing page.

**Modified**: `app/post/preview.tsx` (flag-gated), `locales/en/translation.json` (`imageScan.*`), `tsconfig.json` (exclude `workers/**`), `tsconfig.test.json`, `supabase/tests/run-all.mjs`, admin listing page (one card).

## 5. How each requirement is met

- **Watermark**: Worker bakes "Suuqiye" tiled at −30°, 32 % opacity, white with dark halo, sized to the image (`watermarkLayout`). Text only — **no logo was invented**; the approved monogram in `assets/brand` is not used. Each derivative is verified (`markIsPresent`: still the same picture by thumbnail, but measurably different pixels) before anything is published; one failure aborts the whole scan before any public write. Input is always the private original, never a `wm/` file, so no double mark; OCR also rejects photos already reading "Suuqiye".
- **Screenshots**: normal screenshots are allowed. Legacy photos get the overlay in the full-screen viewer; new `wm/` derivatives already carry the mark, so the overlay is skipped for them (no double marking). **No client can prevent screenshots, cropping, re-photographing or removal; this is deterrence and traceability only.**
- **Watermark detection**: OCR only (own brand → reject; ≥2 mentions or a URL-shaped mention of another marketplace → reject; a single mention → review; ordinary product text → pass). There is **no visual watermark detector**, so logo-only or text-free watermarks are not caught.
- **Duplicates**: 64-bit dHash, Hamming ≤ 6 against other users' published photos → review, never rejection or accusation; same owner → ignored; identical photo twice in one batch → fix. Lookup returns distance + "same owner" only. Repeated hits (≥3 in 7 days) flag staff. dHash misses rotation, heavy crops, overlays.
- **Content**: SafeSearch adult/violence VERY_LIKELY → reject (`prohibited_content`); LIKELY → review; racy only VERY_LIKELY → review (swimwear/fashion tolerance). Weapons: Vision label/object ≥0.85 → reject outside toy/sport/tool contexts; ≥0.6 → review. **Deletion (code only, undeployed):** in the Worker pipeline, a rejected photo with `prohibited_content` **or** `weapon` has its private original deleted immediately; no separate suspected-CSAM branch exists, so suspected CSAM classified into either issue would be deleted (see §3 decision 4). Weapon recall of Vision is **unverified**; **CSAM detection is not implemented and SafeSearch does not provide it** — see section 3 (launch gate).
- **Category**: keyword evidence from labels/objects + title/description words; mismatch requires another category ≥0.8 and own <0.3; unclear → "couldn't confidently identify" (review). Services/jobs/business and unknown ids are lenient. People are never penalised.
- **Outage**: provider failure → `check_failed`, photo held (derivative private), "Try again" or "Publish for review". Never silently safe.
- **Server enforcement** (migration 0048, when `image_scan_config.enforce`): client writes may only add photos from a finished scan by the same user for the same listing id; rejected photos can't publish; review photos force the listing into the existing hidden `deactivated` state; clients can't read/write scan tables; duplicate scan jobs collapse on `(user, listing, fingerprint)`; rate limit 20 scans/hour/user before any paid call; fingerprint computed server-side from bytes.
- **Admin**: moderator/admin see issues, signals, photo (on click, via staff-only Worker endpoint), approve/reject/request-replacement with required internal reason; audit row + seller notice contain only the generic text and the public message. Only an admin can override a clear automatic reject.
- **Retention**: `purge_scan_evidence()` (service role) nulls private keys/signals after `evidence_retention_days` (30) and returns keys for the Worker to delete; photos awaiting review are kept. `purge_scan_evidence()` exists only in the **unapplied** migration 0048 with a 30-day default; **nothing schedules it, so no purge is active** (and no scan data exists in production). Production storage, access controls, log handling and real-world retention are **unverified** because nothing is deployed.

## 6. Tests — exact results

Run locally 2026-10-16:
- `npm test`: **419 tests, 419 pass** (new: 17 policy, 18 pipeline/Vision-mapping, 8 client-state).
- Database (PGlite = real Postgres, full chain 0001–0048): **all 12 suites pass**; new `image_scans` has 27 assertions (forged/foreign/unfinished scans, review hold, hidden from public, staff-only evidence, replacement flow, audit/notice privacy, hash-lookup privacy, retention, rollback to OFF).
- `tsc` app: clean. Worker: clean (strict, DOM lib). Web: no errors in new files. ESLint on changed app files: only the 11 findings already present in `ZoomableImage.tsx` at HEAD.

**Verified vs mocked (as of 2026-10-17).**

| Verified by running | Mocked / fixture only | Not verified at all |
|---|---|---|
| Policy logic, pipeline orchestration, Vision-response mapping, client state, SQL (PGlite) | Every Vision signal (hand-written fixtures shaped like Vision output); Cloudflare bindings (fakes) | Live Vision, R2, Images-binding or Worker calls; latency; real cost; FP/FN rates; weapon/category recall; viewer overlay on device; any CSAM provider; Google pricing in a billing console (only a search snippet of the pricing page was seen) |

Thresholds are starting values.

**Controlled test set (planned, not built).** Lawful, non-sensitive images only: products across the 18 categories, toy guns/tools/sports gear, packaging text, people in ordinary clothing, screenshots, resized/recompressed duplicates, own-brand and third-party watermark text. Photos we own or have licensed; no personal data, no real user uploads, no adult or violent content, and **nothing that depicts or could be mistaken for minors in a sexual context**. SafeSearch adult/violence recall is therefore **not measurable by us**; we measure only false positives on benign images (e.g. swimwear/fashion, kitchen knives, anatomy-like product shapes) and category relevance, and rely on vendor documentation for the rest. Record per-image expected outcome, Vision output, and decision; report FP rate per category and ambiguous-rate (extra Object Localization cost).

## 7. Not done / remaining risks (read before enabling)

1. **Edit-listing, web Sell, and bulk upload are not wired** to the scan, and the legacy public upload path (item 2) remains. With `enforce = true` they would fail to add new photos, and until the legacy path is closed users could bypass the checks. Wire them (or keep enforcement off) before flipping it.
2. **Originals are still public until the legacy path is closed**: `r2-presign` still issues public `listings/…` PUT URLs. After rollout, remove the `listings/` folder from `isAllowedFolder`.
3. **Unverified Cloudflare assumptions** (nothing has run against live Cloudflare; check first in staging): R2 private-bucket and Worker binding behaviour, Images-binding transform behaviour and pricing, SVG `<text>` overlay in `draw()` (fonts!), `rgba` output, EXIF orientation/GPS stripping, and Vision's weapon/category/SafeSearch model performance. Fallback: pre-rendered PNG tile from the brand font.
4. Held (sensitive) photos are private until staff approve; admin UI calls approve then `/v1/promote` — a short window where the restored listing's image 404s, and a failed promote needs the "Publish photo" retry.
5. so/am `imageScan.*` strings are my own translations (the repo requires every English key) — **have native speakers review them before release**.
6. No image-text similarity model; no visual watermark detector; **no CSAM service (launch gate, section 3)**; legacy listings are unscanned.
7. Vision limitations: SafeSearch is likelihood-based and can miss or over-flag; label/OCR are English-biased and weak on Somali/Amharic text; images are sent to Google (privacy policy and data-processing terms need updating and review before enabling).
8. `image_hashes` lookup is a sequential scan — fine to ~100k photos; needs bucketed/BK-tree indexing beyond.
9. HEIC is refused server-side (the app already re-encodes to JPEG).

## 8. Credentials / config needed (none exist yet)

Provider credentials are **server-side only**: `VISION_API_KEY`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY` (and any future CSAM-vendor key) live as Cloudflare Worker secrets. Never in `EXPO_PUBLIC_*`, `NEXT_PUBLIC_*`, `app.json`, the repo or logs; the client talks only to the Worker with the user's Supabase session. Cloudflare: private R2 bucket, Workers Paid, Images binding. Google: Cloud project with billing + Vision API, key restricted to Vision API (and the Worker's egress if possible), budget alert. App/web env (non-secret URLs only): `EXPO_PUBLIC_IMAGE_SCAN_URL`, `NEXT_PUBLIC_IMAGE_SCAN_URL`. Fill `wrangler.toml` placeholders.

## 9. Staging plan and approval gates

**Nothing below happens without explicit approval of the specific step:** no paid-service activation (Google billing, Workers Paid, CSAM vendor), no production deployment, no production migration, no commit.

1. **Now (free, local):** finish this plan; draft the CSAM policy and counsel questions; apply to the CSAM vendors (PhotoDNA, Safer, Google, Cloudflare) — applications/enquiries cost nothing but need your approval to send, since they disclose business details.
2. Build the controlled test set (section 6) from lawful, non-sensitive images.
3. *(needs approval: enable billing)* Throwaway Google project with a low budget cap and alert; run the test set through Vision; record FP rate, category relevance, ambiguous-rate, latency, actual billed units; reconcile against the cost table; tune `POLICY`.
4. *(needs approval)* Apply 0048 to a **staging** Supabase only; run PGlite suite plus a manual pass. Enforcement OFF.
5. *(needs approval)* Deploy the Worker to staging with a restricted key; verify the three Cloudflare assumptions with real photos; confirm originals are not publicly reachable.
6. Staging app build with `EXPO_PUBLIC_IMAGE_SCAN_URL`: clean / watermarked / duplicate / outage-simulated listings; admin card and notices. Staging uses only test accounts and the controlled set.
7. **CSAM gate:** chosen provider integrated and tested (vendor test mechanisms or mocks, clearly labelled), quarantine state and runbook in place, counsel sign-off. Until then, no production rollout of the public photo pipeline.
8. Wire edit/web/bulk; schedule `purge_scan_evidence()`; production migration, Worker, app release with enforcement OFF (each needs approval); watch cost and review queue.
9. Flip `enforce` only after old app versions that bypass the scan are gone or force-updated; then close the legacy `listings/` presign folder.

## 10. Decision register (nothing resolved)

Nine decisions as listed in the source-verification audit (supplied by the owner 2026-10-17). Status is **Open** for every row: no item has evidence of resolution. Ordering shows dependencies: 1 gates 2, 4 and 5; 2 and 5 gate 3's reporting integration; 7 gates any spend or vendor contact.

| # | Decision needed | Current evidence | Accountable reviewer | Prerequisite to proceed | Status |
|---|---|---|---|---|---|
| 1 | Legal coverage and applicable jurisdictions (Suuqiye, its providers, its users) | § 2258A text read via secondary source (§3); applicability unassessed; Pub. L. 119-60 text unverified | Counsel | Counsel opinion working from official statutory text | Open |
| 2 | Quarantine vs. deletion, access restrictions and preservation for suspected illegal material | Undeployed Worker pipeline code (`workers/image-scan/src/pipeline.ts`) deletes the private original of a rejected photo carrying `prohibited_content` or `weapon`; this has only been unit-tested with fake in-memory storage (`tests/imageScanPipeline.test.ts`), which asserts deletion of the original for an adult-`VERY_LIKELY` reject (the `prohibited_content` path) but does not assert deletion for the `weapon` reject, and there is no separate suspected-CSAM branch. Production behaviour is unverified. No quarantine state exists in the current implementation (none in the Worker code or migration 0048), and nothing here is deployed; ordinary rejects and suspected illegal material not yet separated | Counsel (process), engineer (implementation) | Decision 1; counsel-approved restricted, auditable procedure. Do not assume every adult-content reject needs preservation, or that every original can safely be deleted | Open |
| 3 | A CSAM detection option that works before publication | Four options (§3), third-party summaries only; Cloudflare's tool classified unsuitable; none confirmed. Evaluate against: pre-publication scanning, eligibility for an Ethiopia-based business, documented API, false-negative limits, privacy/retention terms, reporting responsibilities, total cost | Owner, with counsel; engineer for API fit | Vendor documentation read; enquiries approved under decision 7; reporting duties known from 1 and 4 | Open |
| 4 | Reporting workflow, designated responsible person, seller communication | None exists (§3 "Missing today"); seller notice is generic only | Owner, with counsel | Decision 1; named trained person; counsel-approved wording | Open |
| 5 | Retention overrides and legally required preservation | 30-day `evidence_retention_days` default and `purge_scan_evidence()` (unscheduled) apply to everything today | Counsel | Decisions 1 and 2; retention period and access set by counsel, not engineering | Open |
| 6 | Google Vision data processing, privacy policy and data-processing terms | Photos would be sent to Google; policy/terms not updated or reviewed (§7 item 7) | Counsel, owner | Counsel review before any real user photo is processed | Open |
| 7 | Explicit approval for paid services, vendor applications and staging migrations | Nothing approved; gates listed in §9; pricing read from official page but not console-reconciled | Owner | Per-step written approval; budget cap and alert for any billing | Open |
| 8 | Somali and Amharic review, including OCR limitations | `imageScan.*` so/am strings unreviewed (§7 item 5); label/OCR English-biased and weak on Somali/Amharic text (§7 item 7) | Native-language reviewers, engineer | Review recorded; OCR limits accounted for in policy | Open |
| 9 | Complete upload-path coverage and safe retirement of the legacy public upload path | Edit-listing, web Sell, bulk upload not wired; `r2-presign` still issues public `listings/…` URLs (§7 items 1–2) | Engineer, approved by owner | Wiring built and tested; old app versions gone or force-updated before `enforce` flips and the folder is closed | Open |

Not in the register but still open: the unverified Cloudflare assumptions (§7 item 3) are checked in staging under decision 7.
