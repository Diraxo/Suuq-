// The small, on-demand listings cache — no React, no platform imports, so it can be unit-tested with fake fetchers
// (tests/listingsCore.test.ts). store/listings.ts plugs the real Supabase fetcher into it.
//
// It replaces the old "download every listing at launch" cache. Nothing here ever asks for "all listings": a screen
// asks for the ids (or the seller, or the category sample) it shows, and the cache remembers what came back.
//
// Rules the screens rely on:
//  - A listing is `ready` (in `listings`), `missing` (the server did not return it: removed, deactivated, blocked,
//    never existed, seller profile gone), `loading` (first fetch in flight, nothing cached to show) or `error`
//    (the fetch failed and there was nothing cached to show). A failed REFRESH of a cached listing keeps showing it.
//  - Every id carries a ticket. A response only commits for an id whose ticket is still the newest, and every local
//    change (publish / edit / sold / removal / sign-out) takes a new ticket — so a slow, older response can never
//    overwrite newer data or resurrect something that was removed meanwhile.
//  - Overlapping requests for an id share one fetch unless `force` is set.
//  - The cache is capped (LISTING_CACHE_MAX, newest-touched first); ids a mounted screen has pinned are never evicted.
import type { Listing } from '../types';
import { notifyListingsChanged } from './feedEvents';

export type LookupState = 'loading' | 'ready' | 'missing' | 'error';
export type Lookup = { state: LookupState; error?: string };

/** ids per request — keeps the request small and the server cap (200) far away. */
export const LOOKUP_CHUNK_SIZE = 100;
export const LISTING_CACHE_MAX = 300;
export const LOOKUP_TIMEOUT_MS = 20000;

export function uniqueIds(ids: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
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
}

/** Keeps the newest `max` entries (front of the array) plus any pinned id. */
export function capListings(listings: Listing[], max: number, pinned: ReadonlySet<string>): { kept: Listing[]; dropped: string[] } {
  if (listings.length <= max) return { kept: listings, dropped: [] };
  const kept: Listing[] = [];
  const dropped: string[] = [];
  listings.forEach((l, i) => {
    if (i < max || pinned.has(l.id)) kept.push(l);
    else dropped.push(l.id);
  });
  return { kept, dropped };
}

export type ListingsDeps = {
  /** The visible listings among `ids` (<= LOOKUP_CHUNK_SIZE). Absent rows mean "not visible to this viewer". Throws on failure. */
  fetchByIds: (ids: string[]) => Promise<Listing[]>;
  /** Only real (uuid) ids are fetched; anything else (static demo ids) is resolved locally by the caller. */
  isRealId: (id: string) => boolean;
  timeoutMs?: number;
  chunkSize?: number;
  max?: number;
};

export type ListingsState = {
  /** Newest-touched first. Small by construction (see LISTING_CACHE_MAX) — never the whole catalogue. */
  listings: Listing[];
  lookups: Record<string, Lookup>;
  /** Bumped by reset(): screens that are open re-request what they show. */
  epoch: number;
  /** Fetches what is not cached (or everything with `force`). Resolves true when none of the ids ended in `error`. */
  ensure: (ids: readonly string[], opts?: { force?: boolean }) => Promise<boolean>;
  /** Instant local patches so a publish/edit/delete reflects immediately, without waiting on a refetch. They also announce the change to the paged feeds. */
  upsertLocal: (listing: Listing) => void;
  patchLocal: (id: string, patch: Partial<Listing>) => void;
  removeLocal: (id: string) => void;
  /** Adds/refreshes listings that a server-paged screen (Home, search, category, city, seller) just received, so they can be opened without another request. */
  mergeFetched: (listings: Listing[]) => void;
  /** Drops everything (sign-out / account switch / block list change: what a viewer may see changed). In-flight responses are discarded. */
  reset: () => void;
  /** Protects ids from eviction while a screen shows them. Returns the unpin function. */
  pin: (ids: readonly string[]) => () => void;
};

type SetFn = (partial: Partial<ListingsState> | ((s: ListingsState) => Partial<ListingsState>)) => void;
type GetFn = () => ListingsState;

