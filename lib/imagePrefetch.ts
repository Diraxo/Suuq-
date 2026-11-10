import { Image } from 'expo-image';
import { imageOriginalUrl, imageUrl, reportResizeFailure } from '@/lib/imageUrl';
import { redactImageUrl } from '@/lib/viewerImage';
import { imageDiag } from '@/lib/imageTiming';
import { coverLookahead, createImageQueue, neighbourPlan, PREFETCH_PRIORITY, URGENT_UP_TO, type ImageRequestState } from '@/lib/imageQueue';
import type { QueuePolicy } from '@/lib/imageNetworkPolicy';

// ONE shared, bounded queue for every prefetch: home covers, listing hero, thumbnail strip and the full-screen gallery. Priorities
// (lib/imageQueue.ts PREFETCH_PRIORITY) decide who goes first; the queue keeps one reserved slot for the photo the user is looking at.
// Groups name the screen that asked, so a screen can withdraw its own queued work without touching another screen's.
const GROUP = { home: 'home', detail: 'detail', hero: 'hero', strip: 'strip', gallery: 'gallery' } as const;

async function prefetchOnce(url: string): Promise<boolean> {
  try {
    return await Image.prefetch(url, 'memory-disk');
  } catch {
    return false;
  }
}

// A resized variant that fails is retried once as the original (a valid photo address by construction). If the original then
// loads, the transformation is what failed, and the session circuit breaker in lib/imageUrl.ts counts it.
async function load(url: string): Promise<boolean> {
  imageDiag('prefetch requested', { host: redactImageUrl(url) });
  const first = await prefetchOnce(url);
  imageDiag('prefetch completed', { ok: first });
  if (first) return true;
  const original = imageOriginalUrl(url);
  if (!original) return false;
  const ok = await prefetchOnce(original);
  if (ok) {
    reportResizeFailure();
    imageDiag('resize variant failed, original ok', { variant: redactImageUrl(url) });
  }
  return ok;
}

const queue = createImageQueue({ concurrency: 3, urgent: { upTo: URGENT_UP_TO, extra: 1 }, load });

/** Network / app-state policy (see lib/imageNetworkPolicy.ts). */
export function setImageQueuePolicy(p: QueuePolicy): void {
  queue.setConcurrency(p.concurrency);
  if (p.paused) queue.pause();
  else queue.resume();
}
export function forgetImageFailures(): number { return queue.forgetFailures(); }
export function imageRequestState(url: string): ImageRequestState { return queue.stateOf(url); }
export function imageQueueStats() { return queue.stats(); }

/** Detail-size photos (the hero carousel's URL) of a listing, e.g. the first photos of a card that was just tapped. */
export function prefetchCardImages(urls: readonly (string | undefined)[], priority: number = PREFETCH_PRIORITY.hero): void {
  queue.enqueueAll(urls.map((u) => (u ? imageUrl(u, { size: 'card' }) : undefined)), priority, GROUP.detail);
}

/** Detail-screen thumbnail strip photos (the exact URL the strip requests). */
export function prefetchStripImages(urls: readonly (string | undefined)[]): void {
  queue.enqueueAll(urls.map((u) => (u ? imageUrl(u, { size: 'strip' }) : undefined)), PREFETCH_PRIORITY.strip, GROUP.strip);
}

/**
 * The hero carousel of the open listing at the carousel's URL: the selected photo first, its next and previous neighbours, then the
 * rest of the listing. A newer call (the selection moved) withdraws the older call's queued work.
 */
export function prefetchHeroPhotos(urls: readonly string[], active: number): void {
  queue.cancelGroup(GROUP.hero);
  for (const { index, priority } of neighbourPlan(urls.length, active, PREFETCH_PRIORITY.hero)) {
    queue.enqueue(imageUrl(urls[index], { size: 'card' }), priority, GROUP.hero);
  }
}

/**
 * Home list: fetch the covers on screen first, then the next rows. Work still queued from an older look-ahead is withdrawn first,
 * so a fast scroll never leaves the queue downloading photos nobody will see. Other screens' work is untouched.
 */
export function prefetchHomeCovers(covers: readonly (string | undefined)[], visible: readonly number[], columns: number): void {
  const plan = coverLookahead(covers, visible, columns);
  if (plan.length === 0) return;
  queue.cancelGroup(GROUP.home);
  for (const { url, priority } of plan) queue.enqueue(imageUrl(url, { size: 'thumb' }), priority, GROUP.home);
}

/** Startup: the first covers of the feed, at the card's size, at home priority. Never awaited by anything. */
export function prefetchStartupCovers(covers: readonly (string | undefined)[], count = 6): void {
  covers.slice(0, Math.max(0, count)).forEach((u, i) => {
    queue.enqueue(u ? imageUrl(u, { size: 'thumb' }) : undefined, i < 4 ? PREFETCH_PRIORITY.homeVisible : PREFETCH_PRIORITY.homeNext, GROUP.home);
  });
}

export function cancelDetailPrefetch(): void {
  for (const g of [GROUP.detail, GROUP.hero, GROUP.strip]) queue.cancelGroup(g);
}
export function cancelGalleryPrefetch(): void { queue.cancelGroup(GROUP.gallery); }

/**
 * The photos of ONE listing at the exact URL the viewer requests (1600). `opened` = the viewer is (about to be) on screen: the open
 * photo is top priority, its neighbours next, the rest after. Otherwise (the listing page preparing ahead of a tap) everything is
 * low priority, nearest first, so it never competes with the hero or the thumbnails. A newer call supersedes the older one's
 * queued work; photos already loaded or in flight are not requested again (the queue de-duplicates by URL).
 */
export function prefetchGalleryPhotos(urls: readonly string[], active: number, opts: { opened?: boolean } = {}): void {
  queue.cancelGroup(GROUP.gallery);
  const plan = neighbourPlan(urls.length, active, PREFETCH_PRIORITY.visible);
  for (const { index, priority } of plan) {
    queue.enqueue(imageUrl(urls[index], { size: 'full' }), opts.opened ? priority : PREFETCH_PRIORITY.listingRest, GROUP.gallery);
  }
  imageDiag('gallery prefetch planned', { photos: urls.length, active, opened: !!opts.opened });
}
