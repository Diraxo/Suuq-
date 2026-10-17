'use client';

import { Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search as SearchIcon, X } from '@/lib/icons';
import { Listing } from '@/lib/types';
import { fetchSearchPage, type SearchPage as SearchResultPage } from '@/services/search';
import { ListingCard } from '@/components/ListingCard';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import { useLocations } from '@/services/locations';
import { useLocationText } from '@/lib/locationText';
import { useHomeScope } from '@/store/homeBrowse';
import { displayName, pathLabel, searchLocations, toLang } from '@/lib/locationTree';
import { initialSession, sessionReducer } from '@/lib/searchSession';
import {
  FILTER_IDS,
  FilterId,
  FilterState,
  NO_FILTERS,
  SEARCH_DEBOUNCE_MS,
  SearchInput,
  hasActiveFilters,
  recommendationSearches,
  recoveryActions,
  searchKey,
  toggleFilter,
} from '@/lib/searchFilters';
import { createLatestGuard } from '@/lib/refreshController';
import { requireAuth } from '@/store/authPrompt';
import { useAuthStore } from '@/store/auth';
import { addSavedSearch } from '@/services/account';
import { registerKnownListingIds, useVisibilityStore, withoutHidden } from '@/store/visibility';

const FILTER_LABELS: Record<FilterId, string> = {
  verified: 'Verified only',
  boostedToday: 'Boosted today',
  priceReduced: 'Price reduced',
  negotiable: 'Negotiable',
  postedToday: 'Posted today',
};
const RECOVERY_LABELS = {
  clearFilters: 'Clear filters',
  clearSearch: 'Clear search',
  clearCategory: 'Remove category',
  clearLocation: 'Remove location',
} as const;

function SearchPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const category = params.get('category') || null;
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [debouncedQuery, setDebouncedQuery] = useState(params.get('q') ?? '');
  const [filters, setFilters] = useState<FilterState>(NO_FILTERS);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [recs, setRecs] = useState<Listing[]>([]);
  const directory = useLocations();
  const { t, lang: locale } = useLocationText();
  const lang = toLang(locale);
  const scopeId = useHomeScope((s) => s.scopeId);
  const setHomeScope = useHomeScope((s) => s.setScope);

  const [searchSaved, setSearchSaved] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const saveThisSearch = () =>
    requireAuth(async () => {
      const uid = useAuthStore.getState().session?.user.id;
      if (!uid || searchSaved === 'saving') return;
      setSearchSaved('saving');
      const activeFilters = FILTER_IDS.filter((f) => filters[f]).map((f) => FILTER_LABELS[f]).join(', ');
      const ok = await addSavedSearch(uid, query.trim(), activeFilters);
      setSearchSaved(ok ? 'saved' : 'failed');
    }, { next: `/search?q=${encodeURIComponent(query.trim())}` });
  // A different search is a different thing to save.
  useEffect(() => setSearchSaved('idle'), [debouncedQuery, filters]);

  const [session, dispatch] = useReducer(sessionReducer<Listing>, undefined, initialSession<Listing>);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const guard = useRef(createLatestGuard()).current;

  // Typing is debounced; clearing the box and the filter chips apply immediately.
  useEffect(() => {
    if (!query.trim()) {
      setDebouncedQuery('');
      return;
    }
    const id = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const input: SearchInput = useMemo(() => ({ query: debouncedQuery, category, scopeId, filters }), [debouncedQuery, category, scopeId, filters]);
  const key = searchKey(input);

  // First page for the current search. A response to a superseded search/refresh carries an old ticket and is dropped.
  useEffect(() => {
    const ticket = guard.next();
    dispatch({ type: 'begin', key, ticket });
    fetchSearchPage(input)
      .then((page: SearchResultPage) => dispatch({ type: 'success', ticket, page }))
      .catch(() => dispatch({ type: 'failure', ticket }));
    // `input` is fully determined by `key`; refreshNonce re-runs the same search (Retry).
  }, [key, refreshNonce]);

  const loadMore = useCallback(() => {
    const s = sessionRef.current;
    if (s.status !== 'ready' || !s.hasMore || s.loadingMore || !s.cursor) return;
    const ticket = s.ticket;
    dispatch({ type: 'beginMore', ticket });
    fetchSearchPage(input, s.cursor)
      .then((page) => dispatch({ type: 'moreSuccess', ticket, page }))
      .catch(() => dispatch({ type: 'moreFailure', ticket }));
  }, [input]);

  // Infinite scroll: load the next page when the sentinel scrolls into view.
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadMore(), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, session.items.length, session.hasMore]);

  // Listings staff hid since this page loaded disappear immediately (real-time + reconciled on reconnect).
  const hidden = useVisibilityStore((s) => s.hidden);
  const results = useMemo(() => withoutHidden(session.items, hidden), [session.items, hidden]);
  useEffect(() => registerKnownListingIds(session.items.map((l) => l.id)), [session.items]);
  const isEmpty = session.status === 'ready' && results.length === 0;
  const loadingFirst = session.status === 'loading' && results.length === 0;

  // Real, eligible recommendations when nothing matched.
  useEffect(() => {
    setRecs([]);
    if (!isEmpty) return;
    let live = true;
    (async () => {
      for (const alt of recommendationSearches(input)) {
        try {
          const page = await fetchSearchPage(alt, null, 6);
          if (!live) return;
          if (page.items.length > 0) {
            setRecs(page.items);
            return;
          }
        } catch {
          return;
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [isEmpty, key]);

  // Places from the approved directory that the typed text names; when nothing
  // else matched, "did you mean" alternatives for a misspelling (never auto-applied).
  const places = useMemo(() => {
    if (!query.trim()) return { items: [], isSuggestion: false };
    const found = searchLocations(directory.index, query, lang);
    if (found.matches.length) return { items: found.matches.slice(0, 3), isSuggestion: false };
    return { items: isEmpty ? found.suggestions.slice(0, 3) : [], isSuggestion: true };
  }, [directory.index, query, lang, isEmpty]);

  // Saved searches aren't available on the web yet, so that action is never offered here.
  const webRecovery = recoveryActions(input).filter((a): a is keyof typeof RECOVERY_LABELS => a !== 'saveSearch');

  const runRecovery = (action: keyof typeof RECOVERY_LABELS) => {
    switch (action) {
      case 'clearFilters':
        return setFilters(NO_FILTERS);
      case 'clearSearch':
        setQuery('');
        return setDebouncedQuery('');
      case 'clearCategory':
        return router.replace(query ? `/search?q=${encodeURIComponent(query)}` : '/search');
      case 'clearLocation':
        return setHomeScope(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-10 pt-4 md:px-6 md:pt-8">
      <div className="flex w-full items-center gap-2 rounded-md bg-inputBackground px-4 py-3 md:max-w-2xl">
        <SearchIcon size={18} className="text-textMuted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search phones, cars, furniture..."
          className="min-w-0 flex-1 bg-transparent text-sm text-textPrimary placeholder:text-textMuted focus:outline-none"
          autoFocus
        />
        {query && (
          <button onClick={() => setQuery('')} aria-label="Clear search">
            <X size={16} className="text-textMuted" />
          </button>
        )}
      </div>

      {query.trim() && (
        <button onClick={saveThisSearch} disabled={searchSaved === 'saving' || searchSaved === 'saved'} className="mt-3 text-sm font-medium text-primary disabled:text-textMuted">
          {searchSaved === 'saved' ? 'Search saved' : searchSaved === 'failed' ? 'Couldn’t save — try again' : 'Save this search'}
        </button>
      )}

      <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:overflow-visible md:px-0" role="group" aria-label="Filters">
        {FILTER_IDS.map((id) => {
          const active = filters[id];
          return (
            <button
              key={id}
              onClick={() => setFilters((f) => toggleFilter(f, id))}
              aria-pressed={active}
              className={`shrink-0 rounded-pill border px-3 py-1.5 text-sm ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-surface text-textSecondary'}`}
            >
              {FILTER_LABELS[id]}
            </button>
          );
        })}
      </div>

      {places.items.length > 0 && (
        <div className="mt-3" role="status" aria-live="polite">
          <p className="mb-1 text-xs text-textSecondary">{places.isSuggestion ? t('noExactMatch', { query: query.trim() }) : t('places')}</p>
          <div className="no-scrollbar flex gap-2 overflow-x-auto">
            {places.items.map((node) => {
              const where = pathLabel(directory.index, node.id, lang);
              return (
                <button
                  key={node.id}
                  onClick={() => {
                    setHomeScope(node.id);
                    router.push('/');
                  }}
                  className="shrink-0 rounded-md border border-border bg-surface px-3 py-1.5 text-left text-sm text-primary"
                >
                  {displayName(node, lang)}
                  {where && <span className="block text-[11px] text-textMuted">{where}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-5" aria-busy={session.status === 'loading'}>
        {loadingFirst ? (
          <p className="py-10 text-center text-sm text-textSecondary">Searching…</p>
        ) : session.status === 'error' ? (
          <div className="py-10 text-center" role="alert">
            <p className="text-sm font-semibold text-textPrimary">Search couldn’t load</p>
            <p className="mt-1 text-sm text-textSecondary">Check your connection and try again.</p>
            <div className="mt-4 flex justify-center">
              <Button onClick={() => setRefreshNonce((n) => n + 1)}>Try again</Button>
            </div>
          </div>
        ) : isEmpty ? (
          <div>
            <EmptyState
              icon={SearchIcon}
              title={hasActiveFilters(filters) ? 'No listings match this filter' : 'Nothing matches yet'}
              message={
                hasActiveFilters(filters)
                  ? 'Try another filter, or clear it to see all listings.'
                  : debouncedQuery.trim()
                    ? 'Try a different search term, or check the spelling.'
                    : 'No listings are available right now. Check back soon.'
              }
            />
            {webRecovery.length > 0 && (
              <div className="mb-6 flex flex-wrap justify-center gap-2">
                {webRecovery.map((action, i) => (
                  <Button key={action} variant={i === 0 ? 'primary' : 'outline'} size="sm" onClick={() => runRecovery(action)}>
                    {RECOVERY_LABELS[action]}
                  </Button>
                ))}
              </div>
            )}
            {recs.length > 0 && (
              <section>
                <h2 className="mb-3 text-base font-semibold text-textPrimary">You might like these</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {recs.map((listing) => (
                    <ListingCard key={listing.id} listing={listing} />
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          <>
            <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 ${session.status === 'loading' ? 'opacity-60' : ''}`}>
              {results.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
            <div ref={sentinel} className="h-8" />
            {session.loadingMore && <p className="py-4 text-center text-sm text-textSecondary">Loading more…</p>}
            {session.moreFailed && (
              <div className="flex justify-center py-4">
                <Button variant="outline" size="sm" onClick={loadMore}>
                  Try again
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageInner />
    </Suspense>
  );
}
