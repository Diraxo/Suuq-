// Home's browsing selections (discovery tab, category, price order/currency) and
// the one definition of their defaults — plain TypeScript on a vanilla zustand
// store, so the identical file lives at web/src/lib/homeBrowse.ts (keep the two
// copies in sync; scripts/run-tests.js fails if they drift).
//
// The selected place is NOT held here. On mobile it is the persisted, app-wide
// useLocationStore scope shared with Search, so mobile passes no ScopePort and
// reset() leaves it alone (a Home reset must not change what Search shows). On
// web the scope is a Home-only, session-only store, so web passes a ScopePort
// and reset() restores "All Locations" through it — no second source of truth.
import { createStore } from 'zustand/vanilla';
import { DISCOVERY_TABS, DiscoveryTab, PriceOrder } from './homeFeed';

export type HomeBrowseSelection = {
  activeTab: DiscoveryTab;
  activeCategory: string | null;
  priceOrder: PriceOrder;
  /** Currency compared on the Price tab; null = the most common one. */
  priceCurrency: string | null;
};

/** Default Home view: For You, All Categories, lowest price first, All Locations. */
export const HOME_BROWSE_DEFAULTS: HomeBrowseSelection & { scopeId: string | null } = {
  activeTab: DISCOVERY_TABS[0],
  activeCategory: null,
  priceOrder: 'asc',
  priceCurrency: null,
  scopeId: null,
};

export type ScopePort = { setScope: (id: string | null) => void };

export type HomeBrowseState = HomeBrowseSelection & {
  setActiveTab: (tab: DiscoveryTab) => void;
  setActiveCategory: (category: string | null) => void;
  setPriceOrder: (order: PriceOrder) => void;
  setPriceCurrency: (currency: string | null) => void;
  /**
   * Back to the default Home view (selections above, plus the place when a
   * scope port was supplied). Client-side browsing state only — never touches listings, account
   * data, favorites, language or any other preference.
   */
  reset: () => void;
};

export function createHomeBrowseStore(scope?: ScopePort) {
  return createStore<HomeBrowseState>((set) => ({
    activeTab: HOME_BROWSE_DEFAULTS.activeTab,
    activeCategory: HOME_BROWSE_DEFAULTS.activeCategory,
    priceOrder: HOME_BROWSE_DEFAULTS.priceOrder,
    priceCurrency: HOME_BROWSE_DEFAULTS.priceCurrency,
    setActiveTab: (activeTab) => set({ activeTab }),
    setActiveCategory: (activeCategory) => set({ activeCategory }),
    setPriceOrder: (priceOrder) => set({ priceOrder }),
    setPriceCurrency: (priceCurrency) => set({ priceCurrency }),
    reset: () => {
      set({
        activeTab: HOME_BROWSE_DEFAULTS.activeTab,
        activeCategory: HOME_BROWSE_DEFAULTS.activeCategory,
        priceOrder: HOME_BROWSE_DEFAULTS.priceOrder,
        priceCurrency: HOME_BROWSE_DEFAULTS.priceCurrency,
      });
      scope?.setScope(HOME_BROWSE_DEFAULTS.scopeId);
    },
  }));
}
