'use client';

import { use, useMemo, useState } from 'react';
import { notFound } from 'next/navigation';
import { CategoryIcon, Tag } from '@/lib/icons';
import { categories } from '@/lib/categories';
import { ListingCard } from '@/components/ListingCard';
import { EmptyState } from '@/components/EmptyState';
import { FeedFooter } from '@/components/FeedFooter';
import { BASE_QUERY } from '@/lib/homeFeedPaging';
import { usePagedFeed, useScreenFeed } from '@/hooks/usePagedFeed';
import { useVisibilityStore, withoutHidden } from '@/store/visibility';
import { useT } from '@/lib/i18n';
import { categoryLabel, subcategoryLabel } from '@/lib/categoryNames';

// Mirrors app/category/[id].tsx on mobile: category header, its real
// subcategory chips, then listings filtered to this category (and
// subcategory, once one is picked). Real Supabase listings, one page at a
// time (home_feed, migration 0042) — the category and subcategory are filters
// in the database query, not a filter over every listing.
export default function CategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useT();
  const { id } = use(params);
  const category = categories.find((c) => c.id === id);
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const query = useMemo(() => (category ? { ...BASE_QUERY, categories: [category.id], subcategory: activeSub } : null), [category, activeSub]);
  const feed = useScreenFeed(query);
  const state = usePagedFeed(feed);
  const hidden = useVisibilityStore((s) => s.hidden);
  const listings = useMemo(() => withoutHidden(state.items, hidden), [state.items, hidden]);

  if (!category) notFound();

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primaryText">
          <CategoryIcon icon={category.icon} size={22} />
        </span>
        <h1 className="text-2xl font-bold text-textPrimary">{categoryLabel(t, category.id, category.name)}</h1>
      </div>

      {!!category.subcategories?.length && (
        <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveSub(null)}
            className={`shrink-0 rounded-pill px-3 py-1.5 text-sm ${!activeSub ? 'bg-primary text-primaryText' : 'bg-surface text-textSecondary shadow-sm'}`}
          >
            {t('favorites.all')}
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
              {subcategoryLabel(t, category.id, sub.name)}
            </button>
          ))}
        </div>
      )}

      <div className="mt-5">
        {listings.length === 0 && state.status === 'error' ? (
          <div className="py-10 text-center">
            <p className="text-sm text-textSecondary">{t('web.t.couldnTLoadListingsTry')}</p>
            <button onClick={() => void feed.refresh()} className="mt-2 text-sm font-medium text-primary">
              {t('chat.retry')}
            </button>
          </div>
        ) : listings.length === 0 && state.status === 'ready' ? (
          <EmptyState icon={Tag} title={t('web.m.noCategoryListings', { name: categoryLabel(t, category.id, category.name).toLowerCase() })} message={t('web.t.checkBackSoonOrTry')} />
        ) : listings.length === 0 ? (
          <p className="py-10 text-center text-sm text-textSecondary" role="status">
            {t('web.t.loadingListings')}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {listings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
            <FeedFooter
              count={listings.length}
              loadingMore={state.loadingMore}
              moreFailed={state.moreFailed}
              hasMore={state.hasMore}
              ready={state.status === 'ready'}
              onLoadMore={() => void feed.loadMore()}
            />
          </>
        )}
      </div>
    </div>
  );
}
