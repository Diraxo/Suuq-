'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark' | 'system';

type ThemeState = {
  mode: ThemeMode;
  /** The actually-applied light/dark theme — resolves `mode: 'system'` against
   *  the OS preference. Kept in sync by ThemeApplier (and by the inline
   *  head script on first paint) so any UI reflecting "is dark active right
   *  now" — e.g. ThemeToggle — agrees with the real applied theme instead of
   *  just checking `mode === 'dark'`, which is blind to the system case. */
  resolved: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
  setResolved: (resolved: 'light' | 'dark') => void;
};

// Mirrors theme/ThemeContext.tsx on mobile (light / dark / system, persisted).
export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: 'system',
      resolved: 'light',
      setMode: (mode) => set({ mode }),
      setResolved: (resolved) => set({ resolved }),
    }),
    { name: 'fursad-web-theme', partialize: (state) => ({ mode: state.mode }) }
  )
);
