'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { Search, ChevronDown, CategoryIcon } from '@/lib/icons';
import { categories } from '@/lib/categories';
import { useLocations } from '@/services/locations';
import { LocationFilter } from '@/components/LocationFilter';
import { LocNode, displayName, findByName, toLang } from '@/lib/locationTree';
import { DISCOVERY_TABS, FallbackKind, FeedCategory } from '@/lib/homeFeed';
import { buildHomeQuery, categoryValues, fallbackPlan, feedKey, runFallback } from '@/lib/homeFeedPaging';
import { fetchCurrencyOptions, fetchFeedSample } from '@/services/homeFeed';
import { homeFeed } from '@/store/homeFeed';
import { usePagedFeed } from '@/hooks/usePagedFeed';
import { usePriceOptions } from '@/hooks/usePriceOptions';
import { FeedFooter } from '@/components/FeedFooter';
import { useVisibilityStore, withoutHidden } from '@/store/visibility';
import { Listing } from '@/lib/types';
import { currencyLabel } from '@/lib/currency';
import { ListingCard } from '@/components/ListingCard';
import { HomeEmpty } from '@/components/HomeEmpty';
import { useAuthStore } from '@/store/auth';
import { homeRefresh, refreshHome, useHomeRefresh } from '@/store/homeRefresh';
import { useHomeBrowseStore, useHomeScope } from '@/store/homeBrowse';

