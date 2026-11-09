import { formatBirr } from './currency';

/**
 * The price line for staff screens. A stored 0 is never a price: it is how a "Contact for price" service is saved (migration 0085),
 * and some staff reads (the listing list, report snapshots) do not carry the listing's attributes, so a zero is described rather than shown as "0 Birr".
 */
export function adminPriceText(price: number | string | null | undefined, currency?: string | null): string {
  const n = Number(price);
  if (price === null || price === undefined || price === '' || !Number.isFinite(n)) return 'No price';
  return n === 0 ? 'Contact for price (no amount)' : formatBirr(n, currency);
}
