// The listing photo list: ONE ordered array of real photos, nothing else.
// No placeholders, no separately stored cover index or count — the cover, the
// remaining slots, whether "Add photo" shows and the upload order are all
// derived from the array, so they can never disagree with it.
//
// Every function is pure (returns a new array, never mutates its input).
// Shared by mobile (app/post, app/listing/edit) and web (sell, listing edit);
// web/src/lib/photoList.ts is a byte-identical copy (tests/sellParity).

export const MAX_PHOTOS = 5;

export type PhotoItem = { id: string };

/** Appends `incoming` after the existing photos, never beyond `max`; anything over is returned in `rejected`. Ids already in the list are skipped. */
export function addPhotos<T extends PhotoItem>(
  list: readonly T[],
  incoming: readonly T[],
  max: number = MAX_PHOTOS
): { list: T[]; added: T[]; rejected: T[]; duplicates: T[] } {
  const seen = new Set(list.map((p) => p.id));
  const added: T[] = [];
  const rejected: T[] = [];
  const duplicates: T[] = [];
  for (const p of incoming) {
    if (seen.has(p.id)) duplicates.push(p);
    else if (list.length + added.length >= max) rejected.push(p);
    else {
      seen.add(p.id);
      added.push(p);
    }
  }
  return { list: [...list, ...added], added, rejected, duplicates };
}

/** Removes exactly the photo with this id; the rest keep their relative order and close the gap. */
export function removePhotoById<T extends PhotoItem>(list: readonly T[], id: string): T[] {
  return list.filter((p) => p.id !== id);
}

/** Moves the photo at `from` so it ends up at index `to` (both clamped into range). Out-of-range or no-op moves return an equal copy. */
export function movePhoto<T extends PhotoItem>(list: readonly T[], from: number, to: number): T[] {
  const copy = [...list];
  if (from < 0 || from >= copy.length) return copy;
  const target = Math.min(Math.max(to, 0), copy.length - 1);
  if (target === from) return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(target, 0, item);
  return copy;
}

/** Replaces one photo in place (same position, new content). Unknown id → unchanged copy. */
export function replacePhotoById<T extends PhotoItem>(list: readonly T[], id: string, next: T): T[] {
  return list.map((p) => (p.id === id ? next : p));
}

/** The cover is always the first photo. */
export function coverOf<T extends PhotoItem>(list: readonly T[]): T | undefined {
  return list[0];
}

export function isCover(index: number): boolean {
  return index === 0;
}

export function remainingSlots(count: number, max: number = MAX_PHOTOS): number {
  return Math.max(0, max - count);
}

/** `count` is everything occupying a slot (e.g. photos + photos still being retried). */
export function showAddTile(count: number, max: number = MAX_PHOTOS): boolean {
  return count < max;
}

/** Index of the grid cell after `fromIndex` when dragged by whole columns/rows, clamped to the last real photo. */
export function dragTargetIndex(fromIndex: number, deltaCol: number, deltaRow: number, columns: number, count: number): number {
  'worklet'; // called from the drag gesture's UI-thread onEnd
  if (count <= 0) return 0;
  return Math.min(Math.max(fromIndex + deltaRow * columns + deltaCol, 0), count - 1);
}
