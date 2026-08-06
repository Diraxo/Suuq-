import { create } from 'zustand';

const initialCollections = ['Dream Car', 'Future Home', 'Laptop Wishlist'];

type CollectionsState = {
  collections: string[];
  addCollection: (name: string) => void;
  renameCollection: (oldName: string, newName: string) => void;
  deleteCollection: (name: string) => void;
  reset: () => void;
};

export const useCollectionsStore = create<CollectionsState>((set) => ({
  collections: initialCollections,
  addCollection: (name) =>
    set((s) => (name.trim() && !s.collections.includes(name.trim()) ? { collections: [...s.collections, name.trim()] } : s)),
  renameCollection: (oldName, newName) =>
    set((s) => (newName.trim() ? { collections: s.collections.map((c) => (c === oldName ? newName.trim() : c)) } : s)),
  deleteCollection: (name) => set((s) => ({ collections: s.collections.filter((c) => c !== name) })),
  reset: () => set({ collections: initialCollections }),
}));
