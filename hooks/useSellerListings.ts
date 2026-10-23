import { useCallback, useMemo } from 'react';
import { Listing } from '@/types';
import { useListingsStore } from '@/store/listings';
import { useResource } from '@/hooks/useResource';
import { fetchSellerListings, SellerListingsPage } from '@/lib/listingsApi';
import { isRealListingId } from '@/data/validation';
import { useBlockedUsersStore } from '@/store/blockedUsers';

/**
 * One seller's listings, fetched with a single request (seller_listings(), newest first, capped). The list stays live:
 * a sale/edit/removal made on this device (store/listings.ts) shows up immediately, and a listing this device just
 * published for that seller is included — without ever loading anyone else's listings. Blocked sellers (either direction),
 * removed and deactivated listings never come back from the server.
 */
export function useSellerListings(sellerId: string | undefined) {
  const enabled = !!sellerId && isRealListingId(sellerId); // seller ids are uuids too
  // Block / unblock changes what the server returns for this seller, so the request is keyed on the block-list version:
  // without it, a page fetched while blocked (empty) would stay on screen after unblocking.
  const blockVersion = useBlockedUsersStore((s) => s.version);
  const res = useResource<SellerListingsPage>(enabled ? `${sellerId}|${blockVersion}` : null, async (key) => {
    const page = await fetchSellerListings(key.split('|')[0]);
    useListingsStore.getState().mergeFetched(page.items); // so a tapped card opens without another request
    return page;
  });
  const cache = useListingsStore((s) => s.listings);
  const lookups = useListingsStore((s) => s.lookups);

  const listings = useMemo<Listing[]>(() => {
    if (!enabled || !res.data) return [];
    const byId = new Map(cache.map((l) => [l.id, l]));
    const seen = new Set<string>();
    const out: Listing[] = [];
    for (const l of res.data.items) {
      seen.add(l.id);
      if (lookups[l.id]?.state === 'missing') continue; // removed/deactivated since the page was fetched
      out.push(byId.get(l.id) ?? l); // the cached copy carries local edits (sold, price)
    }
    for (const l of cache) if (l.seller.id === sellerId && !seen.has(l.id)) out.push(l); // published here after the fetch
    return out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }, [enabled, res.data, cache, lookups, sellerId]);

  const retry = useCallback(() => void res.reload(), [res]);
  return {
    listings,
    /** The seller has more listings than were fetched, so counts derived from `listings` would be too low. */
    hasMore: !!res.data?.hasMore,
    loading: enabled && (res.status === 'idle' || res.status === 'loading') && !res.data,
    failed: enabled && res.status === 'error' && !res.data,
    retry,
  };
}
