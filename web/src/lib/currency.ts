// Mirrors lib/currency.ts from the mobile app: every rendered amount is
// shown in Birr regardless of the underlying stored currency code.
export function formatAmount(amount: number): string {
  return Math.round(amount).toLocaleString('en-US');
}

export function formatBirr(amount: number): string {
  return `${formatAmount(amount)} Birr`;
}
