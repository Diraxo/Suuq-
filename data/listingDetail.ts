// What the detail page of an ordinary (non-service) listing shows: a short strip of key facts, then grouped sections.
// Pure TypeScript (no React, no DOM) so the app, the website and the node tests build exactly the same layout from the
// listing's existing `attributes` map — nothing here needs a database change. Services use data/serviceDetail.ts instead.
// web/src/lib/listingDetail.ts is a verbatim copy; tests/sellParity.test.ts fails if the two drift apart.

import { attributeRows, type Translate } from './sellText';
import { formatNumberInput } from './serviceConfig';
import type { DetailRow } from './serviceDetail';

export type DetailFact = DetailRow & { icon: string };
export type DetailSection = { id: string; title: string; rows: DetailRow[] };
export type ListingDetail = {
  /** The few things a buyer decides on, shown first as tiles (at most FACT_LIMIT). */
  facts: DetailFact[];
  /** Every other answer, grouped. Nothing is dropped and nothing is repeated. */
  sections: DetailSection[];
};

export const FACT_LIMIT = 4;

/** Key-fact tile icons (Ionicons names, mirrored in web/src/lib/icons.tsx). */
export const FACT_ICONS: Record<string, string> = {
  year: 'calendar-outline',
  mileage: 'speedometer-outline',
  transmission: 'cog-outline',
  fuel: 'flame-outline',
  engineCC: 'cog-outline',
  engineSize: 'cog-outline',
  seats: 'people-outline',
  payload: 'cube-outline',
  boatType: 'boat-outline',
  _condition: 'ribbon-outline',
  storage: 'server-outline',
  ram: 'hardware-chip-outline',
  processor: 'hardware-chip-outline',
  battery: 'battery-full-outline',
  screenSize: 'tv-outline',
  resolution: 'tv-outline',
  connectivity: 'wifi-outline',
  bedrooms: 'bed-outline',
  bathrooms: 'water-outline',
  size: 'resize-outline',
  furnished: 'home-outline',
  floor: 'layers-outline',
  rentalKind: 'key-outline',
  landType: 'leaf-outline',
  offer: 'pricetag-outline',
  color: 'color-palette-outline',
};
export const DEFAULT_FACT_ICON = 'information-circle-outline';

type Layout = { facts: string[]; sections: [id: string, keys: string[]][] };

const VEHICLES: Layout = {
  facts: ['year', 'mileage', 'transmission', 'fuel', 'engineCC', 'engineSize', 'seats', 'payload', 'boatType', '_condition'],
  sections: [
    ['vehicle', ['brand', 'model', 'year', 'color', 'seats', 'boatType', 'partType', 'compatibleBrand', 'compatibleModel', 'lengthMeters', 'material']],
    ['performance', ['mileage', 'transmission', 'fuel', 'engineSize', 'engineCC', 'drivetrain', 'payload', 'engineType']],
    ['papers', ['registration', 'importStatus']],
    ['rental', ['offer', 'rentPeriod']],
  ],
};

const DEVICES: Layout = {
  facts: ['_condition', 'storage', 'ram', 'battery', 'screenSize', 'processor', 'resolution', 'connectivity'],
  sections: [
    ['overview', ['brand', 'model', 'color', 'accessoryType', 'compatibleBrand', 'platform', 'cameraType', 'deviceType', 'printType']],
    ['specs', ['ram', 'storage', 'processor', 'screenSize', 'resolution', 'graphics', 'smartTv', 'hdmiPorts', 'battery', 'power', 'connectivity', 'network', 'sim', 'accessories']],
    ['warranty', ['warranty']],
  ],
};

const PROPERTY: Layout = {
  facts: ['bedrooms', 'bathrooms', 'size', 'furnished', 'floor', 'landType', 'rentalKind', 'offer'],
  sections: [
    ['property', ['rentalKind', 'offer', 'landType', 'size', 'floor', 'yearBuilt', 'ceilingHeight', 'loadingDock', 'pool', 'furnished']],
    ['rooms', ['bedrooms', 'bathrooms', 'bathroomType']],
    ['utilities', ['electricity', 'water', 'parking', 'utilitiesIncluded', 'roadAccess']],
    ['terms', ['rentPeriod', 'availability', 'leaseTerm']],
    ['ownership', ['titleDeed']],
    ['location', ['neighborhood', 'address', 'landmark']],
  ],
};

