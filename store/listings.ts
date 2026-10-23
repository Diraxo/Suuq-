import { create } from 'zustand';
import { Listing } from '@/types';
import { mockListings } from '@/data/mockListings';
import { isRealListingId } from '@/data/validation';
import { createListingsState, ListingsState } from '@/lib/listingsCore';
import { fetchListingsByIds } from '@/lib/listingsApi';
import { useAuthStore } from '@/store/auth';
import { useBlockedUsersStore } from '@/store/blockedUsers';

// A small, on-demand cache of listings from every seller. NOTHING downloads the whole table any more (the old
// startup `load()` is gone): detail, Favorites, Compare, Offers, Recently Viewed, the edit/insights/gallery screens
// ask for the ids they show (hooks/useListings.ts -> ensure()), Home/category/city/search/seller pages add what they
// received with mergeFetched(). Behaviour and rules: lib/listingsCore.ts. store/myListings.ts is separate: it is
// scoped to the signed-in user's own listings (My Listings, Seller Dashboard, Price Drops).
export const useListingsStore = create<ListingsState>()((set, get) =>
  createListingsState(set, get, { fetchByIds: fetchListingsByIds, isRealId: isRealListingId })
);

// What a viewer may see depends on who they are and on their block list (the database hides blocked sellers in both
// directions), so a cached listing must never outlive either: drop the cache on sign-in/out/switch and whenever the
// viewer's own block list changes. Screens that are open simply re-request what they show.
let lastViewer: string | null = null;
useAuthStore.subscribe((state) => {
  const uid = state.session?.user.id ?? null;
  if (uid === lastViewer) return;
  lastViewer = uid;
  useListingsStore.getState().reset();
});
let lastBlocked = '';
useBlockedUsersStore.subscribe((state) => {
  const key = state.blocked
    .map((b) => b.id)
    .sort()
    .join(',');
  if (key === lastBlocked) return;
  lastBlocked = key;
  useListingsStore.getState().reset();
});

// A listing can come from two places: the static mock catalogue (permanent demo inventory, currently empty) or the
// real `listings` table. Real ids are Supabase uuids and never collide with mock ids ('l1', 'l2', ...).
export function resolveLocalListing(id: string): Listing | undefined {
  return mockListings.find((l) => l.id === id);
}

/** A listing from an already-loaded list (e.g. the signed-in user's own listings), falling back to the static catalogue. */
export function resolveListing(id: string | undefined, list: Listing[]): Listing | undefined {
  if (!id) return undefined;
  return list.find((l) => l.id === id) ?? resolveLocalListing(id);
}
