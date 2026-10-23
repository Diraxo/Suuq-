// A tiny notification channel between the data stores and the paginated feeds. store/listings.ts announces every
// local change to the public listings (a publish, edit, sale, price drop, removal); the feeds listen so Home and
// the category/city screens stay current without anything downloading "all listings" again.
export type ListingsChange = { type: 'removed'; id: string } | { type: 'changed' };

const listeners = new Set<(change: ListingsChange) => void>();

export function onListingsChanged(listener: (change: ListingsChange) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyListingsChanged(change: ListingsChange): void {
  listeners.forEach((l) => l(change));
}
