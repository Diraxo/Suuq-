// The one prioritised download queue for every image the app prepares ahead of time (home covers, listing hero, thumbnail strip,
// full-screen gallery). Pure (the actual download is injected), so it is unit-tested in node (tests/imageQueue.test.ts) without
// React Native.
//
// Rules:
//  - at most `concurrency` downloads run at once, so prefetching can never saturate a slow connection; work at or above
//    `urgent.upTo` may use `urgent.extra` further slots, so the photo the user is looking at never waits behind background work;
//  - a lower `priority` number runs first (see PREFETCH_PRIORITY);
//  - one URL is only ever queued/in flight once; asking again can raise its priority but never duplicates the download;
//  - a URL that downloaded successfully is not requested again for `ttlMs`;
//  - a failure is retried a bounded number of times with exponential backoff, then given up on until `ttlMs` has passed;
//  - a download that never answers is abandoned after `timeoutMs` (counted as a failure) so it cannot hold a slot forever;
//  - queued work that is no longer useful can be dropped by priority (cancelBelow), by URL (cancel) or by the screen that asked
//    for it (cancelGroup): a photo wanted by two screens survives until both have cancelled it;
//  - the number of waiting URLs and the number of remembered URLs are both bounded.
//
// What it cannot do: `Image.prefetch` has no abort and reports only true/false, so a download already started is never cancelled
// (it finishes into the cache) and a permanent 404 cannot be told from a dropped connection; failures are therefore capped, not
// classified.

export type ImageQueueOptions = {
  /** Performs one download; resolves true on success. Must not throw (a throw counts as a failure). */
  load: (url: string) => Promise<boolean>;
  concurrency?: number;
  /** Extra slots usable only by work with priority <= upTo. */
  urgent?: { upTo: number; extra: number };
  ttlMs?: number;
  maxRetries?: number;
  backoffMs?: number;
  /** A download with no answer after this long counts as failed. */
  timeoutMs?: number;
  /** Upper bound on remembered URLs (done + failed), oldest dropped first. */
  memoryLimit?: number;
  /** Upper bound on URLs waiting to start; beyond it the least important waiting URL is dropped. */
  maxQueued?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
};

export type ImageRequestState = 'idle' | 'queued' | 'loading' | 'retrying' | 'loaded' | 'failed';

type Entry = { url: string; priority: number; seq: number; attempts: number; groups: Set<string> };

export type ImageQueue = {
  enqueue(url: string | undefined | null, priority: number, group?: string): void;
  enqueueAll(urls: readonly (string | undefined | null)[], priority: number, group?: string): void;
  /** Drops queued (not yet started) work with a priority number greater than `priority`. In-flight downloads finish. */
  cancelBelow(priority: number): number;
  /** Drops one URL that has not started (queued or waiting to retry). */
  cancel(url: string): boolean;
  /** Withdraws `group`'s interest in queued work; a URL no other group wants is dropped. In-flight downloads finish. */
  cancelGroup(group: string): number;
  /** Nothing new starts and retry timers are suspended; waiting work is kept. */
  pause(): void;
  resume(): void;
  /** Makes URLs that gave up eligible again (call when the network comes back). Returns how many. */
  forgetFailures(): number;
  setConcurrency(n: number): void;
  stateOf(url: string): ImageRequestState;
  stats(): { queued: number; running: number; retrying: number; done: number; failed: number; started: number; dropped: number };
};

