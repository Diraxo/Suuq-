'use client';

import { create, useStore } from 'zustand';
import { createHomeBrowseStore, HomeBrowseState } from '@/lib/homeBrowse';

// Web counterpart of store/homeBrowse.ts: the same shared definition and
// defaults (lib/homeBrowse.ts), plus the selected place (mobile keeps that in
// its persisted location store; on web it is session-only).
export const useHomeScope = create<{ scopeId: string | null; setScope: (id: string | null) => void }>((set) => ({
  scopeId: null,
  setScope: (scopeId) => set({ scopeId }),
}));

export const homeBrowse = createHomeBrowseStore({ setScope: (id) => useHomeScope.getState().setScope(id) });

export function useHomeBrowseStore<T>(selector: (s: HomeBrowseState) => T): T {
  return useStore(homeBrowse, selector);
}