// Mirrors app/(tabs)/home.tsx on mobile: greeting + search, category row,
// discovery tabs, location strip, then the feed. Which listings show, and in
// what order, is decided on the server one page at a time (home_feed, migration
// 0042) from the rules lib/homeFeed.ts defines — the app asks the same
// question, so the same selection gives the same results on both. Real
// Supabase listings only (never demo products).
export default function HomePage() {
  // Selections live in a store (lib/homeBrowse.ts defaults, same as the app) so
  // they survive leaving Home and coming back; only a repeated tap on the
  // active Home tab resets them.
  const activeTab = useHomeBrowseStore((s) => s.activeTab);
  const setActiveTab = useHomeBrowseStore((s) => s.setActiveTab);
  const activeCategory = useHomeBrowseStore((s) => s.activeCategory);
  const setActiveCategory = useHomeBrowseStore((s) => s.setActiveCategory);
  const priceOrder = useHomeBrowseStore((s) => s.priceOrder);
  const setPriceOrder = useHomeBrowseStore((s) => s.setPriceOrder);
  const priceCurrency = useHomeBrowseStore((s) => s.priceCurrency);
  const setPriceCurrency = useHomeBrowseStore((s) => s.setPriceCurrency);
  const scopeId = useHomeScope((s) => s.scopeId);
  const setScopeId = useHomeScope((s) => s.setScope);
  const [priceMenuOpen, setPriceMenuOpen] = useState(false);
  const [pickerToken, setPickerToken] = useState(0);
  const directory = useLocations();
  const refresh = useHomeRefresh();
  const profileCity = useAuthStore((s) => s.profile?.city);
  const lang = toLang('en');

  // Double-tap Home (see homeRefresh.onHomeTabPress): after the selections are
  // reset, scroll the whole page back to the top and the location strip to its
  // start. Bumping a token and acting in an effect runs after React has applied
  // the reset, so the scroll can't race the re-render.
  const [resetToken, setResetToken] = useState(0);
  useEffect(() => homeRefresh.onReset(() => setResetToken((n) => n + 1)), []);
  useEffect(() => {
    if (resetToken > 0) window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [resetToken]);

  const category = useMemo(() => categories.find((c) => c.id === activeCategory) ?? null, [activeCategory]);
  const scopeNode = scopeId ? directory.index.byId.get(scopeId) : undefined;
  const placeName = scopeNode ? displayName(scopeNode, lang) : null;
  const homePlaceId = useMemo(() => findByName(directory.index, profileCity)?.id ?? null, [directory.index, profileCity]);

  const feedCategory: FeedCategory | null = useMemo(() => (category ? { id: category.id, name: category.name } : null), [category]);

  // Wait for the place directory before asking when the answer depends on it (a saved place, or Nearby), so a first
  // load is not for the wrong place.
  const awaitingDirectory = (!!scopeId || activeTab === 'Nearby') && directory.index.nodes.length === 0 && directory.status === 'loading';
  const priceOptions = usePriceOptions(activeTab === 'Price' && !awaitingDirectory, categoryValues(feedCategory), scopeNode ? scopeNode.id : null, fetchCurrencyOptions, refresh.lastUpdatedAt ?? 0);
  const hq = useMemo(
    () =>
      buildHomeQuery({
        index: directory.index,
        scopeId,
        category: feedCategory,
        tab: activeTab,
        priceOrder,
        currency: priceCurrency,
        homePlaceId,
        priceOptions: priceOptions.options,
      }),
    [directory.index, scopeId, feedCategory, activeTab, priceOrder, priceCurrency, homePlaceId, priceOptions.options]
  );
  const wantedQuery = awaitingDirectory ? null : hq.query;
  const wantedKey = wantedQuery ? feedKey(wantedQuery) : null;
  useEffect(() => {
    homeFeed.setQuery(wantedQuery);
    // `wantedQuery` is fully determined by `wantedKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey]);
  // Revalidate on every visit: the rows already on screen stay while the first page is refetched. (A changed
  // selection is already loading, so there is nothing to revalidate then.)
  useEffect(() => {
    if (homeFeed.getState().status === 'ready') void homeRefresh.refresh();
  }, []);
  const feedState = usePagedFeed(homeFeed);
  const hidden = useVisibilityStore((s) => s.hidden);
  // Hidden by staff since this page loaded: gone at once, without a refetch.
  const items = useMemo(() => withoutHidden(feedState.items, hidden), [feedState.items, hidden]);
  const emptyKey = feedState.status === 'ready' && items.length === 0 ? `${feedState.key}|${activeCategory}|${scopeId}` : null;
  const [fallback, setFallback] = useState<{ key: string; kind: FallbackKind; place: LocNode | null; items: Listing[] } | null>(null);
  // Nothing matched: look for clearly labelled alternatives (a wider place, other categories, the marketplace).
  useEffect(() => {
    if (!emptyKey || hq.needsLocation) return;
    let live = true;
    runFallback(fallbackPlan(directory.index, scopeId, feedCategory), fetchFeedSample, () => live)
      .then((found) => {
        if (live) setFallback(found && found.items.length ? { key: emptyKey, kind: found.kind, place: found.place, items: found.items } : null);
      })
      .catch(() => live && setFallback(null)); // alternatives are optional; the empty state works without them
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the empty selection changes
  }, [emptyKey]);
  const emptyFeed = useMemo(
    () => ({
      items: [] as Listing[],
      needsLocation: hq.needsLocation,
      nearbyAnchor: hq.nearbyAnchor,
      price: hq.price,
      fallback: fallback && fallback.key === emptyKey ? { kind: fallback.kind, place: fallback.place, items: fallback.items } : null,
    }),
    [hq, fallback, emptyKey]
  );
  const failed = feedState.status === 'error' || priceOptions.failed;

  const priceLabel = priceOrder === 'asc' ? 'Lowest price first' : 'Highest price first';

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="md:flex md:items-end md:justify-between">
        <div>
          <p className="text-sm text-textSecondary">Good morning 👋</p>
          <h1 className="text-2xl font-bold text-textPrimary md:text-3xl">What are you looking for today?</h1>
        </div>
      </div>

      <Link
        href="/search"
        className="mt-4 flex items-center gap-2 rounded-md bg-inputBackground px-4 py-3 text-sm text-textMuted md:hidden"
      >
        <Search size={18} />
        Search phones, cars, furniture...
      </Link>

      <div className="no-scrollbar mt-5 flex gap-2 overflow-x-auto md:flex-wrap md:gap-3">
        {categories.map((cat) => {
          const active = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(active ? null : cat.id)}
              aria-pressed={active}
              className="flex w-16 shrink-0 flex-col items-center gap-1 md:w-20"
            >
              <span className={`flex h-14 w-14 items-center justify-center rounded-lg ${active ? 'bg-primary text-primaryText' : 'bg-surface text-primary'}`}>
                <CategoryIcon icon={cat.icon} size={22} />
              </span>
              <span className={`line-clamp-1 text-center text-[11px] ${active ? 'text-primary' : 'text-textPrimary'}`}>{cat.name}</span>
            </button>
          );
        })}
      </div>

      <div className="no-scrollbar mt-6 flex gap-2 overflow-x-auto">
        {DISCOVERY_TABS.map((tab) => {
          const active = activeTab === tab;
          const cls = `shrink-0 rounded-pill px-3 py-1.5 text-sm ${active ? 'bg-primary text-primaryText' : 'bg-surface text-textSecondary shadow-sm'}`;
          if (tab !== 'Price') {
            return (
              <button key={tab} onClick={() => setActiveTab(tab)} aria-pressed={active} className={cls}>
                {tab}
              </button>
            );
          }
          return (
            <div key={tab} className="relative shrink-0">
              <button onClick={() => setPriceMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={priceMenuOpen} aria-pressed={active} className={`${cls} flex items-center gap-1`}>
                {active ? `Price: ${priceLabel}` : 'Price'}
                <ChevronDown size={14} />
              </button>
              {priceMenuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setPriceMenuOpen(false)} />
                  <div role="menu" aria-label="Sort by price" className="absolute left-0 top-full z-40 mt-1 w-52 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-md">
                    {(['asc', 'desc'] as const).map((order) => {
                      const on = active && priceOrder === order;
                      return (
                        <button
                          key={order}
                          role="menuitemradio"
                          aria-checked={on}
                          onClick={() => {
                            setPriceOrder(order);
                            setActiveTab('Price');
                            setPriceMenuOpen(false);
                          }}
                          className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-inputBackground ${on ? 'font-semibold text-primary' : 'text-textPrimary'}`}
                        >
                          {order === 'asc' ? 'Lowest price first' : 'Highest price first'}
                          {on && <span aria-hidden>✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      {activeTab === 'Price' && hq.price && hq.price.options.length > 1 && (
        <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto">
          {hq.price.options.map((o) => {
            const on = o.code === hq.price!.currency;
            return (
              <button
                key={o.code}
                onClick={() => setPriceCurrency(o.code)}
                aria-pressed={on}
                className={`shrink-0 rounded-md border px-3 py-1 text-xs ${on ? 'border-primary bg-primary text-primaryText' : 'border-border bg-surface text-textPrimary'}`}
              >
                {currencyLabel(o.code)} ({o.count})
              </button>
            );
          })}
        </div>
      )}

      <LocationFilter directory={directory} scopeId={scopeId} onChange={setScopeId} openToken={pickerToken} scrollResetToken={resetToken} />

      <div className="mb-1 mt-6 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-textPrimary">{activeTab}</h2>
          {(category || placeName) && <p className="text-xs text-textSecondary">{[category?.name, placeName].filter(Boolean).join(' · ')}</p>}
          {activeTab === 'Nearby' && hq.nearbyAnchor && (
            <p className="text-xs text-textSecondary">Closest to {displayName(hq.nearbyAnchor, lang)} first: same city, then region, then country.</p>
          )}
          {activeTab === 'Price' && hq.price && (
            <p className="text-xs text-textSecondary">
              Prices are only compared within one currency.
              {hq.price.hiddenOther > 0 ? ` ${hq.price.hiddenOther} more listings are in other currencies. Choose a currency above to see them.` : ''}
            </p>
          )}
        </div>
        <button
          onClick={() => refreshHome()}
          disabled={refresh.refreshing}
          aria-busy={refresh.refreshing}
          aria-label="Refresh listings"
          className="flex shrink-0 items-center gap-1.5 rounded-pill bg-surface px-3 py-1.5 text-xs text-textSecondary shadow-sm hover:text-primary disabled:opacity-70"
        >
          <RefreshCw size={14} className={refresh.refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>
      {/* Success is silent and the spinning icon above is the progress indicator; only a failure speaks here (with Retry). Fixed height, so nothing jumps. */}
      <div className="mb-3 min-h-[1.25rem] text-xs text-textSecondary" role="status" aria-live="polite">
        {!refresh.refreshing && refresh.failed && items.length > 0 ? (
          <span>
            Couldn&apos;t refresh. Showing the last results we had.{' '}
            <button onClick={() => refreshHome()} className="font-medium text-primary">
              Try again
            </button>
          </span>
        ) : null}
      </div>

      {hq.needsLocation && !awaitingDirectory ? (
        <HomeEmpty
          feed={emptyFeed}
          categoryName={category?.name ?? null}
          placeName={placeName}
          onClearCategory={() => setActiveCategory(null)}
          onClearPlace={() => setScopeId(null)}
          onChoosePlace={() => setPickerToken((n) => n + 1)}
          onBackToSelection={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        />
      ) : items.length === 0 && failed ? (
        <div className="py-10 text-center">
          <p className="text-sm text-textSecondary">Couldn&apos;t load listings. Check your connection and try again.</p>
          <button
            onClick={() => {
              if (priceOptions.failed) priceOptions.retry();
              else void homeRefresh.refresh();
            }}
            className="mt-2 text-sm font-medium text-primary"
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 && feedState.status === 'ready' ? (
        <HomeEmpty
          feed={emptyFeed}
          categoryName={category?.name ?? null}
          placeName={placeName}
          onClearCategory={() => setActiveCategory(null)}
          onClearPlace={() => setScopeId(null)}
          onChoosePlace={() => setPickerToken((n) => n + 1)}
          onBackToSelection={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        />
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-sm text-textSecondary" role="status">
          Loading listings…
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {items.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
          <FeedFooter
            count={items.length}
            loadingMore={feedState.loadingMore}
            moreFailed={feedState.moreFailed}
            hasMore={feedState.hasMore}
            ready={feedState.status === 'ready'}
            onLoadMore={() => void homeFeed.loadMore()}
          />
        </>
      )}
    </div>
  );
}
