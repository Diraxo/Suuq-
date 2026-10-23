import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CategoryField } from '@/data/categoryFields';
import { keyboardFor, validateAttribute, ATTRIBUTE_TEXT_MAX_LENGTH, numericRuleFor } from '@/data/sellRules';
import { fieldHintText, fieldLabelText, fieldPlaceholderText, localizeSellError, numericHintText, optionText } from '@/lib/sellText';
import { Input } from './Input';
import { ChoiceChips } from './ChoiceChips';
import { YearPicker } from './YearPicker';

type Props = {
  field: CategoryField;
  value: string;
  onChange: (value: string) => void;
  /** Error to show now (the screen passes one once the seller has pressed Continue). */
  error?: string;
  onFocus?: () => void;
  /** True while a NEW listing is being created: fields that are only required for new listings (requiredForNew) show as required. */
  isNew?: boolean;
};

const check = (done: boolean) => (done ? '✓ ' : '');

// Renders one category-specific field (data/categoryFields.ts) as the right
// control for its type — text input, choice chips, or a year picker — so
// details.tsx doesn't have to branch on field.type itself. Labels, option
// names, hints and examples come from the locale files (lib/sellText.ts); the
// value stored on the listing is always the English option text.
//
// Numeric fields (data/sellRules.ts NUMERIC_RULES) get the matching native
// keypad, an explicit range hint, and are validated as typed on blur. The
// keypad is only an aid — the same rule runs again on Continue and on
// Publish, so a pasted value can't slip through.
export function DynamicField({ field, value, onChange, error, onFocus, isNew }: Props) {
  const { t } = useTranslation();
  const [touched, setTouched] = useState(false);
  const label = fieldLabelText(t, field);
  // Messages come from the shared rules in English; show them in the seller's language.
  const shownError = localizeSellError(t, error);
  const required = !!field.required || (!!isNew && !!field.requiredForNew);

  if (field.type === 'year') {
    return <YearPicker label={label} required={required} value={value || undefined} onChange={onChange} error={shownError} />;
  }
  if (field.type === 'select') {
    return (
      <ChoiceChips
        label={label}
        required={required}
        options={field.options ?? []}
        optionLabel={(opt) => optionText(t, opt)}
        value={value || undefined}
        onChange={onChange}
        error={shownError}
      />
    );
  }
  const rule = numericRuleFor(field);
  const numeric = !!rule;
  const maxLength = field.maxLength ?? ATTRIBUTE_TEXT_MAX_LENGTH;
  const blurError = touched ? validateAttribute(field, value, new Date(), isNew) : undefined;
  const hint = [fieldHintText(t, field), rule ? numericHintText(t, rule) : undefined].filter(Boolean).join(' ') || undefined;
  return (
    <Input
      label={`${check(!!value && !(error ?? blurError))}${required ? `${label} *` : label}`}
      placeholder={fieldPlaceholderText(t, field)}
      value={value}
      onChangeText={onChange}
      error={shownError ?? localizeSellError(t, blurError)}
      hint={hint}
      onFocus={onFocus}
      onBlur={() => setTouched(true)}
      keyboardType={keyboardFor(field)}
      autoCorrect={numeric ? false : undefined}
      counter={!numeric && value.length > maxLength * 0.8 ? { current: value.trim().length, max: maxLength } : undefined}
    />
  );
}
