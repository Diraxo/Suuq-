import { create } from 'zustand';

export type MockNetworkState = 'normal' | 'loading' | 'error' | 'offline' | 'empty' | 'slow';

type DevMockStore = {
  networkState: MockNetworkState;
  setNetworkState: (s: MockNetworkState) => void;
};

// Dev-only — never read outside __DEV__ guarded code paths.
export const useDevMockStore = create<DevMockStore>((set) => ({
  networkState: 'normal',
  setNetworkState: (networkState) => set({ networkState }),
}));
