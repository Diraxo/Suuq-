// Sell-flow business rules shared by the mobile app and the website — pure
// TypeScript, no React / React Native / DOM imports, so the exact same rules
// run in both places and in the node test suite (tests/sellRules.test.ts).
//
// web/src/lib/sellRules.ts is a verbatim copy of this file (the web build
// can't import from outside web/, same convention as lib/homeFeed.ts); the
// parity test fails if the two ever drift apart. Edit data/sellRules.ts, then
// copy it over.
//
// IMPORTANT: UI input modes (numeric keyboards, <input type="file" accept>)
// are conveniences, not security boundaries — a paste, a bluetooth keyboard or
// a hand-written request bypasses them. Everything here validates the actual
// string, and the same checks must run again at publish time (and, for the
// parts the database can express, server-side — see supabase/proposed/).

import type { CategoryField } from './categoryFields';

// ───────────────────────────── Limits ─────────────────────────────

export const TITLE_MIN_LENGTH = 1; // non-empty after trim; "TV" / "PC" are legitimate titles
export const TITLE_MAX_LENGTH = 200; // matches DB constraint listings_title_length
// A description is required, but one meaningful character is enough — the old
// 20-character floor forced filler text. The cap matches DB constraint
// listings_description_length.
export const DESCRIPTION_MIN_LENGTH = 1;
export const DESCRIPTION_MAX_LENGTH = 5000;
export const SELLER_NOTES_MAX_LENGTH = 1000;
export const ATTRIBUTE_TEXT_MAX_LENGTH = 100;
export const MAX_LISTING_PHOTOS = 5;
export const PRICE_MAX = 999_999_999_999;

export const LISTING_CONDITIONS = ['new', 'like-new', 'used', 'for-parts'] as const;
export type ListingCondition = (typeof LISTING_CONDITIONS)[number];

// ──────────────────────── Numeric field schema ────────────────────────

export type NumericRule = {
  /** 'percent' is an integer with a % hint. 'integer' = digits only, 'decimal' = digits with an optional fractional part. */
  kind: 'integer' | 'decimal' | 'percent';
  min: number;
  max: number;
  /** decimal only: max digits after the point. */
  decimals?: number;
};

// Which free-text category fields are really numbers, with their real domain
// bounds. Keyed by field key. Deliberately NOT inferred from labels: a key
// that means different things in different categories (e.g. `size` is "Size
// (sqm)" for property but "M"/"XL" for clothing) is only matched through
// NUMERIC_RULES_BY_KEY_AND_LABEL below. Select fields never use these rules —
// their value must be one of the field's own options.
//
// Fields that look numeric but legitimately take text/units (model, brand,
// storage, salary with unknown currency, floor "Ground", age "2 years",
// expiry date...) are intentionally absent and stay free text.
export const NUMERIC_RULES: Record<string, NumericRule> = {
  // Battery health is a percentage; a phone can genuinely report 0%, so the
  // range is 0–100 inclusive. Condition belongs in the description.
  battery: { kind: 'percent', min: 0, max: 100 },
  mileage: { kind: 'integer', min: 0, max: 2_000_000 },
  engineCC: { kind: 'integer', min: 50, max: 20_000 },
  quantity: { kind: 'integer', min: 1, max: 1_000_000 },
  gears: { kind: 'integer', min: 1, max: 30 },
  setPieces: { kind: 'integer', min: 1, max: 1000 },
  resolution: { kind: 'decimal', min: 0.1, max: 1000, decimals: 1 },
  lengthMeters: { kind: 'decimal', min: 0.1, max: 500, decimals: 2 },
  ceilingHeight: { kind: 'decimal', min: 1, max: 20, decimals: 2 },
  voltage: { kind: 'decimal', min: 0.1, max: 100_000, decimals: 1 },
  weightCapacity: { kind: 'decimal', min: 0.1, max: 10_000_000, decimals: 1 },
};

const NUMERIC_RULES_BY_KEY_AND_LABEL: Record<string, NumericRule> = {
  'size|Size (sqm)': { kind: 'decimal', min: 1, max: 1_000_000, decimals: 2 },
};

