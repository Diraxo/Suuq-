// Validation + sanitising for the personal profile and the business profile. Pure TypeScript (no React Native, DOM or
// i18n imports) so the mobile app, the website and the node tests all run the same code.
//
// web/src/lib/profileRules.ts is a verbatim copy (the web build cannot import from outside web/); a parity test in
// tests/profileRules.test.ts fails if they drift apart.
//
// This is the CLIENT half. The trusted half is migration 0056 (constraints + guard trigger on public.profiles): anything
// a hand-written request sends is checked again there, so nothing here is a security boundary on its own.
//
// Errors are machine codes, not sentences: each platform maps a code to its own wording (mobile via i18n, web inline).

export const PROFILE_LIMITS = {
  fullName: 100,
  bio: 1000,
  city: 80,
  businessName: 150,
  businessDescription: 1000,
  businessAddress: 250,
  url: 250,
} as const;

export type WeekDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type DayHours = { closed: boolean; open: string; close: string };
export type HoursDays = Partial<Record<WeekDay, DayHours>>;
export const WEEK_DAYS: WeekDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DEFAULT_DAY_HOURS: DayHours = { closed: false, open: '09:00', close: '18:00' };

export type SocialKey = 'facebook' | 'instagram' | 'telegram' | 'tiktok' | 'whatsapp';
export const SOCIAL_KEYS: SocialKey[] = ['facebook', 'instagram', 'telegram', 'tiktok', 'whatsapp'];
export type SocialLinks = Partial<Record<SocialKey, string>>;

// Only these hosts (and their subdomains) are accepted for a social link, so a profile can never point a button at an
// arbitrary site that merely says "Facebook" on it. Keep in sync with the SQL function in migration 0056.
export const SOCIAL_HOSTS: Record<SocialKey, string[]> = {
  facebook: ['facebook.com', 'fb.com', 'fb.me'],
  instagram: ['instagram.com'],
  telegram: ['t.me', 'telegram.me'],
  tiktok: ['tiktok.com'],
  whatsapp: ['wa.me', 'whatsapp.com'],
};

export type ProfileErrorCode =
  | 'nameRequired'
  | 'nameTooShort'
  | 'nameTooLong'
  | 'nameInvalid'
  | 'phoneInvalid'
  | 'bioTooLong'
  | 'cityTooLong'
  | 'businessNameTooLong'
  | 'descriptionTooLong'
  | 'addressTooLong'
  | 'websiteInvalid'
  | 'socialInvalid'
  | 'hoursInvalid'
  | 'categoryInvalid';

/** Strips control characters (incl. zero-width and bidi overrides, used to spoof names) and collapses whitespace runs. */
export function cleanText(input: string): string {
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Multi-line variant for descriptions/bios: keeps line breaks, caps blank lines at one. */
export function cleanMultiline(input: string): string {
  return cleanText(input.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]*\n[ \t]*/g, '\n'));
}

const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** Parses an http(s) URL with a real hostname and no credentials; null for anything else (javascript:, data:, intranet, IPs). */
function parseWebUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if (!HOST_RE.test(url.hostname)) return null; // also rejects "localhost", bare IPs and single-label hosts
  return url;
}

/** Normalises what a user typed into a website value to store. Adds https:// when no scheme was typed. null = invalid. */
export function normalizeWebsite(input: string): string | null {
  const text = cleanText(input);
  if (!text) return '';
  if (/\s/.test(text) || text.length > PROFILE_LIMITS.url) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  const url = parseWebUrl(withScheme);
  return url ? url.toString().replace(/\/$/, '') : null;
}

/** Normalises a social link for `key`: must be https on that network's own host. Returns '' for blank, null if invalid. */
export function normalizeSocial(key: SocialKey, input: string): string | null {
  const text = cleanText(input);
  if (!text) return '';
  // WhatsApp: a plain phone number is enough, it becomes the wa.me link.
  if (key === 'whatsapp' && /^\+?[\d\s().-]{7,24}$/.test(text)) {
    const digits = text.replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15 ? `https://wa.me/${digits}` : null;
  }
  // Other networks: a bare @username is enough, it becomes the profile link.
  const handle = /^@?([A-Za-z0-9._-]{2,64})$/.exec(text);
  if (handle && key !== 'whatsapp' && !SOCIAL_HOSTS[key].some((h) => text.toLowerCase().includes(h))) {
    const base = { facebook: 'https://facebook.com/', instagram: 'https://instagram.com/', telegram: 'https://t.me/', tiktok: 'https://tiktok.com/@' }[key];
    return `${base}${handle[1]}`;
  }
  if (/\s/.test(text) || text.length > PROFILE_LIMITS.url) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  const url = parseWebUrl(withScheme);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!SOCIAL_HOSTS[key].some((h) => host === h || host.endsWith(`.${h}`))) return null;
  url.protocol = 'https:';
  return url.toString().replace(/\/$/, '');
}

