'use client';

// Web port of components/DiscountModal.tsx on mobile: percent and new price fill each other in, 3/7/14/30 days, an
// optional short note, and "End discount" while one is running. The database enforces the limits (migration 0080).
import { useEffect, useMemo, useState } from 'react';
import { Tag } from '@/lib/icons';
import { Button } from './Button';
import { formatBirr } from '@/lib/currency';
import { useT } from '@/lib/i18n';
import type { Listing } from '@/lib/types';
import {
  DISCOUNT_DAYS,
  DISCOUNT_MAX_DAYS,
  DISCOUNT_NOTE_MAX_LENGTH,
  activeDiscount,
  discountEndsAtFor,
  discountEndsText,
  formatDiscountInstant,
  parseCustomDays,
  percentFromPrice,
  priceFromPercent,
  validateDiscountInput,
  type DiscountDuration,
} from '@/lib/discount';

type Props = {
  open: boolean;
  listing: Listing | null;
  loading: boolean;
  /** Already translated explanation of why the last attempt failed. */
  error?: string;
  onCancel: () => void;
  /** `replace` is true when the seller edits a running discount. */
  onStart: (newPrice: number, days: DiscountDuration, note: string, replace?: boolean) => void;
  onEnd: () => void;
};

// Only used for the greyed example in the empty boxes; the boxes themselves start empty.
const EXAMPLE_PERCENT = 10;
const DAY_MS = 86_400_000;
const digits = (s: string) => s.replace(/[^0-9]/g, '');
const percentText = (p: number) => String(Math.round(p * 10) / 10);
const inputClass = 'w-full rounded-md border border-border bg-inputBackground px-4 py-3 text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary';

