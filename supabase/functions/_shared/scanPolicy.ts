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
//  * non-listing folders                         → never affected by the listing gate (avatars/ and business/ have their own, unconditional, gates below)

export type PresignGate =
  | { allow: true }
  | { allow: false; status: 426 | 503; code: 'update_required' | 'policy_unavailable' | 'media_scan_required' | 'uploads_paused'; message: string };

export type PolicyRead = { data: unknown; error: { code?: string; message?: string } | null };

/** true = closed, false = open, null = could not tell. */
export function readClosedFlag(r: PolicyRead): boolean | null {
  if (r.error) {
    const missing = r.error.code === '42883' || r.error.code === 'PGRST202' || /could not find the function|does not exist/i.test(r.error.message ?? '');
    return missing ? false : null;
  }
  return r.data === true ? true : r.data === false ? false : null;
}

// Case-insensitive on purpose: uploadPaths.isAllowedFolder() matches its folders case-insensitively, but R2 keys are case-sensitive, so a
// `Listings/…` or `Business/…` folder would otherwise pass the allow-list, miss this gate and land an unscanned object in the public bucket.
export const isListingFolder = (folder: string) => /^listings(\/|$)/i.test(folder);

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

// ── business logos / banners ─────────────────────────────────────────────────────────────────────────────────────────
// A presigned PUT into business/{uid}/(logo|banner) lands an UNCHECKED file in the PUBLIC bucket. Unlike listings there is no
// rollout ladder to wait for: these folders are refused unconditionally, and the only way in is the scan Worker's
// /v1/business-media route (workers/image-scan/src/businessMedia.ts). Deploy order matters — see docs/STOREFRONTS_0054_OWNER_DECISIONS.md.
export const isBusinessMediaFolder = (folder: string) => /^business(\/|$)/i.test(folder);

// Policy (2026-10-21, owner decision): until the scan Worker is deployed, avatars/logos/banners may be uploaded with a presigned PUT (the
// clients already crop, shrink and re-encode them. NOTE: these gates are no longer called by r2-presign (profile scanning was removed).
// They are kept only for a future re-enable.
export const mediaScanRequired = (flag: string | undefined | null) => /^\s*(true|1|on|yes)\s*$/i.test(flag ?? '');

export function businessMediaPresignGate(folder: string, scanRequired = false): PresignGate {
  if (!isBusinessMediaFolder(folder) || !scanRequired) return { allow: true };
  return {
    allow: false,
    status: 426,
    code: 'media_scan_required',
    message: 'Business logos and banners must be checked before they are published, and cannot be uploaded this way. Please update the app and try again.',
  };
}

// ── profile avatars ──────────────────────────────────────────────────────────────────────────────────────────────────
// Same hole as business media: a presigned PUT into avatars/{uid} puts an UNCHECKED file in the PUBLIC bucket. Avatars go through the
// scan Worker (kind 'avatar') and this refusal is unconditional (fail closed) — it no longer depends on any flag or database read.
export const isAvatarFolder = (folder: string) => /^avatars(\/|$)/i.test(folder);

export function avatarPresignGate(folder: string, scanRequired = false): PresignGate {
  if (!isAvatarFolder(folder) || !scanRequired) return { allow: true };
  return {
    allow: false,
    status: 426,
    code: 'media_scan_required',
    message: 'Profile photos must be checked before they are published, and cannot be uploaded this way. Please update the app and try again.',
  };
}

/**
 * Emergency stop for ALL presigned uploads (R2_PRESIGN_DISABLED). Any value other than an explicit "false"/"0"/"off"/empty is read as
 * "disabled" except when it is unset, so a typo stops uploads instead of leaving them open. Unlike unsetting R2_ACCESS_KEY_ID it does not
 * break r2-delete or the R2 cleanup in delete-account, which share that credential.
 */
export function presignKillSwitchGate(flag: string | undefined | null): PresignGate {
  if (flag == null || /^\s*(|false|0|off|no)\s*$/i.test(flag)) return { allow: true };
  return { allow: false, status: 503, code: 'uploads_paused', message: 'Photo uploads are paused for a moment. Please try again later.' };
}