export function createImageQueue(opts: ImageQueueOptions): ImageQueue {
  let concurrency = Math.max(1, opts.concurrency ?? 3);
  const urgent = opts.urgent ?? { upTo: -1, extra: 0 };
  const ttlMs = opts.ttlMs ?? 10 * 60 * 1000;
  const maxRetries = opts.maxRetries ?? 2;
  const backoffMs = opts.backoffMs ?? 1500;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const memoryLimit = opts.memoryLimit ?? 400;
  const maxQueued = Math.max(1, opts.maxQueued ?? 300);
  const now = opts.now ?? Date.now;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));

  const queued = new Map<string, Entry>();
  const running = new Map<string, Entry>();
  const finished = new Map<string, { at: number; ok: boolean }>();
  /** Failed, waiting for the backoff to pass. `timer` is undefined while paused (re-armed on resume). */
  const retrying = new Map<string, { entry: Entry; timer: unknown; delay: number }>();
  let seq = 0;
  let started = 0;
  let dropped = 0;
  let paused = false;

  const remember = (url: string, ok: boolean) => {
    finished.delete(url);
    finished.set(url, { at: now(), ok });
    if (finished.size > memoryLimit) finished.delete(finished.keys().next().value as string);
  };

  const better = (a: Entry, b: Entry) => a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq);

  const pump = () => {
    if (paused) return;
    for (;;) {
      if (queued.size === 0) return;
      let best: Entry | null = null;
      for (const e of queued.values()) if (!best || better(e, best)) best = e;
      if (!best) return;
      const limit = best.priority <= urgent.upTo ? concurrency + urgent.extra : concurrency;
      if (running.size >= limit) return;
      queued.delete(best.url);
      run(best);
    }
  };

  const settle = (entry: Entry, ok: boolean) => {
    if (running.get(entry.url) !== entry) return; // already settled (timeout won, or the late answer arrived)
    running.delete(entry.url);
    if (ok) {
      remember(entry.url, true);
    } else if (entry.attempts < maxRetries) {
      const next: Entry = { ...entry, attempts: entry.attempts + 1 };
      armRetry(next, backoffMs * 2 ** entry.attempts);
    } else {
      remember(entry.url, false);
    }
    pump();
  };

  const armRetry = (entry: Entry, delay: number) => {
    const slot: { entry: Entry; timer: unknown; delay: number } = { entry, timer: undefined, delay };
    retrying.set(entry.url, slot);
    if (paused) return;
    slot.timer = setTimer(() => {
      retrying.delete(entry.url);
      if (!queued.has(entry.url) && !running.has(entry.url)) {
        queued.set(entry.url, slot.entry);
        pump();
      }
    }, delay);
  };

  const run = (entry: Entry) => {
    running.set(entry.url, entry);
    started++;
    let result: Promise<boolean>;
    try {
      result = opts.load(entry.url);
    } catch {
      result = Promise.resolve(false);
    }
    const timer = setTimer(() => settle(entry, false), timeoutMs);
    void result
      .catch(() => false)
      .then((ok) => {
        clearTimer(timer);
        settle(entry, ok);
      });
  };

  const trim = () => {
    while (queued.size > maxQueued) {
      let worst: Entry | null = null;
      for (const e of queued.values()) if (!worst || better(worst, e)) worst = e;
      if (!worst) return;
      queued.delete(worst.url);
      dropped++;
    }
  };

  const enqueue = (url: string | undefined | null, priority: number, group?: string) => {
    if (!url) return;
    const known = finished.get(url);
    if (known && now() - known.at < ttlMs) return;
    const live = running.get(url);
    if (live) {
      if (group) live.groups.add(group);
      return;
    }
    const waiting = retrying.get(url);
    if (waiting) {
      if (priority < waiting.entry.priority) waiting.entry.priority = priority;
      if (group) waiting.entry.groups.add(group);
      return;
    }
    const existing = queued.get(url);
    if (existing) {
      if (priority < existing.priority) existing.priority = priority;
      if (group) existing.groups.add(group);
      pump(); // a raised URL may now be allowed into the urgent lane
      return;
    }
    queued.set(url, { url, priority, seq: ++seq, attempts: 0, groups: new Set(group ? [group] : []) });
    trim();
    pump();
  };

  return {
    enqueue,
    enqueueAll(urls, priority, group) {
      for (const u of urls) enqueue(u, priority, group);
    },
    cancelBelow(priority) {
      let n = 0;
      for (const [url, e] of queued) {
        if (e.priority > priority) {
          queued.delete(url);
          n++;
        }
      }
      return n;
    },
    cancel(url) {
      const r = retrying.get(url);
      let hit = false;
      if (r) {
        if (r.timer !== undefined) clearTimer(r.timer);
        retrying.delete(url);
        hit = true;
      }
      return queued.delete(url) || hit;
    },
    cancelGroup(group) {
      let n = 0;
      for (const [url, e] of queued) {
        if (!e.groups.delete(group)) continue;
        if (e.groups.size === 0) {
          queued.delete(url);
          n++;
        }
      }
      for (const [url, r] of retrying) {
        if (!r.entry.groups.delete(group)) continue;
        if (r.entry.groups.size === 0) {
          if (r.timer !== undefined) clearTimer(r.timer);
          retrying.delete(url);
          n++;
        }
      }
      return n;
    },
    pause() {
      if (paused) return;
      paused = true;
      for (const r of retrying.values()) {
        if (r.timer !== undefined) clearTimer(r.timer);
        r.timer = undefined;
      }
    },
    resume() {
      if (!paused) return;
      paused = false;
      for (const [url, r] of [...retrying]) {
        retrying.delete(url);
        armRetry(r.entry, r.delay);
      }
      pump();
    },
    forgetFailures() {
      let n = 0;
      for (const [url, f] of [...finished]) {
        if (!f.ok) {
          finished.delete(url);
          n++;
        }
      }
      return n;
    },
    setConcurrency(n) {
      concurrency = Math.max(1, Math.trunc(n) || 1);
      pump();
    },
    stateOf(url) {
      if (running.has(url)) return running.get(url)!.attempts > 0 ? 'retrying' : 'loading';
      if (retrying.has(url)) return 'retrying';
      if (queued.has(url)) return 'queued';
      const f = finished.get(url);
      if (f && now() - f.at < ttlMs) return f.ok ? 'loaded' : 'failed';
      return 'idle';
    },
    stats() {
      let done = 0;
      let failed = 0;
      for (const f of finished.values()) {
        if (f.ok) done++;
        else failed++;
      }
      return { queued: queued.size, running: running.size, retrying: retrying.size, done, failed, started, dropped };
    },
  };
}

