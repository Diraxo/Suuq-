import { create } from 'zustand';

// Listings the server has told us are no longer publicly visible (removed / deactivated / deleted), kept for the
// life of the session so every screen — feed, search, favorites, deep links — can hide them without a refetch.
// `restoredNonce` bumps when a listing becomes visible again so lists know to refetch.
// Identical copy at web/src/store/visibility.ts.
type VisibilityState = {
  hidden: Set<string>;
  restoredNonce: number;
  markHidden: (id: string) => void;
  markShown: (id: string) => void;
  /** Drops everything on sign-out / account switch so a stale set never hides legitimate listings. */
  reset: () => void;
};

export const useVisibilityStore = create<VisibilityState>((set) => ({
  hidden: new Set<string>(),
  restoredNonce: 0,
  markHidden: (id) =>
    set((s) => {
      if (s.hidden.has(id)) return s; // idempotent: a duplicate event changes nothing and re-renders nothing
      const hidden = new Set(s.hidden);
      hidden.add(id);
      return { hidden };
    }),
  markShown: (id) =>
    set((s) => {
      const hidden = new Set(s.hidden);
      hidden.delete(id);
      return { hidden, restoredNonce: s.restoredNonce + 1 };
    }),
  reset: () => set({ hidden: new Set<string>() }),
}));

/** Removes hidden listings from any list of things that have an `id`. */
export function withoutHidden<T extends { id: string }>(items: T[], hidden: Set<string>): T[] {
  return hidden.size === 0 ? items : items.filter((i) => !hidden.has(i.id));
}

// Ids of listings currently shown on any screen. Reconciliation (hidden_listing_ids) asks the database about these
// after every reconnect / foreground, so a missed realtime event or a stale cache heals itself. Bounded so a very
// long session cannot grow it forever.
const known = new Set<string>();
export function registerKnownListingIds(ids: string[]): void {
  for (const id of ids) known.add(id);
  if (known.size > 2000) {
    const keep = Array.from(known).slice(-1000);
    known.clear();
    keep.forEach((id) => known.add(id));
  }
}
export function getKnownListingIds(): string[] {
  return Array.from(known);
}
