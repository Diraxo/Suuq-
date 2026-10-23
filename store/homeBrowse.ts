import { useStore } from 'zustand';
import { createHomeBrowseStore, HomeBrowseState } from '@/lib/homeBrowse';
import { DISCOVERY_TABS, DiscoveryTab, PriceOrder } from '@/lib/homeFeed';

export { DISCOVERY_TABS };
export type { DiscoveryTab, PriceOrder };

// Home's temporary browsing state — which discovery tab, category, price order
// and currency are active. Defined once in lib/homeBrowse.ts (shared with web)
// and kept outside app/(tabs)/home.tsx so it survives navigating away and back:
// arriving at Home from another tab shows it as it was left. Only a repeated
// tap on the already-active Home tab calls reset() (see store/homeRefresh.ts).
// The place filter lives in the shared, persisted useLocationStore (also read by
// Search) and is deliberately NOT given to the store: reset() never touches it.
export const homeBrowse = createHomeBrowseStore();

export function useHomeBrowseStore<T>(selector: (s: HomeBrowseState) => T): T {
  return useStore(homeBrowse, selector);
}
