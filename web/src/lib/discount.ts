// Mirrored in lib/discount.ts on mobile — keep the two in step.
// Server rules: supabase/migrations/0080_seller_discounts.sql (set_listing_discount / listing_discount_live). These
// helpers only decide what to show and pre-check the seller's input; the database enforces the same limits.

export const DISCOUNT_DAYS = [3, 7, 14, 30] as const;
/** The longest finite discount, in whole days. Longer needs "until I end it" (permanent). Same limit as the database (0081). */
export const DISCOUNT_MAX_DAYS = 365;
export const DISCOUNT_MIN_PERCENT = 1;
export const DISCOUNT_MAX_PERCENT = 90;
export const DISCOUNT_NOTE_MAX_LENGTH = 60;
/** The current price must have been in place this long before it can be discounted. */
export const PRICE_HOLD_DAYS = 3;

const DAY = 86_400_000;

/** `endsAt` is absent for a permanent discount (`permanent: true`): it has no end date, the seller ends it. */
export type Discount = { originalPrice: number; percent: number; endsAt?: number; permanent?: true; note?: string };

type DiscountFacts = { price: number; status?: string; discountOriginalPrice?: number; discountEndsAt?: number; discountPermanent?: boolean; discountNote?: string };

/**
 * The buyer-facing discount on a listing: the seller set one (database columns discount_*), it has not ended and the price
 * is still below the original by at least a whole 1%. Null otherwise. Only an 'available' listing carries a discount: sold,
 * reserved, expired and staff-hidden ones do not, whichever screen shows them. Missing, non-finite or invalid facts mean
 * no discount. A plain price edit never produces one.
 */
export function activeDiscount(l: DiscountFacts, now: number = Date.now()): Discount | null {
  if (l.status !== undefined && l.status !== 'available') return null;
  const orig = l.discountOriginalPrice;
  const ends = l.discountEndsAt;
  const permanent = l.discountPermanent === true;
  if (orig == null || (!permanent && ends == null)) return null;
  if (!Number.isFinite(orig) || !Number.isFinite(l.price) || (!permanent && !Number.isFinite(ends))) return null;
  if (!(orig > 0) || !(l.price < orig)) return null;
  if (!permanent && (ends as number) <= now) return null;
  // At least a whole 1% off, tested exactly: rounding alone would advertise a 0.5% cut as "-1%".
  if ((orig - l.price) * 100 < orig) return null;
  const percent = Math.round((1 - l.price / orig) * 100);
  const note = l.discountNote?.trim();
  return { originalPrice: orig, percent, ...(permanent ? { permanent: true as const } : { endsAt: ends as number }), ...(note ? { note } : {}) };
}

/** "Ends today" within the last 24 hours, otherwise whole days left rounded up (4.2 days left reads "5 days"). */
export function discountEndsIn(endsAt: number | undefined, now: number = Date.now()): { kind: 'today' } | { kind: 'days'; days: number } | null {
  if (endsAt == null || !Number.isFinite(endsAt)) return null;
  const left = endsAt - now;
  if (left <= 0) return null;
  if (left <= DAY) return { kind: 'today' };
  return { kind: 'days', days: Math.ceil(left / DAY) };
}

/**
 * A discount that has ended but has not been written back by the database yet still stores the low price. Show the
 * original price for it (and no discount) so nothing silently stays low. Used when mapping a database row.
 */
export function settledListingPrice(price: number, originalPrice: number | undefined, endsAt: number | undefined, now: number = Date.now()): number {
  if (originalPrice != null && endsAt != null && Number.isFinite(originalPrice) && Number.isFinite(endsAt) && endsAt <= now) return originalPrice;
  return price;
}

type Translate = (key: string, opts?: Record<string, string | number>) => string;

/** One line for every screen: "Discount ends today", "Discount ends in 5 days" or "No end date - the seller ends it". */
export function discountEndsText(d: Pick<Discount, 'endsAt' | 'permanent'>, t: Translate, now: number = Date.now()): string | undefined {
  if (d.permanent) return t('discount.noEndDate');
  const ends = discountEndsIn(d.endsAt, now);
  if (!ends) return undefined;
  return ends.kind === 'today' ? t('discount.endsToday') : t('discount.endsInDays', { count: ends.days });
}

