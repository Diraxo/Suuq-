'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { formatBirr } from '@/lib/currency';
import { discountServerError, formatDiscountInstant, type DiscountDuration } from '@/lib/discount';
import { setListingDiscount, endListingDiscount } from '@/services/listings';
import { isContactPriceListing } from '@/lib/serviceConfig';
import type { Listing } from '@/lib/types';

const pageLocale = () => (typeof document !== 'undefined' ? document.documentElement.lang || undefined : undefined);

/**
 * The seller's discount flow, shared by My Listings and the listing's own action bar (mirrors hooks/useSellerDiscount.ts on
 * mobile). `notice` is the success line, set only after the server confirmed; a refusal keeps the modal open and shows the
 * database's real reason in `error`. `onChanged` reloads whatever the page shows so no old price stays on screen.
 */
export function useSellerDiscount(onChanged: () => void) {
  const t = useT();
  const [target, setTarget] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  const close = () => {
    setTarget(null);
    setError(undefined);
  };

  const start = async (newPrice: number, days: DiscountDuration, note: string, replace = false) => {
    if (!target || loading) return;
    setLoading(true);
    setError(undefined);
    const { error: failure, result } = await setListingDiscount(target.id, newPrice, days, note, replace);
    setLoading(false);
    if (failure || !result) {
      const e = discountServerError(failure, pageLocale());
      setError(t(`discount.errors.${e.key}`, e.params));
      return;
    }
    setNotice(result.endsAt != null ? t('discount.appliedUntil', { date: formatDiscountInstant(result.endsAt, pageLocale()) }) : t('discount.appliedForever'));
    close();
    onChanged();
  };

  const end = async () => {
    if (!target || loading) return;
    const original = target.discountOriginalPrice ?? target.price;
    const currency = target.currency;
    setLoading(true);
    setError(undefined);
    const { error: failure } = await endListingDiscount(target.id);
    setLoading(false);
    if (failure) {
      setError(t('discount.errors.endFailed'));
      return;
    }
    setNotice(t('discount.ended', { price: formatBirr(original, currency) }));
    close();
    onChanged();
  };

  // A contact-for-price service has no price to discount (the database refuses it too, migration 0086).
  const open = (listing: Listing | null) => setTarget(listing && isContactPriceListing(listing) ? null : listing);

  return { target, open, close, loading, error, start, end, notice, clearNotice: () => setNotice(undefined) };
}
