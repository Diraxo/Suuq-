// Pure, framework-free rules for the business-owner storefront flow. They mirror the limits that migration 0054 enforces in
// the database (storefronts CHECK constraints, trg_storefront_guard, request_storefront_verification) so the client can explain a
// problem before a round trip. The database stays the authority: nothing here grants anything, and every server refusal is
// still handled through storefrontErrorKind(). The web build cannot import from outside web/, so web/src/lib/storefront.ts is a
// byte-identical copy (tests/storefront.test.ts fails if they drift).

export type StorefrontStatus = 'draft' | 'published' | 'suspended';
export type VerificationStatus = 'not_requested' | 'pending' | 'verified' | 'rejected';

/** The columns an owner may read from public.storefronts (owner policy: select on own row). */
export const STOREFRONT_COLUMNS =
  'id, name, description, address, website, hours, logo_url, banner_url, logo_public_id, banner_public_id, status, verification_status, published_at, verified_at';

export type StorefrontRow = {
  id: string;
  name: string | null;
  description: string | null;
  address: string | null;
  website: string | null;
  hours: Record<string, unknown>;
  logo_url: string | null;
  banner_url: string | null;
  logo_public_id: string | null;
  banner_public_id: string | null;
  status: StorefrontStatus;
  verification_status: VerificationStatus;
  published_at: string | null;
  verified_at: string | null;
};

/** What my_storefront_verification() returns: status plus the one message staff chose to send. Never documents or internal reasons. */
export type VerificationInfo = {
  status: VerificationStatus;
  submittedAt: string | null;
  decidedAt: string | null;
  message: string | null;
};

export type StorefrontForm = { name: string; description: string; address: string; website: string };

export const LIMITS = { name: 150, description: 2000, address: 300, website: 300, note: 1000, documents: 5 } as const;

export type FormErrors = Partial<Record<keyof StorefrontForm, 'required' | 'tooLong' | 'badWebsite'>>;

const WEBSITE = /^https?:\/\/[^\s]+$/i;

export function formFromRow(row: StorefrontRow | null): StorefrontForm {
  return { name: row?.name ?? '', description: row?.description ?? '', address: row?.address ?? '', website: row?.website ?? '' };
}

/** Field problems, using the same limits as the table's CHECK constraints. `name` is required only to publish or ask for verification. */
export function validateStorefrontForm(form: StorefrontForm, opts: { needName?: boolean } = {}): FormErrors {
  const errors: FormErrors = {};
  const name = form.name.trim();
  if (opts.needName && !name) errors.name = 'required';
  if (name.length > LIMITS.name) errors.name = 'tooLong';
  if (form.description.trim().length > LIMITS.description) errors.description = 'tooLong';
  if (form.address.trim().length > LIMITS.address) errors.address = 'tooLong';
  const website = form.website.trim();
  if (website && (website.length > LIMITS.website || !WEBSITE.test(website))) errors.website = website.length > LIMITS.website ? 'tooLong' : 'badWebsite';
  return errors;
}

const orNull = (s: string): string | null => (s.trim() ? s.trim() : null);

/** Column values to write. Only the columns the owner is granted; status/verification are never sent (the guard trigger refuses them). */
export function toStorefrontPayload(form: StorefrontForm): { name: string | null; description: string | null; address: string | null; website: string | null } {
  return { name: orNull(form.name), description: orNull(form.description), address: orNull(form.address), website: orNull(form.website) };
}

export type StorefrontActions = {
  /** Fields can be saved. False only while suspended (the update policy refuses it). */
  canEdit: boolean;
  /** Name and address are frozen for everyone while a verification request is pending (error 55006). */
  identityLocked: boolean;
  canPublish: boolean;
  canUnpublish: boolean;
  canRequestVerification: boolean;
  /** Changing name or address after approval voids the verification (the guard trigger resets it). */
  editVoidsVerification: boolean;
};

export function storefrontActions(row: StorefrontRow | null): StorefrontActions {
  if (!row) return { canEdit: true, identityLocked: false, canPublish: false, canUnpublish: false, canRequestVerification: false, editVoidsVerification: false };
  const suspended = row.status === 'suspended';
  const hasName = !!row.name && row.name.trim() !== '';
  return {
    canEdit: !suspended,
    identityLocked: row.verification_status === 'pending',
    canPublish: !suspended && row.status === 'draft' && hasName,
    canUnpublish: !suspended && row.status === 'published',
    canRequestVerification: !suspended && hasName && (row.verification_status === 'not_requested' || row.verification_status === 'rejected'),
    editVoidsVerification: row.verification_status === 'verified',
  };
}

export type StorefrontErrorKind =
  | 'notSignedIn'
  | 'suspended'
  | 'noStorefront'
  | 'nameRequired'
  | 'invalidImage'
  | 'invalidInput'
  | 'identityLocked'
  | 'alreadyRequested'
  | 'unknownDocument'
  | 'rateLimited'
  | 'unavailable'
  | 'generic';

type PgLikeError = { code?: string; message?: string } | null | undefined;

