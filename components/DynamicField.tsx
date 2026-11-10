import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CategoryField } from '@/data/categoryFields';
import { keyboardFor, validateAttribute, ATTRIBUTE_TEXT_MAX_LENGTH, numericRuleFor } from '@/data/sellRules';
import { fieldHintText, fieldLabelText, fieldPlaceholderText, localizeSellError, numericHintText, optionText } from '@/lib/sellText';
import { Input } from './Input';
import { ChoiceChips } from './ChoiceChips';
import { YearPicker } from './YearPicker';
import { CatalogPicker } from './CatalogPicker';
import { MultiSelectField } from './MultiSelectField';
import { SelectField } from './SelectField';
import { RadioGroup } from './RadioGroup';
import { Text } from './Text';
import { useTheme } from '@/theme/ThemeContext';
import { parseMulti, joinMulti, amountInputToDigits, formatNumberInput } from '@/data/serviceConfig';
import { catalogBrands, catalogModels } from '@/data/brandCatalog';

type Props = {
  field: CategoryField;
  value: string;
  onChange: (value: string) => void;
  /** Error to show now (the screen passes one once the seller has pressed Continue). */
  error?: string;
  onFocus?: () => void;
  /** True while a NEW listing is being created: fields that are only required for new listings (requiredForNew) show as required. */
  isNew?: boolean;
  /** Current value of the category's Brand field — a Model picker lists that brand's models. */
  brandValue?: string;
};

const check = (done: boolean) => (done ? '✓ ' : '');

/** "08:00" → "8:00 AM", "17:30" → "5:30 PM" (the stored value stays 24-hour). */
const clockLabel = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

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
export function DynamicField({ field, value, onChange, error, onFocus, isNew, brandValue }: Props) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const [touched, setTouched] = useState(false);
  const label = fieldLabelText(t, field);
  // Messages come from the shared rules in English; show them in the seller's language.
  const shownError = localizeSellError(t, error);
  const required = !!field.required || (!!isNew && !!field.requiredForNew);

  if (field.type === 'year') {
    return <YearPicker label={label} required={required} value={value || undefined} onChange={onChange} error={shownError} />;
  }
  if (field.type === 'multi') {
    // Several choices can be ticked; the answer is stored as one text value ("Monday, Tuesday").
    const options = (field.options ?? []).map((o) => ({ value: o, label: optionText(t, o) }));
    return (
      <View>
        <MultiSelectField
          label={`${required ? `${label} *` : label}`}
          placeholder={t('post.catalog.choose')}
          options={options}
          value={parseMulti(value)}
          onChange={(list) => onChange(joinMulti(list))}
        />
        {shownError ? (
          <Text variant="caption" color="error" style={{ marginTop: spacing.xxs }}>
            {shownError}
          </Text>
        ) : null}
      </View>
    );
  }
  if (field.type === 'select' && field.control === 'dropdown') {
    // A long list (times of day): a dropdown sheet instead of dozens of chips. A second tap on the chosen value clears it.
    return (
      <View>
        <SelectField
          label={required ? `${label} *` : label}
          placeholder={t('post.catalog.choose')}
          options={(field.options ?? []).map((o) => ({ value: o, label: /^\d{2}:\d{2}$/.test(o) ? clockLabel(o) : optionText(t, o) }))}
          value={value || undefined}
          onChange={(v) => onChange(v === value && !required ? '' : v)}
        />
        {shownError ? (
          <Text variant="caption" color="error" style={{ marginTop: spacing.xxs }}>
            {shownError}
          </Text>
        ) : null}
      </View>
    );
  }
  if (field.type === 'select' && field.control === 'radio') {
    return (
      <RadioGroup
        label={required ? `${label} *` : label}
        options={(field.options ?? []).map((o) => ({ value: o, label: optionText(t, o) }))}
        value={value || undefined}
        onChange={onChange}
        error={shownError}
      />
    );
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
  if (field.catalog) {
    // Brand: pick from the catalog (or type one). Model: that brand's models; a brand with no model list keeps the plain text field below.
    const { set, role } = field.catalog;
    const brands = role === 'brand' ? catalogBrands(set) : undefined;
    const models = role === 'model' ? catalogModels(set, brandValue) : undefined;
    const list = brands ?? models;
    if (list) {
      return <CatalogPicker label={label} required={required} common={list.common} all={list.all} value={value} onChange={onChange} error={shownError} />;
    }
    if (role === 'model' && !brandValue?.trim()) {
      return <CatalogPicker label={label} required={required} common={[]} all={[]} value={value} onChange={onChange} error={shownError} disabledHint={t('post.catalog.brandFirst')} />;
    }
  }
  const rule = numericRuleFor(field);
  const numeric = !!rule;
  const grouped = !!rule && rule.kind !== 'percent';
  const maxLength = field.maxLength ?? ATTRIBUTE_TEXT_MAX_LENGTH;
  const blurError = touched ? validateAttribute(field, value, new Date(), isNew) : undefined;
  const hint = [fieldHintText(t, field), rule ? numericHintText(t, rule) : undefined].filter(Boolean).join(' ') || undefined;
  return (
    <Input
      label={`${check(!!value && !(error ?? blurError))}${required ? `${label} *` : label}`}
      placeholder={fieldPlaceholderText(t, field)}
      // Big numbers show thousands separators as they are typed; the stored value stays plain digits.
      value={grouped ? formatNumberInput(value) : value}
      onChangeText={grouped ? (v) => onChange(amountInputToDigits(v)) : onChange}
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
