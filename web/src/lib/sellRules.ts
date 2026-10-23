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

import { RENTABLE, visibleFields, type CategoryField } from './categoryFields';

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
/** Oldest model year offered by the year pickers (mobile + web). */
export const YEAR_PICKER_OLDEST = 1950;
export const MAX_LISTING_PHOTOS = 5;
export const PRICE_MAX = 999_999_999_999;

export const LISTING_CONDITIONS = ['new', 'like-new', 'used', 'for-parts'] as const;
export type ListingCondition = (typeof LISTING_CONDITIONS)[number];

// ───────────────────── Which conditions fit which category ─────────────────────

const ALL_CONDITIONS: readonly ListingCondition[] = ['new', 'like-new', 'used', 'for-parts'];
// "Needs repair" only makes sense for things that can be repaired.
const NO_REPAIR: readonly ListingCondition[] = ['new', 'like-new', 'used'];
const NONE: readonly ListingCondition[] = [];

// Anything not listed keeps the full set, exactly as before. A subcategory entry
// wins over its category's. NONE means a product condition does not apply at
// all (a house for rent is not "like new"; a goat is not "used"); those
// categories describe themselves with their own fields instead — rent period
// and utilities, freshness and expiry, age and breed.
const CONDITION_RULES: Record<string, readonly ListingCondition[]> = {
  property: NONE,
  jobs: NONE,
  services: NONE,
  food: NONE,
  animals: NONE,
  'agriculture/Livestock': NONE,
  'agriculture/Seeds & Crops': NONE,
  'agriculture/Greenhouse & Nursery': NO_REPAIR,
  fashion: NO_REPAIR,
  beauty: NO_REPAIR,
  books: NO_REPAIR,
  'phones/Accessories': NO_REPAIR,
  'baby/Clothing': NO_REPAIR,
  'baby/Toys': NO_REPAIR,
  'baby/Feeding': NO_REPAIR,
  'baby/Baby Safety': NO_REPAIR,
  'kitchen/Cookware': NO_REPAIR,
  'kitchen/Utensils': NO_REPAIR,
  'kitchen/Storage': NO_REPAIR,
  'kitchen/Bakeware': NO_REPAIR,
  'construction/Building Materials': NO_REPAIR,
  'construction/Cement & Blocks': NO_REPAIR,
  'construction/Electrical Supplies': NO_REPAIR,
  'construction/Plumbing Supplies': NO_REPAIR,
  'construction/Roofing': NO_REPAIR,
  'construction/Steel & Metal Works': NO_REPAIR,
  'sports/Team Sports': NO_REPAIR,
  'sports/Outdoor & Camping': NO_REPAIR,
  'sports/Swimming': NO_REPAIR,
  'sports/Running & Athletics': NO_REPAIR,
};

/** The conditions a seller may choose for this category/subcategory. Empty when a product condition does not apply. */
export function conditionOptionsFor(category?: string | null, subcategory?: string | null): readonly ListingCondition[] {
  if (!category) return ALL_CONDITIONS;
  return (subcategory ? CONDITION_RULES[`${category}/${subcategory}`] : undefined) ?? CONDITION_RULES[category] ?? ALL_CONDITIONS;
}

/** Whether the item-condition question applies to this category/subcategory at all. */
export function conditionApplies(category?: string | null, subcategory?: string | null): boolean {
  return conditionOptionsFor(category, subcategory).length > 0;
}

/**
 * Whether a listing is a rental: a property rent-only subcategory ("House for Rent"), or any listing whose "For sale or for rent"
 * question (property business types, vehicles, equipment) was answered "For rent".
 */
export function isRentalListing(category?: string | null, subcategory?: string | null, attributes?: Record<string, string | undefined>): boolean {
  if (category === 'property' && subcategory && /for rent$/i.test(subcategory)) return true;
  if ((attributes?.offer ?? '').trim() !== 'For rent') return false;
  // Only forms that actually ask the question can be rentals (property business types, vehicles, equipment).
  return category === 'property' || RENTABLE.has(`${category}/${subcategory}`);
}

/**
 * What closing a listing means. The stored status is always 'sold' (no schema change); this decides the WORDS: a rental is
 * "Rented", a job is "Filled", a service is "Closed", everything else is "Sold". Shared by the app and the website.
 */
