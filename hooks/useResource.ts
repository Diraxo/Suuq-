import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { createResource, ResourceState } from '@/lib/latestResource';

/**
 * Loads `loader(key)` whenever `key` changes (null/undefined = don't load). The newest request wins, a failure keeps a
 * previous successful result for the same key, and `reload()` re-runs it (pull-to-refresh / Retry). See lib/latestResource.ts.
 */
export function useResource<T>(key: string | null | undefined, loader: (key: string) => Promise<T>): ResourceState<T> & { reload: () => Promise<boolean> } {
  const [resource] = useState(() => createResource<T>());
  const state = useSyncExternalStore(resource.subscribe, resource.getState, resource.getState);

  // `loader` is intentionally not a dependency: a new request starts when the key changes, with the loader of that render.
  useEffect(() => {
    if (key) void resource.load(key, loader);
    else resource.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, resource]);
  useEffect(() => () => resource.reset(), [resource]);

  const reload = useCallback(() => resource.reload(), [resource]);
  // Right after a key change the resource still holds the previous key's state until the effect runs: never expose it.
  const current: ResourceState<T> = state.key === (key ?? null) ? state : { status: key ? 'loading' : 'idle', key: key ?? null, data: null, error: null };
  return { ...current, reload };
}
