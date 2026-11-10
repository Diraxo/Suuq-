// The Services category: its trades, the questions each one asks, how it is priced and when it is available.
// Pure TypeScript (no React, no DOM) so the app, the website and the node tests run exactly the same rules.
// web/src/lib/serviceConfig.ts is a verbatim copy; tests/sellParity.test.ts fails if the two drift apart.
//
// Everything a provider answers is stored in the listing's existing `attributes` map as text, so none of it needs a
// database change — with ONE exception: "Contact for price" has no price to store, and the database requires price > 0
// (migration 0049). That mode is fully built but switched off by CONTACT_PRICE_ENABLED until the owner approves and applies
// supabase/proposed/0085_service_contact_price.sql.

import type { CategoryField } from './categoryFields';
import { CONTACT_PRICE_LOCAL_OVERRIDE } from './contactPriceFlag';

/** Shipped value: false. Turn on for everyone only after the owner approves the release (0085-0087 must be live). While false the pricing-mode question is not asked and every service has a real price.
 *  A development build may switch it on locally against a NON-production database only: see contactPriceFlag.ts and docs/CONTACT_PRICE_LOCAL_TEST.md. */
export const CONTACT_PRICE_ENABLED: boolean = CONTACT_PRICE_LOCAL_OVERRIDE;

export const PROVIDER_TYPES = ['Individual', 'Company'] as const;
export const PRICE_MODE_SET = 'Set a price';
export const PRICE_MODE_CONTACT = 'Contact for price';
export const PRICE_MODES = [PRICE_MODE_SET, PRICE_MODE_CONTACT];

export const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
/** Every half hour of the day, 24-hour clock. */
export const SERVICE_TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

export const WORK_FOR = ['Residential', 'Commercial', 'Industrial'];
export const YES_NO = ['Yes', 'No'];

// Where the work happens. Remote and delivery are only offered to trades where they can be true.
const AT_MY_PLACE = 'At my place';
const I_TRAVEL = 'I travel to customers';
const REMOTE = 'Remote / online';
const DELIVERY = 'I deliver';
const PLACE_ONSITE = [AT_MY_PLACE, I_TRAVEL];
const PLACE_REMOTE = [AT_MY_PLACE, I_TRAVEL, REMOTE];

/** Every price unit a service can use. The stored value is this English text, like every other option. */
export const SERVICE_PRICE_UNITS = [
  'Per service',
  'Per hour',
  'Per day',
  'Per visit',
  'Per item',
  'Per trip',
  'Per session',
  'Per video',
  'Per project',
  'Per package',
  'Per month',
  'Per delivery',
  'Per event',
];

export type ServiceDef = {
  /** What the provider can specialise in; several may be ticked. */
  specialties: string[];
  /** Residential / commercial / industrial customers. */
  workFor?: boolean;
  workPlace: string[];
  /** Only the units that make sense for this trade. */
  units: string[];
  emergency?: boolean;
  sameDay?: boolean;
  booking?: boolean;
  extra?: CategoryField[];
};

const FREQUENCY: CategoryField = { key: 'serviceFrequency', label: 'Service frequency', type: 'multi', options: ['One-time', 'Weekly', 'Every two weeks', 'Monthly', 'Regular contract'], section: 'service' };

