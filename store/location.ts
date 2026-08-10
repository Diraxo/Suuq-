import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

// The city the user is currently browsing — a device-local display filter,
// separate from a seller's own profile city (edit-profile.tsx). Applied
// wherever listings are shown so switching city on Home also narrows Search.
// `city: null` means "All locations".
const STORAGE_KEY = '@suuq/currentCity';

type LocationState = {
  city: string | null;
  hasHydrated: boolean;
  setCity: (city: string | null) => void;
  load: () => Promise<void>;
};

export const useLocationStore = create<LocationState>((set) => ({
  city: null,
  hasHydrated: false,
  setCity: (city) => {
    set({ city });
    if (city) AsyncStorage.setItem(STORAGE_KEY, city).catch(() => {});
    else AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  },
  load: async () => {
    const stored = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
    set({ city: stored, hasHydrated: true });
  },
}));
