import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

// The place the user is currently browsing — a country, region or city from the
// location directory (store/locations.ts). A device-local display filter,
// separate from a seller's own profile city (edit-profile.tsx). Applied
// wherever listings are shown so switching place on Home also narrows Search.
// `scopeId: null` means "All locations".
const STORAGE_KEY = '@suuq/currentLocationScope';

type LocationState = {
  scopeId: string | null;
  hasHydrated: boolean;
  setScope: (id: string | null) => void;
  load: () => Promise<void>;
};

export const useLocationStore = create<LocationState>((set) => ({
  scopeId: null,
  hasHydrated: false,
  setScope: (scopeId) => {
    set({ scopeId });
    if (scopeId) AsyncStorage.setItem(STORAGE_KEY, scopeId).catch(() => {});
    else AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  },
  load: async () => {
    const stored = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
    set({ scopeId: stored, hasHydrated: true });
  },
}));