/** The trades, in the order they are offered. The first 13 are the original subcategories (names unchanged); the rest are additions. */
export const SERVICE_DEFS: Record<string, ServiceDef> = {
  Electrician: {
    specialties: ['Wiring', 'Installation', 'Repair & fault finding', 'Lighting', 'Solar / electrical work', 'Other electrical work'],
    workFor: true,
    workPlace: PLACE_ONSITE,
    units: ['Per service', 'Per hour', 'Per day', 'Per visit', 'Per project'],
    emergency: true,
  },
  Plumber: {
    specialties: ['Leak repair', 'Pipes', 'Water pumps', 'Water tanks', 'Drainage', 'Installation', 'Maintenance', 'Other plumbing work'],
    workFor: true,
    workPlace: PLACE_ONSITE,
    units: ['Per service', 'Per hour', 'Per day', 'Per visit', 'Per project'],
    emergency: true,
  },
  Painter: {
    specialties: ['Interior painting', 'Exterior painting', 'Decorative finishes', 'Other painting work'],
    workFor: true,
    workPlace: [I_TRAVEL],
    units: ['Per project', 'Per day', 'Per hour', 'Per service'],
  },
  Cleaning: {
    specialties: ['House cleaning', 'Office cleaning', 'Deep cleaning', 'Laundry', 'Household assistance', 'After-construction cleaning', 'Other cleaning'],
    workFor: true,
    workPlace: [I_TRAVEL],
    units: ['Per service', 'Per hour', 'Per day', 'Per visit', 'Per month'],
    emergency: true,
    sameDay: true,
    extra: [FREQUENCY],
  },
  Internet: {
    specialties: ['Wi-Fi setup', 'Network cabling', 'Internet connection', 'Troubleshooting'],
    workFor: true,
    workPlace: PLACE_REMOTE,
    units: ['Per service', 'Per hour', 'Per visit', 'Per project', 'Per month'],
  },
  Transport: {
    specialties: ['Taxi', 'Pickup / truck hire', 'Minibus', 'Motorcycle ride', 'Bajaj ride', 'Intercity transport', 'Other transport'],
    workPlace: [I_TRAVEL],
    units: ['Per trip', 'Per hour', 'Per day', 'Per service'],
    sameDay: true,
    booking: true,
    extra: [
      { key: 'vehicleType', label: 'Vehicle type', type: 'select', options: ['Car', 'Minibus', 'Pickup', 'Truck', 'Motorcycle', 'Bajaj', 'Other'], section: 'service' },
      { key: 'serviceCapacity', label: 'Passenger or load capacity', type: 'text', maxLength: 60, section: 'service' },
      { key: 'routes', label: 'Routes you serve', type: 'text', maxLength: 150, section: 'service' },
    ],
  },
  Mechanic: {
    specialties: ['Car mechanic', 'Motorcycle mechanic', 'Bajaj mechanic', 'Truck / heavy vehicle', 'Auto electrician', 'Body work & painting', 'Tyres'],
    workPlace: PLACE_ONSITE,
    units: ['Per service', 'Per hour', 'Per day', 'Per visit', 'Per project'],
    emergency: true,
  },
  IT: {
    specialties: ['Computer repair', 'Website development', 'Mobile app development', 'Software development', 'Networking', 'IT support & troubleshooting', 'Other IT work'],
    workPlace: PLACE_REMOTE,
    units: ['Per project', 'Per hour', 'Per session', 'Per service', 'Per month'],
  },
  Tutor: {
    specialties: ['School subjects', 'Languages', 'University subjects', 'Computer skills', 'Vocational training', 'Exam preparation'],
    workPlace: PLACE_REMOTE,
    units: ['Per hour', 'Per session', 'Per month', 'Per package'],
    booking: true,
    extra: [{ key: 'subjects', label: 'Subjects or skills taught', type: 'text', maxLength: 150, section: 'service' }],
  },
  Salon: {
    specialties: ['Hair', 'Barber', 'Makeup', 'Nails', 'Henna', 'Skin care', 'Massage & spa', 'Other personal care'],
    workPlace: PLACE_ONSITE,
    units: ['Per service', 'Per session', 'Per package', 'Per hour'],
    booking: true,
  },
  'Solar Installation': {
    specialties: ['Solar panels', 'Inverters & batteries', 'Maintenance', 'Solar water pumping'],
    workFor: true,
    workPlace: [I_TRAVEL],
    units: ['Per project', 'Per day', 'Per visit', 'Per service'],
  },
  'Generator Repair': {
    specialties: ['Installation', 'Repair', 'Maintenance', 'Servicing'],
    workFor: true,
    workPlace: PLACE_ONSITE,
    units: ['Per service', 'Per hour', 'Per day', 'Per visit', 'Per project'],
    emergency: true,
    extra: [
      { key: 'generatorType', label: 'Generator type', type: 'multi', options: ['Diesel', 'Petrol', 'Gas'], section: 'service' },
      { key: 'supportedCapacity', label: 'Supported capacity', type: 'text', maxLength: 60, section: 'service' },
    ],
  },
  Photography: {
    specialties: ['Portraits', 'Weddings', 'Events', 'Products', 'Real estate', 'Other photography'],
    workPlace: [AT_MY_PLACE, I_TRAVEL],
    units: ['Per session', 'Per event', 'Per hour', 'Per package'],
    booking: true,
    extra: [{ key: 'shootingSetting', label: 'Shooting setting', type: 'multi', options: ['Indoor', 'Outdoor', 'Studio'], section: 'service' }],
  },
  // ── additions ──
  'Appliance Repair': {
    specialties: ['Refrigerator', 'Freezer', 'Washing machine', 'Air conditioner', 'TV', 'Cooker & microwave', 'Other appliances'],
    workPlace: PLACE_ONSITE,
    units: ['Per service', 'Per visit', 'Per hour', 'Per item'],
    emergency: true,
  },
  'Construction & Maintenance': {
    specialties: ['Building', 'Masonry', 'Fabrication & welding', 'Carpentry', 'Tiling', 'Roofing', 'General maintenance', 'Other construction work'],
    workFor: true,
    workPlace: [I_TRAVEL],
    units: ['Per project', 'Per day', 'Per hour', 'Per service'],
    emergency: true,
  },
  'Graphic Design': {
    specialties: ['Logo & branding', 'Posters & print', 'Social media graphics', 'UI design', 'Other design'],
    workPlace: PLACE_REMOTE,
    units: ['Per project', 'Per item', 'Per package', 'Per hour'],
  },
  'Video Production': {
    specialties: ['Video editing', 'Short-form & social media', 'Wedding videos', 'Promotional videos', 'Event filming', 'Other video work'],
    workPlace: PLACE_REMOTE,
    units: ['Per video', 'Per project', 'Per package', 'Per hour'],
    booking: true,
  },
  'Delivery & Courier': {
    specialties: ['Parcels & documents', 'Food delivery', 'Goods delivery', 'Errands'],
    workPlace: [DELIVERY],
    units: ['Per delivery', 'Per trip', 'Per hour', 'Per day'],
    sameDay: true,
    extra: [
      { key: 'deliveryVehicle', label: 'Delivery vehicle', type: 'select', options: ['On foot', 'Bicycle', 'Motorcycle', 'Car', 'Van', 'Truck'], section: 'service' },
      { key: 'deliveryAreas', label: 'Pickup and delivery areas', type: 'text', maxLength: 150, section: 'service' },
      { key: 'deliveryTime', label: 'Estimated delivery time', type: 'text', maxLength: 60, section: 'service' },
    ],
  },
  'Moving & Logistics': {
    specialties: ['House moving', 'Office moving', 'Freight & cargo', 'Loading & unloading', 'Storage'],
    workPlace: [I_TRAVEL],
    units: ['Per trip', 'Per day', 'Per hour', 'Per project'],
    sameDay: true,
    booking: true,
    extra: [
      { key: 'vehicleType', label: 'Vehicle type', type: 'select', options: ['Pickup', 'Van', 'Truck', 'Other'], section: 'service' },
      { key: 'serviceCapacity', label: 'Passenger or load capacity', type: 'text', maxLength: 60, section: 'service' },
    ],
  },
  'Events & Catering': {
    specialties: ['Catering', 'Event planning', 'DJ & sound', 'Entertainment', 'Decoration', 'MC / host', 'Other events'],
    workPlace: [AT_MY_PLACE, I_TRAVEL],
    units: ['Per event', 'Per hour', 'Per package', 'Per day'],
    booking: true,
  },
  'Business Services': {
    specialties: ['Accounting', 'Legal', 'Translation', 'Consulting', 'Printing & copying', 'Business registration', 'Other business services'],
    workPlace: PLACE_REMOTE,
    units: ['Per service', 'Per hour', 'Per project', 'Per month', 'Per session'],
    booking: true,
  },
  'Other Services': {
    specialties: ['Other service'],
    workPlace: PLACE_REMOTE,
    units: ['Per service', 'Per hour', 'Per day', 'Per visit', 'Per item', 'Per project', 'Per package'],
  },
};

