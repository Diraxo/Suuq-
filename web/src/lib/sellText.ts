// Translated text for the Sell form's data-driven parts (title examples, field
// labels / hints / examples, option labels). The schemas in data/categoryFields.ts
// hold English text — the stored values and the web form use it as-is — and the
// active language is looked up here in the normal locale files (post.titleExamples,
// post.fieldLabels, post.fieldHints, post.fieldOptions, post.examples), falling
// back to the English text when a language has no entry. Pure and React-free so
// it can be tested with a stub translate function. Shared verbatim with the
// website (web/src/lib/sellText.ts), which supplies its own translate function.

import { DEFAULT_TITLE_EXAMPLE, getTitleExample, titleExampleKey, type CategoryField } from './categoryFields';
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
