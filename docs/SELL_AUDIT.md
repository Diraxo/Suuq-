# Sell flow audit — validation, uploads, mobile/web parity

Scope: Sell tab on Android, iOS and web (publish, Edit Listing, bulk import, avatar/business images where they share the upload utilities). Nothing here was deployed, migrated or committed.

## 1. What exists (architecture)

| Layer | Mobile (iOS + Android) | Web |
|---|---|---|
| Steps | `app/post/{index,category,details,location,price,preview,success}.tsx` | one page, `web/src/app/sell/page.tsx` (6 steps) |
| Draft | `store/postDraft.ts` (persisted, AsyncStorage) | component state only (lost on reload) |
| Rules | `data/sellRules.ts` (new, pure) → re-exported by `data/validation.ts` | `web/src/lib/sellRules.ts` (byte-identical copy) |
| Category schema | `data/categoryFields.ts`, `categoryFeatures.ts`, `fieldOptions.ts` | byte-identical copies in `web/src/lib/` |
| Photos | picker → `lib/imageValidation.ts` → copy to app storage → `lib/imagePipeline.ts` (native decode + re-encode JPEG ≤1600px) → `lib/r2.ts` | `web/src/services/imagePrep.ts` (byte check → `createImageBitmap` decode → canvas → JPEG) → `services/r2.ts` |
| Upload | `r2-presign` Edge Function → presigned PUT → R2 public bucket URL | same |
| Publish | `store/myListings.ts addListing` (upsert on a stable id) | `services/listings.ts createListing` (upsert on a stable id) |
| Backend | Supabase `listings` + RLS (0001), rate limit (0019/0031), title/description length constraints (0019), removed-status guard (0027) | same |

`tests/sellParity.test.ts` fails if the web copies drift from the originals.

## 2. Confirmed defects and gaps (before this change)

Security / trust boundary
1. **Nothing server-side validated image bytes.** `r2-presign` returned a PUT URL for any caller-owned folder; the client could upload any bytes (HTML, SVG with script, 500 MB) and they were served from the public bucket URL. All "image only" logic ran in the client.
2. **Folder guard was bypassable.** `folder.split('/').includes(user.id)` accepted `x/{me}/../../listings/{victim}`; the object URL is string-built then normalised by the URL parser, so a crafted folder could write into another user's namespace (new random file name, so no overwrite, but namespace pollution/impersonation).
3. **Web uploaded the raw `File`** with its client-declared `Content-Type` — a renamed text/SVG file went straight to the bucket. No type, size or dimension check at all on web.
4. **Presigned URL not bound to a content type.**
5. `r2-presign` echoed `String(err)` (can name missing secrets/config) on 500.
6. **DB trusted the client for everything but title/description length**: no price range, condition enum, currency format, photo count, attributes shape. `views`, `favorites_count`, `created_at`, `status` are insertable by the owner (0019 only revoked UPDATE).

Validation / consistency
7. **Web Sell had almost no validation**: title non-blank only, no length limits, no category fields (published `attributes: {}`), subcategory optional (mobile requires it), condition defaulted to "used", price silently stripped to digits, no max price.
8. **Specs leaked across categories**: changing category on mobile kept `attributes`/`features` of the previous category and published them (`attributes: draft.attributes`). Same on mobile Edit Listing.
9. **Numeric fields were only a keypad hint** (`NUMERIC_FIELD_KEYS`); nothing validated them, so `battery = "abc"` / `"500"` / `"-3"` published. Battery Health is free text.
10. **Prices were silently rewritten** (`replace(/[^0-9]/g,'')`): pasting `12.5` became `125`.
11. Description required ≥ 20 characters (arbitrary); `validatePrice` only checked `Number(price) > 0` (accepted `1e308`, `0.5`, fractions via bulk import) and had no maximum.
12. Mobile publish had no stable id: a lost response on a committed insert followed by a retry published a duplicate (web already had a stable id).
13. No character counters / hints; errors only on submit; Input had no accessibility label/hint/live-region.

