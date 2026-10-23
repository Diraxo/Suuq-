// Prices are shown in the currency the seller chose for the listing — the code
// stored on Listing.currency — with the currency written after the number:
// "1,200 Birr", "350 USD", "20,000 SOS". Which currencies a seller may pick
// comes from the location directory (see lib/locationTree.ts effectiveFor).
export function formatAmount(amount: number): string {
  return Math.round(amount).toLocaleString('en-US');
}

const LABELS: Record<string, string> = { ETB: 'Birr', BIRR: 'Birr', BR: 'Birr' };

/** Short label shown after an amount. Birr keeps its familiar name; other currencies show their code. */
export function currencyLabel(currency: string | undefined | null): string {
  const code = (currency || 'ETB').toUpperCase();
  return LABELS[code] ?? code;
}

export function formatMoney(amount: number, currency: string | undefined | null): string {
  return `${formatAmount(amount)} ${currencyLabel(currency)}`;
}

/** @deprecated use formatMoney — kept so older call sites without a currency still render as Birr. */
export function formatBirr(amount: number, currency: string | undefined | null = 'ETB'): string {
  return formatMoney(amount, currency);
}
