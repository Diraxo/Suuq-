import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

// The place the user is currently browsing — a country, region or city from the
// location directory (store/locations.ts). A device-local display filter,
// separate from a seller's own profile city (edit-profile.tsx). Applied
// wherever listings are shown so switching place on Home also narrows Search.
// `scopeId: null` means "All locations".
//
// Also remembers whether the "Find listings near me" card was dismissed. Only
// these two values are ever stored for location — never coordinates.
const STORAGE_KEY = '@suuq/currentLocationScope';
const NEAR_ME_DISMISSED_KEY = '@suuq/nearMeDismissed';

type LocationState = {
  scopeId: string | null;
  hasHydrated: boolean;
  /** True once the user has used or dismissed the first-launch "near me" card. */
  nearMeDismissed: boolean;
  setScope: (id: string | null) => void;
  dismissNearMe: () => void;
  load: () => Promise<void>;
};

export const useLocationStore = create<LocationState>((set) => ({
  scopeId: null,
  hasHydrated: false,
  nearMeDismissed: false,
  setScope: (scopeId) => {
    set({ scopeId });
    if (scopeId) AsyncStorage.setItem(STORAGE_KEY, scopeId).catch(() => {});
    else AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  },
  dismissNearMe: () => {
    set({ nearMeDismissed: true });
    AsyncStorage.setItem(NEAR_ME_DISMISSED_KEY, '1').catch(() => {});
  },
  load: async () => {
    const [stored, dismissed] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY).catch(() => null),
      AsyncStorage.getItem(NEAR_ME_DISMISSED_KEY).catch(() => null),
    ]);
    set({ scopeId: stored, nearMeDismissed: dismissed === '1', hasHydrated: true });
  },
}));
