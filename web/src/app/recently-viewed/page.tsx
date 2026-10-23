'use client';

// Web port of app/recently-viewed.tsx. Open to guests too (a local list); signed-in users share one list with the app.
import { useEffect, useState } from 'react';
import { History } from '@/lib/icons';
import { EmptyState } from '@/components/EmptyState';
import { ListingCard } from '@/components/ListingCard';
import { PageHeader } from '@/components/PageHeader';
import { Listing } from '@/lib/types';
import { listListingsByIds } from '@/services/listings';
import { listRecentlyViewedIds } from '@/services/account';
import { useAuthStore } from '@/store/auth';
import { useT } from '@/lib/i18n';

export default function RecentlyViewedPage() {
  const t = useT();
  const initializing = useAuthStore((s) => s.initializing);
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const [items, setItems] = useState<Listing[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (initializing) return;
    let cancelled = false;
    setState('loading');
    (async () => {
      try {
        const ids = await listRecentlyViewedIds(userId);
        const rows = await listListingsByIds(ids);
        // Keep the "most recent first" order; anything no longer visible (removed, blocked) is skipped.
        const byId = new Map(rows.map((l) => [l.id, l]));
        if (cancelled) return;
        setItems(ids.map((id) => byId.get(id)).filter((l): l is Listing => !!l));
        setState('ready');
      } catch {
        if (!cancelled) setState('failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initializing, userId, nonce]);

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <PageHeader title={t('profile.menu.recentlyViewed')} />
      {state === 'loading' ? (
        <p className="py-10 text-center text-sm text-textSecondary">{t('common.loading')}</p>
      ) : state === 'failed' ? (
        <EmptyState icon={History} title={t('web.t.couldnTLoadThisList')} message={t('search.errorMessage')} actionLabel={t('common.retry')} onAction={() => setNonce((n) => n + 1)} />
      ) : items.length === 0 ? (
        <EmptyState icon={History} title={t('recentlyViewed.emptyTitle')} message={t('web.t.listingsYouOpenWillShow')} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
      )}
    </div>
  );
}
