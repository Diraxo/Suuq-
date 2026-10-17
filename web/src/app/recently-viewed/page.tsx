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

export default function RecentlyViewedPage() {
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
      <PageHeader title="Recently Viewed" />
      {state === 'loading' ? (
        <p className="py-10 text-center text-sm text-textSecondary">Loading…</p>
      ) : state === 'failed' ? (
        <EmptyState icon={History} title="Couldn’t load this list" message="Check your connection and try again." actionLabel="Try again" onAction={() => setNonce((n) => n + 1)} />
      ) : items.length === 0 ? (
        <EmptyState icon={History} title="Nothing viewed yet" message="Listings you open will show up here." />
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