export function createListingsState(set: SetFn, get: GetFn, deps: ListingsDeps): ListingsState {
  const timeoutMs = deps.timeoutMs ?? LOOKUP_TIMEOUT_MS;
  const chunkSize = deps.chunkSize ?? LOOKUP_CHUNK_SIZE;
  const max = deps.max ?? LISTING_CACHE_MAX;

  let seq = 0;
  const latest = new Map<string, number>(); // id -> newest ticket
  const inflight = new Map<string, Promise<void>>(); // id -> the request currently fetching it
  const pins = new Map<string, number>();

  const bump = (id: string) => {
    latest.set(id, ++seq);
  };
  const pinned = () => new Set(pins.keys());

  const withCap = (listings: Listing[], lookups: Record<string, Lookup>) => {
    const { kept, dropped } = capListings(listings, max, pinned());
    if (dropped.length === 0) return { listings, lookups };
    const next = { ...lookups };
    for (const id of dropped) delete next[id]; // an evicted id is simply "unknown" again, not "missing"
    return { listings: kept, lookups: next };
  };

  const commit = (batch: string[], tickets: Map<string, number>, rows: Listing[] | null, message?: string) => {
    set((s) => {
      let listings = s.listings;
      const lookups = { ...s.lookups };
      const byId = new Map((rows ?? []).map((r) => [r.id, r]));
      for (const id of batch) {
        if (latest.get(id) !== tickets.get(id)) continue; // superseded by a newer fetch or a local change
        if (rows) {
          const row = byId.get(id);
          listings = listings.filter((l) => l.id !== id);
          if (row) {
            listings = [row, ...listings];
            lookups[id] = { state: 'ready' };
          } else {
            lookups[id] = { state: 'missing' };
          }
        } else if (!listings.some((l) => l.id === id)) {
          lookups[id] = { state: 'error', error: message };
        } // a failed refresh of a cached listing keeps showing it
      }
      return withCap(listings, lookups);
    });
  };

  return {
    listings: [],
    lookups: {},
    epoch: 0,

    ensure: async (ids, opts) => {
      const wanted = uniqueIds(ids).filter(deps.isRealId);
      if (wanted.length === 0) return true;
      const force = !!opts?.force;
      const cached = new Set(get().listings.map((l) => l.id));
      const needed = force ? wanted : wanted.filter((id) => !cached.has(id));

      const waits: Promise<void>[] = [];
      const fresh: string[] = [];
      for (const id of needed) {
        const running = !force ? inflight.get(id) : undefined;
        if (running) waits.push(running);
        else fresh.push(id);
      }

      if (fresh.length > 0) {
        const toLoad = fresh.filter((id) => !cached.has(id));
        if (toLoad.length > 0) {
          set((s) => {
            const lookups = { ...s.lookups };
            for (const id of toLoad) lookups[id] = { state: 'loading' };
            return { lookups };
          });
        }
        for (const batch of chunk(fresh, chunkSize)) {
          const tickets = new Map<string, number>();
          for (const id of batch) {
            bump(id);
            tickets.set(id, latest.get(id)!);
          }
          const run: Promise<void> = (async () => {
            try {
              const rows = await withTimeout(deps.fetchByIds(batch), timeoutMs);
              commit(batch, tickets, rows);
            } catch (e) {
              commit(batch, tickets, null, e instanceof Error ? e.message : String(e));
            }
          })().finally(() => {
            for (const id of batch) if (inflight.get(id) === run) inflight.delete(id);
          });
          for (const id of batch) inflight.set(id, run);
          waits.push(run);
        }
      }

      await Promise.all(waits);
      const lookups = get().lookups;
      return wanted.every((id) => lookups[id]?.state !== 'error');
    },

    upsertLocal: (listing) => {
      bump(listing.id);
      set((s) => withCap([listing, ...s.listings.filter((l) => l.id !== listing.id)], { ...s.lookups, [listing.id]: { state: 'ready' } }));
      notifyListingsChanged({ type: 'changed' });
    },

    patchLocal: (id, patch) => {
      bump(id);
      set((s) => ({ listings: s.listings.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
      notifyListingsChanged({ type: 'changed' });
    },

    removeLocal: (id) => {
      bump(id);
      set((s) => ({ listings: s.listings.filter((l) => l.id !== id), lookups: { ...s.lookups, [id]: { state: 'missing' } } }));
      notifyListingsChanged({ type: 'removed', id });
    },

    mergeFetched: (incoming) => {
      if (incoming.length === 0) return;
      set((s) => {
        const ids = new Set(incoming.map((l) => l.id));
        const lookups = { ...s.lookups };
        for (const id of ids) lookups[id] = { state: 'ready' };
        return withCap([...incoming, ...s.listings.filter((l) => !ids.has(l.id))], lookups);
      });
    },

    reset: () => {
      latest.clear();
      inflight.clear();
      set((s) => ({ listings: [], lookups: {}, epoch: s.epoch + 1 }));
    },

    pin: (ids) => {
      const mine = uniqueIds(ids);
      for (const id of mine) pins.set(id, (pins.get(id) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        for (const id of mine) {
          const n = (pins.get(id) ?? 1) - 1;
          if (n <= 0) pins.delete(id);
          else pins.set(id, n);
        }
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// What a screen shows for a set of ids. Pure, so the "loading is not missing" rule is testable.
export type ResolvedListings = {
  /** Found listings, in the order of `ids`. */
  items: Listing[];
  /** Ids the server says are not visible (or non-real ids with no local match). */
  missingIds: string[];
  /** Real ids still being fetched for the first time. */
  loading: boolean;
  /** At least one id failed to load and has nothing cached to show. */
  failed: boolean;
};

export function resolveIds(ids: readonly string[], cache: readonly Listing[], lookups: Record<string, Lookup>, isRealId: (id: string) => boolean, local: (id: string) => Listing | undefined): ResolvedListings {
  const byId = new Map(cache.map((l) => [l.id, l]));
  const out: ResolvedListings = { items: [], missingIds: [], loading: false, failed: false };
  for (const id of uniqueIds(ids)) {
    const found = byId.get(id) ?? local(id);
    if (found) {
      out.items.push(found);
      continue;
    }
    if (!isRealId(id)) {
      out.missingIds.push(id);
      continue;
    }
    const state = lookups[id]?.state;
    if (state === 'missing') out.missingIds.push(id);
    else if (state === 'error') out.failed = true;
    else out.loading = true; // never requested yet, or the first request is in flight: loading, NOT missing
  }
  return out;
}
