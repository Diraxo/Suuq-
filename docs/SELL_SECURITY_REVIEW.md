# Sell — security review and pre-deployment plan

Status: **review only**. Nothing was deployed, committed, migrated or built. Only client-side rule changes (§4) and a one-line edit to the *proposed* SQL were made.

Legend: **CONFIRMED** = reproduced by running code here. **REVIEWED** = read from the code/docs, not executed. **UNTESTED** = needs an environment I don't have (no Docker/Postgres/R2 here — the Supabase CLI is installed but cannot start a local DB without Docker).

---

## 1. Threat model and confirmed gaps

Attacker: any signed-in user with a hand-written HTTP client (the apps' validation is irrelevant to them).

| # | Gap | Severity | Evidence |
|---|---|---|---|
| G1 | **`r2-delete` ownership check is path-traversable.** `key.split('/').includes(userId)` accepts `x/{me}/../../listings/{victim}/f.jpg`; the URL parser normalises it and the signed DELETE hits the victim's object. Any user can delete any other user's photo if they know/guess the key (keys are in public listing URLs). This is the same bug that was fixed in `r2-presign` but `r2-delete` was never re-audited. | **High** | CONFIRMED (script: guard passes, signed DELETE target = `/bkt/listings/<victim>/abc.jpg`) |
| G2 | **The "signed Content-Type" in `r2-presign` is not signed.** aws4fetch lists `content-type` in `UNSIGNABLE_HEADERS`; the presigned URL has `X-Amz-SignedHeaders=host`. So the claim in the code comment and `SELL_AUDIT.md` §5 ("closes content-type claims") is false: a client can PUT `text/html` / `image/svg+xml` and R2 will serve it with that type. | **High** | CONFIRMED (SignedHeaders=`host`; with `aws:{allHeaders:true}` it becomes `content-type;host`). Cloudflare docs say a signed Content-Type is enforced (403 SignatureDoesNotMatch) — so the fix is real, but UNTESTED against live R2. |
| G3 | **Uploads land directly in the public namespace.** Presign issues keys under `listings/{uid}/…`, served from `R2_PUBLIC_URL` immediately. Nothing forces `r2-verify-images` to run (it isn't deployed or called). Arbitrary bytes (HTML, SVG, 5 GB blobs) are publicly served. | **High** | REVIEWED |
| G4 | **Verify-then-overwrite (TOCTOU).** A presigned PUT URL is reusable until it expires (300 s). Even if verification ran in place, the client could PUT junk to the same key afterwards. In-place verification is therefore not sufficient; the copy must be made *from the bytes the server just validated*. | Medium (design) | REVIEWED |
| G5 | **No size or quota control.** R2 presigned URLs cannot carry a size limit and Cloudflare documents `POST` (policy uploads) as unsupported, so size can only be checked after the fact. `r2-presign` has no per-user rate limit (a user can mint unlimited URLs → storage cost abuse). | Medium | REVIEWED (Cloudflare presigned-URL docs) |
| G6 | **Bulk upload bypasses the whole image pipeline.** `lib/bulkUpload.ts` accepts any `http(s)://` URL, no count cap, no host allowlist; the URL is stored in `listings.images` as-is (hotlinked/tracking/third-party content). | Medium | REVIEWED |
| G7 | Listing `images[]` is not checked to belong to the publisher or to our bucket at all (a listing may reference another user's R2 URL). | Medium | REVIEWED |
| G8 | `r2-delete` returns `String(err)` on 500 (can name secrets/config) — the `r2-presign` fix wasn't applied here. | Low | REVIEWED |
| G9 | Owner can still PATCH `created_at`, `location_id`, `updated_at` (0019 revoked only `views`/`favorites_count`; 0036 sanitises INSERT only). | Medium | REVIEWED |

Already sound (REVIEWED, not DB-tested): RLS insert `auth.uid() = user_id`; update/delete `USING auth.uid() = user_id` (Postgres reuses USING as the check for the new row, so `user_id` can't be reassigned); `removed` transition admin-only (0027); 10 listings/hour limit that idempotent retries don't consume (0031); `views`/`favorites_count` UPDATE revoked (0019). A forged `id` on upsert falls to the UPDATE half and is blocked by RLS.

---

## 2. Review of `supabase/proposed/0036_sell_server_validation.sql`

**What it proposes:** 9 `NOT VALID` CHECK constraints (price range, title/description not blank, condition enum, currency format, images 1–8, attributes shape ≤ 8 KB, features ≤ 30, seller_notes ≤ 20); trigger `listings_validate_attributes` (before insert / update of attributes; numeric ranges for 10 keys); trigger `a_listings_sanitize_new` (before insert: forces views=0, favorites_count=0, created_at/updated_at=now(), sold_at=null, status='available'; skipped for existing ids and admin/skip-rate-limit GUCs). RLS untouched.

Findings, most important first:

1. **"NOT VALID can't break existing listings" is wrong.** `NOT VALID` skips the *initial scan*, but PostgreSQL evaluates every CHECK against every new row version — including `UPDATE`s of unrelated columns. A legacy row that violates any constraint (price 0, 0 or >8 images, lower-case currency, odd condition…) would fail *every* later update: `increment_listing_views()`, the `favorites_count` trigger (so **favouriting that listing would fail**), mark-as-sold, price drops. UNTESTED (per PostgreSQL semantics; no DB available) — must be proven on a copy before applying. **Required:** run the audit queries (§C) against production first; only add a constraint once zero rows violate it, otherwise implement that rule as an INSERT/targeted-UPDATE trigger instead of a CHECK.
2. **Battery range (fixed in the file):** was `[1,100]`, now `[0,100]`. But `battery` was free text until now, so legacy values like `85%`, `90 %`, `100+` likely exist. The trigger fires on any `UPDATE OF attributes`, and the old Edit Listing sends the whole attributes object → editing a legacy listing in an old app would fail with a generic error. **Required change:** on UPDATE, skip a key whose value is unchanged (`new.attributes->>k is not distinct from old.attributes->>k`). Also confirm whether `battery` can mean something else in another category: in `data/categoryFields.ts` it appears once (phones, "Battery Health"), so the key is unambiguous today.
3. **Numeric ranges vs app schema:** the 10 trigger keys match `NUMERIC_RULES` exactly (re-checked after the battery change); `size`/`resolution` correctly excluded. The server accepts more decimals than the client (cosmetic). Non-string JSON values are rejected by the regex (good).
4. **Blank checks are weaker than the product rule.** `btrim()` only strips spaces, so a title of `"\n"` or a tab passes. Use `title !~ '\S'` (or `btrim(title, E' \t\r\n')`). Title min 1 matches the new decision; `description is null or …` still lets NULL through — "description non-empty" needs an INSERT trigger (not a CHECK, because of legacy NULLs and old bulk uploads).
5. **Sanitiser is sound but silent.** It overwrites rather than rejects (acceptable for counters; hides client bugs). `SECURITY DEFINER` isn't needed. Trigger order is correct (`a_…` sorts before `listings_link_location` and `rate_limit_listings`). Retry safety: an existing id skips the reset, so an idempotent retry cannot zero a live listing's counters. A race between two concurrent first-time upserts of the same new id is harmless.
6. **Missing protections (G9):** add `revoke update (created_at, location_id) on public.listings from authenticated` (clients never send them — verified: `dbPatch` in `store/myListings.ts` and `services/listings.ts` only sends named fields), or an UPDATE trigger that restores `old` values. `status` stays owner-writable on purpose (available/reserved/sold/expired); `removed` is guarded by 0027.
7. **images constraint will break Bulk Upload** (G6): >8 URLs, and any future "must be our bucket" rule, reject current bulk rows. Needs a product decision (§6) and a client cap before enabling.
8. `price > 0`: column default is 0, so free/"contact" legacy rows may exist — audit before validating. `currency ~ '^[A-Z]{3}$'`: check `locations.currency_codes` (0032, itself unrun) conforms.
9. **Older app versions:** none depend on out-of-range values by design, but old builds surface a raw/generic error on rejection and old *Edit* flows are affected by (2). Rollback = `drop trigger …; alter table … drop constraint …` (list in the migration to be added).

**Safe order:** (1) fix 2/4/6 in the file; (2) run audit queries on prod (read-only); (3) apply to a **throwaway Supabase project** restored from a prod snapshot and run §C tests; (4) apply constraints that audit shows clean + triggers in a maintenance window; (5) `VALIDATE CONSTRAINT` only after zero violations; (6) observe error logs 48 h.

---

## 3. Image-verification rollout (staged, backwards compatible)

**Contract the published Android app depends on** (from committed `HEAD:lib/r2.ts`): calls `r2-presign {folder,count:1}`, expects `{uploads:[{key,uploadUrl,publicUrl}]}`, PUTs with `Content-Type: image/jpeg`, stores `publicUrl` in `listings.images` and `key` in `image_public_ids`. The *committed/live* web (`HEAD:web/src/services/r2.ts`) sends `file.type || 'image/jpeg'`. Therefore:

- **Do not change `r2-presign` in place** to return staging keys or require signed headers before clients are updated: old Android would publish listings pointing at staging URLs (broken photos), and the live web would 403 on any non-JPEG `file.type`.
- Staged design goes in a **new function** (e.g. `r2-stage-upload` + `r2-finalize-images`); `r2-presign` keeps its contract until old builds are retired.

| Stage | Change | Breaks old Android? | Prereqs |
|---|---|---|---|
| 0 (now, independent) | Fix **G1** in `r2-delete` with a backward-compatible guard: every segment `[A-Za-z0-9_-]+` (no `.`/empty), has the uid as a segment, no `..`. (Don't require `<uuid>.jpg` — legacy keys unverified.) Also generic 500 body. | No | none |
| 1 | Deploy **web** (new build already uploads only `image/jpeg`), then fix **G2** (`allHeaders:true` in `r2-presign`). Verify on a real device that the native PUT sends exactly `Content-Type: image/jpeg` (no charset/case change) — if the header differs the signature fails. | No (Android always sends `image/jpeg`) — UNTESTED on device | web deployed first |
| 2 | Cloudflare **response-header rules** on the custom domain (if one is used; not possible on `r2.dev`): `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, force image types. Neutralises served-script risk for legacy objects. | No | confirm domain type |
| 3 | Deploy **new staged functions** + new client builds (Android/iOS/web): presign → `staging/{uid}/{draftId}/{uuid}`; a finalize function reads the staged object **once**, validates (size, format, dimensions), decodes+re-encodes with a maintained library (format policy needed), writes the *server-produced* bytes to `listings/{uid}/…` using `If-None-Match: *` (supported by R2), deletes the staging object, returns the final URL/key. This removes G3 and G4 (server only ever serves bytes it produced). Cap keys per call, per-user presign rate limit (G5). Same for avatars/business/chat prefixes. | No (additive) | decoder choice, Edge memory/CPU limits tested |
| 4 | R2 lifecycle rule: expire `staging/` after ≤ 24 h (abandoned uploads, retries); finalize is idempotent (same staged key → same final key; double-submit returns the existing result). | No | — |
| 5 | **Sweeper** for legacy `listings/` objects: list bucket, run `checkImageBytes`, quarantine/delete failures. | No | — |
| 6 | **Publication gate** in DB: trigger on `listings` insert/update of `images` — each URL must start with the configured public base + `listings/{user_id}/` (or be a legacy Cloudinary URL on updates where unchanged). Enable only when ≥ ~95 % of active users are on staged-capable builds, behind a minimum-version/force-update screen; decide Bulk Upload (§6). Image *verified* state is implied by location (only the server can write `listings/`, so R2 credentials in presign must be scoped: presign key can't write `listings/`). | **Yes for old builds** — hence last | force-update gate |
| 7 | Retire legacy `r2-presign` contract. | — | — |

Open technical point: Supabase Edge Functions have tight CPU/memory limits and no native `sharp`. Legit uploads are ≤ 1600 px JPEGs (small), so a pure-JS/WASM decode with a strict server cap (e.g. ≤ 4096 px, ≤ 5 MB) is plausible, otherwise move finalize to a Cloudflare Worker. Not benchmarked here. The current `checkImageBytes` is a structural allowlist only and must not be treated as a decoder.

Cloudflare facts used: presigned URLs support GET/HEAD/PUT/DELETE; Content-Type can be bound by signing it; POST/policy uploads unsupported; CopyObject and conditional `If-None-Match` PUT are supported. Whether `Content-Length` can be signed is **not documented** — treat size-binding as unavailable unless tested.

---

## 4. Product validation rules (implemented client-side; DB mirror proposed)

| Field | Rule | Where |
|---|---|---|
| Title | non-empty after trim; ≤ 200; single line, no control chars. 5-char minimum **removed** ("TV", "PC" OK) | `data/sellRules.ts` + web copy (parity test passes); DB: `title !~ '\S'` (proposed fix 4) and existing `listings_title_length` |
| Description | non-empty after trim; ≤ 5000; no control chars; no other minimum | unchanged client rule; DB: INSERT trigger recommended (NULL legacy) |
| Battery health | integer 0–100 inclusive; rejects `-1`, `101`, `50.5`, `90%`, `1e2`, blank is "not provided" (not 0) | client changed; `0036` trigger changed to `[0,100,true]`; legacy values need the "unchanged on update" skip |

The client `battery` error/hint text now reads "percentage from 0 to 100". Locale files were not touched (messages are English strings in `sellRules.ts`).

---

## 5. Tests — what exists and what ran

**Ran (this session):** `npm test` → **120 / 120 pass** after the rule changes (battery `0`,`100` accepted; `-1`,`101`,`50.5`,`90%` rejected; titles `TV`/`PC` accepted, whitespace-only rejected). `web` `tsc --noEmit` clean. Experiments in the scratchpad confirmed G1 and G2 (and the `allHeaders` fix).

**Cannot run here (no Docker/Postgres/R2) — NOT verified:** every database and storage test below. Required before deploy, on a **throwaway Supabase project + a test R2 bucket**, two test users A and B:

| Area | Test | Pass condition |
|---|---|---|
| Forged numerics | INSERT/UPSERT `battery` `-1`,`101`,`abc`,`50.5`, `{}`/array value, 9 KB attributes | all rejected with 23514; `0` and `100` accepted |
| Protected fields | A inserts `views:999999, favorites_count:5, status:'sold', created_at:'2000-01-01'`; A PATCHes `views`, `favorites_count`, `created_at`, `location_id`, `user_id` | insert stored as 0/0/available/now; PATCHes of protected columns denied or ignored |
| Cross-user | A PATCH/DELETE B's listing; INSERT with `user_id=B`; upsert with B's id | 0 rows / 403; B's row unchanged |
| Cross-user images | A calls `r2-delete` with `x/{A}/../../listings/{B}/f.jpg` | 403 (currently succeeds — G1 regression test) |
| Forged upload paths | presign folder `listings/{B}`, `a/../b`, `listings/{A}/..`, encoded `%2e%2e`; PUT with `Content-Type: text/html` to a presigned URL | 403 / SignatureDoesNotMatch after G2 fix |
| Bad uploads | corrupt JPEG, truncated, PNG renamed `.jpg`, SVG/HTML/PDF, 0-byte, > size cap, huge dimensions, JPEG with appended payload | finalize rejects and nothing appears under `listings/` |
| TOCTOU | re-PUT to staged key after finalize | final object unchanged |
| Duplicate/retry | same upsert id twice; lost-response retry; 11th new listing in an hour; double finalize | one row, counters intact, quota consumed once, one final object |
| Legacy compat | on a prod-snapshot copy: increment views, favourite, mark sold, price-drop, edit on every legacy row | no errors (this is the test for finding M1/M2) |
| Old builds | current Play-store Android build against staging functions (stages 0–2) | upload + publish + delete work |

Existing automated coverage that *does* run: `sellRules`, `sellParity`, `imageBytes`, `uploadPaths` unit tests only — no RLS/DB/R2 coverage exists in the repo.

**Audit queries to run read-only on prod first** (also in the 0036 header): constraint-violating rows; `select attributes->>'battery', count(*) … group by 1` to see legacy battery formats; rows with `images` ≠ R2 URLs (Cloudinary/external); count of 0-price rows; count of rows with NULL/blank description.

---

## 6. Working tree / release safety

- `git status`: 120 changed/untracked entries; `web/src/app/sell/page.tsx` diff vs HEAD is +437/−84 and **mixes two lines of work** — the Sell rewrite and the locations-directory work (`LocationPicker`, `useLocationText`, `PickedLocation` imports). They can't be separated from git alone (no commit boundary), and `0032–0035` + `locations` services are unrun/untested per memory notes. Nothing was reverted or overwritten. Edits made this session are limited to: `data/sellRules.ts`, `web/src/lib/sellRules.ts` (title min, battery), `tests/sellRules.test.ts`, `supabase/proposed/0036…sql` (battery bounds). CRLF line endings are in use; edits preserved them.
- Release must not be cut from this tree until the Sell and Locations work are committed separately and each reviewed.

---

## 7. Decisions / approvals needed from you

1. Approve **Stage 0** (`r2-delete` traversal fix) as an immediate, independent deploy — no client change needed. Recommended first.
2. Approve revising 0036 (unchanged-value skip for attributes, `\S` blank checks, `created_at`/`location_id` protection, description INSERT trigger) and running the prod audit queries + a snapshot-copy test before any apply.
3. Image policy: accepted formats and dimension cap after re-encode (suggest JPEG-only output, ≤ 1600 px as clients already produce, ≤ 5 MB), and decoder location (Edge Function vs Cloudflare Worker).
4. Bulk Upload: keep arbitrary external image URLs (then the "our bucket only" gate can't apply to bulk), or require upload through our pipeline / cap to 8 URLs.
5. Minimum-app-version / force-update mechanism and date for retiring legacy `r2-presign`.
6. Confirm whether the bucket uses a custom domain (needed for response-header hardening) or `r2.dev`.
7. Allow a throwaway Supabase project and test R2 bucket for the DB/storage test matrix.
