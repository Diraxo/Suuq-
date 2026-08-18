'use client';

import { create } from 'zustand';

type HomeRefreshState = {
  token: number;
  refresh: () => void;
};

// Bumped by MobileTabBar when the user taps the Home tab while already on
// Home — HomePage listens and re-fetches its feed. Mirrors the mobile app's
// double-tap-Home-tab-to-refresh behavior, but via data revalidation instead
// of a screen remount/full reload (theme, auth, and navigation state are
// untouched).
export const useHomeRefreshStore = create<HomeRefreshState>((set) => ({
  token: 0,
  refresh: () => set((s) => ({ token: s.token + 1 })),
}));
