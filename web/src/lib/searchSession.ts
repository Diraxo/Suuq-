// Pure state machine for a paginated search screen — no React or platform imports, so the identical file
// lives at web/src/lib/searchSession.ts (keep the copies in sync; tests/searchFilters.test.ts checks).
//
// Guarantees that tests/searchFilters.test.ts proves:
//  - a response is applied only if it carries the newest ticket (stale/out-of-order responses are dropped)
//  - changing the search keeps the previous results visible while the new ones load (no flicker/jump)
//  - "load more" appends without duplicates and can fail without discarding what is already shown
//  - a failure never looks like an empty result set
import { PageCursor } from './searchFilters';

export type SessionStatus = 'idle' | 'loading' | 'ready' | 'error';

export type SearchSession<T extends { id: string }> = {
  /** Identity of the search these items belong to (see searchKey). */
  key: string | null;
  /** Newest request ticket; responses carrying any other ticket are stale. */
  ticket: number;
  status: SessionStatus;
  items: T[];
  hasMore: boolean;
  cursor: PageCursor | null;
  loadingMore: boolean;
  moreFailed: boolean;
};

export type SessionPage<T> = { items: T[]; hasMore: boolean; cursor: PageCursor | null };

export type SessionAction<T extends { id: string }> =
  /** `reset` clears the shown items first (the Home feed does this when its filters change, so rows that do not match the new filters are never shown). */
  | { type: 'begin'; key: string; ticket: number; reset?: boolean }
  /** Back to idle (nothing to show); the ticket still advances so in-flight responses are dropped. */
  | { type: 'reset'; ticket: number }
  | { type: 'success'; ticket: number; page: SessionPage<T> }
  | { type: 'failure'; ticket: number }
  | { type: 'beginMore'; ticket: number }
  | { type: 'moreSuccess'; ticket: number; page: SessionPage<T> }
  | { type: 'moreFailure'; ticket: number }
  | { type: 'remove'; id: string }
  | { type: 'patch'; id: string; patch: Partial<T> };

export function initialSession<T extends { id: string }>(): SearchSession<T> {
  return { key: null, ticket: 0, status: 'idle', items: [], hasMore: false, cursor: null, loadingMore: false, moreFailed: false };
}

export function sessionReducer<T extends { id: string }>(s: SearchSession<T>, a: SessionAction<T>): SearchSession<T> {
  switch (a.type) {
    case 'begin':
      // Keep showing the previous results while the new search loads — unless it is a different search, in
      // which case they are cleared on success; `status: loading` lets the UI show progress either way.
      if (a.reset) return { ...initialSession<T>(), key: a.key, ticket: a.ticket, status: 'loading' };
      return { ...s, key: a.key, ticket: a.ticket, status: 'loading', loadingMore: false, moreFailed: false };
    case 'reset':
      return { ...initialSession<T>(), ticket: a.ticket };
    case 'success':
      if (a.ticket !== s.ticket) return s;
      return { ...s, status: 'ready', items: dedupe(a.page.items), hasMore: a.page.hasMore, cursor: a.page.cursor, loadingMore: false, moreFailed: false };
    case 'failure':
      if (a.ticket !== s.ticket) return s;
      return { ...s, status: 'error', loadingMore: false };
    case 'beginMore':
      if (a.ticket !== s.ticket || s.status !== 'ready' || !s.hasMore || s.loadingMore) return s;
      return { ...s, loadingMore: true, moreFailed: false };
    case 'moreSuccess': {
      if (a.ticket !== s.ticket) return s;
      const seen = new Set(s.items.map((i) => i.id));
      const fresh = dedupe(a.page.items).filter((i) => !seen.has(i.id));
      return { ...s, items: [...s.items, ...fresh], hasMore: a.page.hasMore, cursor: a.page.cursor, loadingMore: false };
    }
    case 'moreFailure':
      if (a.ticket !== s.ticket) return s;
      return { ...s, loadingMore: false, moreFailed: true };
    case 'remove':
      return s.items.some((i) => i.id === a.id) ? { ...s, items: s.items.filter((i) => i.id !== a.id) } : s;
    case 'patch':
      return s.items.some((i) => i.id === a.id) ? { ...s, items: s.items.map((i) => (i.id === a.id ? { ...i, ...a.patch } : i)) } : s;
  }
}

function dedupe<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}
