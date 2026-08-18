'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { notFound } from 'next/navigation';
import { CategoryIcon, Tag } from '@/lib/icons';
import { categories } from '@/lib/categories';
import { Listing } from '@/lib/types';
import { listListingsByCategory } from '@/services/listings';
import { ListingCard } from '@/components/ListingCard';
import { EmptyState } from '@/components/EmptyState';

// Mirrors app/category/[id].tsx on mobile: category header, its real
// subcategory chips, then listings filtered to this category (and
// subcategory, once one is picked). Phase 2: real Supabase listings.
export default function CategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const category = categories.find((c) => c.id === id);
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const [categoryListings, setCategoryListings] = useState<Listing[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!category) return;
    setStatus('loading');
    listListingsByCategory(category.id)
      .then((rows) => {
        setCategoryListings(rows);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, [category]);

  const listings = useMemo(() => {
    if (!activeSub) return categoryListings;
    return categoryListings.filter((l) => l.subcategory === activeSub);
  }, [categoryListings, activeSub]);

  if (!category) notFound();

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primaryText">
          <CategoryIcon icon={category.icon} size={22} />
        </span>
        <h1 className="text-2xl font-bold text-textPrimary">{category.name}</h1>
      </div>

      {!!category.subcategories?.length && (
        <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveSub(null)}
            className={`shrink-0 rounded-pill px-3 py-1.5 text-sm ${!activeSub ? 'bg-primary text-primaryText' : 'bg-surface text-textSecondary shadow-sm'}`}
          >
            All
          </button>
          {category.subcategories.map((sub) => (
            <button
              key={sub.name}
              onClick={() => setActiveSub(sub.name)}
              className={`flex shrink-0 items-center gap-1.5 rounded-pill px-3 py-1.5 text-sm ${
                activeSub === sub.name ? 'bg-primary text-primaryText' : 'bg-surface text-textSecondary shadow-sm'
              }`}
            >
              <CategoryIcon icon={sub.icon} size={14} />
              {sub.name}
            </button>
          ))}
        </div>
      )}

      <div className="mt-5">
        {status === 'loading' ? (
          <p className="py-10 text-center text-sm text-textSecondary">Loading listings…</p>
        ) : status === 'error' ? (
          <p className="py-10 text-center text-sm text-textSecondary">Couldn&apos;t load listings. Try again shortly.</p>
        ) : listings.length === 0 ? (
          <EmptyState icon={Tag} title={`No ${category.name.toLowerCase()} listings yet`} message="Check back soon, or try a different subcategory." />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