/** The numeric rule for a field, or undefined when the field is not numeric. Only free-text fields can be numeric. */
export function numericRuleFor(field: Pick<CategoryField, 'key' | 'label' | 'type'>): NumericRule | undefined {
  if (field.type !== 'text') return undefined;
  return NUMERIC_RULES_BY_KEY_AND_LABEL[`${field.key}|${field.label}`] ?? NUMERIC_RULES[field.key];
}

const fmt = (n: number) => n.toLocaleString('en-US');

/** Helper text shown under a numeric field before the user can make a mistake. */
export function numericHint(rule: NumericRule): string {
  if (rule.kind === 'percent') return `Enter a percentage from ${rule.min} to ${rule.max}.`;
  if (rule.kind === 'integer') return `Whole number from ${fmt(rule.min)} to ${fmt(rule.max)}.`;
  return `Number from ${fmt(rule.min)} to ${fmt(rule.max)}${rule.decimals ? ` (up to ${rule.decimals} decimal place${rule.decimals === 1 ? '' : 's'})` : ''}.`;
}

/** Hint for any category field (numeric rule hint today; undefined for plain text/select/year). */
export function fieldHint(field: Pick<CategoryField, 'key' | 'label' | 'type'>): string | undefined {
  const rule = numericRuleFor(field);
  return rule ? numericHint(rule) : undefined;
}

/** Native keyboard to request for a field: whole numbers → number-pad, decimals → decimal-pad, else default. */
export function keyboardFor(field: Pick<CategoryField, 'key' | 'label' | 'type'>): 'number-pad' | 'decimal-pad' | undefined {
  const rule = numericRuleFor(field);
  if (!rule) return undefined;
  return rule.kind === 'decimal' ? 'decimal-pad' : 'number-pad';
}

export type NumberParse = { ok: true; value: number } | { ok: false; error: string };

// The strict parser. Only plain ASCII digits (with one optional ".digits"
// fraction for decimal rules) are accepted — so letters, signs, exponents
// ("1e5"), "NaN", "Infinity", hex, grouping separators, Arabic-Indic digits
// and whitespace inside the number are all rejected with a message rather than
// being stripped or coerced to 0.
export function parseNumericInput(raw: string, rule: NumericRule, label = 'This field'): NumberParse {
  const s = raw.trim();
  if (!s) return { ok: false, error: `${label} can't be empty.` };
  const shape = rule.kind === 'decimal' ? /^\d+(\.\d+)?$/ : /^\d+$/;
  if (s.length > 16 || !shape.test(s)) {
    return {
      ok: false,
      error:
        rule.kind === 'decimal'
          ? `${label} must be a number — digits with an optional decimal point (e.g. 2.5).`
          : `${label} must be a whole number — digits only.`,
    };
  }
  if (rule.kind === 'decimal' && rule.decimals !== undefined) {
    const places = s.includes('.') ? s.split('.')[1].length : 0;
    if (places > rule.decimals) {
      return { ok: false, error: `${label} can have at most ${rule.decimals} decimal place${rule.decimals === 1 ? '' : 's'}.` };
    }
  }
  const value = Number(s);
  if (!Number.isFinite(value)) return { ok: false, error: `${label} is not a valid number.` };
  if (value < rule.min || value > rule.max) {
    return {
      ok: false,
      error: rule.kind === 'percent' ? `${label} must be a percentage from ${rule.min} to ${rule.max}.` : `${label} must be between ${fmt(rule.min)} and ${fmt(rule.max)}.`,
    };
  }
  return { ok: true, value };
}

// ──────────────────────────── Text fields ────────────────────────────

// Control characters (NUL breaks Postgres text columns outright; the rest are
// never legitimate in a listing). Newline/CR/tab are allowed only where the
// field is multi-line.
const CONTROL_CHARS_SINGLE_LINE = /[\u0000-\u001F\u007F]/;
const CONTROL_CHARS_MULTI_LINE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export function validateTitle(title: string): string | undefined {
  const trimmed = title.trim();
  if (!trimmed) return 'Title is required.';
  if (CONTROL_CHARS_SINGLE_LINE.test(trimmed)) return "Title can't contain line breaks or control characters.";
  if (trimmed.length > TITLE_MAX_LENGTH) return `Title must be at most ${TITLE_MAX_LENGTH} characters (currently ${trimmed.length}).`;
  return undefined;
}

