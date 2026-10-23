'use client';

import { useState } from 'react';
import type { CategoryField } from '@/lib/categoryFields';
import { ATTRIBUTE_TEXT_MAX_LENGTH, numericRuleFor, validateAttribute, yearOptions } from '@/lib/sellRules';
import { fieldHintText, fieldLabelText, fieldPlaceholderText, localizeSellError, numericHintText, optionText } from '@/lib/sellText';
import { useSellT } from '@/lib/sellI18n';

export const sellFieldId = (key: string) => `sell-field-${key}`;

/** Moves keyboard focus to a field (text input, or the first option button of a selector) by its sellFieldId. */
export function focusSellField(key: string) {
  const el = document.getElementById(sellFieldId(key));
  if (!el) return;
  (el.matches('input, textarea, select, button') ? el : el.querySelector<HTMLElement>('button, input'))?.focus();
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

const INPUT =
  'w-full rounded-md border bg-inputBackground px-4 py-3 text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary';
const pill = (selected: boolean) => `rounded-pill px-3 py-1.5 text-sm ${selected ? 'bg-primary text-primaryText' : 'bg-surface text-textSecondary shadow-sm'}`;

// Next year down to 1950: new model years go on sale before January, and nothing is pre-selected.
const YEARS = yearOptions();

// Web counterpart of components/DynamicField.tsx on mobile: renders one
// category field (lib/categoryFields.ts, the same schema file the mobile app
// ships) as the right control — free text, a selector, or a year — using the
// shared rules in lib/sellRules.ts for the numeric keypad hint, the range hint
// and validation. inputMode only chooses the on-screen keyboard; the value is
// always validated as a string, so pasted/typed junk is caught either way.
export function SellField({
  field,
  value,
  onChange,
  submitted,
  isNew = false,
}: {
  field: CategoryField;
  value: string;
  onChange: (value: string) => void;
  /** True once the seller pressed Continue — shows errors for fields they never touched. */
  submitted: boolean;
  /** True while a NEW listing is being created: fields that are only required for new listings (requiredForNew) show as required. */
  isNew?: boolean;
}) {
  const t = useSellT();
  const [touched, setTouched] = useState(false);
  const id = sellFieldId(field.key);
  const labelText = fieldLabelText(t, field);
  const required = !!field.required || (isNew && !!field.requiredForNew);
  const maxLength = field.maxLength ?? ATTRIBUTE_TEXT_MAX_LENGTH;
  const error = submitted || touched ? localizeSellError(t, validateAttribute(field, value, new Date(), isNew)) : undefined;
  const rule = numericRuleFor(field);
  const hint = [fieldHintText(t, field), rule ? numericHintText(t, rule) : undefined].filter(Boolean).join(' ') || undefined;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const label = (
    <label htmlFor={id} className="mb-1 block text-sm font-medium text-textPrimary">
      {labelText}
      {required && <span aria-hidden="true"> *</span>}
      {required && <span className="sr-only"> {t('post.webSell.requiredSr')}</span>}
    </label>
  );
  const feedback = (
    <>
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-error">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-textMuted">
          {hint}
        </p>
      ) : null}
    </>
  );

  if (field.type === 'select' || field.type === 'year') {
    const options = field.type === 'year' ? YEARS : field.options ?? [];
    return (
      <div>
        <p id={`${id}-label`} className="mb-1 block text-sm font-medium text-textPrimary">
          {labelText}
          {required && <span aria-hidden="true"> *</span>}
          {required && <span className="sr-only"> {t('post.webSell.requiredSr')}</span>}
        </p>
        <div id={id} role="group" aria-labelledby={`${id}-label`} aria-describedby={describedBy} className="flex flex-wrap gap-2">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              aria-pressed={value === opt}
              onClick={() => {
                onChange(value === opt && !required ? '' : opt);
                setTouched(true);
              }}
              className={pill(value === opt)}
            >
              {field.type === 'year' ? opt : optionText(t, opt)}
            </button>
          ))}
        </div>
        {feedback}
      </div>
    );
  }

  return (
    <div>
      {label}
      <input
        id={id}
        // type=text on purpose: <input type="number"> accepts "e", "+", "-" and
        // silently reports '' for invalid text, which would hide bad input.
        type="text"
        inputMode={rule ? (rule.kind === 'decimal' ? 'decimal' : 'numeric') : undefined}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        placeholder={fieldPlaceholderText(t, field)}
        aria-invalid={!!error}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        className={`${INPUT} ${error ? 'border-error' : 'border-border'}`}
      />
      {!rule && value.length > maxLength * 0.8 && (
        <p className={`mt-1 text-right text-xs ${value.trim().length > maxLength ? 'text-error' : 'text-textMuted'}`}>
          {value.trim().length} / {maxLength}
        </p>
      )}
      {feedback}
    </div>
  );
}
