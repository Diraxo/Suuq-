'use client';

import { useEffect, useState } from 'react';
import { Heart } from '@/lib/icons';
import { EmptyState } from '@/components/EmptyState';
import { ListingCard } from '@/components/ListingCard';
import { Listing } from '@/lib/types';
import { listListingsByIds } from '@/services/listings';
import { useFavoritesStore } from '@/store/favorites';
import { useAuthStore } from '@/store/auth';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { useT } from '@/lib/i18n';

// Mirrors app/favorites.tsx on mobile. Phase 2: real Supabase `favorites`
// table (via src/store/favorites.ts), synced with the mobile app.
export default function FavoritesPage() {
  const t = useT();
  const session = useAuthStore((s) => s.session);
  const ids = useFavoritesStore((s) => s.ids);
  const hasHydrated = useFavoritesStore((s) => s.hasHydrated);
  const [favorited, setFavorited] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useRequireAuthPage('/favorites');

  useEffect(() => {
    if (!hasHydrated) return;
    if (ids.length === 0) {
      setFavorited([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    listListingsByIds(ids).then((rows) => {
      setFavorited(rows);
      setLoading(false);
    });
  }, [ids, hasHydrated]);

  if (!session) return <div className="min-h-[50vh]" />;

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <h1 className="mb-4 text-2xl font-bold text-textPrimary">{t('settings.notificationPreferences.categories.favorites.label')}</h1>
      {loading ? (
        <p className="py-10 text-center text-sm text-textSecondary">{t('web.t.loadingFavorites')}</p>
      ) : favorited.length === 0 ? (
        <EmptyState icon={Heart} title={t('favorites.emptyTitle')} message={t('favorites.emptyMessage')} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {favorited.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </div>
  );
}
