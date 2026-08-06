import { categories, cityCurrency, cityRegion, regions } from '@/data/categories';
import { validateTitle, validateDescription, validatePrice } from '@/data/validation';
import { Listing, Seller } from '@/types';

export const BULK_UPLOAD_COLUMNS = ['title', 'description', 'price', 'category', 'condition', 'city', 'image_urls'];

export type BulkRow = {
  title: string;
  description: string;
  price: number;
  categoryId: string;
  categoryName: string;
  condition: Listing['condition'];
  city: string;
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

/** Validates one CSV row against the same rules Create Listing enforces
 *  (data/validation.ts), plus lookups against the app's own category/city
 *  lists — never a separate, looser set of rules for imported listings. */
export function parseBulkRow(raw: Record<string, string>): BulkRow {
  const errors: string[] = [];

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
  const matchedCategory = categories.find(
    (c) => c.name.toLowerCase() === categoryInput.toLowerCase() || c.id.toLowerCase() === categoryInput.toLowerCase()
  );
  if (!matchedCategory) errors.push(`Unknown category "${categoryInput || '(blank)'}".`);

  const conditionInput = (raw.condition ?? '').trim().toLowerCase();
  const condition = CONDITION_MAP[conditionInput];
  if (!condition) errors.push(`Unknown condition "${raw.condition || '(blank)'}". Use new, like-new, used, or for-parts.`);

  const cityInput = (raw.city ?? '').trim();
  const matchedCity = regions.find((r) => r.toLowerCase() === cityInput.toLowerCase());
  if (!matchedCity) errors.push(`Unknown city "${cityInput || '(blank)'}".`);

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
    city: matchedCity ?? cityInput,
    images: validImages,
    errors,
  };
}

export function buildListingFromBulkRow(row: BulkRow, seller: Seller): Listing {
  return {
    id: `bulk-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: row.title,
    price: row.price,
    currency: cityCurrency[row.city] ?? 'USD',
    negotiable: false,
    condition: row.condition,
    category: row.categoryId,
    city: row.city,
    region: cityRegion[row.city] ?? '',
    images: row.images,
    description: row.description,
    postedAt: 'just now',
    createdAt: Date.now(),
    status: 'available',
    seller,
    views: 0,
    favoritesCount: 0,
  };
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
