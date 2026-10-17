import { useState } from 'react';
import { CategoryField } from '@/data/categoryFields';
import { fieldHint, keyboardFor, validateAttribute, ATTRIBUTE_TEXT_MAX_LENGTH, numericRuleFor } from '@/data/sellRules';
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
};

const check = (done: boolean) => (done ? '✓ ' : '');

// Renders one category-specific field (data/categoryFields.ts) as the right
// control for its type — text input, choice chips, or a year picker — so
// details.tsx doesn't have to branch on field.type itself.
//
// Numeric fields (data/sellRules.ts NUMERIC_RULES) get the matching native
// keypad, an explicit range hint, and are validated as typed on blur. The
// keypad is only an aid — the same rule runs again on Continue and on
// Publish, so a pasted value can't slip through.
export function DynamicField({ field, value, onChange, error, onFocus }: Props) {
  const [touched, setTouched] = useState(false);

  if (field.type === 'year') {
    return <YearPicker label={field.label} required={field.required} value={value || undefined} onChange={onChange} error={error} />;
  }
  if (field.type === 'select') {
    return <ChoiceChips label={field.label} required={field.required} options={field.options ?? []} value={value || undefined} onChange={onChange} error={error} />;
  }
  const numeric = !!numericRuleFor(field);
  const blurError = touched ? validateAttribute(field, value) : undefined;
  return (
    <Input
      label={`${check(!!value && !(error ?? blurError))}${field.required ? `${field.label} *` : field.label}`}
      placeholder={field.label}
      value={value}
      onChangeText={onChange}
      error={error ?? blurError}
      hint={fieldHint(field)}
      onFocus={onFocus}
      onBlur={() => setTouched(true)}
      keyboardType={keyboardFor(field)}
      autoCorrect={numeric ? false : undefined}
      counter={!numeric && value.length > ATTRIBUTE_TEXT_MAX_LENGTH * 0.8 ? { current: value.trim().length, max: ATTRIBUTE_TEXT_MAX_LENGTH } : undefined}
    />
  );
}
