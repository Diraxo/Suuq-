'use client';

// Web port of components/PriceDropModal.tsx on mobile: same suggested-90%
// starting value, same validation (numeric, positive, strictly lower than
// the current price), same explicit-confirm-required behavior — a single
// click on the trigger button never mutates the price by itself.
import { useEffect, useState } from 'react';
import { TrendingDown } from '@/lib/icons';
import { Button } from './Button';
import { formatBirr } from '@/lib/currency';

const SUGGESTED_DROP_RATIO = 0.9;

type Props = {
  open: boolean;
  currentPrice: number;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (newPrice: number) => void;
};

export function PriceDropModal({ open, currentPrice, loading, onCancel, onConfirm }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (open) {
      setValue(String(Math.max(1, Math.round(currentPrice * SUGGESTED_DROP_RATIO))));
      setError(undefined);
    }
  }, [open, currentPrice]);

  if (!open) return null;

  const handleConfirm = () => {
    const newPrice = Number(value.replace(/[^0-9.]/g, ''));
    if (!value.trim() || Number.isNaN(newPrice) || newPrice <= 0) {
      setError('Enter a valid price.');
      return;
    }
    if (newPrice >= currentPrice) {
      setError('New price must be lower than the current price.');
      return;
    }
    onConfirm(newPrice);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={loading ? undefined : onCancel}
      role="presentation"
    >
      <div className="w-full max-w-[340px] rounded-lg bg-surface p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto flex h-[52px] w-[52px] items-center justify-center rounded-full bg-background">
          <TrendingDown size={24} className="text-primary" />
        </div>
        <h2 className="mt-3 text-center text-lg font-bold text-textPrimary">Drop the price</h2>
        <p className="mt-1 text-center text-sm text-textSecondary">Current price: {formatBirr(currentPrice)}</p>

        <div className="mt-4">
          <label htmlFor="price-drop-input" className="mb-1 block text-sm font-medium text-textPrimary">
            New price
          </label>
          <input
            id="price-drop-input"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(undefined);
            }}
            inputMode="numeric"
            disabled={loading}
            className="w-full rounded-md border border-border bg-inputBackground px-4 py-3 text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {error && <p className="mt-1 text-xs text-error">{error}</p>}
        </div>

        <div className="mt-5 flex gap-2">
          <Button variant="outline" fullWidth disabled={loading} onClick={onCancel}>
            Cancel
          </Button>
          <Button fullWidth loading={loading} disabled={loading} onClick={handleConfirm}>
            Confirm
          </Button>
        </div>
      </div>
    </div>
  );
}