const LAYOUTS: Record<string, Layout> = { vehicles: VEHICLES, phones: DEVICES, electronics: DEVICES, property: PROPERTY };

const SECTION_TITLES: Record<string, string> = {
  vehicle: 'Vehicle',
  performance: 'Performance',
  papers: 'Registration & import',
  rental: 'Rental terms',
  overview: 'Overview',
  specs: 'Specifications',
  warranty: 'Warranty',
  property: 'Property',
  rooms: 'Rooms',
  utilities: 'Utilities & services',
  terms: 'Rent terms',
  ownership: 'Ownership',
  location: 'Location',
  details: 'Details',
  more: 'More details',
};

export const sectionTitle = (t: Translate, id: string): string => t(`listing.detail.sections.${id}`, { defaultValue: SECTION_TITLES[id] ?? SECTION_TITLES.more });

/** "Mileage (km)" + "85000" → "Mileage" + "85,000 km": a unit written in the label moves next to a plain number. Other values are untouched. */
function withUnit(row: DetailRow): DetailRow {
  const m = /^(.*?)\s*\(([^)]{1,12})\)$/.exec(row.label);
  if (!m || !m[1]) return row;
  const value = row.value.trim();
  return /^\d[\d,.\s]*$/.test(value) ? { ...row, label: m[1], value: `${formatNumberInput(value.replace(/[,\s]/g, ''))} ${m[2]}` } : row;
}

/** A size or quantity and its unit ("50" + "kg") read as one value; the separate unit row goes away. */
function foldUnit(rows: DetailRow[]): DetailRow[] {
  const unit = rows.find((r) => r.key === 'unit');
  const amount = rows.find((r) => r.key === 'size' || r.key === 'quantity');
  if (!unit || !amount) return rows;
  return rows.filter((r) => r.key !== 'unit').map((r) => (r === amount ? { ...r, value: `${r.value} ${unit.value}` } : r));
}

// The form asks a few of these as questions; a listing states them.
const DISPLAY_LABELS: Record<string, [string, string]> = {
  rentalKind: ['listing.detail.labels.rentalKind', 'Rental type'],
  offer: ['listing.detail.labels.offer', 'Listed for'],
};

/** Short enough to sit in a tile: a long free-text answer belongs in a section. */
const FITS_TILE = (v: string) => v.length <= 22;

/**
 * The layout of a listing page's details. `rows` are the translated category answers (attributeRows) in form order, `condition` the
 * listing's own condition when the category has one. Posted date, location and negotiability are not repeated: the header already shows them.
 */
export function listingDetail(t: Translate, category: string | undefined, subcategory: string | undefined, attributes: Record<string, string> | undefined, condition?: string | null): ListingDetail {
  let rows: DetailRow[] = foldUnit(attributeRows(t, category, subcategory, attributes))
    .map((r) => (DISPLAY_LABELS[r.key] ? { ...r, label: t(DISPLAY_LABELS[r.key][0], { defaultValue: DISPLAY_LABELS[r.key][1] }) } : r))
    .map(withUnit);
  const conditionRow = condition?.trim() ? { key: '_condition', label: t('listing.condition'), value: condition.trim() } : undefined;
  if (conditionRow) rows = [conditionRow, ...rows];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const layout = category ? LAYOUTS[category] : undefined;

  const facts: DetailFact[] = [];
  const used = new Set<string>();
  const factKeys = layout ? layout.facts : rows.map((r) => r.key); // no tailored layout: the form's first questions are its most important
  for (const key of factKeys) {
    const row = byKey.get(key);
    if (!row || facts.length >= FACT_LIMIT || !FITS_TILE(row.value)) continue;
    if (!layout && facts.length >= 3) break;
    facts.push({ ...row, icon: FACT_ICONS[key] ?? DEFAULT_FACT_ICON });
    used.add(key);
  }

  const sections: DetailSection[] = [];
  if (layout) {
    for (const [id, keys] of layout.sections) {
      const rowsHere = keys.filter((k) => !used.has(k) && byKey.has(k)).map((k) => byKey.get(k)!);
      rowsHere.forEach((r) => used.add(r.key));
      if (rowsHere.length) sections.push({ id, title: sectionTitle(t, id), rows: rowsHere });
    }
  }
  const rest = rows.filter((r) => !used.has(r.key));
  if (rest.length) sections.push({ id: layout ? 'more' : 'details', title: sectionTitle(t, layout ? 'more' : 'details'), rows: rest });
  return { facts, sections };
}
