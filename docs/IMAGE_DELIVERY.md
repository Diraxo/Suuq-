# Image delivery (sizes, placeholders, caching)

Status 2026-11-09: code written, type-checked and unit-tested; **nothing here is deployed, and nothing has been measured or seen on a device**.

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

## Architecture (2026-11-09 completion pass)

### Status key
| Mark | Meaning |
|---|---|
| CODE | written and type-checked |
| TEST | covered by an automated test that runs real logic (`npm test`) |
| DEVICE | must still be seen on a phone/emulator (not done) |
| EXTERNAL | needs Cloudflare / provider setup (not done) |

### One shared queue (`lib/imageQueue.ts`, used through `lib/imagePrefetch.ts`) — CODE, TEST
Every prefetch (home covers, listing hero, thumbnail strip, full-screen gallery) goes through one queue.

| Priority | Number | Who |
|---|---:|---|
| visible | 0 | gallery photo on screen |
| hero | 1 | selected hero; first photos of a card that was just tapped |
| neighbour | 2 | next / previous hero or gallery photo |
| strip | 3 | thumbnails of the open listing |
| homeVisible | 4 | covers on screen |
| homeNext | 5 | covers in the next two rows |
| homeAhead | 6 | rest of the 8-cover look-ahead |
| listingRest | 7 | remaining photos of the open listing (gallery preparation) |
| background | 8 | reserved |

- Concurrency 3 (2 on cellular/metered, 1 on 2G/3G; see `lib/imageNetworkPolicy.ts`). Work at priority <= 2 may also use **one reserved extra slot**, so a photo the user is looking at never waits behind background downloads.
- De-duplicated by exact URL: queued, in flight, and finished within 10 minutes are not requested twice. A repeat request can only raise a waiting URL's priority.
- Cancellation by screen (`home`, `hero`, `strip`, `detail`, `gallery`): a new home look-ahead or gallery swipe withdraws that screen's older queued work; a photo two screens want survives until both withdraw. Leaving the detail screen / closing the viewer withdraws their queued work.
- Failures retry twice (1.5 s, 3 s), then give up for 10 minutes. A download with no answer after 30 s counts as a failure and frees its slot.
- Bounds: at most 300 waiting URLs (least important dropped first), 400 remembered results.
- **Limit of the platform:** `Image.prefetch` cannot be aborted and returns only true/false. A download that already started always finishes into the cache, and a permanent 404 cannot be told from a dropped connection. Failures are capped (above), not classified.

### Lifecycle (`lib/imageLifecycle.ts`, started in `app/_layout.tsx`) — CODE, TEST (policy), DEVICE (listeners)
Backgrounded or offline: the queue pauses (queued work and pending retries are kept, not lost). Foreground / back online: it resumes, and downloads that gave up during the outage become eligible again.

### Image URLs and sizes — CODE, TEST; resizing itself EXTERNAL
| Use | Size | Width |
|---|---|---:|
| Detail thumbnail strip | `strip` | 200 |
| Home card | `thumb` | 400 |
| Detail hero | `card` | 800 |
| Full-screen gallery | `full` | 1600 |

- Each prefetch asks for the **same URL the screen displays**, so the cache key matches. Cache identity = the exact URL; photo object keys are random UUIDs and never overwritten, so a replaced photo is a different URL (no stale image). With resizing off all four sizes are one URL, so they are one download and one cache entry (not four copies).
- **Failed variant fallback:** if a resized URL fails to load (card, hero, thumbnail, gallery photo, prefetch), the screen retries once with the original it was built from (`imageOriginalUrl`, `hooks/useImageFallback.ts`); only then does it show its failed state. If a variant fails AND its original then loads three times in a session, a circuit breaker (`imageUrl.ts`) stops building resized URLs until restart.
- Resizing is **not proven operational**. Nothing here has seen a real transformed response.

