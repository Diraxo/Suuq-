'use client';

import { useState } from 'react';
import type { CategoryField } from '@/lib/categoryFields';
import { ATTRIBUTE_TEXT_MAX_LENGTH, numericRuleFor, validateAttribute, yearOptions } from '@/lib/sellRules';
import { fieldHintText, fieldLabelText, fieldPlaceholderText, localizeSellError, numericHintText, optionText } from '@/lib/sellText';
import { useSellT } from '@/lib/sellI18n';
import { catalogBrands, catalogModels } from '@/lib/brandCatalog';
import { CatalogPicker } from './CatalogPicker';
import { parseMulti, toggleMulti } from '@/lib/serviceConfig';

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
  brandValue,
}: {
  field: CategoryField;
  value: string;
  onChange: (value: string) => void;
  /** True once the seller pressed Continue — shows errors for fields they never touched. */
  submitted: boolean;
  /** True while a NEW listing is being created: fields that are only required for new listings (requiredForNew) show as required. */
  isNew?: boolean;
  /** Current value of the category's Brand field — a Model picker lists that brand's models. */
  brandValue?: string;
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

  if (field.catalog) {
    // Brand: pick from the catalog (or type one). Model: that brand's models; a brand with no model list keeps the plain text field below.
    const { set, role } = field.catalog;
    const list = role === 'brand' ? catalogBrands(set) : catalogModels(set, brandValue);
    const locked = role === 'model' && !list && !brandValue?.trim();
    if (list || locked) {
      return (
        <div>
          <CatalogPicker id={id} label={labelText} required={required} common={list?.common ?? []} all={list?.all ?? []} value={value} onChange={onChange} disabledHint={locked ? t('post.catalog.brandFirst') : undefined} describedBy={describedBy} />
          {feedback}
        </div>
      );
    }
  }

  if (field.type === 'multi') {
    // Several choices can be ticked; the answer is stored as one text value ("Monday, Tuesday").
    const chosen = parseMulti(value);
    return (
      <div>
        <p id={`${id}-label`} className="mb-1 block text-sm font-medium text-textPrimary">
          {labelText}
          {required && <span aria-hidden="true"> *</span>}
          {required && <span className="sr-only"> {t('post.webSell.requiredSr')}</span>}
        </p>
        <div id={id} role="group" aria-labelledby={`${id}-label`} aria-describedby={describedBy} className="flex flex-wrap gap-2">
          {(field.options ?? []).map((opt) => (
            <button
              key={opt}
              type="button"
              aria-pressed={chosen.includes(opt)}
              onClick={() => {
                onChange(toggleMulti(value, opt, field.options ?? []));
                setTouched(true);
              }}
              className={pill(chosen.includes(opt))}
            >
              {optionText(t, opt)}
            </button>
          ))}
        </div>
        {feedback}
      </div>
    );
  }

  if (field.type === 'select' && field.control === 'dropdown') {
    // A long list (times of day) is a dropdown, not dozens of buttons.
    return (
      <div>
        {label}
        <select
          id={id}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setTouched(true);
          }}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={`${INPUT} ${error ? 'border-error' : 'border-border'}`}
        >
          <option value="">{t('post.catalog.choose')}</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {optionText(t, opt)}
            </option>
          ))}
        </select>
        {feedback}
      </div>
    );
  }

  if (field.type === 'select' && field.control === 'radio') {
    return (
      <div>
        <p id={`${id}-label`} className="mb-1 block text-sm font-medium text-textPrimary">
          {labelText}
          {required && <span aria-hidden="true"> *</span>}
          {required && <span className="sr-only"> {t('post.webSell.requiredSr')}</span>}
        </p>
        <div id={id} role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={describedBy} className="flex flex-col gap-2">
          {(field.options ?? []).map((opt) => (
            <label key={opt} className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm ${value === opt ? 'border-primary bg-primary/5 text-textPrimary' : 'border-border text-textSecondary'}`}>
              <input
                type="radio"
                name={id}
                checked={value === opt}
                onChange={() => {
                  onChange(opt);
                  setTouched(true);
                }}
              />
              {optionText(t, opt)}
            </label>
          ))}
        </div>
        {feedback}
      </div>
    );
  }

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
