import { create } from 'zustand';
import { useLocationStore } from '@/store/location';
import { useListingsStore } from '@/store/listings';

// Home's temporary browsing state — which discovery tab, category, and city
// filter are active. Kept in its own store (not local useState in
// app/(tabs)/home.tsx) so app/(tabs)/_layout.tsx can reset it from outside the
// screen: on double-tapping the already-focused Home tab, and on returning to
// Home from another tab (Search/Chats/Profile). City lives in the separate,
// already-shared useLocationStore rather than here, but is reset alongside
// these for the same "back to Home's default state" behavior.
export const DISCOVERY_TABS = ['For You', 'Nearby', 'Latest', 'Trending', 'Price Drops'] as const;
const DEFAULT_TAB: string = DISCOVERY_TABS[0];

type HomeBrowseState = {
  activeTab: string;
  activeCategory: string | null;
  setActiveTab: (tab: string) => void;
  setActiveCategory: (category: string | null) => void;
};

export const useHomeBrowseStore = create<HomeBrowseState>((set) => ({
  activeTab: DEFAULT_TAB,
  activeCategory: null,
  setActiveTab: (activeTab) => set({ activeTab }),
  setActiveCategory: (activeCategory) => set({ activeCategory }),
}));

/**
 * Restores Home to its default browsing state: default discovery tab, no
 * category, all locations. Never touches account data, favorites, follows,
 * language, or any other persisted preference — only this transient filter
 * state. Pass `refetch: true` (double-tap-to-reset) to also pull the latest
 * feed; a plain return-to-Home focus only needs to reset the filters already
 * applied over the already-loaded feed.
 */
export function resetHomeBrowsing({ refetch = false }: { refetch?: boolean } = {}) {
  useHomeBrowseStore.setState({ activeTab: DEFAULT_TAB, activeCategory: null });
  useLocationStore.getState().setCity(null);
  if (refetch) useListingsStore.getState().load();
}
