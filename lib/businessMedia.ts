// Client side of business logo / banner intake. Platform-free so mobile and web share the rules (web keeps a byte-identical
// copy, enforced by tests/imageParity.test.ts). The client never decides whether an image is acceptable: it posts the
// picture to the scan Worker (workers/image-scan, POST /v1/business-media) and uses ONLY what the Worker returns.

/** 'avatar' is a profile photo: same scan Worker, but its key lives under avatars/{uid}/ instead of business/{uid}/. */
/**
 * POLICY (fail closed): a new avatar, business logo or banner is NEVER uploaded directly. It goes to the scan Worker and only an explicit,
 * well-formed `approved` answer can be saved. If the scan service is not configured, unreachable, slow, or answers anything else, the upload is
 * refused and the user's current image is left untouched. There is deliberately no switch that turns this off. Listing photos have their own ladder.
 */

export type BusinessMediaKind = 'logo' | 'banner' | 'avatar';

/** `business/{uid}/(logo|banner)` or `avatars/{uid}` — the folders every caller already passes to uploadToR2(). */
export function parseBusinessMediaFolder(folder: string): { userId: string; kind: BusinessMediaKind } | null {
  const m = /^business\/([A-Za-z0-9_-]{1,64})\/(logo|banner)$/.exec(folder);
  if (m) return { userId: m[1], kind: m[2] as BusinessMediaKind };
  const a = /^avatars\/([A-Za-z0-9_-]{1,64})$/.exec(folder);
  return a ? { userId: a[1], kind: 'avatar' } : null;
}

export type BusinessMediaErrorCode = 'notConfigured' | 'offline' | 'rateLimited' | 'unreadable' | 'unavailable' | 'rejected' | 'held' | 'failed';

export type BusinessMediaOutcome = { ok: true; key: string; url: string } | { ok: false; code: BusinessMediaErrorCode; message: string };

/** English fallbacks. Screens that have translations look up `errors.businessMedia.<code>` first (mobile: hooks/useImageUpload.ts). */
export const BUSINESS_MEDIA_MESSAGES: Record<BusinessMediaErrorCode, string> = {
  notConfigured: 'The image service is temporarily unavailable. Your current image has been kept. Please try again later.',
  offline: 'Image upload failed. Check your connection and try again.',
  rateLimited: 'Too many image checks. Please try again in a little while.',
  unreadable: 'That image could not be read. Please choose a different one.',
  unavailable: 'We could not check your image right now. Please try again in a moment.',
  rejected: 'This image cannot be used. Please choose a different one.',
  held: 'We could not accept this image automatically. Please choose a different one.',
  failed: 'Image upload failed. Please try again.',
};

/** Thrown by the upload helpers so a screen can show a translated message by `code` instead of the English text. */
export class BusinessMediaError extends Error {
  readonly code: BusinessMediaErrorCode;
  constructor(code: BusinessMediaErrorCode) {
    super(BUSINESS_MEDIA_MESSAGES[code]);
    this.name = 'BusinessMediaError';
    this.code = code;
  }
}

/**
 * Turns the Worker's HTTP answer into something a screen can use. Fails closed: anything that is not an explicit,
 * well-formed `approved` answer for THIS folder is an error — including a 200 whose key or URL does not line up.
 */
export function interpretBusinessMediaResponse(status: number, body: unknown, expect: { userId: string; kind: BusinessMediaKind }): BusinessMediaOutcome {
  const M = BUSINESS_MEDIA_MESSAGES;
  if (status === 429) return { ok: false, code: 'rateLimited', message: M.rateLimited };
  if (status === 422) return { ok: false, code: 'unreadable', message: M.unreadable };
  if (status === 503) return { ok: false, code: 'unavailable', message: M.unavailable };
  if (status !== 200) return { ok: false, code: 'failed', message: M.failed };
  const b = (body && typeof body === 'object' ? body : {}) as { status?: unknown; key?: unknown; url?: unknown };
  if (b.status === 'rejected') return { ok: false, code: 'rejected', message: M.rejected };
  if (b.status === 'held') return { ok: false, code: 'held', message: M.held };
  if (b.status !== 'approved' || typeof b.key !== 'string' || typeof b.url !== 'string') return { ok: false, code: 'failed', message: M.failed };
  const prefix = expect.kind === 'avatar' ? `avatars/${expect.userId}` : `business/${expect.userId}/${expect.kind}`;
  const keyOk = new RegExp(`^${prefix}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg$`).test(b.key);
  if (!keyOk || !b.url.startsWith('https://') || !b.url.endsWith(`/${b.key}`)) return { ok: false, code: 'failed', message: M.failed };
  return { ok: true, key: b.key, url: b.url };
}
