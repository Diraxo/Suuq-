// What the detail page of a Services listing shows, grouped for reading: overview, highlights, availability, provider, more.
// Pure TypeScript (no React, no DOM) so the app, the website and the node tests build exactly the same sections from the
// listing's existing `attributes` map — nothing here needs a database change.
// web/src/lib/serviceDetail.ts is a verbatim copy; tests/sellParity.test.ts fails if the two drift apart.

import { getCategoryFields, visibleFields } from './categoryFields';
import { fieldLabelText, optionText, type Translate } from './sellText';
import { hoursText, parseMulti } from './serviceConfig';

export type DetailRow = { key: string; label: string; value: string };

export type ServiceDetail = {
  /** From the stored providerType; undefined when the provider never said (older listings). */
  providerKind?: 'individual' | 'business';
  /** "Individual" / "Business" in the active language, for the small chip beside the category. */
  providerKindLabel?: string;
  /** What the provider offers (their ticked specialties), translated. */
  specialties: string[];
  /** Experience, service area, where they work and who they work for. */
  highlights: DetailRow[];
  /** Working days in week order, translated. */
  days: string[];
  /** "08:00 – 17:00", when both ends are set. */
  hours?: string;
  /** Full-time / emergency / same-day / booking lines. */
  availability: DetailRow[];
  /** The provider's public name, labelled for their type. Empty when none was given. */
  provider: DetailRow[];
  /** Every other answer the form asked, so nothing the provider wrote is lost. */
  more: DetailRow[];
};

/** The icon identifier (data/categories.ts) of a subcategory; the category's own icon, then a generic one, when it has none. */
export function subcategoryIcon(
  categories: readonly { id: string; icon: string; subcategories?: readonly { name: string; icon: string }[] }[],
  category: string | null | undefined,
  subcategory: string | null | undefined,
): string {
  const cat = categories.find((c) => c.id === category);
  return cat?.subcategories?.find((s) => s.name === subcategory)?.icon ?? cat?.icon ?? 'construct-outline';
}

/** Days to show before "+N more": the first `limit`, how many are hidden. A short list is shown whole. */
export function summarizeDays(days: readonly string[], limit = 3): { shown: string[]; hidden: number } {
  if (days.length <= limit + 1) return { shown: [...days], hidden: 0 }; // "+1 more" saves nothing
  return { shown: days.slice(0, limit), hidden: days.length - limit };
}

const HIGHLIGHT_KEYS = ['experience', 'serviceArea', 'workPlace', 'workFor'];
const AVAILABILITY_KEYS = ['availability', 'emergency', 'sameDay', 'booking'];
// Handled on their own (identity, price line, chips, hours) so they never repeat as a plain row.
const HANDLED_KEYS = ['providerType', 'providerName', 'specialty', 'availableDays', 'availableFrom', 'availableTo', 'priceMode', 'priceUnit'];

// How the page names a few answers. The form asks them as questions ("Where you work"); a listing states them.
const DISPLAY_LABELS: Record<string, [string, string]> = {
  experience: ['listing.service.labels.experience', 'Experience'],
  workPlace: ['listing.service.labels.workPlace', 'Service location'],
  workFor: ['listing.service.labels.workFor', 'Customers'],
};

const WEEK_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "5" → "5 years" (the question is Years of Experience); free text such as "5 years" or "since 2015" is shown as written. */
function experienceText(t: Translate, raw: string): string {
  return /^\d{1,2}$/.test(raw) ? t('listing.service.years', { count: Number(raw), defaultValue: `${raw} years` }) : raw;
}

/** The sections of a service listing, or null when the listing is not a service. Empty answers are left out entirely. */
export function serviceDetail(t: Translate, category: string | null | undefined, subcategory: string | null | undefined, attributes: Record<string, string> | null | undefined): ServiceDetail | null {
  if (category !== 'services') return null;
  const attrs = attributes ?? {};
  const type = attrs.providerType?.trim();
  const providerKind = type === 'Individual' ? 'individual' : type === 'Company' ? 'business' : undefined;

  const detail: ServiceDetail = {
    providerKind,
    providerKindLabel: providerKind ? t(`listing.service.kind.${providerKind}`, { defaultValue: providerKind === 'business' ? 'Business' : 'Individual' }) : undefined,
    specialties: parseMulti(attrs.specialty).map((v) => optionText(t, v)),
    highlights: [],
    days: parseMulti(attrs.availableDays)
      .sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b))
      .map((v) => optionText(t, v)),
    hours: hoursText(attrs),
    availability: [],
    provider: [],
    more: [],
  };

  // Only the name the provider typed for the public page. The account's own name is never read here, and a provider type is
  // a chip, never a row — "Individual" is not anybody's name.
  const name = attrs.providerName?.trim();
  if (name) {
    detail.provider.push({
      key: 'providerName',
      label: providerKind === 'business' ? t('listing.service.businessName', { defaultValue: 'Business name' }) : t('listing.service.providerName', { defaultValue: 'Name' }),
      value: name,
    });
  }

  for (const f of visibleFields(getCategoryFields(category, subcategory ?? undefined), attrs)) {
    const raw = attrs[f.key]?.trim();
    if (!raw || HANDLED_KEYS.includes(f.key)) continue;
    const value = f.key === 'experience' ? experienceText(t, raw) : f.type === 'select' ? optionText(t, raw) : f.type === 'multi' ? parseMulti(raw).map((v) => optionText(t, v)).join(', ') : raw;
    const display = DISPLAY_LABELS[f.key];
    const row = { key: f.key, label: display ? t(display[0], { defaultValue: display[1] }) : fieldLabelText(t, f), value };
    (HIGHLIGHT_KEYS.includes(f.key) ? detail.highlights : AVAILABILITY_KEYS.includes(f.key) ? detail.availability : detail.more).push(row);
  }
  return detail;
}