/** The exact moment as a short local date and time, e.g. "28 Oct 2026, 18:05". Falls back to ISO when Intl is unavailable. */
export function formatDiscountInstant(ms: number, locale?: string): string {
  if (!Number.isFinite(ms)) return '';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

/** The instant a discount of `days` whole days started now would end (the database adds exactly days x 24 hours). */
export function discountEndsAtFor(days: number, now: number = Date.now()): number {
  return now + days * DAY;
}

export function priceFromPercent(original: number, percent: number): number {
  return Math.max(0, Math.round((original * (100 - percent)) / 100));
}

export function percentFromPrice(original: number, price: number): number {
  if (!(original > 0)) return 0;
  return Math.round((1 - price / original) * 1000) / 10;
}

export type DiscountInputError = 'invalid' | 'mustBeLower' | 'tooSmall' | 'tooLarge' | 'noteTooLong' | 'noteControl' | 'duration';

/** A duration is a whole number of days from 1 to DISCOUNT_MAX_DAYS, or 'forever'. */
export type DiscountDuration = number | 'forever';

/** Parses what the seller typed into the custom-days box: digits only, no zero, no more than DISCOUNT_MAX_DAYS. Undefined when invalid. */
export function parseCustomDays(text: string): number | undefined {
  const s = text.trim();
  if (!/^[0-9]+$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isSafeInteger(n) && n >= 1 && n <= DISCOUNT_MAX_DAYS ? n : undefined;
}

/** The seller-side pre-check. Same limits as the database function, which has the final say. */
export function validateDiscountInput(i: { original: number; price: number; days: DiscountDuration; note?: string }): DiscountInputError | undefined {
  if (!Number.isFinite(i.original) || !(i.original > 0) || !Number.isFinite(i.price) || !(i.price > 0) || !Number.isInteger(i.price)) return 'invalid';
  if (i.days !== 'forever' && !(Number.isInteger(i.days) && i.days >= 1 && i.days <= DISCOUNT_MAX_DAYS)) return 'duration';
  if (i.price >= i.original) return 'mustBeLower';
  if ((i.original - i.price) * 100 < i.original) return 'tooSmall';
  if (i.price * 10 < i.original) return 'tooLarge';
  const note = (i.note ?? '').trim();
  if (/[\u0000-\u001F\u007F]/.test(note)) return 'noteControl';
  if (note.length > DISCOUNT_NOTE_MAX_LENGTH) return 'noteTooLong';
  return undefined;
}

type DiscountRow = {
  price: number | string;
  discount_original_price?: number | string | null;
  discount_started_at?: string | null;
  discount_ends_at?: string | null;
  discount_permanent?: boolean | null;
  discount_note?: string | null;
};

/** The price and discount fields of a Listing from a database row (an ended, not-yet-settled discount shows the original price). */
export function discountFromRow(row: DiscountRow, now: number = Date.now()): Pick<
  { price: number; discountOriginalPrice?: number; discountStartedAt?: number; discountEndsAt?: number; discountPermanent?: boolean; discountNote?: string },
  'price' | 'discountOriginalPrice' | 'discountStartedAt' | 'discountEndsAt' | 'discountPermanent' | 'discountNote'
> {
  const stored = Number(row.price);
  const original = row.discount_original_price != null ? Number(row.discount_original_price) : undefined;
  const ends = row.discount_ends_at ? new Date(row.discount_ends_at).getTime() : undefined;
  const permanent = row.discount_permanent === true && row.discount_ends_at == null;
  if (original == null || !Number.isFinite(original) || (!permanent && (ends == null || !Number.isFinite(ends)))) return { price: stored };
  if (!permanent && (ends as number) <= now) return { price: settledListingPrice(stored, original, ends, now) };
  const started = row.discount_started_at ? new Date(row.discount_started_at).getTime() : undefined;
  const note = row.discount_note?.trim();
  return {
    price: stored,
    discountOriginalPrice: original,
    ...(started != null && Number.isFinite(started) ? { discountStartedAt: started } : {}),
    ...(permanent ? { discountPermanent: true } : { discountEndsAt: ends as number }),
    ...(note ? { discountNote: note } : {}),
  };
}

/** Maps the database's English explanation to a `discount.errors.*` key (and its params) so the seller reads it in their language. */
export function discountServerError(message: string | undefined, locale?: string): { key: string; params?: Record<string, string | number> } {
  const m = message ?? '';
  // 0081 sends the exact UTC instant ("2026-10-28T09:30:00Z"); 0080 sent only the date. Show the seller's local time when we can.
  const stamp = /from (\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?)/.exec(m)?.[1];
  const date = stamp ? (stamp.includes('T') ? formatDiscountInstant(Date.parse(stamp), locale) : stamp) : undefined;
  if (/already running/i.test(m)) return { key: 'alreadyRunning' };
  if (/changed recently/i.test(m)) return date ? { key: 'recentlyChanged', params: { date } } : { key: 'generic' };
  if (/available listing/i.test(m)) return { key: 'notAvailable' };
  if (/at least 1%/i.test(m)) return { key: 'tooSmall' };
  if (/at most 90%/i.test(m)) return { key: 'tooLarge' };
  if (/lower than/i.test(m)) return { key: 'mustBeLower' };
  if (/whole number/i.test(m)) return { key: 'invalid' };
  if (/1 to (30|365)/i.test(m)) return { key: 'duration', params: { max: DISCOUNT_MAX_DAYS } };
  if (/at most 60/i.test(m)) return { key: 'noteTooLong', params: { max: DISCOUNT_NOTE_MAX_LENGTH } };
  if (/special characters/i.test(m)) return { key: 'noteControl' };
  return { key: 'generic' };
}