// ── Priority tiers ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Priority tiers used by the app, most important first. A photo the user is looking at must not wait behind anything below it.
 *  visible    the image on screen right now that is not yet in the cache (gallery page)
 *  hero       the selected hero of the open listing (and the first photos of a listing that is just being opened)
 *  neighbour  the next / previous gallery or hero photo
 *  strip      thumbnails of the open listing
 *  homeVisible, homeNext, homeAhead   covers on screen, the next rows, the rest of the look-ahead
 *  listingRest remaining photos of the currently open listing
 *  background distant prefetch
 */
export const PREFETCH_PRIORITY = {
  visible: 0,
  hero: 1,
  neighbour: 2,
  strip: 3,
  homeVisible: 4,
  homeNext: 5,
  homeAhead: 6,
  listingRest: 7,
  background: 8,
} as const;

/** Work at or above this priority may use the queue's reserved slot. */
export const URGENT_UP_TO = PREFETCH_PRIORITY.neighbour;

// ── Look-ahead selection (home list) ─────────────────────────────────────────────────────────────────────────────────────

/** How many covers after the last visible one are prepared. An initial value, not a tuned one. */
export const HOME_LOOKAHEAD = 8;

/**
 * Which cover photos to fetch for a list. `visible` are the indexes on screen; the next `ahead` items after the last visible one
 * are the look-ahead. Returns [url, priority] pairs: visible first, then the following row(s), then the rest of the look-ahead.
 */
export function coverLookahead(
  covers: readonly (string | undefined)[],
  visible: readonly number[],
  columns: number,
  ahead = HOME_LOOKAHEAD
): { url: string; priority: number }[] {
  if (covers.length === 0 || visible.length === 0) return [];
  const cols = Math.max(1, Math.trunc(columns) || 1);
  const sorted = [...visible].filter((i) => i >= 0 && i < covers.length).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const last = sorted[sorted.length - 1];
  const out: { url: string; priority: number }[] = [];
  const seen = new Set<string>();
  const push = (i: number, priority: number) => {
    const url = covers[i];
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ url, priority });
  };
  for (const i of sorted) push(i, PREFETCH_PRIORITY.homeVisible);
  for (let i = last + 1; i <= last + ahead && i < covers.length; i++) {
    push(i, i <= last + cols * 2 ? PREFETCH_PRIORITY.homeNext : PREFETCH_PRIORITY.homeAhead);
  }
  return out;
}

// ── Gallery plan ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Priorities for the photos of one listing around the one in front of the user: the open photo, then the next and previous, then the
 * rest by distance. `index` order is irrelevant to the caller; the queue orders by priority, then by arrival (which is distance, since
 * the list is emitted nearest first).
 */
export function neighbourPlan(count: number, active: number, openPriority: number = PREFETCH_PRIORITY.visible): { index: number; priority: number }[] {
  if (!(count > 0)) return [];
  const start = Math.max(0, Math.min(Math.trunc(active) || 0, count - 1));
  const out = [{ index: start, priority: openPriority }];
  for (let d = 1; out.length < count; d++) {
    for (const i of [start + d, start - d]) {
      if (i < 0 || i >= count) continue;
      out.push({ index: i, priority: d === 1 ? PREFETCH_PRIORITY.neighbour : PREFETCH_PRIORITY.listingRest });
    }
  }
  return out;
}
