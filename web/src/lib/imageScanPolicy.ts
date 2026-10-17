// Which way a client may publish listing photos, decided from the SERVER's rollout mode (migration 0050,
// image_scan_client_policy()). Pure and platform-free: mobile uses lib/imageScanPolicy.ts, web uses a byte-identical
// copy (web/src/lib/imageScanPolicy.ts, kept in step by tests/imageParity.test.ts).
//
// The client never decides whether a photo is safe or watermarked. It only decides "may I use the old direct-upload
// path, must I go through the scan, or must I stop and tell the person to update" — and that decision comes from the
// server, so flipping the server mode changes every client at once without a release.

export type ScanMode = 'off' | 'shadow' | 'enforce';
export type ScanClientPolicy = { mode: ScanMode; scanRequired: boolean; legacyUploadClosed: boolean };

/** What the person is told when a photo cannot be published; each has copy under imageScan.errors.* (mobile) and in web's scan dialog. */
export type ScanBlockKind = 'update_required' | 'not_verified' | 'photo_rejected' | 'policy_unavailable';

export type PublishPath =
  | { kind: 'legacy' } // today's direct upload (server mode off, or the scan service isn't configured on a build that doesn't need it)
  | { kind: 'scan' } //   send the photos to the scan service and publish only the derivatives it returns
  | { kind: 'blocked'; reason: ScanBlockKind };

export function parsePolicy(raw: unknown): ScanClientPolicy | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.mode !== 'off' && r.mode !== 'shadow' && r.mode !== 'enforce') return null;
  return { mode: r.mode, scanRequired: r.mode !== 'off' || r.scanRequired === true, legacyUploadClosed: r.legacyUploadClosed === true };
}

/**
 * @param policy         what the server said, or null when it couldn't be read
 * @param scanConfigured whether THIS build knows where the scan service is (EXPO_PUBLIC_IMAGE_SCAN_URL / NEXT_PUBLIC_IMAGE_SCAN_URL)
 *
 *  server mode      scan configured   → path
 *  off              yes               → scan   (the build opted in; photos get watermarked)
 *  off              no                → legacy (nothing changes for builds without the service)
 *  shadow / enforce yes               → scan
 *  shadow / enforce no                → BLOCKED "update required" — fail closed with a clear message, never a silent legacy upload
 *  unknown          yes               → scan
 *  unknown          no                → legacy (the database still refuses unscanned photos once enforced, and says so)
 */
export function choosePublishPath(policy: ScanClientPolicy | null, scanConfigured: boolean): PublishPath {
  if (scanConfigured) return { kind: 'scan' };
  if (policy && policy.scanRequired) return { kind: 'blocked', reason: 'update_required' };
  return { kind: 'legacy' };
}

/** Recognises the database's refusal of an unscanned / rejected photo (migration 0048/0050 trigger) so it can be explained. */
export function scanBlockFromDbError(err: unknown): ScanBlockKind | null {
  const o = (err && typeof err === 'object' ? err : {}) as { hint?: unknown; message?: unknown; details?: unknown };
  const text = [typeof err === 'string' ? err : '', String(o.hint ?? ''), String(o.message ?? ''), String(o.details ?? '')].join(' ');
  if (/image_not_verified|Photo has not been checked/i.test(text)) return 'not_verified';
  if (/image_rejected|Photo was not accepted/i.test(text)) return 'photo_rejected';
  return null;
}

/** r2-presign's structured refusal of a legacy listing upload (see supabase/functions/_shared/scanPolicy.ts). */
export function scanBlockFromPresignBody(body: unknown): ScanBlockKind | null {
  const code = body && typeof body === 'object' ? (body as { code?: unknown }).code : undefined;
  return code === 'update_required' ? 'update_required' : code === 'policy_unavailable' ? 'policy_unavailable' : null;
}

/**
 * "Publish for review" is only offered when the listing will really be held out of public view while a human looks
 * (the database does that only in enforce mode). A photo the Worker kept PRIVATE because it may be explicit or a
 * weapon would otherwise leave a live listing pointing at a private (404) image, so outside enforce mode the seller
 * is asked to replace it instead.
 */
export function reviewPublishAllowed(result: { images: { held: boolean }[] }, policy: ScanClientPolicy | null): boolean {
  return !result.images.some((i) => i.held) || policy?.mode === 'enforce';
}