export type CloseKind = 'sold' | 'rented' | 'filled' | 'closed';
export function closeKind(l: { category?: string | null; subcategory?: string | null; attributes?: Record<string, string | undefined> | null }): CloseKind {
  if (l.category === 'jobs') return 'filled';
  if (l.category === 'services') return 'closed';
  return isRentalListing(l.category, l.subcategory, l.attributes ?? undefined) ? 'rented' : 'sold';
}

/** Model years for a year picker: next year (new models go on sale early) down to YEAR_PICKER_OLDEST. Never pre-selected — the current year is only where the list opens. */
export function yearOptions(now = new Date()): string[] {
  const newest = now.getFullYear() + 1;
  return Array.from({ length: newest - YEAR_PICKER_OLDEST + 1 }, (_, i) => String(newest - i));
}

// ───────────────────────── Error messages ─────────────────────────

// Every message a seller can see from these rules, as a template. The validators
// build their English text from here (sellError) and the screens map a message
// back to its id and values (matchSellError) to show it in the seller's language
// — so the wording lives in one place and no screen has to parse prose.
export const SELL_ERROR_TEMPLATES = {
  titleRequired: 'Title is required.',
  titleControl: "Title can't contain line breaks or control characters.",
  titleTooLong: 'Title must be at most {max} characters (currently {count}).',
  descriptionRequired: 'Description is required.',
  descriptionControl: "Description contains characters that aren't allowed.",
  descriptionTooLong: 'Description must be at most {max} characters (currently {count}).',
  notesControl: "Seller notes contain characters that aren't allowed.",
  notesTooLong: 'Seller notes must be at most {max} characters (currently {count}).',
  priceRequired: 'Price is required.',
  priceDigits: 'Enter the price using digits only (no letters, spaces, commas or symbols).',
  priceZero: 'Enter a price greater than 0.',
  priceMax: "Price can't be more than {max}.",
  currencyChoose: 'Choose a currency.',
  currencyUnavailable: "That currency isn't available for the chosen location.",
  conditionChoose: 'Choose the condition of the item.',
  attrRequired: '{label} is required.',
  attrChoice: 'Choose a valid {label}.',
  attrYear: '{label} must be a valid year.',
  attrControl: "{label} can't contain line breaks or control characters.",
  attrTooLong: '{label} must be at most {max} characters.',
  numEmpty: "{label} can't be empty.",
  numDecimalShape: '{label} must be a number — digits with an optional decimal point (e.g. 2.5).',
  numIntegerShape: '{label} must be a whole number — digits only.',
  numDecimalsOne: '{label} can have at most 1 decimal place.',
  numDecimalsMany: '{label} can have at most {decimals} decimal places.',
  numInvalid: '{label} is not a valid number.',
  numPercent: '{label} must be a percentage from {min} to {max}.',
  numRange: '{label} must be between {min} and {max}.',
  photosRequired: 'Add at least one photo.',
  photosMax: 'You can add up to {max} photos.',
  categoryChoose: 'Choose a category.',
  subcategoryInvalid: 'Choose a valid subcategory.',
  subcategoryChoose: 'Choose a subcategory.',
  cityChoose: 'Select a city.',
  phoneInvalid: 'Enter a valid phone number.',
} as const;

export type SellErrorId = keyof typeof SELL_ERROR_TEMPLATES;

/** The English text of a message, with its {values} filled in. */
export function sellError(id: SellErrorId, params: Record<string, string | number> = {}): string {
  return SELL_ERROR_TEMPLATES[id].replace(/\{(\w+)\}/g, (_, key) => String(params[key]));
}

let errorMatchers: { id: SellErrorId; keys: string[]; re: RegExp }[] | undefined;