/** A value safe to put in an <a href>: only http(s). Anything else (a legacy or hand-written row) renders as plain text. */
export function safeHref(value: string | null | undefined): string | null {
  if (!value) return null;
  const url = parseWebUrl(value.trim());
  return url ? url.toString() : null;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Returns cleaned hours, or null when any open day has a malformed or backwards time range. */
export function normalizeHours(days: HoursDays): HoursDays | null {
  const out: HoursDays = {};
  for (const day of WEEK_DAYS) {
    const h = days[day];
    if (!h) continue;
    if (typeof h.closed !== 'boolean') return null;
    if (h.closed) {
      out[day] = { closed: true, open: DEFAULT_DAY_HOURS.open, close: DEFAULT_DAY_HOURS.close };
      continue;
    }
    if (!TIME_RE.test(h.open) || !TIME_RE.test(h.close) || h.open >= h.close) return null;
    out[day] = { closed: false, open: h.open, close: h.close };
  }
  return out;
}

export function validateFullName(raw: string): { ok: true; value: string } | { ok: false; error: ProfileErrorCode } {
  const value = cleanText(raw);
  if (!value) return { ok: false, error: 'nameRequired' };
  if ([...value].length < 2) return { ok: false, error: 'nameTooShort' };
  if ([...value].length > PROFILE_LIMITS.fullName) return { ok: false, error: 'nameTooLong' };
  // A name that is only digits/symbols is almost always spam or an impersonation attempt.
  if (!/\p{L}/u.test(value)) return { ok: false, error: 'nameInvalid' };
  return { ok: true, value };
}

export type PersonalInput = { fullName: string; bio: string; city: string };
export type PersonalResult =
  | { ok: true; value: { full_name: string; bio: string | null; city: string | null } }
  | { ok: false; errors: Partial<Record<'fullName' | 'bio' | 'city', ProfileErrorCode>> };

export function validatePersonalProfile(input: PersonalInput): PersonalResult {
  const errors: Partial<Record<'fullName' | 'bio' | 'city', ProfileErrorCode>> = {};
  const name = validateFullName(input.fullName);
  if (!name.ok) errors.fullName = name.error;
  const bio = cleanMultiline(input.bio);
  if ([...bio].length > PROFILE_LIMITS.bio) errors.bio = 'bioTooLong';
  const city = cleanText(input.city);
  if ([...city].length > PROFILE_LIMITS.city) errors.city = 'cityTooLong';
  if (Object.keys(errors).length || !name.ok) return { ok: false, errors };
  return { ok: true, value: { full_name: name.value, bio: bio || null, city: city || null } };
}

// No name here: the account's name is profiles.full_name (Edit profile). The legacy business_name column is never written by the business editor.
export type BusinessInput = {
  description: string;
  address: string;
  website: string;
  hours: HoursDays;
  social: Partial<Record<SocialKey, string>>;
  deliveryAvailable: boolean;
  /** Marketplace category ids (at most BUSINESS_CATEGORY_MAX). Leave undefined to not touch the stored value; [] clears it. */
  categories?: string[];
};

export type BusinessFieldKey = 'description' | 'address' | 'website' | 'hours' | 'category' | SocialKey;

const BUSINESS_CATEGORY_RE = /^[a-z][a-z_]{1,29}$/;
export const BUSINESS_CATEGORY_MAX = 5;

export type BusinessPayload = {
  business_description: string | null;
  business_address: string | null;
  business_website: string | null;
  business_hours: { days: HoursDays } | Record<string, never>;
  social_links: SocialLinks;
  delivery_available: boolean;
  /** Present only when the caller supplied categories, so saving other fields never writes the column. */
  business_categories?: string[];
};

export type BusinessResult = { ok: true; value: BusinessPayload } | { ok: false; errors: Partial<Record<BusinessFieldKey, ProfileErrorCode>> };

export function validateBusinessProfile(input: BusinessInput): BusinessResult {
  const errors: Partial<Record<BusinessFieldKey, ProfileErrorCode>> = {};
  const description = cleanMultiline(input.description);
  const address = cleanText(input.address);
  if ([...description].length > PROFILE_LIMITS.businessDescription) errors.description = 'descriptionTooLong';
  if ([...address].length > PROFILE_LIMITS.businessAddress) errors.address = 'addressTooLong';

  const website = normalizeWebsite(input.website);
  if (website === null) errors.website = 'websiteInvalid';

  const social: SocialLinks = {};
  for (const key of SOCIAL_KEYS) {
    const link = normalizeSocial(key, input.social[key] ?? '');
    if (link === null) errors[key] = 'socialInvalid';
    else if (link) social[key] = link;
  }

  const hours = normalizeHours(input.hours);
  if (hours === null) errors.hours = 'hoursInvalid';
  const categories = input.categories === undefined ? undefined : [...new Set(input.categories.map((c) => cleanText(c)).filter(Boolean))];
  if (categories && (categories.length > BUSINESS_CATEGORY_MAX || categories.some((c) => !BUSINESS_CATEGORY_RE.test(c)))) errors.category = 'categoryInvalid';

  if (Object.keys(errors).length || website === null || hours === null) return { ok: false, errors };
  return {
    ok: true,
    value: {
      business_description: description || null,
      business_address: address || null,
      business_website: website || null,
      business_hours: Object.keys(hours).length ? { days: hours } : {},
      social_links: social,
      delivery_available: input.deliveryAvailable,
      ...(categories === undefined ? {} : { business_categories: categories }),
    },
  };
}
