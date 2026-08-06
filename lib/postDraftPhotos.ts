import { Directory, File, Paths } from 'expo-file-system';

// expo-image-picker's returned URIs point into the OS's ephemeral picker
// cache, which is not guaranteed to survive an app relaunch (iOS in
// particular can reclaim it). The Sell flow's draft is persisted across app
// kills, so a picked photo has to be copied into the app's own permanent
// storage the moment it's added, or the persisted draft would end up
// pointing at files that no longer exist.
function getDraftDir(): Directory {
  const dir = new Directory(Paths.document, 'post-draft-photos');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Copies a freshly picked photo into permanent app storage and returns the new, stable URI. */
export async function persistDraftPhoto(sourceUri: string): Promise<string> {
  const dir = getDraftDir();
  const ext = sourceUri.split('.').pop()?.split('?')[0] || 'jpg';
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const destFile = new File(dir, name);
  new File(sourceUri).copy(destFile);
  return destFile.uri;
}

/** Deletes one persisted draft photo (e.g. when the seller removes it from the grid). Safe to call on any URI. */
export async function deleteDraftPhoto(uri: string): Promise<void> {
  try {
    const dir = getDraftDir();
    if (!uri.startsWith(dir.uri)) return;
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Best-effort cleanup — a failure here should never block the Sell flow.
  }
}

/** Wipes every persisted draft photo — called once the draft is done with (published or discarded). */
export async function clearDraftPhotos(): Promise<void> {
  try {
    const dir = new Directory(Paths.document, 'post-draft-photos');
    if (dir.exists) dir.delete();
  } catch {
    // Best-effort cleanup — a failure here should never block resetting the draft.
  }
}
