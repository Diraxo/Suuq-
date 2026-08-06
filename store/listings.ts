import { create } from 'zustand';
import { Listing, Profile } from '@/types';
import { mockListings } from '@/data/mockListings';
import { supabase } from '@/lib/supabase';
import { getSellerStatsBatch, profileToSeller } from '@/lib/sellerStats';
import { rowToListing, ListingRow } from '@/store/myListings';

// The cross-user public feed — every real listing from every seller (RLS on
// `listings` allows public select), merged with the static mock catalogue at
// the call sites below. This is what Home/Search/Category/City/etc read from,
// as opposed to store/myListings.ts which is scoped to the signed-in user's
// own listings (My Listings, Seller Dashboard, Price Drops).
type ListingsState = {
  listings: Listing[];
  hasHydrated: boolean;
  load: () => Promise<void>;
  /** Instant local patches so a publish/edit/delete reflects immediately, without waiting on a refetch. */
  upsertLocal: (listing: Listing) => void;
  patchLocal: (id: string, patch: Partial<Listing>) => void;
  removeLocal: (id: string) => void;
};

export const useListingsStore = create<ListingsState>((set) => ({
  listings: [],
  hasHydrated: false,

  load: async () => {
    const { data: rows } = await supabase.from('listings').select('*').order('created_at', { ascending: false });
    const listingRows = (rows ?? []) as ListingRow[];
    const userIds = listingRows.map((r) => r.user_id);

    if (userIds.length === 0) {
      set({ listings: [], hasHydrated: true });
      return;
    }

    const [{ data: profileRows }, statsMap] = await Promise.all([
      supabase.from('profiles').select('*').in('id', userIds),
      getSellerStatsBatch(userIds),
    ]);
    const profileMap = new Map<string, Profile>((profileRows ?? []).map((p) => [(p as Profile).id, p as Profile]));

    const listings = listingRows
      .map((row) => {
        const profile = profileMap.get(row.user_id);
        if (!profile) return null;
        const stats = statsMap.get(row.user_id) ?? { listingsCount: 0, soldCount: 0, followers: 0, rating: 0, reviewCount: 0 };
        return rowToListing(row, profileToSeller(profile, stats));
      })
      .filter((l): l is Listing => !!l);

    set({ listings, hasHydrated: true });
  },

  upsertLocal: (listing) => set((s) => ({ listings: [listing, ...s.listings.filter((l) => l.id !== listing.id)] })),
  patchLocal: (id, patch) => set((s) => ({ listings: s.listings.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
  removeLocal: (id) => set((s) => ({ listings: s.listings.filter((l) => l.id !== id) })),
}));

// A listing can come from two places: the static mock catalogue (permanent
// demo inventory) or the real cross-user `listings` table. Real ids are
// Supabase uuids and never collide with mock ids ('l1', 'l2', ...).
export function resolveListing(id: string | undefined, allListings: Listing[]): Listing | undefined {
  if (!id) return undefined;
  return allListings.find((l) => l.id === id) ?? mockListings.find((l) => l.id === id);
}

export function resolveAllListings(allListings: Listing[]): Listing[] {
  const overridden = mockListings.map((l) => allListings.find((m) => m.id === l.id) ?? l);
  const newOnes = allListings.filter((m) => !mockListings.some((l) => l.id === m.id));
  return [...newOnes, ...overridden];
}
