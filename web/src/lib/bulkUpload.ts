// CSV row validation for Bulk Upload on the website — the same rules as lib/bulkUpload.ts on mobile (same columns, same
// title / description / price rules from sellRules, same category / condition / city lookups, same "at least one http(s) photo
// link"), with the messages in plain English. Never a looser rule set for imported listings than for Create Listing.
import { categories } from './categories';
import { LocIndex, effectiveFor, findByName } from './locationTree';
import { conditionApplies, validateDescription, validatePrice, validateTitle } from './sellRules';
import type { Listing } from './types';

export const BULK_UPLOAD_COLUMNS = ['title', 'description', 'price', 'category', 'condition', 'city', 'image_urls'];

/** Upload size guard: a CSV for a dealer's inventory is a few hundred KB; anything bigger is not a CSV we want to parse in the browser. */
export const BULK_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const BULK_MAX_ROWS = 500;

export type BulkRow = {
  title: string;
  description: string;
  price: number;
  categoryId: string;
  categoryName: string;
  condition: Listing['condition'];
  city: string;
  region: string;
  currency: string;
  images: string[];
  errors: string[];
};

const CONDITION_MAP: Record<string, Listing['condition']> = {
  new: 'new',
  'like-new': 'like-new',
  'like new': 'like-new',
  used: 'used',
  'for-parts': 'for-parts',
  'for parts': 'for-parts',
  'needs repair': 'for-parts',
};

export function parseBulkRow(raw: Record<string, string>, index: LocIndex): BulkRow {
  const errors: string[] = [];
  const blank = '(blank)';

  const title = (raw.title ?? '').trim();
  const titleError = validateTitle(title);
  if (titleError) errors.push(titleError);

  const description = (raw.description ?? '').trim();
  const descriptionError = validateDescription(description);
  if (descriptionError) errors.push(descriptionError);

  const priceDigits = (raw.price ?? '').replace(/[^0-9.]/g, '');
  const priceError = validatePrice(priceDigits);
  if (priceError) errors.push(priceError);
  const price = Number(priceDigits) || 0;

  const categoryInput = (raw.category ?? '').trim();
  const matchedCategory = categories.find((c) => c.name.toLowerCase() === categoryInput.toLowerCase() || c.id.toLowerCase() === categoryInput.toLowerCase());
  if (!matchedCategory) errors.push(`Unknown category "${categoryInput || blank}".`);

  const conditionInput = (raw.condition ?? '').trim().toLowerCase();
  const condition = CONDITION_MAP[conditionInput];
  // The CSV has no subcategory column, so the category's own rule decides; a blank or unknown condition is fine where none applies.
  if (!condition && conditionApplies(matchedCategory?.id ?? categoryInput)) errors.push(`Unknown condition "${raw.condition || blank}". Use new, like-new, used, or for-parts.`);

  const cityInput = (raw.city ?? '').trim();
  const cityNode = index.nodes.find((c) => c.kind === 'city' && c.name.toLowerCase() === cityInput.toLowerCase());
  if (!cityNode) errors.push(`Unknown city "${cityInput || blank}".`);
  const place = cityNode ? effectiveFor(index, cityNode.id) : null;

  const images = (raw.image_urls ?? '')
    .split('|')
    .map((u) => u.trim())
    .filter(Boolean);
  const validImages = images.filter((u) => /^https?:\/\//i.test(u));
  if (validImages.length === 0) errors.push('At least one image URL is required (separate multiple with "|").');

  return {
    title,
    description,
    price,
    categoryId: matchedCategory?.id ?? '',
    categoryName: matchedCategory?.name ?? categoryInput,
    condition: condition ?? 'used',
    city: cityNode?.name ?? cityInput,
    region: place?.regionLabel ?? '',
    currency: place?.defaultCurrency ?? 'USD',
    images: validImages,
    errors,
  };
}

/** Looks a place up by name the same way the rest of the site does (used when publishing queued rows). */
export function placeFor(index: LocIndex, city: string): { region: string; currency: string } {
  const node = findByName(index, city);
  const e = node ? effectiveFor(index, node.id) : null;
  return { region: e?.regionLabel ?? '', currency: e?.defaultCurrency ?? 'USD' };
}

export function bulkUploadTemplate(): string {
  const header = BULK_UPLOAD_COLUMNS.join(',');
  const example =
    '"Toyota Corolla 2015",' +
    '"Clean title, well maintained, new tires.",' +
    '8500,Vehicles,used,Hargeisa,' +
    '"https://example.com/photo1.jpg|https://example.com/photo2.jpg"';
  return `${header}\n${example}\n`;
}