export function validateDescription(description: string): string | undefined {
  const trimmed = description.trim();
  if (trimmed.length < DESCRIPTION_MIN_LENGTH) return 'Description is required.';
  if (CONTROL_CHARS_MULTI_LINE.test(trimmed)) return "Description contains characters that aren't allowed.";
  if (trimmed.length > DESCRIPTION_MAX_LENGTH) return `Description must be at most ${fmt(DESCRIPTION_MAX_LENGTH)} characters (currently ${fmt(trimmed.length)}).`;
  return undefined;
}

export function validateSellerNotes(notes: string): string | undefined {
  if (!notes.trim()) return undefined;
  if (CONTROL_CHARS_MULTI_LINE.test(notes)) return "Seller notes contain characters that aren't allowed.";
  if (notes.trim().length > SELLER_NOTES_MAX_LENGTH) return `Seller notes must be at most ${fmt(SELLER_NOTES_MAX_LENGTH)} characters (currently ${fmt(notes.trim().length)}).`;
  return undefined;
}

// ───────────────────────────── Price ─────────────────────────────

// Prices are whole currency units everywhere in the product (formatAmount
// rounds, the inputs are digit-only), so a price is a positive integer. The
// raw string is validated as typed — nothing is stripped or coerced.
export function validatePrice(price: string): string | undefined {
  const s = price.trim();
  if (!s) return 'Price is required.';
  if (!/^\d+$/.test(s) || s.length > 15) return 'Enter the price using digits only (no letters, spaces, commas or symbols).';
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return 'Enter a price greater than 0.';
  if (n > PRICE_MAX) return `Price can't be more than ${fmt(PRICE_MAX)}.`;
  return undefined;
}

export function validateCurrency(currency: string | undefined, allowed?: readonly string[]): string | undefined {
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return 'Choose a currency.';
  if (allowed && allowed.length > 0 && !allowed.includes(currency)) return "That currency isn't available for the chosen location.";
  return undefined;
}

export function validateCondition(condition: string | undefined): string | undefined {
  if (!condition || !(LISTING_CONDITIONS as readonly string[]).includes(condition)) return 'Choose the condition of the item.';
  return undefined;
}

// ───────────────────── Category-specific attributes ─────────────────────

const YEAR_MIN = 1900;

/** Validates one category field's value. Returns an error string, or undefined when the value is blank-and-optional or valid. */
export function validateAttribute(field: CategoryField, rawValue: string | undefined, now = new Date()): string | undefined {
  const value = (rawValue ?? '').trim();
  if (!value) return field.required ? `${field.label} is required.` : undefined;

  if (field.type === 'select') {
    if (field.options && !field.options.includes(value)) return `Choose a valid ${field.label}.`;
    return undefined;
  }
  if (field.type === 'year') {
    const year = Number(value);
    if (!/^\d{4}$/.test(value) || year < YEAR_MIN || year > now.getFullYear() + 1) return `${field.label} must be a valid year.`;
    return undefined;
  }
  const rule = numericRuleFor(field);
  if (rule) {
    const parsed = parseNumericInput(value, rule, field.label);
    return parsed.ok ? undefined : parsed.error;
  }
  if (CONTROL_CHARS_SINGLE_LINE.test(value)) return `${field.label} can't contain line breaks or control characters.`;
  if (value.length > ATTRIBUTE_TEXT_MAX_LENGTH) return `${field.label} must be at most ${ATTRIBUTE_TEXT_MAX_LENGTH} characters.`;
  return undefined;
}

/** Validates every field of the active category schema → { fieldKey: message } (empty object = valid). */
export function validateAttributes(fields: CategoryField[], attributes: Record<string, string>, now = new Date()): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const error = validateAttribute(field, attributes[field.key], now);
    if (error) errors[field.key] = error;
  }
  return errors;
}

