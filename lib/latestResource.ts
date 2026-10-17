// One async resource with "newest request wins" semantics — no React or platform imports (unit-tested in
// tests/latestResource.test.ts). Used for the per-screen reads that are not id lookups: a seller's listings, the
// comparable sample for Compare / market price / price suggestions, saved-search counts.
//
//  - load(key) starts a request; a response only commits while it is still the newest request, so changing the key
//    quickly (or refreshing) can never let an older, slower response overwrite newer data.
//  - A failed or timed-out request becomes `error`; data from a previous successful load of the SAME key stays visible.
//  - Loading a different key clears the data so one seller's/category's rows are never shown under another's.
import { createLatestGuard } from './refreshController';

export type ResourceStatus = 'idle' | 'loading' | 'ready' | 'error';
export type ResourceState<T> = { status: ResourceStatus; key: string | null; data: T | null; error: string | null };

export const RESOURCE_TIMEOUT_MS = 20000;

export type Loader<T> = (key: string) => Promise<T>;

export type Resource<T> = {
  getState: () => ResourceState<T>;
  subscribe: (listener: () => void) => () => void;
  /** Resolves true when this request committed data (false: failed, or a newer request superseded it). */
  load: (key: string, loader?: Loader<T>) => Promise<boolean>;
  /** Re-runs the current key with the loader last used (pull-to-refresh / Retry). */
  reload: () => Promise<boolean>;
  reset: () => void;
};

export function createResource<T>(initialLoader?: Loader<T>, timeoutMs: number = RESOURCE_TIMEOUT_MS): Resource<T> {
  let lastLoader = initialLoader;
  let state: ResourceState<T> = { status: 'idle', key: null, data: null, error: null };
  const listeners = new Set<() => void>();
  const guard = createLatestGuard();
  const set = (next: ResourceState<T>) => {
    state = next;
    listeners.forEach((l) => l());
  };

  const load = async (key: string, loader: Loader<T> | undefined = lastLoader): Promise<boolean> => {
    if (!loader) throw new Error('createResource: no loader');
    lastLoader = loader;
    const ticket = guard.next();
    set({ status: 'loading', key, data: state.key === key ? state.data : null, error: null });
    try {
      const data = await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        loader(key).then(
          (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          (e) => {
            clearTimeout(timer);
            reject(e);
          }
        );
      });
      if (!guard.isLatest(ticket)) return false;
      set({ status: 'ready', key, data, error: null });
      return true;
    } catch (e) {
      if (!guard.isLatest(ticket)) return false;
      set({ status: 'error', key, data: state.key === key ? state.data : null, error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    reload: () => (state.key === null ? Promise.resolve(false) : load(state.key)),
    reset: () => {
      guard.next(); // discard anything in flight
      set({ status: 'idle', key: null, data: null, error: null });
    },
  };
}
