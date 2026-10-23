# Image delivery (sizes, placeholders, caching)

Status 2026-10-22: code written and unit-tested; **nothing here is deployed or measured on a device**.

## Why photos were slow
1. `imageUrl()` only resized Cloudinary URLs. R2 photos were fetched at the uploaded size (up to 1280 px, ~150-400 KB) for every card.
2. A `*.r2.dev` URL is for development: Cloudflare does not cache it at the edge and rate-limits it. Real traffic needs a custom domain.
3. The carousel loaded a slide only when swiped to; there was no placeholder, so the first frame was a flat grey box.

## What the app now does
| Place | Size | Source |
|---|---|---|
| Cards, lists, thumbnails strip | 400 px (`thumb`) | `lib/imageUrl.ts` |
| Listing carousel | 800 px (`card`) | same |
| Full-screen gallery | 1600 px (`full`) | same |
| Placeholder | stored thumbhash, else a 32 px copy | `lib/imagePlaceholder.ts` |

- Resizing is **off until `EXPO_PUBLIC_IMAGE_RESIZE_BASE` is set**; with it unset every URL is returned unchanged (old behaviour).
- Legacy Cloudinary URLs keep their transform at the same widths. Any other host (picsum, Google avatars) is untouched.
- Pressing a card prefetches the first two photos at carousel size; the carousel prefetches the next two (`lib/imagePrefetch.ts`).
- New listings store one thumbhash per photo in `listings.image_hashes` (migration 0073, generated on the device with `Image.generateThumbhashAsync`).
  The app only trusts the array while its length equals `images`; a trigger clears it when `images` changes without it.

## What you must do (nothing below has been done)
1. Connect a **custom domain** to the R2 bucket (Cloudflare dashboard > R2 > bucket > Settings > Custom Domains). Set `R2_PUBLIC_URL` (Edge Function secret) to it.
   Existing rows keep their old `*.r2.dev` URLs, which are not resized; they only benefit once re-pointed (a one-off `update ... set images = replace(...)`, not written here).
2. On that zone enable **Images > Transformations** for the domain. Cost: first 5,000 unique transformations a month are free, then US$0.50 per 1,000 (check current pricing).
   A 400 / 800 / 1600 variant of one photo counts as 3. If that is not acceptable, leave the variable empty; placeholders and prefetch still work.
3. Cache: add a Cache Rule on the domain: Edge TTL 1 year and Browser TTL 1 year for the bucket path. Object keys are random UUIDs and never overwritten, so `public, max-age=31536000, immutable` is safe.
   (Setting it on the objects instead would require signing a `Cache-Control` header into the presigned PUT, which breaks every app build already in users' hands.)
4. Set `EXPO_PUBLIC_IMAGE_RESIZE_BASE` (EAS env var) to the same origin, then build.
5. Apply migration 0073 **before** releasing the build (the app also retries a publish without the column, but then new photos get no hash).
6. Verify: `node scripts/verify-image-headers.mjs <a photo URL> --base https://your.media.domain` prints status, bytes, ms, Cache-Control and `cf-cache-status` for the original and the 400 / 800 / 1600 versions.

## Time to first visible image
Not measured. Dev builds log `[img] home first card: N ms` and `[img] listing detail first photo: N ms` (`lib/imageTiming.ts`). Record them on a real phone
over a throttled connection before and after steps 1-4.
