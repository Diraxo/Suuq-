// Which R2 object keys / folders a signed-in user may create or touch.
// Pure TypeScript (no Deno APIs) so it is shared by r2-presign and
// r2-verify-images and unit-tested in node (tests/uploadPaths.test.ts).
//
// Every segment is restricted to [A-Za-z0-9_-]: no '.', '..', empty segments
// or extra slashes. That matters because object URLs are built by string
// concatenation and then normalised by the URL parser — a folder such as
// `listings/{myUid}/../../listings/{victimUid}` would otherwise collapse into
// another user's namespace while still "containing" the caller's own id.

const SEGMENT = '[A-Za-z0-9_-]{1,64}';
const FILE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg'; // `\\.` — in a normal string a lone `\.` collapses to `.`, a wildcard

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const isUserId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/**
 * Folders r2-presign may issue keys under for `userId`:
 *   listings/{uid}[/{draftId}]   avatars/{uid}   business/{uid}/(logo|banner)
 * Chat is text-only, so there is deliberately NO chat/ upload folder.
 */
export function isAllowedFolder(folder: string, userId: string): boolean {
  if (typeof folder !== 'string' || !isUserId(userId)) return false;
  return [
    new RegExp(`^listings/${userId}(/${SEGMENT})?$`, 'i'),
    new RegExp(`^avatars/${userId}$`, 'i'),
    new RegExp(`^business/${userId}/(logo|banner)$`, 'i'),
  ].some((p) => p.test(folder));
}

/** A full object key: an allowed folder plus the server-generated "<uuid>.jpg" file name.
 *  The chat/ pattern is kept ONLY so a user can still delete their own legacy chat objects
 *  (uploaded before chat became text-only); nothing can create new ones. */
export function isOwnedKey(key: string, userId: string): boolean {
  if (typeof key !== 'string' || !isUserId(userId)) return false;
  return [
    new RegExp(`^listings/${userId}(/${SEGMENT})?/${FILE}$`, 'i'),
    // Watermarked derivative published by the scan Worker: wm/listings/{uid}/{listingId}/{uuid}.jpg. The owner may
    // delete it (listing delete, photo removed on edit). It is NEVER an allowed upload folder — see isAllowedFolder.
    new RegExp(`^wm/listings/${userId}/${UUID}/${FILE}$`, 'i'),
    new RegExp(`^avatars/${userId}/${FILE}$`, 'i'),
    new RegExp(`^business/${userId}/(logo|banner)/${FILE}$`, 'i'),
    new RegExp(`^chat/${SEGMENT}/${userId}/${FILE}$`, 'i'),
  ].some((p) => p.test(key));
}