/** Maps a PostgREST / RPC error to a stable kind; each surface turns the kind into copy. Never shows raw database text. */
export function storefrontErrorKind(error: PgLikeError): StorefrontErrorKind {
  if (!error) return 'generic';
  const code = error.code ?? '';
  const message = error.message ?? '';
  // The storefronts table / RPCs do not exist yet (0054 is not applied to this project): say "not available", not "failed".
  if (code === '42P01' || code === '42883' || code === 'PGRST205' || code === 'PGRST202') return 'unavailable';
  if (/rate limit/i.test(message)) return 'rateLimited';
  if (code === '55006') return 'identityLocked';
  if (code === '23505') return 'alreadyRequested';
  if (code === 'P0002') return /document/i.test(message) ? 'unknownDocument' : 'noStorefront';
  if (code === '42501') return /not signed in/i.test(message) ? 'notSignedIn' : 'suspended';
  if (code === '23514') return /logo|banner/i.test(message) ? 'invalidImage' : 'nameRequired';
  if (code === '22023') return /unknown document/i.test(message) ? 'unknownDocument' : 'invalidInput';
  return 'generic';
}

// ---- verification documents (private bucket `storefront-verification`, owner folder `<uid>/<file>`) ----

export const VERIFICATION_BUCKET = 'storefront-verification';
export const VERIFICATION_MAX_BYTES = 10 * 1024 * 1024;
export const VERIFICATION_MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export type DocumentCheck = { ok: true; ext: string } | { ok: false; reason: 'type' | 'size' | 'empty' };

/** Client-side pre-check only: the Storage API enforces the same 10 MiB / mime list. */
export function checkVerificationFile(mime: string | null | undefined, sizeBytes: number | null | undefined): DocumentCheck {
  const ext = VERIFICATION_MIME_EXT[(mime ?? '').toLowerCase()];
  if (!ext) return { ok: false, reason: 'type' };
  if (sizeBytes != null && sizeBytes <= 0) return { ok: false, reason: 'empty' };
  if (sizeBytes != null && sizeBytes > VERIFICATION_MAX_BYTES) return { ok: false, reason: 'size' };
  return { ok: true, ext };
}

/** `<uid>/<fileId>.<ext>`: exactly the shape the Storage insert policy and request_storefront_verification() accept. */
export function verificationObjectPath(userId: string, fileId: string, ext: string): string {
  return `${userId}/${fileId}.${ext}`;
}

/** Same rule as the SQL regex, so a bad path is caught before the request RPC. */
export function isOwnVerificationPath(userId: string, path: string): boolean {
  return path.startsWith(`${userId}/`) && /^[^/]+\/[A-Za-z0-9._-]{1,100}\.(jpg|jpeg|png|webp|pdf)$/i.test(path);
}

/** Folder for logo/banner uploads: r2-presign appends `/<uuid>.jpg`, which is the only key 0054 accepts. */
export function storefrontImageFolder(userId: string, kind: 'logo' | 'banner'): string {
  return `business/${userId}/${kind}`;
}

// ---- public read path (view public.public_storefronts: published storefronts of owners in good standing, nothing else) ----

/** Exactly the columns public_storefronts exposes. Drafts, suspended storefronts and banned/suspended owners return no row. */
export const PUBLIC_STOREFRONT_COLUMNS = 'id, owner_id, name, description, address, website, hours, logo_url, banner_url, verified, published_at';

export type PublicStorefront = {
  id: string;
  owner_id: string;
  name: string | null;
  description: string | null;
  address: string | null;
  website: string | null;
  hours: unknown;
  logo_url: string | null;
  banner_url: string | null;
  verified: boolean;
  published_at: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isStorefrontId = (id: unknown): id is string => typeof id === 'string' && UUID_RE.test(id);

/** Only plain http(s) links are ever opened from a storefront; anything else (javascript:, data:, intent:) is dropped. */
export function safeWebsiteHref(url: string | null | undefined): string | null {
  const v = (url ?? '').trim();
  if (!/^https?:\/\/[^\s]+$/i.test(v)) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type HoursDay = (typeof DAYS)[number];
export type HoursLine = { day: HoursDay; closed: boolean; open: string | null; close: string | null };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Reads the stored hours object ({ days: { mon: { closed, open, close } } }, written by the app's hours editor) for display.
 * Days with no entry are omitted (unknown, not "closed"); malformed entries are ignored; a legacy free-text `note` is kept
 * as a string. Times are returned as stored (24 h "HH:MM") so display never depends on the device locale.
 */
export function hoursLines(hours: unknown): { days: HoursLine[]; note: string | null } {
  const obj = hours && typeof hours === 'object' ? (hours as { days?: unknown; note?: unknown }) : {};
  const days: HoursLine[] = [];
  const src = obj.days && typeof obj.days === 'object' ? (obj.days as Record<string, unknown>) : {};
  for (const day of DAYS) {
    const e = src[day];
    if (!e || typeof e !== 'object') continue;
    const { closed, open, close } = e as { closed?: unknown; open?: unknown; close?: unknown };
    if (closed === true) days.push({ day, closed: true, open: null, close: null });
    else if (typeof open === 'string' && typeof close === 'string' && TIME.test(open) && TIME.test(close)) days.push({ day, closed: false, open, close });
  }
  const note = typeof obj.note === 'string' && obj.note.trim() ? obj.note.trim().slice(0, 300) : null;
  return { days, note };
}
/** "13:30" -> "1:30 PM". Display only; stored hours stay 24 h. */
export function formatTime12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** The day key for a JS Date (local time), in the same mon..sun order the hours are stored with. */
export function hoursDayOf(now: Date): HoursDay {
  return DAYS[(now.getDay() + 6) % 7];
}

/** true / false when today's hours are known, null when today has no entry (we do not guess). */
export function isOpenNow(lines: HoursLine[], now: Date = new Date()): boolean | null {
  const today = lines.find((l) => l.day === hoursDayOf(now));
  if (!today) return null;
  if (today.closed || !today.open || !today.close) return false;
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return hhmm >= today.open && hhmm < today.close;
}

