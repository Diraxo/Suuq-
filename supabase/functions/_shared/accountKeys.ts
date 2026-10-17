// Which R2 keys delete-account may delete with the service-role R2 credentials.
// Pure TypeScript (no Deno APIs) so it is unit-tested in node (tests/accountKeys.test.ts).
//
// The key columns (profiles.avatar_public_id / business_logo_public_id /
// business_banner_public_id, listings.image_public_ids) are WRITABLE BY THEIR
// OWNER, so a value in them proves nothing about ownership. The only trust
// anchors are the verified auth user id (from the JWT) and the key's own shape:
// each key must sit in that user's namespace for the column it came from, and end
// in a server-generated "<uuid>.jpg". Anything else is skipped (never deleted,
// never fatal): the failure mode is an orphaned object, not someone else's
// object being deleted.

// Self-contained on purpose: Deno needs './x.ts' import specifiers, the node test
// compile (tsconfig.test.json) does not accept them. The folder grammar below is
// the kind-specific subset of uploadPaths.isOwnedKey (tests assert they agree).

export type KeyKind = 'avatar' | 'logo' | 'banner' | 'listing' | 'chat';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const FILE = `${UUID}[.]jpg`; // [.] not backslash-dot: a lone backslash-dot in a template literal collapses to a wildcard "."
const isUserId = (id: unknown): id is string => typeof id === 'string' && new RegExp(`^${UUID}$`, 'i').test(id);

/** Strict, per-column expectation. userId is interpolated only after isUserId() proved it is a bare UUID. */
export function isKeyForKind(key: unknown, kind: KeyKind, userId: string): key is string {
  if (typeof key !== 'string' || !isUserId(userId)) return false;
  // Every variable segment is [A-Za-z0-9_-]{1,64}: no '.', '..', '/', '%', ':' or whitespace.
  const re: Record<KeyKind, RegExp> = {
    avatar: new RegExp(`^avatars/${userId}/${FILE}$`, 'i'),
    logo: new RegExp(`^business/${userId}/logo/${FILE}$`, 'i'),
    banner: new RegExp(`^business/${userId}/banner/${FILE}$`, 'i'),
    listing: new RegExp(`^listings/${userId}(/[A-Za-z0-9_-]{1,64})?/${FILE}$`, 'i'),
    chat: new RegExp(`^chat/[A-Za-z0-9_-]{1,64}/${userId}/${FILE}$`, 'i'),
  };
  return re[kind].test(key);
}

export type KeyCandidate = { kind: KeyKind; key: unknown };

/** Splits candidates into keys safe to delete (de-duplicated) and a count of skipped ones. Never returns skipped values. */
export function selectOwnedKeys(candidates: KeyCandidate[], userId: string): { keys: string[]; skipped: number } {
  const keys = new Set<string>();
  let skipped = 0;
  for (const { kind, key } of candidates) {
    if (key === null || key === undefined || key === '') continue; // absent, not suspicious
    if (isKeyForKind(key, kind, userId)) keys.add(key);
    else skipped++;
  }
  return { keys: [...keys], skipped };
}

/**
 * Fallback for listings created before image_public_ids was persisted (web sell
 * flow): derive the object key from `listings.images` public URLs.
 *
 * A URL is only converted when it starts with EXACTLY the configured public base
 * ("<R2_PUBLIC_URL>/", textual prefix — no URL parsing, so '..', '%2e', '?', '#',
 * userinfo ('@') and other-host tricks can't be normalised into a match). What
 * follows is only a *candidate*: it still has to pass selectOwnedKeys() as a
 * 'listing' key for the verified user, so a URL pointing into someone else's
 * namespace, or at a non-conforming path, is skipped like any other bad key.
 * URLs that don't match the base (Cloudinary, picsum, another host) are passed
 * through unchanged and are therefore counted as skipped, never deleted.
 */
export function listingKeyCandidatesFromUrls(urls: unknown, publicBaseUrl: string | undefined | null): KeyCandidate[] {
  if (!publicBaseUrl || !Array.isArray(urls)) return [];
  const prefix = `${publicBaseUrl.replace(/\/+$/, '')}/`;
  return urls
    .filter((u): u is string => typeof u === 'string' && u !== '')
    .map((u) => ({ kind: 'listing' as const, key: u.startsWith(prefix) ? u.slice(prefix.length) : u }));
}
