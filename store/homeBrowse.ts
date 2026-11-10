import { useStore } from 'zustand';
import { createHomeBrowseStore, HomeBrowseState } from '@/lib/homeBrowse';
import { DISCOVERY_TABS, DiscoveryTab, PriceOrder } from '@/lib/homeFeed';
import { useLocationStore } from '@/store/location';

export { DISCOVERY_TABS };
export type { DiscoveryTab, PriceOrder };

// Home's temporary browsing state — which discovery tab, category, price order
// and currency are active. Defined once in lib/homeBrowse.ts (shared with web)
// and kept outside app/(tabs)/home.tsx so it survives navigating away and back:
// arriving at Home from another tab shows it as it was left. Only a repeated
// tap on the already-active Home tab calls reset() (see store/homeRefresh.ts).
// The place filter lives in the shared, persisted useLocationStore (also read by
// Search). A Home reset returns it to All Locations through the scope port, so a
// selected country such as Somalia does not survive a double-tap on Home.
export const homeBrowse = createHomeBrowseStore({ setScope: (id) => useLocationStore.getState().setScope(id) });

export function useHomeBrowseStore<T>(selector: (s: HomeBrowseState) => T): T {
  return useStore(homeBrowse, selector);
}