/**
 * The attributes that may be published: only keys that belong to the active
 * category/subcategory schema (a draft that switched category must not carry
 * the previous category's specs), trimmed, non-blank, and — for selectors —
 * one of the field's own options.
 */
export function sanitizeAttributes(fields: CategoryField[], attributes: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    const raw = attributes[field.key];
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (!value) continue;
    if (field.type === 'select' && field.options && !field.options.includes(value)) continue;
    out[field.key] = value;
  }
  return out;
}

/** Keeps only features that are offered for the active category/subcategory (a draft that switched category must not publish the old category's highlights). */
export function sanitizeFeatures(offered: readonly string[], features: readonly string[]): string[] {
  return features.filter((f, i) => offered.includes(f) && features.indexOf(f) === i);
}

// ───────────────────── Whole-listing validation ─────────────────────

export type SellStep = 'photos' | 'category' | 'details' | 'location' | 'price';

export type ListingDraftInput = {
  photoCount: number;
  category?: string | null;
  subcategory?: string | null;
  title: string;
  description: string;
  condition?: string | null;
  sellerNotes?: string;
  city?: string | null;
  price: string;
  currency?: string;
  allowedCurrencies?: readonly string[];
  attributes: Record<string, string>;
  /** The active schema for category/subcategory (getCategoryFields). */
  fields: CategoryField[];
  /** The category list, to confirm category/subcategory exist. */
  categories: readonly { id: string; subcategories?: readonly { name: string }[] }[];
  /** Mobile only: phone error when no phone is saved yet. */
  phoneError?: string;
};

export type ListingDraftResult = {
  ok: boolean;
  /** field key → message. Attribute errors are keyed `attr:<fieldKey>`. */
  errors: Record<string, string>;
  /** Earliest wizard step with a problem, to send the seller back to. */
  firstInvalidStep?: SellStep;
};

const STEP_ORDER: SellStep[] = ['photos', 'category', 'details', 'location', 'price'];

/** The one publish-time gate used by both platforms: re-checks every step, so a seller who edited an earlier step (or a forged draft) can't skip validation. */
export function validateListingDraft(input: ListingDraftInput): ListingDraftResult {
  const errors: Record<string, string> = {};
  const stepOf: Record<string, SellStep> = {};
  const add = (step: SellStep, key: string, message: string | undefined) => {
    if (!message) return;
    errors[key] = message;
    stepOf[key] = step;
  };

  if (input.photoCount < 1) add('photos', 'photos', 'Add at least one photo.');
  if (input.photoCount > MAX_LISTING_PHOTOS) add('photos', 'photos', `You can add up to ${MAX_LISTING_PHOTOS} photos.`);

  const category = input.categories.find((c) => c.id === input.category);
  if (!category) add('category', 'category', 'Choose a category.');
  else if (input.subcategory && !category.subcategories?.some((s) => s.name === input.subcategory)) add('category', 'subcategory', 'Choose a valid subcategory.');
  else if (category.subcategories?.length && !input.subcategory) add('category', 'subcategory', 'Choose a subcategory.');

  add('details', 'title', validateTitle(input.title));
  add('details', 'description', validateDescription(input.description));
  add('details', 'condition', validateCondition(input.condition ?? undefined));
  add('details', 'sellerNotes', validateSellerNotes(input.sellerNotes ?? ''));
  add('details', 'phone', input.phoneError);
  for (const [key, message] of Object.entries(validateAttributes(input.fields, input.attributes))) add('details', `attr:${key}`, message);

  if (!input.city) add('location', 'city', 'Select a city.');
  add('price', 'price', validatePrice(input.price));
  add('price', 'currency', validateCurrency(input.currency, input.allowedCurrencies));

  const failing = new Set(Object.keys(errors).map((k) => stepOf[k]));
  return { ok: Object.keys(errors).length === 0, errors, firstInvalidStep: STEP_ORDER.find((s) => failing.has(s)) };
}
