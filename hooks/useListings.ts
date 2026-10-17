import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Listing } from '@/types';
import { resolveLocalListing, useListingsStore } from '@/store/listings';
import { isRealListingId } from '@/data/validation';
import { resolveIds, uniqueIds } from '@/lib/listingsCore';

export type UseListingsOptions = {
  /** Re-check every id with the server once when the screen mounts (cached rows still show meanwhile), so a listing that was sold/removed/edited elsewhere is current. */
  revalidate?: boolean;
};

/** The listings for a set of ids: cache first, the missing ones fetched in batches (never one request per id). */
export function useListings(ids: readonly string[], { revalidate = true }: UseListingsOptions = {}) {
  const key = uniqueIds(ids).join(',');
  const cache = useListingsStore((s) => s.listings);
  const lookups = useListingsStore((s) => s.lookups);
  const epoch = useListingsStore((s) => s.epoch);
  const [refreshing, setRefreshing] = useState(false);
  const firstRun = useRef(true);

  useEffect(() => {
    const real = key ? key.split(',').filter(isRealListingId) : [];
    if (real.length === 0) return;
    const { ensure, pin } = useListingsStore.getState();
    const unpin = pin(real);
    void ensure(real, { force: revalidate && firstRun.current });
    firstRun.current = false;
    return unpin;
  }, [key, epoch, revalidate]);

  const resolved = useMemo(() => resolveIds(key ? key.split(',') : [], cache, lookups, isRealListingId, resolveLocalListing), [key, cache, lookups]);

  const refresh = useCallback(async () => {
    const real = key ? key.split(',').filter(isRealListingId) : [];
    setRefreshing(true);
    try {
      return await useListingsStore.getState().ensure(real, { force: true });
    } finally {
      setRefreshing(false);
    }
  }, [key]);

  return { ...resolved, refresh, refreshing };
}

export type ListingStatus = 'loading' | 'ready' | 'missing' | 'error';

/** One listing by id. `missing` = not visible to this viewer (removed, deactivated, blocked, or never existed); `loading` is never reported as missing. */
export function useListing(id: string | undefined): { listing: Listing | undefined; status: ListingStatus; retry: () => void } {
  const ids = useMemo(() => (id ? [id] : []), [id]);
  const { items, missingIds, loading, failed, refresh } = useListings(ids);
  const listing = items[0];
  const status: ListingStatus = listing ? 'ready' : !id ? 'missing' : failed ? 'error' : loading ? 'loading' : missingIds.length > 0 ? 'missing' : 'loading';
  return { listing, status, retry: () => void refresh() };
}
