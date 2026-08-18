'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, MapPin } from '@/lib/icons';
import { CategoryIcon } from '@/lib/icons';
import { categories, cities } from '@/lib/categories';
import { Listing } from '@/lib/types';
import { listListings, listRecentPriceDropIds } from '@/services/listings';
import { ListingCard } from '@/components/ListingCard';
import { useHomeRefreshStore } from '@/store/homeRefresh';

const DISCOVERY_TABS = ['For You', 'Nearby', 'Latest', 'Trending', 'Price Drops'] as const;
type DiscoveryTab = (typeof DISCOVERY_TABS)[number];

// Mirrors app/(tabs)/home.tsx on mobile: greeting + search, category row,
// discovery tabs, city chips, then the feed — same defaults, same filtering
// rules (city + category apply under every tab). Phase 2: real Supabase
// listings (store/listings.ts on mobile) — no mock catalogue fallback.
export default function HomePage() {
  const [activeTab, setActiveTab] = useState<DiscoveryTab>('For You');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [allListings, setAllListings] = useState<Listing[]>([]);
  const [priceDropIds, setPriceDropIds] = useState<string[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const refreshToken = useHomeRefreshStore((s) => s.token);

  const load = () => {
    setStatus('loading');
    Promise.all([listListings(), listRecentPriceDropIds()])
      .then(([listings, drops]) => {
        setAllListings(listings);
        setPriceDropIds(drops);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [refreshToken]);

  const listings = useMemo(() => {
    let base = allListings;
    if (city) base = base.filter((l) => l.city === city);
    if (activeCategory) base = base.filter((l) => l.category === activeCategory);

    switch (activeTab) {
      case 'Latest':
        return [...base].reverse();
      case 'Trending':
        return [...base].sort((a, b) => b.views - a.views);
      case 'Price Drops': {
        const order = new Map(priceDropIds.map((id, i) => [id, i]));
        return base.filter((l) => order.has(l.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
      }
      default:
        return base;
    }
  }, [activeTab, activeCategory, city, allListings, priceDropIds]);

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
        {DISCOVERY_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`shrink-0 rounded-pill px-3 py-1.5 text-sm ${activeTab === tab ? 'bg-primary text-primaryText' : 'bg-surface text-textSecondary shadow-sm'}`}
          >
            {tab}
          </button>
        ))}
      </div>

      <h2 className="mt-6 text-lg font-semibold text-textPrimary">Explore by city</h2>
      <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto">
        {[{ label: 'All Locations', value: null }, ...cities.map((c) => ({ label: c, value: c }))].map((opt) => {
          const active = city === opt.value;
          return (
            <button
              key={opt.label}
              onClick={() => setCity(opt.value)}
              className={`flex shrink-0 items-center gap-1 rounded-md border px-3 py-1.5 text-sm ${
                active ? 'border-primary bg-primary text-primaryText' : 'border-border bg-surface text-textPrimary'
              }`}
            >
              <MapPin size={14} className={active ? 'text-primaryText' : 'text-primary'} />
              {opt.label}
            </button>
          );
        })}
      </div>

      <h2 className="mb-3 mt-6 text-lg font-semibold text-textPrimary">{activeTab}</h2>
      {status === 'loading' ? (
        <p className="py-10 text-center text-sm text-textSecondary">Loading listings…</p>
      ) : status === 'error' ? (
        <div className="py-10 text-center">
          <p className="text-sm text-textSecondary">Couldn&apos;t load listings. Check your connection and try again.</p>
          <button onClick={load} className="mt-2 text-sm font-medium text-primary">
            Retry
          </button>
        </div>
      ) : listings.length === 0 ? (
        <p className="py-10 text-center text-sm text-textSecondary">No listings match these filters yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </div>
  );
}
