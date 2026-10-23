// Home refresh, as plain state + a de-duplicating runner — no React or
// platform imports, so the identical file lives at web/src/lib/refreshController.ts
// (keep the two copies in sync; scripts/run-tests.js fails if they drift).
//
// Two distinct actions, one network pipeline:
//  - refresh(): pull-to-refresh, the web Refresh button, Retry, a Home visit. Reloads
//    data only; browsing selections are untouched.
//  - reset(): tapping the already-active Home tab. Restores the default Home view
//    (via the installed reset handler), tells the screen to scroll to the top
//    (onReset listeners), then refreshes.
// Both end in refresh(): while a request is in flight further triggers share it
// instead of starting another one.

export type RefreshState = {
  refreshing: boolean;
  /** ms since epoch of the last successful refresh (feeds Trending's "now"); never shown to the user. */
  lastUpdatedAt: number | null;
  /** The last refresh failed (cleared by the next attempt). */
  failed: boolean;
};

/** Handed to the runner so an abandoned (timed-out) request can tell it lost and must not commit. */
export type RefreshContext = {
  /** True until this request times out or is superseded by a newer one. Check right before writing fetched data. */
  isCurrent: () => boolean;
};

/**
 * Newest-wins guard for async loads: take a ticket before the request, commit
 * only if it is still the newest when the response arrives. Used by the data
 * stores so a slow, abandoned response can never overwrite a newer one.
 */
export function createLatestGuard() {
  let latest = 0;
  return {
    next: () => ++latest,
    isLatest: (ticket: number) => ticket === latest,
  };
}

export type RefreshController = {
  getState: () => RefreshState;
  subscribe: (listener: () => void) => () => void;
  /** Install what "refresh" means. Must resolve true on success, and must only commit fetched data while `ctx.isCurrent()` is true. */
  setRunner: (run: (ctx: RefreshContext) => Promise<boolean>) => void;
  refresh: () => Promise<boolean>;
  /** Install what "restore the default Home view" means (client-side state only). */
  setResetHandler: (handler: () => void) => void;
  /** Called on every reset() — after the state reset — so screens can scroll to the top. Returns an unsubscribe. */
  onReset: (listener: () => void) => () => void;
  /** Full reset: default selections, scroll to top, then refresh (sharing any in-flight request). */
  reset: () => Promise<boolean>;
  /** Tab press: a full reset only when the Home tab was already the active one; null (do nothing extra) when arriving from another tab. */
  onHomeTabPress: (wasFocused: boolean) => Promise<boolean> | null;
};

/** A refresh that has not settled after this long is treated as failed so the UI can't stay stuck on "refreshing". */
export const REFRESH_TIMEOUT_MS = 20000;

export function createRefreshController(now: () => number = Date.now, timeoutMs: number = REFRESH_TIMEOUT_MS): RefreshController {
  let state: RefreshState = { refreshing: false, lastUpdatedAt: null, failed: false };
  let run: ((ctx: RefreshContext) => Promise<boolean>) | null = null;
  let inflight: Promise<boolean> | null = null;
  const generations = createLatestGuard();
  let resetHandler: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const resetListeners = new Set<() => void>();
  const set = (patch: Partial<RefreshState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };

  const refresh = (): Promise<boolean> => {
    if (inflight) return inflight;
    if (!run) return Promise.resolve(false);
    set({ refreshing: true, failed: false });
    const ticket = generations.next();
    const ctx: RefreshContext = { isCurrent: () => generations.isLatest(ticket) };
    inflight = (async () => {
      let ok = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // A hung runner loses the race: this refresh settles as failed and
        // inflight is cleared, so Retry starts exactly one new request. The
        // timeout also takes a new ticket, so the abandoned request is stale
        // from that moment and its late response cannot commit over newer data.
        ok = await Promise.race([
          run!(ctx),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => {
              generations.next();
              resolve(false);
            }, timeoutMs);
          }),
        ]);
      } catch {
        ok = false;
      } finally {
        if (timer) clearTimeout(timer);
      }
      inflight = null;
      set(ok ? { refreshing: false, lastUpdatedAt: now(), failed: false } : { refreshing: false, failed: true });
      return ok;
    })();
    return inflight;
  };

  const reset = (): Promise<boolean> => {
    // The UI reset always happens, even when a refresh is already running.
    resetHandler?.();
    resetListeners.forEach((l) => l());
    return refresh();
  };

  return {
    getState: () => state,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    setRunner: (r) => {
      run = r;
    },
    setResetHandler: (h) => {
      resetHandler = h;
    },
    onReset: (l) => {
      resetListeners.add(l);
      return () => resetListeners.delete(l);
    },
    refresh,
    reset,
    onHomeTabPress: (wasFocused) => (wasFocused ? reset() : null),
  };
}