/** The inverse of sellError: which message is this, and with which values? undefined for text that is not one of ours. */
export function matchSellError(message: string): { id: SellErrorId; params: Record<string, string> } | undefined {
  if (!errorMatchers) {
    errorMatchers = (Object.keys(SELL_ERROR_TEMPLATES) as SellErrorId[])
      .map((id) => {
        const keys: string[] = [];
        const pattern = SELL_ERROR_TEMPLATES[id]
          .replace(/[.*+?^$()|[\]\\]/g, '\\$&')
          .replace(/\{(\w+)\}/g, (_, key) => {
            keys.push(key);
            return '(.+?)';
          });
        return { id, keys, re: new RegExp('^' + pattern + '$') };
      })
      // wording with no values is the most specific, so it is tried first
      .sort((a, b) => a.keys.length - b.keys.length);
  }
  for (const { id, keys, re } of errorMatchers) {
    const m = re.exec(message);
    if (m) return { id, params: Object.fromEntries(keys.map((k, i) => [k, m[i + 1]])) };
  }
  return undefined;
}

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

/** Hint for any category field: its own hint (e.g. "Optional — …") followed by the numeric range, when it has either. */
export function fieldHint(field: Pick<CategoryField, 'key' | 'label' | 'type'> & { hint?: string }): string | undefined {
  const rule = numericRuleFor(field);
  const parts = [field.hint, rule ? numericHint(rule) : undefined].filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
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
  if (!s) return { ok: false, error: sellError('numEmpty', { label }) };
  const shape = rule.kind === 'decimal' ? /^\d+(\.\d+)?$/ : /^\d+$/;
  if (s.length > 16 || !shape.test(s)) {
    return {
      ok: false,
      error:
        rule.kind === 'decimal' ? sellError('numDecimalShape', { label }) : sellError('numIntegerShape', { label }),
    };
  }
  if (rule.kind === 'decimal' && rule.decimals !== undefined) {
    const places = s.includes('.') ? s.split('.')[1].length : 0;
    if (places > rule.decimals) {
      return { ok: false, error: rule.decimals === 1 ? sellError('numDecimalsOne', { label }) : sellError('numDecimalsMany', { label, decimals: rule.decimals }) };
    }
  }
  const value = Number(s);
  if (!Number.isFinite(value)) return { ok: false, error: sellError('numInvalid', { label }) };
  if (value < rule.min || value > rule.max) {
    return {
      ok: false,
      error: rule.kind === 'percent' ? sellError('numPercent', { label, min: rule.min, max: rule.max }) : sellError('numRange', { label, min: fmt(rule.min), max: fmt(rule.max) }),
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
  if (!trimmed) return sellError('titleRequired');
  if (CONTROL_CHARS_SINGLE_LINE.test(trimmed)) return sellError('titleControl');
  if (trimmed.length > TITLE_MAX_LENGTH) return sellError('titleTooLong', { max: TITLE_MAX_LENGTH, count: trimmed.length });
  return undefined;
}

export function validateDescription(description: string): string | undefined {
  const trimmed = description.trim();
  if (trimmed.length < DESCRIPTION_MIN_LENGTH) return sellError('descriptionRequired');
  if (CONTROL_CHARS_MULTI_LINE.test(trimmed)) return sellError('descriptionControl');
  if (trimmed.length > DESCRIPTION_MAX_LENGTH) return sellError('descriptionTooLong', { max: fmt(DESCRIPTION_MAX_LENGTH), count: fmt(trimmed.length) });
  return undefined;
}

export function validateSellerNotes(notes: string): string | undefined {
  if (!notes.trim()) return undefined;
  if (CONTROL_CHARS_MULTI_LINE.test(notes)) return sellError('notesControl');
  if (notes.trim().length > SELLER_NOTES_MAX_LENGTH) return sellError('notesTooLong', { max: fmt(SELLER_NOTES_MAX_LENGTH), count: fmt(notes.trim().length) });
  return undefined;
}

// ───────────────────────────── Price ─────────────────────────────

// Prices are whole currency units everywhere in the product (formatAmount
// rounds, the inputs are digit-only), so a price is a positive integer. The
// raw string is validated as typed — nothing is stripped or coerced.
export function validatePrice(price: string): string | undefined {
  const s = price.trim();
  if (!s) return sellError('priceRequired');
  if (!/^\d+$/.test(s) || s.length > 15) return sellError('priceDigits');
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return sellError('priceZero');
  if (n > PRICE_MAX) return sellError('priceMax', { max: fmt(PRICE_MAX) });
  return undefined;
}

export function validateCurrency(currency: string | undefined, allowed?: readonly string[]): string | undefined {
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return sellError('currencyChoose');
  if (allowed && allowed.length > 0 && !allowed.includes(currency)) return sellError('currencyUnavailable');
  return undefined;
}

/** `allowed` is conditionOptionsFor(category, subcategory); an empty list means no condition is asked, so nothing is required. */
export function validateCondition(condition: string | undefined, allowed: readonly string[] = LISTING_CONDITIONS): string | undefined {
  if (allowed.length === 0) return undefined;
  if (!condition || !allowed.includes(condition)) return sellError('conditionChoose');
  return undefined;
}

// ───────────────────── Category-specific attributes ─────────────────────

const YEAR_MIN = 1900;

/** Validates one category field's value. Returns an error string, or undefined when the value is blank-and-optional or valid. */
export function validateAttribute(field: CategoryField, rawValue: string | undefined, now = new Date(), isNew = false): string | undefined {
  const value = (rawValue ?? '').trim();
  if (!value) return field.required || (isNew && field.requiredForNew) ? sellError('attrRequired', { label: field.label }) : undefined;

  if (field.type === 'select') {
    if (field.options && !field.options.includes(value) && !field.legacyOptions?.includes(value)) return sellError('attrChoice', { label: field.label });
    return undefined;
  }
  if (field.type === 'year') {
    const year = Number(value);
    if (!/^\d{4}$/.test(value) || year < YEAR_MIN || year > now.getFullYear() + 1) return sellError('attrYear', { label: field.label });
    return undefined;
  }
  const rule = numericRuleFor(field);
  if (rule) {
    const parsed = parseNumericInput(value, rule, field.label);
    return parsed.ok ? undefined : parsed.error;
  }
  if (CONTROL_CHARS_SINGLE_LINE.test(value)) return sellError('attrControl', { label: field.label });
  const maxLength = field.maxLength ?? ATTRIBUTE_TEXT_MAX_LENGTH;
  if (value.length > maxLength) return sellError('attrTooLong', { label: field.label, max: maxLength });
  return undefined;
}

/** Validates every field of the active category schema → { fieldKey: message } (empty object = valid). */
export function validateAttributes(fields: CategoryField[], attributes: Record<string, string>, now = new Date(), isNew = false): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of visibleFields(fields, attributes)) {
    const error = validateAttribute(field, attributes[field.key], now, isNew);
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
  for (const field of visibleFields(fields, attributes)) {
    const raw = attributes[field.key];
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (!value) continue;
    if (field.type === 'select' && field.options && !field.options.includes(value) && !field.legacyOptions?.includes(value)) continue;
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

  if (input.photoCount < 1) add('photos', 'photos', sellError('photosRequired'));
  if (input.photoCount > MAX_LISTING_PHOTOS) add('photos', 'photos', sellError('photosMax', { max: MAX_LISTING_PHOTOS }));

  const category = input.categories.find((c) => c.id === input.category);
  if (!category) add('category', 'category', sellError('categoryChoose'));
  else if (input.subcategory && !category.subcategories?.some((s) => s.name === input.subcategory)) add('category', 'subcategory', sellError('subcategoryInvalid'));
  else if (category.subcategories?.length && !input.subcategory) add('category', 'subcategory', sellError('subcategoryChoose'));

  add('details', 'title', validateTitle(input.title));
  add('details', 'description', validateDescription(input.description));
  add('details', 'condition', validateCondition(input.condition ?? undefined, conditionOptionsFor(input.category, input.subcategory)));
  add('details', 'sellerNotes', validateSellerNotes(input.sellerNotes ?? ''));
  add('details', 'phone', input.phoneError);
  for (const [key, message] of Object.entries(validateAttributes(input.fields, input.attributes, new Date(), true))) add('details', `attr:${key}`, message);

  if (!input.city) add('location', 'city', sellError('cityChoose'));
  add('price', 'price', validatePrice(input.price));
  add('price', 'currency', validateCurrency(input.currency, input.allowedCurrencies));

  const failing = new Set(Object.keys(errors).map((k) => stepOf[k]));
  return { ok: Object.keys(errors).length === 0, errors, firstInvalidStep: STEP_ORDER.find((s) => failing.has(s)) };
}
