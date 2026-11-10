import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMyListingsStore } from '@/store/myListings';
import { formatBirr } from '@/lib/currency';
import { showSnackbar } from '@/lib/snackbar';
import { discountServerError, formatDiscountInstant, type DiscountDuration } from '@/lib/discount';
import { isContactPriceListing } from '@/data/serviceConfig';
import type { Listing } from '@/types';

/**
 * The seller's discount flow, shared by My Listings and the listing's own action bar: which listing the DiscountModal is
 * about, the in-flight flag, and the database's real reason when it refuses. Success is announced only after the server
 * confirmed (the store patches the listing from the server's answer), and a refusal keeps the modal open with the seller's input.
 */
export function useSellerDiscount() {
  const { t, i18n } = useTranslation();
  const setDiscount = useMyListingsStore((s) => s.setDiscount);
  const endDiscount = useMyListingsStore((s) => s.endDiscount);
  const [target, setTarget] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const close = () => {
    setTarget(null);
    setError(undefined);
  };

  const start = (newPrice: number, days: DiscountDuration, note: string, replace = false) => {
    if (!target) return;
    setLoading(true);
    setError(undefined);
    setDiscount(target.id, newPrice, days, note, replace)
      .then((r) => {
        if (r.ok) {
          showSnackbar(
            r.endsAt != null
              ? t('discount.appliedUntil', { date: formatDiscountInstant(r.endsAt, i18n.language) })
              : t('discount.appliedForever'),
            { tone: 'success' }
          );
          close();
        } else {
          const e = discountServerError(r.message, i18n.language);
          setError(t(`discount.errors.${e.key}`, e.params));
        }
      })
      .finally(() => setLoading(false));
  };

  const end = () => {
    if (!target) return;
    const original = target.discountOriginalPrice ?? target.price;
    setLoading(true);
    setError(undefined);
    endDiscount(target.id)
      .then((ok) => {
        if (ok) {
          showSnackbar(t('discount.ended', { price: formatBirr(original, target.currency) }), { tone: 'success' });
          close();
        } else {
          setError(t('discount.errors.endFailed'));
        }
      })
      .finally(() => setLoading(false));
  };

  // A contact-for-price service has no price to discount (the database refuses it too, migration 0086).
  const open = (listing: Listing | null) => setTarget(listing && isContactPriceListing(listing) ? null : listing);

  return { target, open, close, loading, error, start, end };
}
