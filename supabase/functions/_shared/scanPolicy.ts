// Decides whether r2-presign may still hand out PUBLIC listing-photo upload URLs. Pure TypeScript (no Deno APIs) so
// it is unit-tested in node (tests/scanPolicy.test.ts).
//
// Background: with the photo scan in place every listing photo must reach the public bucket as a watermarked
// derivative produced by the scan Worker. A presigned PUT into `listings/…` lets a client put an UNSCANNED,
// UNMARKED original straight into a publicly readable location, so once checks are enforced that path has to close.
// It is closed by a database flag (image_scan_config.legacy_presign_closed, migration 0050) rather than an env var so
// it can be flipped — and rolled back — with one audited SQL statement and no redeploy.
//
// Fail-safe rules (each is tested):
//  * flag false                                  → open (today's behaviour)
//  * flag true                                   → closed, with a structured "update required" answer
//  * 0050 not applied yet (function missing)     → open: the ladder does not exist, so the legacy path is the only path
//  * any OTHER read failure                      → the listing folder is refused with a retryable 503, never silently opened
//  * non-listing folders (avatars, business)     → never affected

export type PresignGate =
  | { allow: true }
  | { allow: false; status: 426 | 503; code: 'update_required' | 'policy_unavailable'; message: string };

export type PolicyRead = { data: unknown; error: { code?: string; message?: string } | null };

/** true = closed, false = open, null = could not tell. */
export function readClosedFlag(r: PolicyRead): boolean | null {
  if (r.error) {
    const missing = r.error.code === '42883' || r.error.code === 'PGRST202' || /could not find the function|does not exist/i.test(r.error.message ?? '');
    return missing ? false : null;
  }
  return r.data === true ? true : r.data === false ? false : null;
}

export const isListingFolder = (folder: string) => folder === 'listings' || folder.startsWith('listings/');

export function listingPresignGate(folder: string, closed: boolean | null): PresignGate {
  if (!isListingFolder(folder)) return { allow: true };
  if (closed === false) return { allow: true };
  if (closed === true) {
    return {
      allow: false,
      status: 426,
      code: 'update_required',
      message: 'This version of Suuqiye can no longer upload listing photos. Please update the app and try again.',
    };
  }
  return { allow: false, status: 503, code: 'policy_unavailable', message: 'We could not prepare your photo upload right now. Please try again in a moment.' };
}
