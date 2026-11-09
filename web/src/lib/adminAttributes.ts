// The answers of a listing as a moderator reads them: the form's own labels ("Available days", not "availableDays"), values in full,
// and — unlike the public page — anything stored that the form no longer asks (older listings, price mode and unit), so nothing a
// moderator may need to see is hidden. Pure, so it is tested in node.

import { attributeRows, type Translate } from './sellText';

export type AdminAttributeRow = { key: string; label: string; value: string };

/** "availableDays" → "Available days". */
export const humanizeKey = (key: string): string => {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

export function adminAttributeRows(t: Translate, category: string | undefined, subcategory: string | undefined, attributes: Record<string, string> | null | undefined): AdminAttributeRow[] {
  if (!attributes) return [];
  const rows: AdminAttributeRow[] = attributeRows(t, category, subcategory, attributes);
  const covered = new Set([...rows.map((r) => r.key), 'availableTo']); // the working-hours row already holds both ends
  for (const [key, raw] of Object.entries(attributes)) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value && !covered.has(key)) rows.push({ key, label: humanizeKey(key), value });
  }
  return rows;
}
