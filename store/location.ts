import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

// The place the user is currently browsing — a country, region or city from the
// location directory (store/locations.ts). A device-local display filter,
// separate from a seller's own profile city (edit-profile.tsx). Applied
// wherever listings are shown so switching place on Home also narrows Search.
// `scopeId: null` means "All locations". It lasts for the session only: a fresh
// launch always starts on All Locations, so a place chosen yesterday (or by "near
// me") can never leave Home quietly showing a handful of listings.
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
  },
  dismissNearMe: () => {
    set({ nearMeDismissed: true });
    AsyncStorage.setItem(NEAR_ME_DISMISSED_KEY, '1').catch(() => {});
  },
  load: async () => {
    // A place saved by an earlier version is forgotten rather than restored.
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    const dismissed = await AsyncStorage.getItem(NEAR_ME_DISMISSED_KEY).catch(() => null);
    set({ nearMeDismissed: dismissed === '1', hasHydrated: true });
  },
}));
