import { CategoryField, NUMERIC_FIELD_KEYS } from '@/data/categoryFields';
import { Input } from './Input';
import { ChoiceChips } from './ChoiceChips';
import { YearPicker } from './YearPicker';

type Props = {
  field: CategoryField;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  onFocus?: () => void;
};

const check = (done: boolean) => (done ? '✓ ' : '');

// Renders one category-specific field (data/categoryFields.ts) as the right
// control for its type — text input, choice chips, or a year picker — so
// details.tsx doesn't have to branch on field.type itself.
export function DynamicField({ field, value, onChange, error, onFocus }: Props) {
  if (field.type === 'year') {
    return <YearPicker label={field.label} required={field.required} value={value || undefined} onChange={onChange} error={error} />;
  }
  if (field.type === 'select') {
    return <ChoiceChips label={field.label} required={field.required} options={field.options ?? []} value={value || undefined} onChange={onChange} error={error} />;
  }
  return (
    <Input
      label={`${check(!!value)}${field.required ? `${field.label} *` : field.label}`}
      placeholder={field.label}
      value={value}
      onChangeText={onChange}
      error={error}
      onFocus={onFocus}
      keyboardType={NUMERIC_FIELD_KEYS.has(field.key) ? 'numeric' : undefined}
    />
  );
}