/** Subcategory names of the Services category, in display order. */
export const SERVICE_SUBCATEGORIES = Object.keys(SERVICE_DEFS);

const sel = (key: string, label: string, options: string[], extra: Partial<CategoryField> = {}): CategoryField => ({ key, label, type: 'select', options, ...extra });
const when = (key: string, equals: string[]) => ({ key, equals });

/** The pricing questions, asked on the price step next to the amount. */
function pricingFields(def: ServiceDef, contactPrice: boolean): CategoryField[] {
  const fields: CategoryField[] = [];
  if (contactPrice) fields.push(sel('priceMode', 'How do you charge?', PRICE_MODES, { control: 'radio', step: 'price', section: 'pricing', requiredForNew: true }));
  const unit = sel('priceUnit', 'Price is charged', def.units, { step: 'price', section: 'pricing', requiredForNew: true });
  // '' = the pricing mode was never chosen (or the question is off), which means a normal price.
  fields.push(contactPrice ? { ...unit, showIf: when('priceMode', ['', PRICE_MODE_SET]) } : unit);
  return fields;
}

/** The whole question list for one trade (or the general list when the subcategory is unknown). */
export function buildServiceFields(subcategory?: string, contactPrice: boolean = CONTACT_PRICE_ENABLED): CategoryField[] {
  const def = (subcategory && SERVICE_DEFS[subcategory]) || SERVICE_DEFS['Other Services'];
  const fields: CategoryField[] = [
    sel('providerType', 'Provider type', [...PROVIDER_TYPES], { requiredForNew: true, section: 'provider' }),
    { key: 'providerName', label: 'Your name or company name', type: 'text', maxLength: 80, section: 'provider', hint: 'Optional — leave blank to use the name on your profile.' },
    { key: 'experience', label: 'Years of Experience', type: 'text', section: 'provider' },
    { key: 'specialty', label: 'What you offer', type: 'multi', options: def.specialties, requiredForNew: true, section: 'service' },
  ];
  if (def.workFor) fields.push({ key: 'workFor', label: 'Work for', type: 'multi', options: WORK_FOR, section: 'service' });
  fields.push(...(def.extra ?? []).map((f) => ({ ...f })));
  fields.push(
    { key: 'serviceArea', label: 'Service area', type: 'text', maxLength: 150, section: 'service', hint: 'Districts, towns or neighborhoods you cover.' },
    { key: 'workPlace', label: 'Where you work', type: 'multi', options: def.workPlace, section: 'service' }
  );
  // Availability: descriptive only — there is no booking system behind it.
  fields.push(
    { key: 'availableDays', label: 'Available days', type: 'multi', options: WEEK_DAYS, section: 'availability' },
    sel('availableFrom', 'Available from', SERVICE_TIMES, { control: 'dropdown', section: 'availability' }),
    sel('availableTo', 'Available until', SERVICE_TIMES, { control: 'dropdown', section: 'availability' }),
    // Kept from the first version of this form: the key and options stay valid for listings saved with it.
    sel('availability', 'Availability', ['Full-time', 'Part-time', 'On-call'], { section: 'availability' })
  );
  if (def.emergency) fields.push(sel('emergency', 'Emergency or 24-hour service', YES_NO, { section: 'availability' }));
  if (def.sameDay) fields.push(sel('sameDay', 'Same-day service', YES_NO, { section: 'availability' }));
  if (def.booking) fields.push(sel('booking', 'Booking', ['Appointment required', 'Walk-ins welcome', 'Call first'], { section: 'availability' }));
  fields.push(...pricingFields(def, contactPrice));
  return fields;
}

