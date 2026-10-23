# Image protection parity — route-by-route audit

Written 2026-10-17. Every row was traced through the actual code (not inferred from a helper's name). "Before" is the state at the start of this work; "After" is the state of the working tree **now** (nothing committed, deployed, migrated or billed). Protection that depends on a rollout mode says so — *no route is protected in production, because none of this is deployed.*

Vocabulary: **mode** = `image_scan_config.mode` (`off` → `shadow` → `enforce`, migration 0050). **Derivative** = the watermarked JPEG the scan Worker publishes under `wm/…`. **Legacy path** = presigned PUT into the public `listings/…` folder.

## A. Upload / publish routes

| # | Platform · route | Before: actual flow | Before: protected? | After (this work) |
|---|---|---|---|---|
| 1 | **Mobile · create listing** (`app/post/preview.tsx`) | If `EXPO_PUBLIC_IMAGE_SCAN_URL` was set at *build time*: photos → Worker `/v1/scans`, derivative URLs published. Otherwise `uploadListingImages` → `lib/r2.ts` → `r2-presign` → public `listings/{uid}/{draft}/{uuid}.jpg`, unscanned, unmarked. | Only on a build with the URL; the Worker was undeployed, so **no** | Server policy decides (`decidePublishPath`): scan / legacy / **blocked "update required"**. Scan failures, DB refusals (`image_not_verified`, `image_rejected`) and presign refusals each show a specific message. "Publish for review" hidden when a held photo would 404 (non-enforce). |
| 2 | **Mobile · edit listing** (`app/listing/edit/[id].tsx`) | `uploadListingImagesStrict` → legacy public path. **No scan call at all.** | **No** | New/replaced photos are scanned (only those; kept photos are untouched). Same policy, sheet, and error mapping as #1. Legacy upload remains only for `off` mode on builds without the scan URL. |
| 3 | **Mobile · replace image / multi-image** | Same code as #2 (replace = remove slot + add local uri; multi = up to 5 slots, `UPLOAD_CONCURRENCY` parallel). | **No** | Covered by #2: all new local URIs in one scan request (≤ 8 per request by Worker limit). |
| 4 | **Mobile · bulk upload** (`app/business/bulk-upload.tsx`) | CSV `image_urls` (any `http(s)://` URL, **remote, never fetched**) inserted **directly** into `listings.images`. No upload, no scan, no watermark, hot-linked third-party images. | **No** (and not even an R2 object) | While the server is `enforce`: rows go to the **bulk queue** (0051). Otherwise legacy insert (unchanged; counted as *unverified* in shadow mode). See `IMAGE_PARITY_REPORT.md` § Bulk. |
| 5 | **Web · Sell / create** (`web/src/app/sell/page.tsx`) | `uploadToR2` → `r2-presign` → public `listings/…`. No scan. | **No** | Same policy gate as mobile; scan dialog (`ImageScanDialog`); derivatives adopted, nothing uploaded from the browser on the scan path; cleanup of abandoned derivatives via `r2-delete`. |
| 6 | **Web · edit / replace / multi** (`web/src/app/listing/edit/[id]/page.tsx`) | `uploadToR2` per new file → legacy public path. | **No** | Same as #2 for the browser. |
| 7 | **Web · bulk upload** | **Does not exist** (no route, no component). | n/a | Not built. Stated so nobody assumes parity: bulk is mobile-only today. |
| 8 | Direct API: `supabase.from('listings').insert/update` with any image URL | Allowed (RLS only checks ownership). | **No** | `enforce`: trigger `trg_listing_image_scan` refuses any added photo without a finished scan by *this* user for *this* listing id (PGlite-tested incl. borrowed scans, other users' scans, unfinished scans). `shadow`: allowed but **recorded**. `off`: allowed. |
| 9 | Direct API: `r2-presign` for `listings/…` then PUT | Always issued a public-bucket upload URL. | **No** | `legacy_presign_closed` (only settable in `enforce`) → HTTP 426 `update_required`. Unreadable flag → 503 for listings only. Flag missing (0050 not applied) → open. `wm/`, `orig/`, `pending/` can **never** be requested (`isAllowedFolder`). |
| 10 | Avatars, business logo/banner (`avatars/`, `business/`) | `uploadToR2` → presign. | Not scanned | **Out of scope** — not listing images; unchanged and unaffected by the closure. Listed so the gap is explicit. |
| 11 | Chat images | Chat is text-only (migration 0037); no upload folder. | n/a | Unchanged. |

### Per-route trace of the *new* scan path (identical on mobile and web)

| Step | Where | Notes |
|---|---|---|
| Upload destination | Worker `POST /v1/scans` (multipart) → **private** R2 `orig/{uid}/{listing}/{sha}.bin`; derivative → public `wm/listings/{uid}/{listing}/{uuid}.jpg` (or private `pending/…` if held) | The client never writes to a bucket on this path. |
| Authorization | Supabase JWT verified by the Worker (`/auth/v1/user`) | |
| Validation | magic bytes (JPEG/PNG/WebP only, HEIC refused), size, dimensions; **orientation must already be upright**; derivative **stripped of EXIF/GPS/XMP/IPTC, re-read, size re-checked, mark verified on pixels** — any failure aborts the whole scan before a public write | `workers/image-scan/src/pipeline.ts`, `lib/jpegMeta.ts` |
| Scan result handling | `decideBatch` → `approved` / `pending_review` / `needs_changes`; provider outage = `check_failed` + `canRetry` (a retry **really re-scans** — fixed, see report) | |
| Watermark | Worker bakes it into pixels: SVG overlay first, **pre-rendered PNG tile fallback** (`WATERMARK_MODE`) — each verified | Cloudflare behaviour **unverified** until staging |
| Stored URL/key | `listing_scan_images.public_url` / `public_key`; app stores `images` = derivative URLs, `image_public_ids` = `wm/…` keys | `r2-delete` now accepts the owner's `wm/listings/{uid}/{listing}/{uuid}.jpg` keys |
| Publication gate | DB trigger (enforce) — the *only* gate; clients do not decide | |
| Failure behaviour | Fail closed; specific retry / update-required / replace messages (en/so/am; web English copy kept identical by test) | |

## B. Display surfaces

New protected photos need no viewer logic: they are already marked and the viewer overlay is **skipped for `/wm/` URLs** (no double mark). The overlay is a legacy-only deterrent and is **not** evidence a photo is protected.

| Surface | Image source | Legacy (unmarked) photo | New photo |
|---|---|---|---|
| Mobile feed / cards (`components/ListingCard.tsx`, compare card, my-listings, chat header) | `listing.images[…]` URL | plain | derivative URL (marked) |
| Mobile listing detail (`app/listing/[id].tsx`) | same | plain | derivative |
| Mobile full-screen gallery (`ZoomableImage` via `app/listing/gallery/[id].tsx`) | same | **viewer overlay** | derivative, overlay skipped |
| Web feed / cards (`web/src/components/ListingCard.tsx`) | same | plain | derivative |
| Web listing detail hero + thumbnails | same | **overlay (new)** on hero | derivative, overlay skipped |
| Web lightbox | same | **overlay (new)** | derivative, overlay skipped |
| Admin listing/report views (web) | same URLs | plain | derivative; held originals only via staff-gated Worker `/v1/evidence` |
| Share / preview images | **None exist.** Mobile `Share.share` sends text only; web has no share action and no `og:image`/metadata. | n/a | If OG tags are ever added they must use `images[0]` (derivative) — never a key under `orig/` or `pending/` (a test fails if client code references those namespaces). |

Held (sensitive) photos stay private under `pending/` until staff approve; the listing is hidden by the database trigger in `enforce` mode. Outside `enforce` there is nothing to hide the listing, so the apps **do not offer** "publish for review" for such photos.

## C. Things this audit found that were not in the brief

1. **Bulk upload hot-links arbitrary remote URLs** (row 4) — the largest hole; it never even touched our storage.
2. **A retry after a provider outage could never succeed**: the Worker returned the stored "provider unavailable" answer for the same photos forever (idempotency check ignored `canRetry`). Fixed + tested.
3. **Rejected-original deletion** was automatic for any `prohibited_content`/`weapon` reject (an irreversible retention decision, no CSAM branch). Now **retained by default**; deletion is an explicit env opt-in (`REJECTED_ORIGINAL_POLICY=delete`).
4. **`supabase/migrations/0049_sell_server_validation.sql` could not be applied** (PL/pgSQL ended an `IF` at the `THEN` inside a `CASE`). One-line fix; the full-chain `report_notify` suite then needed one fixture field (photos ≥ 1).
5. **No derivative could be deleted by its owner** (`r2-delete` only knew `listings/…`): deleting a listing or removing a photo would have left `wm/…` objects forever. Ownership of `wm/listings/{uid}/{listing}/{uuid}.jpg` added.
6. **Abandoned scans leave public derivatives** (scan publishes before the listing exists). Web deletes them best-effort; mobile does not. A server-side orphan sweep is **not built** — open decision.
7. **No forced-update / minimum-version mechanism exists** in either app (searched). The rollout therefore uses *shadow-mode measurement* instead of a version number.
