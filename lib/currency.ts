// Suuq+ only displays Ethiopian Birr — the underlying 'USD'/'ETB' currency
// code on Listing/Offer rows (see data/categories.ts cityCurrency) stays as
// stored data, but every rendered amount goes through here so the UI never
// shows "USD" or a "$" glyph.
export function formatAmount(amount: number): string {
  return Math.round(amount).toLocaleString('en-US');
}

export function formatBirr(amount: number): string {
  return `${formatAmount(amount)} Birr`;
}
