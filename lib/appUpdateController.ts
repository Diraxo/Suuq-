// Drives the mandatory-update check: startup, foreground rechecks, caching, retry back-off.
// Pure (all I/O is injected) so tests/appUpdateController.test.ts covers blocking, store round-trips and failures.
import { decideUpdate, UpdateDecision, UpdatePolicy } from './appUpdate';

export type UpdateStatus = {
  /** 'checking' only until the first answer (or the startup time limit); the app is held back meanwhile only when `blocking`. */
  phase: 'checking' | 'ready';
  decision: UpdateDecision;
  /** The last request failed (or returned an invalid row); the decision then comes from the cache, or is `unverified`. */
  lastFetchFailed: boolean;
};

export type FetchResult = { ok: true; policy: UpdatePolicy } | { ok: false };

export type UpdateDeps = {
  fetchPolicy: () => Promise<FetchResult>;
  getInstalledVersion: () => string | null;
  loadCache: () => Promise<UpdatePolicy | null>;
  saveCache: (policy: UpdatePolicy) => Promise<void>;
  now: () => number;
  /** Runs `fn` after `ms`; returns a cancel function. */
  schedule: (fn: () => void, ms: number) => () => void;
};

/** A healthy, recently verified policy is not re-fetched on every foreground. */
export const FOREGROUND_MIN_INTERVAL_MS = 30 * 60 * 1000;
/** A cold start waits for the answer only this long when nothing is cached, then continues (fail-open, `unverified`). */
export const STARTUP_WAIT_MS = 3500;
/** Retry back-off after a failed fetch: 15s, 30s, 60s, 2m, then every 5m. */
export function retryDelayMs(attempt: number): number {
  return Math.min(300_000, 15_000 * 2 ** Math.max(0, attempt));
}

/** The one thing the rest of the app asks: must normal access be withheld right now? */
export function isBlocking(status: UpdateStatus): boolean {
  return status.decision.kind === 'required';
}

export function createUpdateController(deps: UpdateDeps) {
  let policy: UpdatePolicy | null = null;
  let lastSuccessAt = 0;
  let inFlight: Promise<void> | null = null;
  let failures = 0;
  let cancelRetry: (() => void) | null = null;
  let cancelStartup: (() => void) | null = null;
  let started = false;
  let status: UpdateStatus = { phase: 'checking', decision: { kind: 'unverified', reason: 'no-policy' }, lastFetchFailed: false };
  const listeners = new Set<() => void>();

  function publish(next: Partial<UpdateStatus>) {
    status = { ...status, ...next };
    listeners.forEach((l) => l());
  }

  // Re-reads the installed version every time, so a store update (or a lowered minimum) is honoured without a restart.
  function reevaluate() {
    publish({ decision: decideUpdate(deps.getInstalledVersion(), policy) });
  }

  function scheduleRetry() {
    cancelRetry?.();
    cancelRetry = deps.schedule(() => void refresh({ force: true }), retryDelayMs(failures - 1));
  }

  async function doFetch(): Promise<void> {
    let result: FetchResult;
    try {
      result = await deps.fetchPolicy();
    } catch {
      result = { ok: false };
    }
    if (result.ok) {
      policy = result.policy;
      lastSuccessAt = deps.now();
      failures = 0;
      cancelRetry?.();
      cancelRetry = null;
      deps.saveCache(result.policy).catch(() => {});
      publish({ phase: 'ready', lastFetchFailed: false, decision: decideUpdate(deps.getInstalledVersion(), policy) });
    } else {
      failures += 1;
      scheduleRetry();
      // Keep whatever policy we already hold (memory or cache): a block never lifts because a request failed.
      publish({ phase: 'ready', lastFetchFailed: true, decision: decideUpdate(deps.getInstalledVersion(), policy) });
    }
  }

  function refresh(opts: { force?: boolean } = {}): Promise<void> {
    if (inFlight) return inFlight;
    const recent = lastSuccessAt > 0 && deps.now() - lastSuccessAt < FOREGROUND_MIN_INTERVAL_MS;
    if (!opts.force && recent && !isBlocking(status)) {
      reevaluate();
      return Promise.resolve();
    }
    inFlight = doFetch().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    getStatus: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Call once at launch. Resolves when the first decision exists (cached, fetched, or the startup time limit). */
    async start(): Promise<void> {
      if (started) return;
      started = true;
      try {
        policy = await deps.loadCache();
      } catch {
        policy = null;
      }
      if (policy) {
        // A cached policy decides immediately; the fetch below only tightens or relaxes it.
        publish({ phase: 'ready', decision: decideUpdate(deps.getInstalledVersion(), policy) });
        void refresh({ force: true });
        return;
      }
      // Nothing cached: hold the app back for a bounded time, then continue unverified.
      cancelStartup = deps.schedule(() => {
        if (status.phase === 'checking') publish({ phase: 'ready', lastFetchFailed: true, decision: decideUpdate(deps.getInstalledVersion(), policy) });
      }, STARTUP_WAIT_MS);
      await refresh({ force: true });
      cancelStartup?.();
      cancelStartup = null;
    },

    /** App returned to the foreground (e.g. back from the store): re-read the installed version, then refresh (throttled unless blocked). */
    async onForeground(): Promise<void> {
      if (!started) return;
      reevaluate();
      await refresh({ force: isBlocking(status) });
    },

    /** The Retry button on the update screen. */
    async retry(): Promise<void> {
      await refresh({ force: true });
    },

    dispose() {
      cancelRetry?.();
      cancelStartup?.();
      listeners.clear();
    },
  };
}
