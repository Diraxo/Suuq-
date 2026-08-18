'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search as SearchIcon, X } from '@/lib/icons';
import { Listing } from '@/lib/types';
import { searchListings } from '@/services/search';
import { ListingCard } from '@/components/ListingCard';
import { EmptyState } from '@/components/EmptyState';
import { requireAuth } from '@/store/authPrompt';

const FILTERS = ['Verified only', 'Price reduced', 'Negotiable', 'Posted today'];

function SearchPageInner() {
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [results, setResults] = useState<Listing[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const toggleFilter = (f: string) => setActiveFilters((s) => (s.includes(f) ? s.filter((x) => x !== f) : [...s, f]));

  useEffect(() => {
    setStatus('loading');
    const timeout = setTimeout(() => {
      searchListings({ query: query || undefined })
        .then((rows) => {
          setResults(rows);
          setStatus('ready');
        })
        .catch(() => setStatus('error'));
    }, 250); // debounce keystrokes, mirrors the real search's query cost
    return () => clearTimeout(timeout);
  }, [query]);

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="flex items-center gap-2 rounded-md bg-inputBackground px-4 py-3">
        <SearchIcon size={18} className="text-textMuted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search phones, cars, furniture..."
          className="w-full bg-transparent text-sm text-textPrimary placeholder:text-textMuted focus:outline-none"
          autoFocus
        />
        {query && (
          <button onClick={() => setQuery('')} aria-label="Clear search">
            <X size={16} className="text-textMuted" />
          </button>
        )}
      </div>

      <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
        {FILTERS.map((f) => {
          const active = activeFilters.includes(f);
          return (
            <button
              key={f}
              onClick={() => toggleFilter(f)}
              className={`shrink-0 rounded-pill border px-3 py-1.5 text-sm ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-surface text-textSecondary'}`}
            >
              {f}
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        {status === 'loading' ? (
          <p className="py-10 text-center text-sm text-textSecondary">Searching…</p>
        ) : status === 'error' ? (
          <p className="py-10 text-center text-sm text-textSecondary">Search failed. Try again.</p>
        ) : results.length === 0 ? (
          <EmptyState
            icon={SearchIcon}
            title="Nothing matches yet"
            message="Try a different search, or save it and we'll notify you when something matches."
            actionLabel="Save this search"
            onAction={() => requireAuth(() => {})}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {results.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
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