### Home — CODE, TEST (planning, queue behaviour), DEVICE (feel)
- The moment a feed page arrives (`store/homeFeed.ts`) the first 6 covers are queued, before the list has laid out. Nothing waits for them: Home appears when its data does.
- `onViewableItemsChanged` (25 % for 80 ms: **initial values, not tuned**) queues visible covers, then the next 8. Each report withdraws the previous look-ahead, so a fast scroll in either direction never leaves stale downloads queued.
- Splash is unchanged: it still waits only for auth, language, onboarding and the update check. It does not download photos. The feed query depends on the Home screen's own selections, so the splash cannot know which covers to fetch without duplicating that logic; the warm-up above starts as early as the data exists.

### Listing detail — CODE, TEST (queue/strip maths), DEVICE
- Tap on a card: first two photos at `hero` priority. Detail: selected hero (1), next and previous (2), rest (7) via `prefetchHeroPhotos`.
- Thumbnails show their placeholder until the hero has painted (or 1.5 s), then load, so they no longer compete with the hero or appear before it.
- The selected thumbnail is centred with `scrollToOffset` from a computed offset (`lib/stripScroll.ts`, tested for 1, 2, 5, 8 and 30 photos, first/last, bad input). `scrollToIndex` and its failure callback are gone.
- A hero that fails after the fallback shows an icon and a Retry button.

### Gallery — CODE, TEST (plan/priorities), DEVICE (swiping, gestures)
- Tap on a photo queues that photo at 0, its neighbours at 2, the rest at 7 (`prefetchGalleryPhotos(..., {opened: true})`). Each settled swipe replans from the new photo and withdraws the old plan. The old private batching is removed.
- Unchanged and not re-verified without a device: windowed cells (`viewerCellBuilt`, at most 5 built), load-state model (`loading/loaded/error`, 20 s timeout), retry button, always-visible close button.

### Zoom and gestures — unchanged
No gesture code was edited (pinch, double-tap, pan, `scrollEnabled={!zoomed}`). Gesture behaviour is **DEVICE-only** verification; worklets cannot run in node.

## What was and was not verified
| Gate | State |
|---|---|
| Code audit | done (this file + final report) |
| Shared queue on all surfaces | CODE + TEST |
| Automated tests | `npm test`: all pass; `tsc --noEmit`: clean |
| Emulator / simulator | **not run** (no dev build here) |
| Physical device | **not run** |
| Memory measurements | **none**; the bounds above are design limits, not measurements |
| Image resizing | **EXTERNAL, not enabled** |

## Known limits
- Home look-ahead, strip gating (1.5 s) and the 25 %/80 ms viewability values are starting points; tune from `[img]` logs on a device.
- A home card whose cover fails (after the original fallback) shows an icon; there is no per-card retry (opening it or pull-to-refresh recovers).
- Web (`web/`) has its own image code and was not changed.
- `Image.prefetch` disk persistence is expo-image's `memory-disk` policy; this repo cannot prove what the native layer evicts.

## Website (`web/`) — 2026-11-09
The website does not use the app's queue: it uses `next/image` (browser `srcset`, lazy loading, the browser's own HTTP cache and connection scheduling), so there is nothing to port. What was changed:
- First 4 home cards load eagerly (`priority`); a cover that fails shows an icon instead of a blank box.
- Listing page: thumbnails wait for the hero photo (or 1.5 s) before downloading.
- `WatermarkedPhoto` (hero and full-screen viewer): a failed photo now has a Retry control, and reports when it has settled.
- Unchanged: neighbour pre-loading (hero and viewer), the small-copy preview under the viewer photo.
Verified: `tsc --noEmit` on `web/` is clean and the root test suite passes. NOT verified: no browser run, no visual check, no web lint run, no network-throttled test.
**Open (needs your decision, hosting change, not made):** the site deploys to Cloudflare Workers via OpenNext. `/_next/image` resizing there normally needs an `images` binding in `web/wrangler.jsonc`. I could not confirm whether it works in production; check a live photo's `srcset` URL returns a smaller, resized image.
