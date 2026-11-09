// Translated text for the Sell form's data-driven parts (title examples, field
// labels / hints / examples, option labels). The schemas in data/categoryFields.ts
// hold English text — the stored values and the web form use it as-is — and the
// active language is looked up here in the normal locale files (post.titleExamples,
// post.fieldLabels, post.fieldHints, post.fieldOptions, post.examples), falling
// back to the English text when a language has no entry. Pure and React-free so
// it can be tested with a stub translate function. Shared verbatim with the
// website (web/src/lib/sellText.ts), which supplies its own translate function.

import { DEFAULT_TITLE_EXAMPLE, getCategoryFields, getTitleExample, titleExampleKey, visibleFields, type CategoryField } from './categoryFields';
import { hoursText, isContactPriceListing, parseMulti } from './serviceConfig';
import { matchSellError } from './sellRules';

export type Translate = (key: string, options?: Record<string, unknown>) => string;

/** i18next treats "." and ":" in a key as separators; locale keys built from English text drop them. */
export const textKey = (text: string): string => text.replace(/[.:]/g, '');

const lookup = (t: Translate, group: string, english: string): string => t(`post.${group}.${textKey(english)}`, { defaultValue: english });

/** The label for a category field in the active language. */
export const fieldLabelText = (t: Translate, field: Pick<CategoryField, 'label'>): string => lookup(t, 'fieldLabels', field.label);

/** The label of one option of a select field (the stored value stays the English option). */
export const optionText = (t: Translate, option: string): string => lookup(t, 'fieldOptions', option);

/** The field's own helper line ("Optional — …"), translated; undefined when it has none. */
export const fieldHintText = (t: Translate, field: Pick<CategoryField, 'hint'>): string | undefined => (field.hint ? lookup(t, 'fieldHints', field.hint) : undefined);

const wrapExample = (t: Translate, example: string) => t('post.details.exampleWrap', { example, defaultValue: `e.g. ${example}` });

/** Greyed-out example inside an empty text field: "e.g. Toyota". Falls back to the label when a field has no example. */
export function fieldPlaceholderText(t: Translate, field: Pick<CategoryField, 'label' | 'placeholder'>): string {
  return field.placeholder ? wrapExample(t, lookup(t, 'examples', field.placeholder)) : fieldLabelText(t, field);
}

/** The title field's example for the chosen category/subcategory, in the active language. */
export function titlePlaceholderText(t: Translate, category?: string, subcategory?: string): string {
  const key = titleExampleKey(category, subcategory);
  if (!key) return wrapExample(t, t('post.details.titleExampleDefault', { defaultValue: DEFAULT_TITLE_EXAMPLE }));
  return wrapExample(t, t(`post.titleExamples.${key}`, { defaultValue: getTitleExample(category, subcategory) }));
}

/** "Whole number from 0 to 2,000,000." in the active language — the range hint under a numeric field. */
export function numericHintText(t: Translate, rule: { kind: 'integer' | 'decimal' | 'percent'; min: number; max: number; decimals?: number }): string {
  const fmt = (n: number) => n.toLocaleString('en-US');
  const params = { min: fmt(rule.min), max: fmt(rule.max), decimals: rule.decimals };
  if (rule.kind === 'percent') return t('post.numericHint.percent', params);
  if (rule.kind === 'integer') return t('post.numericHint.integer', params);
  return rule.decimals ? t('post.numericHint.decimalPlaces', params) : t('post.numericHint.decimal', params);
}

/** A validation message from the shared rules ("Title is required.") in the active language; text that is not one of ours is returned unchanged. */
export function localizeSellError(t: Translate, message: string | undefined): string | undefined {
  if (!message) return message;
  const found = matchSellError(message);
  if (!found) return message;
  const params: Record<string, unknown> = { ...found.params };
  if (typeof params.label === 'string') params.label = lookup(t, 'fieldLabels', params.label);
  return t(`post.errors.${found.id}`, { ...params, defaultValue: message });
}

// ───────────────────────────── Services: headings, price unit, detail rows ─────────────────────────────

const SECTION_TITLES: Record<NonNullable<CategoryField['section']>, string> = {
  provider: 'About the provider',
  service: 'The service',
  availability: 'Availability',
  pricing: 'Pricing',
};

/** The heading above a group of fields (a field's `section`), in the active language. */
export const sectionText = (t: Translate, section: NonNullable<CategoryField['section']>): string => t(`post.sections.${section}`, { defaultValue: SECTION_TITLES[section] });

/** Fields in order, grouped by consecutive `section` — a field with no section joins the group before it. Used to put a heading above each group of a form. */
export function groupBySection<T extends Pick<CategoryField, 'section'>>(fields: T[]): { section?: NonNullable<CategoryField['section']>; fields: T[] }[] {
  const groups: { section?: NonNullable<CategoryField['section']>; fields: T[] }[] = [];
  for (const field of fields) {
    const last = groups[groups.length - 1];
    if (last && (!field.section || field.section === last.section)) last.fields.push(field);
    else groups.push({ section: field.section, fields: [field] });
  }
  return groups;
}

/** "Per hour" in the active language when the listing is a service charged per unit; undefined for everything else. */
export function priceUnitText(t: Translate, category: string | null | undefined, attributes: Record<string, string | undefined> | null | undefined): string | undefined {
  const unit = category === 'services' ? attributes?.priceUnit?.trim() : undefined;
  return unit ? optionText(t, unit) : undefined;
}

/** "Contact for price" in the active language. */
export const contactForPriceText = (t: Translate): string => t('post.serviceDisplay.contactForPrice', { defaultValue: 'Contact for price' });

/** The price line for a stored listing: "Contact for price" for a contact-price service, otherwise the amount through `format` (formatBirr). Never "0 Birr". */
export function listingPriceText(
  t: Translate,
  listing: { category?: string | null; price: number; currency?: string | null; attributes?: Record<string, string | undefined> | null },
  format: (amount: number, currency?: string | null) => string,
): string {
  return isContactPriceListing(listing) ? contactForPriceText(t) : format(listing.price, listing.currency);
}

export type AttributeRow = { key: string; label: string; value: string };

/**
 * The category-specific lines of a listing page ("Brand: Toyota", "Available days: Monday, Tuesday"): translated, multi-choice answers
 * listed, empty answers skipped. How a service is charged is shown beside the price instead, and the two ends of the working hours
 * share one line.
 */
export function attributeRows(t: Translate, category: string | undefined, subcategory: string | undefined, attributes: Record<string, string> | undefined): AttributeRow[] {
  const rows: AttributeRow[] = [];
  for (const f of visibleFields(getCategoryFields(category, subcategory), attributes ?? {})) {
    const raw = attributes?.[f.key]?.trim();
    if (!raw || f.key === 'priceMode' || f.key === 'priceUnit' || f.key === 'availableTo') continue;
    if (f.key === 'availableFrom') {
      const hours = hoursText(attributes);
      if (hours) rows.push({ key: f.key, label: t('post.serviceDisplay.hours', { defaultValue: 'Working hours' }), value: hours });
      continue;
    }
    const value = f.type === 'select' ? optionText(t, raw) : f.type === 'multi' ? parseMulti(raw).map((v) => optionText(t, v)).join(', ') : raw;
    rows.push({ key: f.key, label: fieldLabelText(t, f), value });
  }
  return rows;
}