Already good (kept untouched)
- Mobile double-tap guard (`publishOnce`), publish-while-away navigation guard, offline pre-flight, per-photo retry, EXIF-preserving draft copies, native re-encode to JPEG, RLS `auth.uid() = user_id` on insert/update/delete (UPDATE has no separate WITH CHECK, so Postgres applies USING to the new row too — ownership can't be reassigned), admin-only `removed` transition (0027), 10 listings/hour rate limit, web stable-id upsert.

## 3. Changes

Shared logic (`data/sellRules.ts` + web copy)
- Numeric field schema `NUMERIC_RULES` (below), strict parser `parseNumericInput`, `validateAttribute(s)`, `sanitizeAttributes/Features`, `validateListingDraft` (publish gate), `validateTitle/Description/SellerNotes/Price/Currency/Condition`.
- Description: required, **min 1 char after trim** (was 20), max 5000, no control chars, never truncated. Title: min 5 (kept), max 200, single line.
- Price: whole currency units, digits only, 1…999,999,999,999, validated as typed.

Mobile
- `DynamicField`: keypad + hint + blur validation from the shared rules; `Input`: `hint`, live `counter`, accessible label/hint, error `role=alert` + live region.
- `details.tsx`: counters, hints, blur-time errors, seller-notes validation, shared attribute validation (first invalid field still scrolled to).
- `price.tsx` / Edit Listing: no silent stripping, `number-pad`, error on blur, formatted echo of the amount.
- `category.tsx`: switching category prunes specs/features to the new schema; `preview.tsx` and Edit Listing sanitize again at publish/save.
- `preview.tsx`: publish gate = `validateListingDraft`; stable `listingId` persisted in the draft → upsert (`store/myListings.ts`), so retries can't duplicate.
- `lib/imageValidation.ts`: rejects video/non-image MIME, empty files, >12000px / >100 MP.

Web
- `sell/page.tsx` rebuilt on the same rules: category-specific fields (`SellField.tsx`), required subcategory, no default condition, features + highlights, counters, blur/Continue errors with focus on the first invalid field, `aria-*`, photo reorder, double-click lock + stable id + upload reuse/cleanup.
- `services/imagePrep.ts` + `services/r2.ts`: every upload is byte-sniffed (allowlist JPEG/PNG/WebP/HEIC, size, dimensions, truncation), decoded by the browser, re-encoded to ≤1600px JPEG (drops EXIF/GPS and appended payloads), uploaded as `image/jpeg` only. Edit Listing uses the same intake + shared title/description/price rules and prunes specs on category change.

Backend (repo only, **not deployed**)
- `r2-presign`: strict folder allowlist (`_shared/uploadPaths.ts`), `Content-Type: image/jpeg` signed into the URL, generic 500 body.
- New `r2-verify-images` + `_shared/imageBytes.ts`: reads stored objects back with the R2 credential, applies the JPEG-only allowlist, **deletes** invalid ones. Not wired into the clients yet (see §5).
- `supabase/proposed/0036_sell_server_validation.sql`: NOT VALID constraints, attribute range trigger, insert sanitiser. Not applied.

## 4. Numeric fields (actual rules)

| Field key (label) | Kind | Range | Note |
|---|---|---|---|
| `battery` (Battery Health) | percent / integer | 1–100 | 0 % is not a meaningful state for an item for sale — confirm if you want 0 allowed |
| `mileage` (km) | integer | 0–2,000,000 | 0 valid (new vehicle) |
| `engineCC` | integer | 50–20,000 | |
| `quantity` | integer | 1–1,000,000 | |
| `gears` | integer | 1–30 | |
| `setPieces` | integer | 1–1,000 | |
| `resolution` (Resolution (MP), text variant only) | decimal ≤1 dp | 0.1–1,000 | the HD/4K *select* with the same key is untouched |
| `lengthMeters` | decimal ≤2 dp | 0.1–500 | |
| `ceilingHeight` | decimal ≤2 dp | 1–20 | |
| `voltage` | decimal ≤1 dp | 0.1–100,000 | label has no unit; was already a numeric keypad |
| `weightCapacity` | decimal ≤1 dp | 0.1–10,000,000 | label has no unit; was already a numeric keypad |
| `size` **only when labelled "Size (sqm)"** | decimal ≤2 dp | 1–1,000,000 | clothing `size` ("M"/"XL") and "Area" stay text |
| price | integer | 1–999,999,999,999 | currency from the chosen place |
| year (select) | 4-digit | 1900…current+1 | |

Left as text on purpose: brand, model/model numbers, storage/RAM (selectors), salary (currency unknown), floor, age, expiry, experience, volume, weight, `seats` (text variant). Select fields must equal one of their own options. Free text ≤ 100 chars, no control characters. All error text is English (same as before); localisation of the new strings beyond `en` is not done.

## 5. Image validation by trust boundary

| Boundary | Check | Strength |
|---|---|---|
| Picker (mobile `mediaTypes: ['images']`, web `accept=`) | image-only request | UX only |
| Client intake (mobile `imageValidation` + native decode/re-encode; web `imagePrep`) | MIME/extension (mobile), **byte-level format allowlist, size, dimensions, truncation (web)**, real decoder, re-encode to JPEG, metadata dropped | strong against honest clients; bypassable by a hand-written request |
| `r2-presign` | caller-owned, shape-checked folder; server-generated `<uuid>.jpg` key; signed `Content-Type: image/jpeg` | closes path traversal + content-type claims |
| **`r2-verify-images` (new, not deployed/wired)** | reads the stored object, JPEG-only, ≤10 MB, structure + dimensions + not truncated, no appended payload; deletes failures | the trusted check |

**Remaining gap:** a presigned PUT cannot bind the bytes, and nothing forces a listing to reference a verified object, so a modified client can still upload junk and insert a listing pointing at it until `r2-verify-images` is enforced. Smallest safe design: (a) presign only `staging/{uid}/…`; (b) the verify function validates then server-side *copies* to `listings/{uid}/…` (only the server can write that prefix); (c) a listings trigger requires `images[]` to start with the public base + `listings/`; (d) R2 lifecycle rule expires `staging/`. That is a coordinated client + function + migration rollout (old app builds would break), so it is proposed, not done. The pure checker is a format/structure allowlist, **not** a pixel decoder — it must stay in front of a real decoder (browser/native) and the re-encode, never replace it.

## 6. Backend authorization / publishing review

- Insert: `with check (auth.uid() = user_id)` ✔. Update/delete: `using (auth.uid() = user_id)` ✔ (applies to the new row as well). Forged `id` on upsert hits the owner-only UPDATE policy → no takeover. Another user's draft/listing cannot be modified.
- `removed` transition guarded (0027). Rate limit 10 new listings/hour, retries don't consume it (0031).
- Gaps (proposed in 0036): no price/condition/currency/photo-count/attributes constraints; owner-forgeable `views`/`favorites_count`/`created_at`/`status` on INSERT.
- Error text: the clients map errors through `toAppError`; `r2-presign` no longer echoes internals. `r2-delete`'s ownership check was not re-audited here.
- RLS/ownership can only be exercised against a database; there is no DB test harness in the repo, so authorization is **reviewed, not tested**. Suggested manual check after deploying: with two test users, (1) PATCH the other user's listing → 0 rows, (2) insert with `user_id` = other → 403, (3) insert `views: 999999` → 0 after 0036.

## 7. Parity findings

Same categories/subcategories (tested), same schema/fields/selectors/numeric rules (shared files, tested), same title/description/price/currency/condition/photo-count rules and publish gate, same JPEG ≤1600px re-encode. Intentional differences: native pickers/keypads vs browser inputs; mobile drag-reorder vs web "move earlier" button; mobile persists the draft, **web does not** (page reload loses it); mobile collects a phone when missing, web does not; web Edit Listing still doesn't edit specs (it prunes them on category change).

## 8. Not verified / needs a human

- No device or browser run: wizard, pickers, keyboards, focus movement, screen-reader output, small-phone/large-text layout.
- Browser decoding of HEIC outside Safari (rejected with a message), very large photos on low-memory phones.
- `r2-presign` signed-Content-Type change and `r2-verify-images` are untested against real R2 (they need deploy + secrets). Deploy order: web build first (it now always sends `image/jpeg`), then `r2-presign`.
- RLS/DB constraints (see §6).
