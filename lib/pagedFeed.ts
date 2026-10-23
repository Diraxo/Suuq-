// A paginated feed as plain state + a request runner — no React or platform imports, so the identical file lives at
// web/src/lib/pagedFeed.ts (keep the copies in sync; tests/homeFeedPaging.test.ts fails if they drift).
// It drives Home, the category screen and the city screen; the page data comes from the injected `fetchPage`.
//
// Guarantees (proved in tests/homeFeedPaging.test.ts):
//  - every request carries a ticket; a response is applied only while its ticket is the newest, so a slow response
//    to a superseded filter, refresh or "load more" can never overwrite newer data
//  - changing the filters clears the rows first (rows that do not match the new filters are never shown) and
//    fetches page 1; asking for the SAME filters again changes nothing
//  - "load more" never runs twice at once, never runs past the end, appends without duplicates, and a failure
//    keeps what is shown and can be retried
//  - refresh() re-fetches page 1 and replaces the rows only on success; a failed refresh keeps the old rows
//  - a failure is an error state, never an empty list
import { createLatestGuard } from './refreshController';
import { PageCursor } from './searchFilters';
import { SearchSession, SessionAction, SessionPage, initialSession, sessionReducer } from './searchSession';

export type FeedFetchContext = {
  /** ms since epoch, fixed for the whole feed (all of its pages) — Trending's age decay is measured at this instant. */
  asOf: number;
  /** False once this request has been superseded; skip side effects (e.g. caching rows) when it is. */
  isCurrent: () => boolean;
};

export type PagedFeedOptions<T extends { id: string }, Q> = {
  keyOf: (query: Q) => string;
  fetchPage: (query: Q, cursor: PageCursor | null, ctx: FeedFetchContext) => Promise<SessionPage<T>>;
  now?: () => number;
  /** A request that has not settled after this long counts as failed (so Retry can start a new one). Default 20s. */
  timeoutMs?: number;
};

export type PagedFeed<T extends { id: string }, Q> = {
  getState: () => SearchSession<T>;
  subscribe: (listener: () => void) => () => void;
  /** The filters the shown rows belong to (null = idle). */
  getQuery: () => Q | null;
  /** Show the feed for these filters. Same filters as now: no-op. Different: clear and fetch page 1. null: go idle. */
  setQuery: (query: Q | null) => void;
  /** Re-fetch page 1 for the current filters, keeping the rows until it succeeds. Resolves true unless the fetch failed. */
  refresh: () => Promise<boolean>;
  /** Fetch the next page, if there is one and nothing is already loading. Resolves true when a page was appended. */
  loadMore: () => Promise<boolean>;
  remove: (id: string) => void;
  /** Stop caring about in-flight requests (screen unmounted). */
  dispose: () => void;
};

export function createPagedFeed<T extends { id: string }, Q>(options: PagedFeedOptions<T, Q>): PagedFeed<T, Q> {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 20000;
  const guard = createLatestGuard();
  const listeners = new Set<() => void>();
  let session: SearchSession<T> = initialSession<T>();
  let query: Q | null = null;
  let asOf = now();
  let refreshInflight: Promise<boolean> | null = null;
  let rerun = false;
  let disposed = false;

  const dispatch = (action: SessionAction<T>) => {
    const next = sessionReducer(session, action);
    if (next === session) return;
    session = next;
    listeners.forEach((l) => l());
  };

  // Runs one request with a time limit. The context tells the fetcher when it has been superseded or timed out.
  const request = (q: Q, cursor: PageCursor | null, ticket: number, at: number): Promise<SessionPage<T>> => {
    let timedOut = false;
    const ctx: FeedFetchContext = { asOf: at, isCurrent: () => guard.isLatest(ticket) && !timedOut };
    return new Promise<SessionPage<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        timedOut = true;
        reject(new Error('feed request timed out'));
      }, timeoutMs);
      (timer as { unref?: () => void }).unref?.(); // Node only: never keep a process alive for this
      options.fetchPage(q, cursor, ctx).then(
        (page) => {
          clearTimeout(timer);
          if (!timedOut) resolve(page);
        },
        (e) => {
          clearTimeout(timer);
          if (!timedOut) reject(e);
        }
      );
    });
  };

  // One first-page request. Resolves false only when the request failed while still current.
  const fetchFirst = async (q: Q, key: string, reset: boolean): Promise<boolean> => {
    const ticket = guard.next();
    asOf = now();
    dispatch({ type: 'begin', key, ticket, reset });
    try {
      const page = await request(q, null, ticket, asOf);
      dispatch({ type: 'success', ticket, page });
      return true;
    } catch {
      dispatch({ type: 'failure', ticket });
      return !guard.isLatest(ticket); // superseded failures are not the caller's problem
    }
  };

  return {
    getState: () => session,
    subscribe: (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    getQuery: () => query,

    setQuery: (q) => {
      if (disposed) return;
      if (q === null) {
        if (query === null) return;
        query = null;
        dispatch({ type: 'reset', ticket: guard.next() });
        return;
      }
      const key = options.keyOf(q);
      if (query !== null && session.key === key) {
        query = q; // same feed: keep rows and state, just hold the latest equivalent filters
        return;
      }
      const hadFeed = session.key !== null;
      query = q;
      void fetchFirst(q, key, hadFeed);
    },

    refresh: () => {
      if (disposed || query === null) return Promise.resolve(false);
      if (refreshInflight) {
        rerun = true; // something changed while loading: fetch once more after this one lands
        return refreshInflight;
      }
      refreshInflight = (async () => {
        let ok = true;
        do {
          rerun = false;
          if (query === null) return false;
          ok = await fetchFirst(query, options.keyOf(query), false);
        } while (rerun && !disposed);
        return ok;
      })().finally(() => {
        refreshInflight = null;
      });
      return refreshInflight;
    },

    loadMore: async () => {
      const s = session;
      if (disposed || query === null || s.status !== 'ready' || !s.hasMore || s.loadingMore || !s.cursor) return false;
      const ticket = s.ticket;
      const q = query;
      dispatch({ type: 'beginMore', ticket });
      try {
        const page = await request(q, s.cursor, ticket, asOf);
        const current = guard.isLatest(ticket);
        dispatch({ type: 'moreSuccess', ticket, page });
        return current;
      } catch {
        dispatch({ type: 'moreFailure', ticket });
        return false;
      }
    },

    remove: (id) => dispatch({ type: 'remove', id }),

    dispose: () => {
      disposed = true;
      listeners.clear();
      // Advance the session's ticket too, so a response that is still on its way is recognised as stale.
      dispatch({ type: 'reset', ticket: guard.next() });
    },
  };
}