// ─────────────────────────── Multiple choices in one text value ───────────────────────────

const MULTI_SEPARATOR = ', ';

/** The ticked choices of a `multi` field. Option names never contain a comma (a test guarantees it), so a comma is always a separator. */
export function parseMulti(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v, i, all) => v && all.indexOf(v) === i);
}

export function joinMulti(values: readonly string[]): string {
  return values.join(MULTI_SEPARATOR);
}

/** Ticks or unticks one choice, keeping the options in their listed order. */
export function toggleMulti(value: string | undefined, option: string, allOptions: readonly string[]): string {
  const current = parseMulti(value);
  const next = current.includes(option) ? current.filter((v) => v !== option) : [...current, option];
  return joinMulti([...allOptions.filter((o) => next.includes(o)), ...next.filter((o) => !allOptions.includes(o))]);
}

// ───────────────────────────────────── Pricing ─────────────────────────────────────

/** Digits only: what is stored and validated. Typing separators ("10,000" or "10 000") is allowed; letters and symbols are left in so validation can reject them. */
export function amountInputToDigits(text: string): string {
  return text.replace(/[,\s]/g, '');
}

/** The amount as shown while typing: "100000" → "100,000". Anything that is not plain digits is shown untouched so the error points at what was typed. */
export function formatAmountInput(digits: string): string {
  if (!/^\d+$/.test(digits)) return digits;
  return digits.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** A number as shown while typing, decimals allowed: "2588665.5" → "2,588,665.5". Anything that is not a plain number is shown untouched. */
export function formatNumberInput(text: string): string {
  const m = /^(\d+)(\.\d*)?$/.exec(text);
  if (!m) return text;
  return formatAmountInput(m[1]) + (m[2] ?? '');
}

/** Whether the provider chose "Contact for price" (and the question is on). */
export function isContactPrice(category: string | null | undefined, attributes: Record<string, string | undefined> | null | undefined): boolean {
  return category === 'services' && attributes?.priceMode === PRICE_MODE_CONTACT;
}

/**
 * Whether a STORED listing is a contact-for-price service: a services listing whose mode says so AND whose stored price is exactly 0
 * (the only shape the database accepts, migration 0085). Display, offers, discounts and market statistics all ask this, never
 * isContactPrice alone: a stale or forged priceMode on a listing with a real price is ignored, so a priced listing can never be
 * shown as "Contact for price", and a 0 price never reads as "0 Birr" or as a free item. Independent of CONTACT_PRICE_ENABLED on
 * purpose: turning the question off must not turn existing contact-price listings back into zero-price ones.
 */
export function isContactPriceListing(l: { category?: string | null; price?: number | string | null; attributes?: Record<string, string | undefined> | null } | null | undefined): boolean {
  if (!l || !isContactPrice(l.category, l.attributes)) return false;
  const raw = l.price;
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return false;
  return Number(raw) === 0;
}

/** A price that can be averaged, compared or ranked: positive, finite, and not a contact-price listing. */
export function hasComparablePrice(l: { category?: string | null; price?: number | string | null; attributes?: Record<string, string | undefined> | null } | null | undefined): boolean {
  if (!l || isContactPriceListing(l)) return false;
  const n = Number(l.price);
  return Number.isFinite(n) && n > 0;
}

/** The price to store: a contact-for-price listing carries 0 and the mode in its attributes (see the proposed migration); everything else its typed amount. */
export function publishedPrice(price: string, contact: boolean): number {
  return contact ? 0 : Number(price);
}

// ─────────────────────────────────── Availability ───────────────────────────────────

export const TIME_ORDER_ERROR = 'Available until must be later than Available from.';

/** Cross-field checks for the availability window → { fieldKey: message }. Only runs for forms that ask the question. */
export function serviceCrossFieldErrors(fieldKeys: readonly string[], attributes: Record<string, string | undefined>, requiredMessage: (label: string) => string): Record<string, string> {
  if (!fieldKeys.includes('availableFrom') || !fieldKeys.includes('availableTo')) return {};
  const from = (attributes.availableFrom ?? '').trim();
  const to = (attributes.availableTo ?? '').trim();
  if (from && !to) return { availableTo: requiredMessage('Available until') };
  if (to && !from) return { availableFrom: requiredMessage('Available from') };
  if (from && to && SERVICE_TIMES.indexOf(to) <= SERVICE_TIMES.indexOf(from)) return { availableTo: TIME_ORDER_ERROR };
  return {};
}

/** Both ends of the window as one line ("08:00 – 17:00"), or undefined when either is missing. */
export function hoursText(attributes: Record<string, string | undefined> | null | undefined): string | undefined {
  const from = attributes?.availableFrom?.trim();
  const to = attributes?.availableTo?.trim();
  return from && to ? `${from} – ${to}` : undefined;
}