export function DiscountModal({ open, listing, loading, error, onCancel, onStart, onEnd }: Props) {
  const t = useT();
  const running = useMemo(() => (listing ? activeDiscount(listing) : null), [listing]);
  // Editing a running discount is measured against the ORIGINAL price (the shown price is already reduced).
  const original = running?.originalPrice ?? listing?.price ?? 0;
  const [editing, setEditing] = useState(false);
  const [percent, setPercent] = useState('');
  const [price, setPrice] = useState('');
  // A preset (3/7/14/30), 'custom' (the days box) or 'forever' (until the seller ends it).
  const [choice, setChoice] = useState<number | 'custom' | 'forever'>(7);
  const [customDays, setCustomDays] = useState('');
  const [note, setNote] = useState('');
  const [localError, setLocalError] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    setEditing(false);
    setPercent('');
    setPrice('');
    setChoice(7);
    setCustomDays('');
    setNote('');
    setLocalError(undefined);
  }, [open, original]);

  if (!open || !listing) return null;

  const beginEdit = () => {
    if (!running) return;
    setPercent(String(running.percent));
    setPrice(String(listing.price));
    setChoice(running.permanent ? 'forever' : 'custom');
    setCustomDays(running.endsAt != null ? String(Math.min(DISCOUNT_MAX_DAYS, Math.max(1, Math.ceil((running.endsAt - Date.now()) / DAY_MS)))) : '');
    setNote(running.note ?? '');
    setLocalError(undefined);
    setEditing(true);
  };

  const onPercentChange = (value: string) => {
    const d = digits(value);
    setPercent(d);
    setLocalError(undefined);
    const p = Number(d);
    setPrice(d && p > 0 && p < 100 ? String(priceFromPercent(original, p)) : '');
  };
  const onPriceChange = (value: string) => {
    const d = digits(value);
    setPrice(d);
    setLocalError(undefined);
    const n = Number(d);
    setPercent(d && n > 0 ? percentText(percentFromPrice(original, n)) : '');
  };

  const newPrice = Number(price);
  const examplePrice = String(priceFromPercent(original, EXAMPLE_PERCENT));
  const preview = price && newPrice > 0 && newPrice < original
    ? t('discount.preview', { percent: percentText(percentFromPrice(original, newPrice)), amount: formatBirr(original - newPrice, listing.currency) })
    : undefined;

  // NaN (an empty or invalid custom box) is refused by validateDiscountInput as a duration error.
  const duration: DiscountDuration = choice === 'forever' ? 'forever' : choice === 'custom' ? (parseCustomDays(customDays) ?? Number.NaN) : choice;
  const endLine = duration === 'forever'
    ? t('discount.foreverNote')
    : Number.isFinite(duration)
      ? t('discount.willEnd', { date: formatDiscountInstant(discountEndsAtFor(duration), typeof document !== 'undefined' ? document.documentElement.lang : undefined) })
      : undefined;

  const handleStart = () => {
    const problem = validateDiscountInput({ original, price: newPrice, days: duration, note });
    if (problem || !price) {
      setLocalError(t(`discount.errors.${!price ? 'enterDiscount' : problem}`, { max: DISCOUNT_NOTE_MAX_LENGTH }));
      return;
    }
    onStart(newPrice, duration, note.trim(), editing);
  };

  const endsText = running ? discountEndsText(running, t) : undefined;
  const shownError = localError ?? error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={loading ? undefined : onCancel} role="presentation">
      <div
        className="max-h-[90vh] w-full max-w-[380px] overflow-y-auto rounded-lg bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={running && !editing ? t('discount.runningTitle') : editing ? t('discount.editTitle') : t('discount.title')}
      >
        <div className="mx-auto flex h-[52px] w-[52px] items-center justify-center rounded-full bg-background">
          <Tag size={24} className="text-primary" />
        </div>

        {running && !editing ? (
          <>
            <h2 className="mt-3 text-center text-lg font-bold text-textPrimary">{t('discount.runningTitle')}</h2>
            <p className="mt-2 text-center text-sm text-textPrimary">
              {t('discount.runningSummary', {
                percent: running.percent,
                original: formatBirr(running.originalPrice, listing.currency),
                price: formatBirr(listing.price, listing.currency),
              })}
            </p>
            {endsText && <p className="mt-1 text-center text-sm text-textSecondary">{endsText}</p>}
            {running.note && <p className="mt-1 text-center text-sm text-textSecondary">{running.note}</p>}
            {shownError && <p role="alert" className="mt-3 text-center text-xs text-error">{shownError}</p>}
            <Button fullWidth disabled={loading} onClick={beginEdit} className="mt-5">{t('discount.edit')}</Button>
            <div className="mt-2 flex gap-2">
              <Button variant="outline" fullWidth disabled={loading} onClick={onCancel}>{t('common.close')}</Button>
              <Button variant="outline" fullWidth loading={loading} disabled={loading} onClick={onEnd}>{t('discount.end')}</Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="mt-3 text-center text-lg font-bold text-textPrimary">{editing ? t('discount.editTitle') : t('discount.title')}</h2>
            <p className="mt-1 text-center text-sm text-textSecondary">{t('discount.currentPrice', { price: formatBirr(original, listing.currency) })}</p>

            <div className="mt-4 grid grid-cols-[1fr_1.4fr] gap-3">
              <div>
                <label htmlFor="discount-percent" className="mb-1 block text-sm font-medium text-textPrimary">{t('discount.percentLabel')}</label>
                <input id="discount-percent" placeholder={t('discount.percentPlaceholder')} value={percent} onChange={(e) => onPercentChange(e.target.value)} inputMode="numeric" disabled={loading} className={inputClass} />
              </div>
              <div>
                <label htmlFor="discount-price" className="mb-1 block text-sm font-medium text-textPrimary">{t('discount.newPriceLabel')}</label>
                <input id="discount-price" placeholder={t('discount.newPricePlaceholder', { price: examplePrice })} value={price} onChange={(e) => onPriceChange(e.target.value)} inputMode="numeric" disabled={loading} className={inputClass} />
              </div>
            </div>
            {preview && (
              <p className="mt-2 flex items-center gap-1.5 rounded-md bg-green-600/10 px-3 py-2 text-xs font-bold text-green-700 dark:bg-emerald-400/10 dark:text-emerald-400">
                {preview}
              </p>
            )}

            <p className="mt-4 text-sm text-textSecondary">{t('discount.durationLabel')}</p>
            <select
              aria-label={t('discount.durationLabel')}
              value={choice === 'custom' ? '' : String(choice)}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                setChoice(v === 'forever' ? 'forever' : Number(v));
                setCustomDays('');
                setLocalError(undefined);
              }}
              disabled={loading}
              className={inputClass + ' mt-2'}
            >
              {choice === 'custom' && <option value="">{t('discount.chooseDuration')}</option>}
              {DISCOUNT_DAYS.map((d) => (
                <option key={d} value={String(d)}>{t('discount.days', { count: d })}</option>
              ))}
              <option value="forever">{t('discount.forever')}</option>
            </select>
            <label htmlFor="discount-days" className="mb-1 mt-3 block text-sm font-medium text-textPrimary">{t('discount.customDaysLabel')}</label>
            <input
              id="discount-days"
              value={customDays}
              onChange={(e) => { const d = digits(e.target.value).slice(0, 3); setCustomDays(d); setChoice(d ? 'custom' : 7); setLocalError(undefined); }}
              inputMode="numeric"
              placeholder={t('discount.customDaysPlaceholder', { max: DISCOUNT_MAX_DAYS })}
              disabled={loading}
              className={inputClass}
            />
            {endLine && <p className="mt-1 text-xs text-textSecondary">{endLine}</p>}

            <label htmlFor="discount-note" className="mb-1 mt-4 block text-sm font-medium text-textPrimary">{t('discount.noteLabel')}</label>
            <input
              id="discount-note"
              value={note}
              onChange={(e) => { setNote(e.target.value.replace(/[\r\n]+/g, ' ')); setLocalError(undefined); }}
              placeholder={t('discount.notePlaceholder')}
              maxLength={DISCOUNT_NOTE_MAX_LENGTH}
              disabled={loading}
              className={inputClass}
            />
            <p className="mt-1 text-right text-xs text-textMuted">{note.length}/{DISCOUNT_NOTE_MAX_LENGTH}</p>
            {shownError && <p role="alert" className="mt-2 text-xs text-error">{shownError}</p>}

            <div className="mt-5 flex gap-2">
              <Button variant="outline" fullWidth disabled={loading} onClick={editing ? () => { setEditing(false); setLocalError(undefined); } : onCancel}>{t('common.cancel')}</Button>
              <Button fullWidth loading={loading} disabled={loading} onClick={handleStart}>{editing ? t('discount.save') : t('discount.start')}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
