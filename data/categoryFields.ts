import {
  COLORS,
  LAPTOP_SCREEN_SIZES,
  TV_SCREEN_SIZES,
  STORAGE_OPTIONS,
  RAM_OPTIONS,
  BEDROOMS,
  BATHROOMS,
  REGISTRATION_OPTIONS,
  AVAILABILITY_OPTIONS,
  YES_NO_NOT_SURE,
  RENT_PERIODS,
  STAY_PERIODS,
  PROPERTY_OFFERS,
  RENTAL_KINDS,
  PROPERTY_AVAILABILITY,
  LEASE_TERMS,
  PACKAGING_OPTIONS,
} from './fieldOptions';

export type CategoryField = {
  key: string;
  label: string;
  type: 'text' | 'select' | 'year';
  options?: string[];
  /** Values saved by older versions of this form: still accepted when editing, but no longer offered as choices. */
  legacyOptions?: string[];
  required?: boolean;
  /** Required when a NEW listing is created, optional when an existing listing is edited — so adding a question never blocks editing a listing that predates it. */
  requiredForNew?: boolean;
  /** English example shown greyed-out inside an empty text field (without the "e.g." prefix). Filled in from fieldExamples by getCategoryFields. */
  placeholder?: string;
  /** English helper line under the field, e.g. "Optional — leave blank if you are not sure." */
  hint?: string;
  /** Text fields only: longest accepted value (defaults to ATTRIBUTE_TEXT_MAX_LENGTH). */
  maxLength?: number;
  /** Only ask this when another field of the same category has one of these values (e.g. rent period only when the property is for rent). A hidden field is neither validated nor published. */
  showIf?: { key: string; equals: string[] };
};

// Questions every residential rental/sale form shares. Exact address and
// landmark are free text on purpose: many places in the region have no street
// names, so nothing here requires one (and no GPS is ever requested for it).
const ADDRESS_FIELD: CategoryField = { key: 'address', label: 'Address / exact location', type: 'text', maxLength: 150, requiredForNew: true };
const LANDMARK_FIELD: CategoryField = { key: 'landmark', label: 'Directions / nearby landmark', type: 'text', maxLength: 200 };
const NEIGHBORHOOD_FIELD: CategoryField = { key: 'neighborhood', label: 'Neighborhood / district', type: 'text' };
const ELECTRICITY_FIELD: CategoryField = { key: 'electricity', label: 'Electricity', type: 'select', options: AVAILABILITY_OPTIONS };
const WATER_FIELD: CategoryField = { key: 'water', label: 'Water', type: 'select', options: AVAILABILITY_OPTIONS };
const PARKING_FIELD: CategoryField = { key: 'parking', label: 'Parking', type: 'select', options: ['Yes', 'No'] };
const FURNISHED_FIELD: CategoryField = { key: 'furnished', label: 'Furnished', type: 'select', options: ['Furnished', 'Unfurnished', 'Partly furnished'], legacyOptions: ['Yes', 'No'] };
const AVAILABILITY_FIELD: CategoryField = { key: 'availability', label: 'Availability', type: 'select', options: PROPERTY_AVAILABILITY };
// The rent AMOUNT is the listing price (price step); this is how often it is charged.
const RENT_PERIOD_FIELD: CategoryField = { key: 'rentPeriod', label: 'Rent is paid', type: 'select', options: RENT_PERIODS, requiredForNew: true };
const WHEN_RENTED = { key: 'offer', equals: ['For rent'] };
const offerField = (): CategoryField => ({ key: 'offer', label: 'For sale or for rent', type: 'select', options: PROPERTY_OFFERS });
// Home rentals: first say WHAT is rented. Whole-place questions (bedrooms, size, parking...) are hidden for "One room only", and the
// room questions are hidden for a whole place. '' (a listing saved before this question existed) counts as a whole place so editing it
// keeps its answers.
const WHOLE_PLACE = { key: 'rentalKind', equals: ['', 'Furnished home', 'Empty home'] };
const ONE_ROOM = { key: 'rentalKind', equals: ['One room only'] };
const RENTAL_KIND_FIELD: CategoryField = {
  key: 'rentalKind',
  label: 'What are you renting out?',
  type: 'select',
  options: RENTAL_KINDS,
  requiredForNew: true,
  hint: 'Furnished includes beds and furniture. Empty is the whole place with nothing inside. One room only means you live in the home and rent out a room.',
};
const wholePlace = (f: CategoryField): CategoryField => ({ ...f, showIf: WHOLE_PLACE });
const rentPeriodWhenRented = (options: string[] = RENT_PERIODS): CategoryField => ({
  key: 'rentPeriod',
  label: 'Rent is paid',
  type: 'select',
  options,
  requiredForNew: true,
  showIf: WHEN_RENTED,
});

// Which free-text fields are numeric (and their min/max) is defined in
// data/sellRules.ts (NUMERIC_RULES) — the single source used for the keyboard,
// the hint and the validation, on mobile and web.

// Extra fields shown on the posting form only for categories/subcategories
// where they make sense. Values are stored in postDraft's generic
// `attributes` map (and later on the published Listing), keyed by field id —
// not as dedicated draft fields, so adding another category's fields later
// doesn't require touching the store.
//
// Keys are either a bare category id ("phones") for fields shared by every
// subcategory of that category, or "category/Subcategory" ("vehicles/Bajaj")
// for a field set specific to one subcategory that replaces the category-wide
// set entirely. See getCategoryFields() below for the lookup order.
//
// Field types: 'text' is free typing (used only where no fixed list exists —
// Brand, Model, Quantity, ...); 'select' renders as choice chips from a fixed
// option list (shared lists live in fieldOptions.ts); 'year' renders a
// scrollable year picker defaulting to the current year.
export const categoryFields: Record<string, CategoryField[]> = {
  // ---- Vehicles: each vehicle type asks only for what applies to it ----
  'vehicles/Cars': [
    { key: 'brand', label: 'Brand', type: 'text', required: true },
    { key: 'model', label: 'Model', type: 'text', required: true },
    { key: 'year', label: 'Year', type: 'year', required: true },
    { key: 'mileage', label: 'Mileage (km)', type: 'text' },
    { key: 'transmission', label: 'Transmission', type: 'select', options: ['Automatic', 'Manual'] },
    { key: 'fuel', label: 'Fuel Type', type: 'select', options: ['Petrol', 'Diesel', 'Hybrid', 'Electric'] },
    { key: 'engineSize', label: 'Engine Size', type: 'text', hint: 'Optional — leave blank if you are not sure.' },
    { key: 'drivetrain', label: 'Drivetrain', type: 'select', options: ['FWD', 'RWD', '4WD', 'AWD'] },
    { key: 'color', label: 'Color', type: 'select', options: COLORS },
    { key: 'seats', label: 'Seats', type: 'select', options: ['2', '4', '5', '7', '8+'] },
    { key: 'registration', label: 'Registration', type: 'select', options: REGISTRATION_OPTIONS },
    { key: 'importStatus', label: 'Import Status', type: 'select', options: ['Locally used', 'Imported'] },
  ],
  'vehicles/SUVs': [
    { key: 'brand', label: 'Brand', type: 'text', required: true },
    { key: 'model', label: 'Model', type: 'text', required: true },
    { key: 'year', label: 'Year', type: 'year', required: true },
    { key: 'mileage', label: 'Mileage (km)', type: 'text' },
    { key: 'transmission', label: 'Transmission', type: 'select', options: ['Automatic', 'Manual'] },
    { key: 'fuel', label: 'Fuel Type', type: 'select', options: ['Petrol', 'Diesel', 'Hybrid', 'Electric'] },
    { key: 'engineSize', label: 'Engine Size', type: 'text', hint: 'Optional — leave blank if you are not sure.' },
    { key: 'drivetrain', label: 'Drivetrain', type: 'select', options: ['FWD', 'RWD', '4WD', 'AWD'] },
    { key: 'color', label: 'Color', type: 'select', options: COLORS },
    { key: 'seats', label: 'Seats', type: 'select', options: ['2', '4', '5', '7', '8+'] },
    { key: 'registration', label: 'Registration', type: 'select', options: REGISTRATION_OPTIONS },
    { key: 'importStatus', label: 'Import Status', type: 'select', options: ['Locally used', 'Imported'] },
  ],
  'vehicles/Trucks': [
    { key: 'brand', label: 'Brand', type: 'text', required: true },
    { key: 'model', label: 'Model', type: 'text', required: true },
    { key: 'year', label: 'Year', type: 'year', required: true },
    { key: 'mileage', label: 'Mileage (km)', type: 'text' },
    { key: 'transmission', label: 'Transmission', type: 'select', options: ['Automatic', 'Manual'] },
    { key: 'fuel', label: 'Fuel Type', type: 'select', options: ['Petrol', 'Diesel'] },
    { key: 'payload', label: 'Payload Capacity', type: 'text' },
    { key: 'color', label: 'Color', type: 'select', options: COLORS },
    { key: 'registration', label: 'Registration', type: 'select', options: REGISTRATION_OPTIONS },
  ],
  'vehicles/Motorcycles': [
    { key: 'brand', label: 'Brand', type: 'text', required: true },
    { key: 'model', label: 'Model', type: 'text', required: true },
    { key: 'year', label: 'Year', type: 'year', required: true },
    { key: 'mileage', label: 'Mileage (km)', type: 'text' },
    { key: 'engineCC', label: 'Engine Size (cc)', type: 'text' },
    { key: 'color', label: 'Color', type: 'select', options: COLORS },
    { key: 'registration', label: 'Registration', type: 'select', options: REGISTRATION_OPTIONS },
  ],
  'vehicles/Bajaj': [
    { key: 'brand', label: 'Brand', type: 'text', required: true },
    { key: 'model', label: 'Model', type: 'text', required: true },
    { key: 'year', label: 'Year', type: 'year', required: true },
    { key: 'mileage', label: 'Mileage (km)', type: 'text' },
    { key: 'fuel', label: 'Fuel Type', type: 'select', options: ['Petrol', 'Diesel', 'CNG'] },
    { key: 'color', label: 'Color', type: 'select', options: COLORS },
    { key: 'registration', label: 'Registration', type: 'select', options: REGISTRATION_OPTIONS },
  ],
  'vehicles/Spare Parts': [
    { key: 'partType', label: 'Part Type', type: 'text', required: true },
    { key: 'compatibleBrand', label: 'Compatible Brand', type: 'text' },
    { key: 'compatibleModel', label: 'Compatible Model', type: 'text' },
  ],
  'vehicles/Buses': [
    { key: 'brand', label: 'Brand', type: 'text', required: true },
    { key: 'model', label: 'Model', type: 'text', required: true },
    { key: 'year', label: 'Year', type: 'year', required: true },
    { key: 'seats', label: 'Seats', type: 'select', options: ['15', '22', '30', '45+'], required: true },
    { key: 'fuel', label: 'Fuel Type', type: 'select', options: ['Petrol', 'Diesel'] },
    { key: 'mileage', label: 'Mileage (km)', type: 'text' },
    { key: 'color', label: 'Color', type: 'select', options: COLORS },
    { key: 'registration', label: 'Registration', type: 'select', options: REGISTRATION_OPTIONS },
  ],
  'vehicles/Boats': [
    { key: 'boatType', label: 'Boat Type', type: 'select', options: ['Fishing Boat', 'Speedboat', 'Cargo Vessel', 'Other'], required: true },
    { key: 'engineType', label: 'Engine Type', type: 'select', options: ['Inboard', 'Outboard', 'None'] },
    { key: 'lengthMeters', label: 'Length (meters)', type: 'text' },
    { key: 'material', label: 'Hull Material', type: 'select', options: ['Fiberglass', 'Wood', 'Steel', 'Other'] },
  ],

  // ---- Phones: same spec fields regardless of brand ----
  phones: [
    { key: 'brand', label: 'Brand', type: 'text', required: true },
    { key: 'model', label: 'Model', type: 'text', required: true },
    { key: 'ram', label: 'RAM', type: 'select', options: RAM_OPTIONS },
    { key: 'storage', label: 'Storage', type: 'select', options: STORAGE_OPTIONS },
    { key: 'color', label: 'Color', type: 'select', options: COLORS },
    { key: 'battery', label: 'Battery Health (%)', type: 'text', hint: 'Optional — only if your phone shows it.' },
    { key: 'network', label: 'Network', type: 'select', options: ['3G', '4G', '5G'] },
    { key: 'sim', label: 'SIM', type: 'select', options: ['Single SIM', 'Dual SIM', 'eSIM'] },
    { key: 'warranty', label: 'Warranty', type: 'select', options: ['None', 'Shop warranty', 'Manufacturer warranty'] },
  ],
  'phones/Accessories': [
    { key: 'accessoryType', label: 'Accessory Type', type: 'text', required: true },
    { key: 'compatibleBrand', label: 'Compatible Brand', type: 'text' },
    { key: 'color', label: 'Color', type: 'select', options: COLORS },
  ],

  // ---- Electronics ----
  'electronics/Laptops': [
    { key: 'brand', label: 'Brand', type: 'text', required: true },
    { key: 'model', label: 'Model', type: 'text', required: true },
    { key: 'processor', label: 'Processor', type: 'text' },
    { key: 'ram', label: 'RAM', type: 'select', options: RAM_OPTIONS },
    { key: 'storage', label: 'Storage', type: 'select', options: STORAGE_OPTIONS },
    { key: 'screenSize', label: 'Screen Size', type: 'select', options: LAPTOP_SCREEN_SIZES },
    { key: 'graphics', label: 'Graphics', type: 'text' },
  ],
  'electronics/TVs': [
    { key: 'brand', label: 'Brand', type: 'text', required: true },
    { key: 'model', label: 'Model', type: 'text' },
    { key: 'screenSize', label: 'Screen Size', type: 'select', options: TV_SCREEN_SIZES, required: true },
    { key: 'resolution', label: 'Resolution', type: 'select', options: ['HD', 'Full HD', '4K', '8K'] },
    { key: 'smartTv', label: 'Smart TV', type: 'select', options: ['Yes', 'No'] },
    { key: 'hdmiPorts', label: 'HDMI Ports', type: 'select', options: ['1', '2', '3', '4+'] },
  ],
  'electronics/Cameras': [
    { key: 'brand', label: 'Brand', type: 'text', required: true },
    { key: 'model', label: 'Model', type: 'text' },
    { key: 'cameraType', label: 'Type', type: 'select', options: ['DSLR', 'Mirrorless', 'Point & Shoot', 'Action Camera'] },
    { key: 'resolution', label: 'Resolution (MP)', type: 'text' },
  ],
  'electronics/Gaming': [
    { key: 'platform', label: 'Platform', type: 'select', options: ['PlayStation', 'Xbox', 'Nintendo Switch', 'PC'] },
    { key: 'storage', label: 'Storage', type: 'text' },
    { key: 'accessories', label: 'Included Accessories', type: 'text' },
  ],
  'electronics/Speakers': [
    { key: 'brand', label: 'Brand', type: 'text', required: true },
    { key: 'connectivity', label: 'Connectivity', type: 'select', options: ['Bluetooth', 'Wired', 'Both'] },
    { key: 'power', label: 'Power Output', type: 'text' },
  ],
  'electronics/Tablets': [
    { key: 'brand', label: 'Brand', type: 'text', required: true },
    { key: 'model', label: 'Model', type: 'text', required: true },
    { key: 'storage', label: 'Storage', type: 'select', options: STORAGE_OPTIONS },
    { key: 'screenSize', label: 'Screen Size', type: 'select', options: ['7"', '8"', '10"', '11"', '12.9"+'] },
    { key: 'connectivity', label: 'Connectivity', type: 'select', options: ['Wi-Fi only', 'Wi-Fi + Cellular'] },
    { key: 'color', label: 'Color', type: 'select', options: COLORS },
  ],
  'electronics/Printers & Scanners': [
    { key: 'brand', label: 'Brand', type: 'text', required: true },
    { key: 'deviceType', label: 'Device Type', type: 'select', options: ['Printer', 'Scanner', 'All-in-One'], required: true },
    { key: 'printType', label: 'Print Type', type: 'select', options: ['Inkjet', 'Laser', 'Dot Matrix'] },
    { key: 'connectivity', label: 'Connectivity', type: 'select', options: ['USB', 'Wi-Fi', 'Both'] },
  ],

  // ---- Fashion: clothing vs. shoes vs. watches each need different specs ----
  'fashion/Men': [
    { key: 'size', label: 'Size', type: 'text', required: true },
    { key: 'color', label: 'Color', type: 'select', options: COLORS },
    { key: 'material', label: 'Material', type: 'text' },
  ],
  'fashion/Women': [
    { key: 'size', label: 'Size', type: 'text', required: true },
    { key: 'color', label: 'Color', type: 'select', options: COLORS },
    { key: 'material', label: 'Material', type: 'text' },
  ],
  'fashion/Kids': [
    { key: 'size', label: 'Size', type: 'text', required: true },
    { key: 'color', label: 'Color', type: 'select', options: COLORS },
    { key: 'material', label: 'Material', type: 'text' },
  ],
  'fashion/Shoes': [
    { key: 'size', label: 'Size', type: 'text', required: true },
    { key: 'brand', label: 'Brand', type: 'text' },
    { key: 'color', label: 'Color', type: 'select', options: COLORS },
  ],
  'fashion/Watches': [
    { key: 'brand', label: 'Brand', type: 'text', required: true },
    { key: 'movement', label: 'Movement', type: 'select', options: ['Automatic', 'Quartz', 'Mechanical', 'Smartwatch'] },
    { key: 'color', label: 'Color', type: 'select', options: COLORS },
  ],
  'fashion/Bags': [
    { key: 'bagType', label: 'Bag Type', type: 'select', options: ['Handbag', 'Backpack', 'Travel Bag', 'Wallet', 'Other'], required: true },
    { key: 'material', label: 'Material', type: 'text' },
    { key: 'color', label: 'Color', type: 'select', options: COLORS },
  ],
  'fashion/Jewelry': [
    { key: 'jewelryType', label: 'Type', type: 'select', options: ['Necklace', 'Earrings', 'Ring', 'Bracelet', 'Set', 'Other'], required: true },
    { key: 'material', label: 'Material', type: 'text' },
    { key: 'gender', label: 'For', type: 'select', options: ['Men', 'Women', 'Unisex'] },
  ],

  // ---- Property: each listing type asks only for what applies to it ----
  // Sale forms lead with ownership; rental forms lead with how the rent is
  // paid, availability and utilities. Commercial types ask whether they are
  // for sale or for rent first and show the matching questions (showIf).
  // Nothing about utilities, ownership or an address is ever mandatory.
  'property/House for Sale': [
    { key: 'bedrooms', label: 'Bedrooms', type: 'select', options: BEDROOMS, required: true },
    { key: 'bathrooms', label: 'Bathrooms', type: 'select', options: BATHROOMS },
    { key: 'size', label: 'Size (sqm)', type: 'text' },
    FURNISHED_FIELD,
    ELECTRICITY_FIELD,
    WATER_FIELD,
    PARKING_FIELD,
    { key: 'yearBuilt', label: 'Year Built', type: 'year' },
    { key: 'titleDeed', label: 'Title deed', type: 'select', options: YES_NO_NOT_SURE },
    NEIGHBORHOOD_FIELD,
    ADDRESS_FIELD,
    LANDMARK_FIELD,
  ],
  'property/House for Rent': [
    RENTAL_KIND_FIELD,
    wholePlace({ key: 'bedrooms', label: 'Bedrooms', type: 'select', options: BEDROOMS, required: true }),
    wholePlace({ key: 'bathrooms', label: 'Bathrooms', type: 'select', options: BATHROOMS }),
    wholePlace({ key: 'size', label: 'Size (sqm)', type: 'text' }),
    { ...FURNISHED_FIELD, showIf: { key: 'rentalKind', equals: [''] } },
    RENT_PERIOD_FIELD,
    AVAILABILITY_FIELD,
    ELECTRICITY_FIELD,
    WATER_FIELD,
    { key: 'bathroomType', label: 'Bathroom', type: 'select', options: ['Private bathroom', 'Shared bathroom'], showIf: ONE_ROOM },
    { key: 'utilitiesIncluded', label: 'Utilities included in rent', type: 'select', options: ['Yes', 'No'] },
    wholePlace(PARKING_FIELD),
    wholePlace({ key: 'leaseTerm', label: 'Minimum lease', type: 'select', options: LEASE_TERMS }),
    NEIGHBORHOOD_FIELD,
    ADDRESS_FIELD,
    LANDMARK_FIELD,
  ],
  'property/Apartment for Sale': [
    { key: 'bedrooms', label: 'Bedrooms', type: 'select', options: BEDROOMS, required: true },
    { key: 'bathrooms', label: 'Bathrooms', type: 'select', options: BATHROOMS },
    { key: 'floor', label: 'Floor', type: 'text' },
    { key: 'size', label: 'Size (sqm)', type: 'text' },
    FURNISHED_FIELD,
    ELECTRICITY_FIELD,
    WATER_FIELD,
    PARKING_FIELD,
    { key: 'titleDeed', label: 'Title deed', type: 'select', options: YES_NO_NOT_SURE },
    NEIGHBORHOOD_FIELD,
    ADDRESS_FIELD,
    LANDMARK_FIELD,
  ],
  'property/Apartment for Rent': [
    RENTAL_KIND_FIELD,
    wholePlace({ key: 'bedrooms', label: 'Bedrooms', type: 'select', options: BEDROOMS, required: true }),
    wholePlace({ key: 'bathrooms', label: 'Bathrooms', type: 'select', options: BATHROOMS }),
    wholePlace({ key: 'floor', label: 'Floor', type: 'text' }),
    wholePlace({ key: 'size', label: 'Size (sqm)', type: 'text' }),
    { ...FURNISHED_FIELD, showIf: { key: 'rentalKind', equals: [''] } },
    RENT_PERIOD_FIELD,
    AVAILABILITY_FIELD,
    ELECTRICITY_FIELD,
    WATER_FIELD,
    { key: 'bathroomType', label: 'Bathroom', type: 'select', options: ['Private bathroom', 'Shared bathroom'], showIf: ONE_ROOM },
    { key: 'utilitiesIncluded', label: 'Utilities included in rent', type: 'select', options: ['Yes', 'No'] },
    wholePlace(PARKING_FIELD),
    wholePlace({ key: 'leaseTerm', label: 'Minimum lease', type: 'select', options: LEASE_TERMS }),
    NEIGHBORHOOD_FIELD,
    ADDRESS_FIELD,
    LANDMARK_FIELD,
  ],
  // A single room (or a room in a shared compound) — no bedroom count, no
  // parking or size questions; just what a person looking for a room asks.
  'property/Single Room for Rent': [
    RENT_PERIOD_FIELD,
    FURNISHED_FIELD,
    { key: 'bathroomType', label: 'Bathroom', type: 'select', options: ['Private bathroom', 'Shared bathroom'] },
    ELECTRICITY_FIELD,
    WATER_FIELD,
    { key: 'utilitiesIncluded', label: 'Utilities included in rent', type: 'select', options: ['Yes', 'No'] },
    AVAILABILITY_FIELD,
    NEIGHBORHOOD_FIELD,
    ADDRESS_FIELD,
    LANDMARK_FIELD,
  ],
  'property/Land': [
    { key: 'size', label: 'Area', type: 'text', required: true },
    { key: 'unit', label: 'Unit', type: 'select', options: ['sqm', 'Hectare', 'Acre'] },
    { key: 'landType', label: 'Purpose', type: 'select', options: ['Residential', 'Commercial', 'Agricultural'] },
    { key: 'titleDeed', label: 'Title deed', type: 'select', options: YES_NO_NOT_SURE },
    { key: 'roadAccess', label: 'Road Access', type: 'select', options: YES_NO_NOT_SURE },
    { key: 'water', label: 'Water', type: 'select', options: YES_NO_NOT_SURE },
    { key: 'electricity', label: 'Electricity', type: 'select', options: YES_NO_NOT_SURE },
    NEIGHBORHOOD_FIELD,
    ADDRESS_FIELD,
    LANDMARK_FIELD,
  ],
  'property/Shop': [
    { ...offerField(), requiredForNew: true },
    rentPeriodWhenRented(),
    { key: 'size', label: 'Size (sqm)', type: 'text', required: true },
    { key: 'floor', label: 'Floor', type: 'text' },
    ELECTRICITY_FIELD,
    WATER_FIELD,
    PARKING_FIELD,
    { key: 'titleDeed', label: 'Title deed', type: 'select', options: YES_NO_NOT_SURE, showIf: { key: 'offer', equals: ['For sale'] } },
    NEIGHBORHOOD_FIELD,
    ADDRESS_FIELD,
    LANDMARK_FIELD,
  ],
  'property/Office': [
    { ...offerField(), requiredForNew: true },
    rentPeriodWhenRented(),
    { key: 'size', label: 'Size (sqm)', type: 'text', required: true },
    { key: 'floor', label: 'Floor', type: 'text' },
    ELECTRICITY_FIELD,
    WATER_FIELD,
    PARKING_FIELD,
    { key: 'titleDeed', label: 'Title deed', type: 'select', options: YES_NO_NOT_SURE, showIf: { key: 'offer', equals: ['For sale'] } },
    NEIGHBORHOOD_FIELD,
    ADDRESS_FIELD,
    LANDMARK_FIELD,
  ],
  'property/Commercial Property': [
    { ...offerField(), requiredForNew: true },
    rentPeriodWhenRented(),
    { key: 'size', label: 'Size (sqm)', type: 'text', required: true },
    { key: 'floor', label: 'Floor', type: 'text' },
    ELECTRICITY_FIELD,
    WATER_FIELD,
    PARKING_FIELD,
    { key: 'titleDeed', label: 'Title deed', type: 'select', options: YES_NO_NOT_SURE, showIf: { key: 'offer', equals: ['For sale'] } },
    NEIGHBORHOOD_FIELD,
    ADDRESS_FIELD,
    LANDMARK_FIELD,
  ],
  'property/Warehouse': [
    { ...offerField(), requiredForNew: true },
    rentPeriodWhenRented(),
    { key: 'size', label: 'Size (sqm)', type: 'text', required: true },
    { key: 'ceilingHeight', label: 'Ceiling Height (m)', type: 'text' },
    { key: 'loadingDock', label: 'Loading Dock', type: 'select', options: ['Yes', 'No'] },
    ELECTRICITY_FIELD,
    WATER_FIELD,
    PARKING_FIELD,
    { key: 'titleDeed', label: 'Title deed', type: 'select', options: YES_NO_NOT_SURE, showIf: { key: 'offer', equals: ['For sale'] } },
    NEIGHBORHOOD_FIELD,
    ADDRESS_FIELD,
    LANDMARK_FIELD,
  ],
  'property/Guest House / Villa': [
    { ...offerField(), requiredForNew: true },
    rentPeriodWhenRented(STAY_PERIODS),
    { key: 'bedrooms', label: 'Bedrooms', type: 'select', options: BEDROOMS, required: true },
    { key: 'bathrooms', label: 'Bathrooms', type: 'select', options: BATHROOMS },
    FURNISHED_FIELD,
    ELECTRICITY_FIELD,
    WATER_FIELD,
    PARKING_FIELD,
    { key: 'pool', label: 'Swimming Pool', type: 'select', options: ['Yes', 'No'] },
    { key: 'titleDeed', label: 'Title deed', type: 'select', options: YES_NO_NOT_SURE, showIf: { key: 'offer', equals: ['For sale'] } },
    NEIGHBORHOOD_FIELD,
    ADDRESS_FIELD,
    LANDMARK_FIELD,
  ],

  // ---- Jobs: same employment fields for every job type, never product fields ----
  jobs: [
    { key: 'company', label: 'Company', type: 'text', required: true },
    { key: 'salary', label: 'Salary', type: 'text' },
    { key: 'employmentType', label: 'Employment Type', type: 'select', options: ['Full-time', 'Part-time', 'Contract', 'Temporary'] },
    { key: 'experience', label: 'Experience Required', type: 'text' },
  ],

  // ---- Services: every trade gets its own description placeholder (see titlePlaceholders) ----
  services: [
    { key: 'experience', label: 'Years of Experience', type: 'text' },
    { key: 'availability', label: 'Availability', type: 'select', options: ['Full-time', 'Part-time', 'On-call'] },
  ],

  // ---- Furniture: each piece type asks only for what applies to it ----
  'furniture/Sofas': [
    { key: 'material', label: 'Material', type: 'select', options: ['Leather', 'Fabric', 'Wood', 'Other'], required: true },
    { key: 'seats', label: 'Seats', type: 'select', options: ['1', '2', '3', '4', '5+'] },
    { key: 'color', label: 'Color', type: 'select', options: COLORS },
  ],
  'furniture/Beds': [
    { key: 'size', label: 'Bed Size', type: 'select', options: ['Single', 'Double', 'Queen', 'King'], required: true },
    { key: 'material', label: 'Frame Material', type: 'text' },
    { key: 'mattressIncluded', label: 'Mattress Included', type: 'select', options: ['Yes', 'No'] },
  ],
  'furniture/Tables & Chairs': [
    { key: 'itemType', label: 'Item Type', type: 'select', options: ['Dining Table', 'Coffee Table', 'Office Desk', 'Chair Set'], required: true },
    { key: 'material', label: 'Material', type: 'text' },
    { key: 'seats', label: 'Seats', type: 'text' },
  ],
  'furniture/Wardrobes': [
    { key: 'doors', label: 'Doors', type: 'select', options: ['2', '3', '4+'], required: true },
    { key: 'material', label: 'Material', type: 'text' },
    { key: 'dimensions', label: 'Dimensions', type: 'text' },
  ],
  'furniture/Office Furniture': [
    { key: 'itemType', label: 'Item Type', type: 'select', options: ['Desk', 'Chair', 'Cabinet', 'Shelf'], required: true },
    { key: 'material', label: 'Material', type: 'text' },
    { key: 'quantity', label: 'Quantity', type: 'text' },
  ],
  'furniture/Outdoor Furniture': [
    { key: 'itemType', label: 'Item Type', type: 'select', options: ['Patio Set', 'Bench', 'Umbrella', 'Sun Lounger', 'Other'], required: true },
    { key: 'material', label: 'Material', type: 'select', options: ['Plastic', 'Metal', 'Wood', 'Rattan'] },
    { key: 'color', label: 'Color', type: 'select', options: COLORS },
  ],

  // ---- Kitchen ----
  'kitchen/Cookware': [
    { key: 'material', label: 'Material', type: 'select', options: ['Non-stick', 'Stainless Steel', 'Cast Iron', 'Ceramic'], required: true },
    { key: 'setPieces', label: 'Set Pieces', type: 'text' },
    { key: 'brand', label: 'Brand', type: 'text' },
  ],
  'kitchen/Appliances': [
    { key: 'applianceType', label: 'Appliance Type', type: 'select', options: ['Fridge', 'Microwave', 'Blender', 'Oven', 'Kettle', 'Other'], required: true },
    { key: 'powerSource', label: 'Power Source', type: 'select', options: ['Electric', 'Gas'] },
    { key: 'brand', label: 'Brand', type: 'text' },
  ],
  'kitchen/Utensils': [
    { key: 'material', label: 'Material', type: 'select', options: ['Wood', 'Stainless Steel', 'Plastic', 'Silicone'], required: true },
    { key: 'setPieces', label: 'Set Pieces', type: 'text' },
  ],
  'kitchen/Storage': [
    { key: 'itemType', label: 'Item Type', type: 'select', options: ['Containers', 'Jars', 'Shelving', 'Other'], required: true },
    { key: 'material', label: 'Material', type: 'text' },
    { key: 'setPieces', label: 'Set Pieces', type: 'text' },
  ],
  'kitchen/Bakeware': [
    { key: 'itemType', label: 'Item Type', type: 'select', options: ['Baking Tray', 'Cake Tin', 'Mixing Bowl', 'Oven Mitt', 'Other'], required: true },
    { key: 'material', label: 'Material', type: 'select', options: ['Non-stick', 'Stainless Steel', 'Silicone', 'Glass'] },
    { key: 'setPieces', label: 'Set Pieces', type: 'text' },
  ],

  // ---- Construction ----
  'construction/Building Materials': [
    { key: 'materialType', label: 'Material Type', type: 'text', required: true },
    { key: 'quantity', label: 'Quantity', type: 'text' },
    { key: 'unit', label: 'Unit', type: 'select', options: ['kg', 'Ton', 'Bag', 'Piece'] },
  ],
  'construction/Tools & Equipment': [
    { key: 'toolType', label: 'Tool Type', type: 'text', required: true },
    { key: 'powerSource', label: 'Power Source', type: 'select', options: ['Manual', 'Electric', 'Petrol'] },
    { key: 'brand', label: 'Brand', type: 'text' },
  ],
  'construction/Cement & Blocks': [
    { key: 'itemType', label: 'Item Type', type: 'select', options: ['Cement', 'Blocks', 'Bricks', 'Sand', 'Gravel'], required: true },
    { key: 'quantity', label: 'Quantity', type: 'text', required: true },
    { key: 'unit', label: 'Unit', type: 'select', options: ['Bag', 'Piece', 'Ton', 'Truckload'] },
  ],
  'construction/Electrical Supplies': [
    { key: 'itemType', label: 'Item Type', type: 'text', required: true },
    { key: 'voltage', label: 'Voltage', type: 'text' },
    { key: 'quantity', label: 'Quantity', type: 'text' },
  ],
  'construction/Plumbing Supplies': [
    { key: 'itemType', label: 'Item Type', type: 'text', required: true },
    { key: 'pipeSize', label: 'Pipe Size', type: 'text' },
    { key: 'material', label: 'Material', type: 'select', options: ['PVC', 'Copper', 'Steel', 'Other'] },
  ],
  'construction/Roofing': [
    { key: 'itemType', label: 'Item Type', type: 'select', options: ['Roofing Sheets', 'Tiles', 'Gutters', 'Insulation', 'Other'], required: true },
    { key: 'material', label: 'Material', type: 'select', options: ['Metal', 'Clay Tile', 'Concrete', 'Other'] },
    { key: 'quantity', label: 'Quantity', type: 'text' },
  ],
  'construction/Steel & Metal Works': [
    { key: 'itemType', label: 'Item Type', type: 'select', options: ['Rebar', 'Steel Beams', 'Metal Sheets', 'Welded Frames', 'Other'], required: true },
    { key: 'quantity', label: 'Quantity', type: 'text' },
    { key: 'unit', label: 'Unit', type: 'select', options: ['kg', 'Ton', 'Piece', 'Meter'] },
  ],

  // ---- Agriculture ----
  'agriculture/Livestock': [
    { key: 'animalType', label: 'Animal Type', type: 'select', options: ['Cow', 'Goat', 'Sheep', 'Camel', 'Donkey', 'Other'], required: true },
    { key: 'quantity', label: 'Quantity', type: 'text', required: true },
    { key: 'age', label: 'Age', type: 'text' },
  ],
  'agriculture/Seeds & Crops': [
    { key: 'cropType', label: 'Crop Type', type: 'text', required: true },
    { key: 'quantity', label: 'Quantity', type: 'text' },
    { key: 'unit', label: 'Unit', type: 'select', options: ['kg', 'Ton', 'Bag', 'Sack'] },
  ],
  'agriculture/Farm Equipment': [
    { key: 'equipmentType', label: 'Equipment Type', type: 'text', required: true },
    { key: 'powerSource', label: 'Power Source', type: 'select', options: ['Manual', 'Electric', 'Diesel', 'Petrol'] },
    { key: 'brand', label: 'Brand', type: 'text' },
  ],
  'agriculture/Irrigation': [
    { key: 'systemType', label: 'System Type', type: 'select', options: ['Drip', 'Sprinkler', 'Pump', 'Hose', 'Other'], required: true },
    { key: 'coverageArea', label: 'Coverage Area', type: 'text' },
    { key: 'powerSource', label: 'Power Source', type: 'select', options: ['Electric', 'Diesel', 'Solar', 'Manual'] },
  ],
  'agriculture/Poultry Equipment': [
    { key: 'equipmentType', label: 'Equipment Type', type: 'select', options: ['Incubator', 'Feeder', 'Cage', 'Brooder', 'Other'], required: true },
    { key: 'capacity', label: 'Capacity', type: 'text' },
    { key: 'powerSource', label: 'Power Source', type: 'select', options: ['Electric', 'Manual', 'Solar'] },
  ],
  'agriculture/Greenhouse & Nursery': [
    { key: 'itemType', label: 'Item Type', type: 'select', options: ['Greenhouse Kit', 'Seedlings', 'Plant Pots', 'Grow Lights', 'Other'], required: true },
    { key: 'size', label: 'Size', type: 'text' },
  ],

  // ---- Beauty ----
  'beauty/Skincare': [
    { key: 'brand', label: 'Brand', type: 'text', required: true },
    { key: 'skinType', label: 'Skin Type', type: 'select', options: ['Oily', 'Dry', 'Combination', 'All Types'] },
    { key: 'expiry', label: 'Expiry Date', type: 'text' },
  ],
  'beauty/Makeup': [
    { key: 'brand', label: 'Brand', type: 'text', required: true },
    { key: 'shade', label: 'Shade', type: 'text' },
    { key: 'expiry', label: 'Expiry Date', type: 'text' },
  ],
  'beauty/Haircare': [
    { key: 'brand', label: 'Brand', type: 'text', required: true },
    { key: 'hairType', label: 'Hair Type', type: 'select', options: ['Straight', 'Curly', 'Coily', 'All Types'] },
    { key: 'expiry', label: 'Expiry Date', type: 'text' },
  ],
  'beauty/Fragrances': [
    { key: 'brand', label: 'Brand', type: 'text', required: true },
    { key: 'volume', label: 'Volume', type: 'text' },
    { key: 'gender', label: 'Gender', type: 'select', options: ['Men', 'Women', 'Unisex'] },
  ],
  'beauty/Nails': [
    { key: 'itemType', label: 'Item Type', type: 'select', options: ['Nail Polish', 'Press-on Nails', 'Nail Tools', 'Nail Art Kit', 'Other'], required: true },
    { key: 'brand', label: 'Brand', type: 'text' },
    { key: 'shade', label: 'Shade', type: 'text' },
  ],
  'beauty/Traditional & Henna': [
    { key: 'itemType', label: 'Item Type', type: 'select', options: ['Henna Cones', 'Malmal / Uunsi', 'Dirac Accessories', 'Other'], required: true },
    { key: 'brand', label: 'Brand', type: 'text' },
  ],

  // ---- Sports ----
  'sports/Fitness Equipment': [
    { key: 'equipmentType', label: 'Equipment Type', type: 'text', required: true },
    { key: 'brand', label: 'Brand', type: 'text' },
    { key: 'weightCapacity', label: 'Weight Capacity', type: 'text' },
  ],
  'sports/Team Sports': [
    { key: 'sportType', label: 'Sport', type: 'select', options: ['Football', 'Basketball', 'Volleyball', 'Other'], required: true },
    { key: 'itemType', label: 'Item Type', type: 'text' },
    { key: 'size', label: 'Size', type: 'text' },
  ],
  'sports/Outdoor & Camping': [
    { key: 'itemType', label: 'Item Type', type: 'text', required: true },
    { key: 'capacity', label: 'Capacity', type: 'text' },
    { key: 'brand', label: 'Brand', type: 'text' },
  ],
  'sports/Bicycles': [
    { key: 'bikeType', label: 'Bike Type', type: 'select', options: ['Mountain', 'Road', 'BMX', 'Kids', 'Electric'], required: true },
    { key: 'frameSize', label: 'Frame Size', type: 'text' },
    { key: 'gears', label: 'Gears', type: 'text' },
  ],
  'sports/Swimming': [
    { key: 'itemType', label: 'Item Type', type: 'select', options: ['Swimwear', 'Goggles', 'Pool Float', 'Life Jacket', 'Other'], required: true },
    { key: 'size', label: 'Size', type: 'text' },
    { key: 'brand', label: 'Brand', type: 'text' },
  ],
  'sports/Running & Athletics': [
    { key: 'itemType', label: 'Item Type', type: 'select', options: ['Running Shoes', 'Track Suit', 'Fitness Tracker', 'Other'], required: true },
    { key: 'size', label: 'Size', type: 'text' },
    { key: 'brand', label: 'Brand', type: 'text' },
  ],

  // ---- Books ----
  'books/Textbooks': [
    { key: 'subject', label: 'Subject', type: 'text', required: true },
    { key: 'gradeLevel', label: 'Grade / Level', type: 'text' },
    { key: 'author', label: 'Author', type: 'text' },
  ],
  'books/Novels': [
    { key: 'author', label: 'Author', type: 'text', required: true },
    { key: 'genre', label: 'Genre', type: 'select', options: ['Fiction', 'Non-Fiction', 'Mystery', 'Romance', 'Other'] },
    { key: 'language', label: 'Language', type: 'text' },
  ],
  'books/Religious Books': [
    { key: 'religion', label: 'Religion', type: 'select', options: ['Islam', 'Christianity', 'Other'], required: true },
    { key: 'language', label: 'Language', type: 'text' },
  ],
  "books/Children's Books": [
    { key: 'ageRange', label: 'Age Range', type: 'text', required: true },
    { key: 'language', label: 'Language', type: 'text' },
  ],
  'books/University & Exam Prep': [
    { key: 'subject', label: 'Subject / Exam', type: 'text', required: true },
    { key: 'level', label: 'Level', type: 'select', options: ['High School', 'University', 'Entrance Exam', 'Professional'] },
    { key: 'author', label: 'Author / Publisher', type: 'text' },
  ],

  // ---- Baby ----
  'baby/Baby Gear': [
    { key: 'itemType', label: 'Item Type', type: 'text', required: true },
    { key: 'ageRange', label: 'Age Range', type: 'text' },
    { key: 'brand', label: 'Brand', type: 'text' },
  ],
  'baby/Clothing': [
    { key: 'ageRange', label: 'Age Range', type: 'text', required: true },
    { key: 'gender', label: 'Gender', type: 'select', options: ['Boy', 'Girl', 'Unisex'] },
    { key: 'size', label: 'Size', type: 'text' },
  ],
  'baby/Toys': [
    { key: 'ageRange', label: 'Age Range', type: 'text' },
    { key: 'material', label: 'Material', type: 'select', options: ['Plastic', 'Wood', 'Fabric', 'Other'] },
    { key: 'brand', label: 'Brand', type: 'text' },
  ],
  'baby/Feeding': [
    { key: 'itemType', label: 'Item Type', type: 'text', required: true },
    { key: 'material', label: 'Material', type: 'select', options: ['Plastic', 'Glass', 'Silicone', 'Other'] },
    { key: 'brand', label: 'Brand', type: 'text' },
  ],
  'baby/Baby Safety': [
    { key: 'itemType', label: 'Item Type', type: 'select', options: ['Car Seat', 'Baby Monitor', 'Safety Gate', 'Socket Covers', 'Other'], required: true },
    { key: 'brand', label: 'Brand', type: 'text' },
  ],

  // ---- Food: freshness, quantity, packaging and expiry — never "condition" ----
  'food/Groceries': [
    { key: 'itemType', label: 'Item Type', type: 'text', required: true },
    { key: 'quantity', label: 'Quantity', type: 'text' },
    { key: 'unit', label: 'Unit', type: 'select', options: ['kg', 'Piece', 'Bag', 'Carton'] },
    { key: 'packaging', label: 'Packaging', type: 'select', options: PACKAGING_OPTIONS },
    { key: 'expiry', label: 'Expiry Date', type: 'text' },
  ],
  'food/Beverages': [
    { key: 'itemType', label: 'Item Type', type: 'text', required: true },
    { key: 'volume', label: 'Volume', type: 'text' },
    { key: 'quantity', label: 'Quantity', type: 'text' },
    { key: 'packaging', label: 'Packaging', type: 'select', options: PACKAGING_OPTIONS },
    { key: 'expiry', label: 'Expiry Date', type: 'text' },
  ],
  'food/Snacks': [
    { key: 'itemType', label: 'Item Type', type: 'text', required: true },
    { key: 'quantity', label: 'Quantity', type: 'text' },
    { key: 'packaging', label: 'Packaging', type: 'select', options: PACKAGING_OPTIONS },
    { key: 'expiry', label: 'Expiry Date', type: 'text' },
  ],
  'food/Bakery': [
    { key: 'itemType', label: 'Item Type', type: 'text', required: true },
    { key: 'quantity', label: 'Quantity', type: 'text' },
    { key: 'freshDate', label: 'Baked On', type: 'text' },
  ],
  'food/Fruits & Vegetables': [
    { key: 'itemType', label: 'Item Type', type: 'text', required: true },
    { key: 'quantity', label: 'Quantity', type: 'text', required: true },
    { key: 'unit', label: 'Unit', type: 'select', options: ['kg', 'Piece', 'Crate', 'Sack'] },
    { key: 'freshness', label: 'Freshness', type: 'select', options: ['Fresh today', 'Fresh this week', 'Ripe — sell soon'] },
    { key: 'organic', label: 'Organic', type: 'select', options: ['Yes', 'No'] },
  ],
  'food/Frozen Foods': [
    { key: 'itemType', label: 'Item Type', type: 'text', required: true },
    { key: 'quantity', label: 'Quantity', type: 'text' },
    { key: 'unit', label: 'Unit', type: 'select', options: ['kg', 'Piece', 'Pack', 'Carton'] },
    { key: 'packaging', label: 'Packaging', type: 'select', options: PACKAGING_OPTIONS },
    { key: 'expiry', label: 'Expiry Date', type: 'text' },
  ],

  // ---- Business Equipment ----
  'business/Office Equipment': [
    { key: 'equipmentType', label: 'Equipment Type', type: 'text', required: true },
    { key: 'brand', label: 'Brand', type: 'text' },
    { key: 'powerSource', label: 'Power Source', type: 'select', options: ['Electric', 'Battery', 'Manual'] },
  ],
  'business/POS & Retail': [
    { key: 'equipmentType', label: 'Equipment Type', type: 'text', required: true },
    { key: 'brand', label: 'Brand', type: 'text' },
    { key: 'connectivity', label: 'Connectivity', type: 'select', options: ['Wired', 'Wireless', 'Bluetooth'] },
  ],
  'business/Industrial Machinery': [
    { key: 'machineType', label: 'Machine Type', type: 'text', required: true },
    { key: 'powerSource', label: 'Power Source', type: 'select', options: ['Electric', 'Diesel', 'Petrol', 'Manual'] },
    { key: 'capacity', label: 'Capacity', type: 'text' },
  ],
  'business/Generators': [
    { key: 'powerOutput', label: 'Power Output', type: 'text', required: true },
    { key: 'fuelType', label: 'Fuel Type', type: 'select', options: ['Diesel', 'Petrol', 'Gas', 'Solar'] },
    { key: 'brand', label: 'Brand', type: 'text' },
  ],
  'business/Restaurant Equipment': [
    { key: 'equipmentType', label: 'Equipment Type', type: 'select', options: ['Oven', 'Fridge/Freezer', 'Grill', 'Fryer', 'Dishwasher', 'Other'], required: true },
    { key: 'brand', label: 'Brand', type: 'text' },
    { key: 'powerSource', label: 'Power Source', type: 'select', options: ['Electric', 'Gas'] },
  ],
  'business/Solar & Power Backup': [
    { key: 'itemType', label: 'Item Type', type: 'select', options: ['Solar Panel', 'Inverter', 'Battery Bank', 'UPS', 'Full Kit'], required: true },
    { key: 'capacity', label: 'Capacity', type: 'text' },
    { key: 'brand', label: 'Brand', type: 'text' },
  ],

  // ---- Animals ----
  'animals/Pets': [
    { key: 'species', label: 'Species', type: 'select', options: ['Dog', 'Cat', 'Rabbit', 'Fish', 'Other'], required: true },
    { key: 'breed', label: 'Breed', type: 'text' },
    { key: 'age', label: 'Age', type: 'text' },
    { key: 'vaccinated', label: 'Vaccinated', type: 'select', options: ['Yes', 'No'] },
  ],
  'animals/Livestock': [
    { key: 'animalType', label: 'Animal Type', type: 'select', options: ['Cow', 'Goat', 'Sheep', 'Camel', 'Donkey', 'Other'], required: true },
    { key: 'breed', label: 'Breed', type: 'text' },
    { key: 'age', label: 'Age', type: 'text' },
    { key: 'weight', label: 'Weight', type: 'text' },
  ],
  'animals/Birds': [
    { key: 'species', label: 'Species', type: 'text', required: true },
    { key: 'age', label: 'Age', type: 'text' },
    { key: 'cageIncluded', label: 'Cage Included', type: 'select', options: ['Yes', 'No'] },
  ],
  'animals/Poultry': [
    { key: 'poultryType', label: 'Type', type: 'select', options: ['Chicken', 'Duck', 'Turkey', 'Other'], required: true },
    { key: 'quantity', label: 'Quantity', type: 'text', required: true },
    { key: 'age', label: 'Age', type: 'text' },
  ],
  'animals/Fish & Aquarium': [
    { key: 'itemType', label: 'Item Type', type: 'select', options: ['Fish', 'Aquarium Tank', 'Filter', 'Decorations', 'Other'], required: true },
    { key: 'quantity', label: 'Quantity', type: 'text' },
  ],
};

// Title examples — every subcategory (or category, when it has no subcategories)
// gets its own example, never one borrowed from another category. Stored WITHOUT
// the "e.g." prefix: the prefix is added by the active language
// (post.details.exampleWrap), and mobile reads the translated example from
// post.titleExamples.<key> (locales/*) and falls back to this English text.
// The web sell page has no i18n yet and uses this English text directly.
export const titleExamples: Record<string, string> = {
  'vehicles/Cars': 'Toyota Corolla 2018, Automatic',
  'vehicles/SUVs': 'Toyota Prado 2016, Diesel, 4WD',
  'vehicles/Trucks': 'Isuzu NPR 2015, 3-ton truck',
  'vehicles/Motorcycles': 'Honda CG 125, 2020',
  'vehicles/Bajaj': 'Bajaj RE three-wheeler, 2022',
  'vehicles/Spare Parts': 'Toyota Corolla front brake pads',
  'vehicles/Buses': 'Toyota Coaster 30-seater, 2017',
  'vehicles/Boats': 'Fiberglass fishing boat, 6 m',
  phones: 'Samsung Galaxy A55, 256 GB',
  'phones/iPhone': 'iPhone 14 Pro, 256 GB',
  'phones/Samsung': 'Samsung Galaxy A55, 256 GB',
  'phones/Tecno': 'Tecno Camon 30, 256 GB',
  'phones/Infinix': 'Infinix Note 40, 128 GB',
  'phones/Xiaomi': 'Xiaomi Redmi Note 13, 128 GB',
  'phones/Nokia': 'Nokia G42, 128 GB',
  'phones/Huawei': 'Huawei Nova 11, 256 GB',
  'phones/Oppo': 'Oppo Reno 11, 256 GB',
  'phones/Vivo': 'Vivo V29, 256 GB',
  'phones/Itel': 'Itel A70, 64 GB',
  'phones/Realme': 'Realme 11 Pro, 256 GB',
  'phones/Accessories': 'Fast charger with USB-C cable',
  'electronics/TVs': 'Samsung 55" 4K Smart TV',
  'electronics/Laptops': 'Dell Latitude 5420, 16 GB RAM',
  'electronics/Cameras': 'Canon EOS 200D with lens',
  'electronics/Gaming': 'PlayStation 5 with 2 controllers',
  'electronics/Speakers': 'JBL Flip 6 Bluetooth speaker',
  'electronics/Tablets': 'Samsung Galaxy Tab A9, 64 GB',
  'electronics/Printers & Scanners': 'HP LaserJet all-in-one printer',
  'fashion/Men': "Men's leather jacket, size L",
  'fashion/Women': "Women's abaya, size M",
  'fashion/Kids': "Kids' school uniform, age 8",
  'fashion/Shoes': 'Nike Air Max, size 42',
  'fashion/Watches': 'Casio digital watch, steel strap',
  'fashion/Bags': 'Leather handbag, black',
  'fashion/Jewelry': 'Gold-plated necklace set',
  'property/House for Sale': '4-bedroom house for sale in 01',
  'property/House for Rent': '2-bedroom house for rent in 01',
  'property/Apartment for Sale': '2-bedroom apartment for sale in 01',
  'property/Apartment for Rent': '2-bedroom apartment for rent in 01',
  'property/Land': 'Residential land for sale in 01',
  'property/Shop': 'Shop for rent near the main market',
  'property/Office': 'Office space for rent in the city center',
  'property/Commercial Property': 'Commercial building for sale in 01',
  'property/Warehouse': '500 sqm warehouse with loading dock',
  'property/Guest House / Villa': '4-bedroom villa with garden',
  jobs: 'Receptionist needed',
  'jobs/NGO Jobs': 'Program officer, humanitarian NGO',
  'jobs/Sales & Marketing Jobs': 'Sales representative needed',
  'services/Electrician': 'Licensed electrician for home wiring',
  'services/Plumber': 'Plumber for leak repair and installation',
  'services/Painter': 'Interior and exterior house painting',
  'services/Cleaning': 'Deep home cleaning service',
  'services/Internet': 'Home Wi-Fi installation and setup',
  'services/Transport': 'Pickup truck for hire, city and intercity',
  'services/Mechanic': 'Mobile car mechanic, all makes',
  'services/IT': 'Computer repair and network setup',
  'services/Tutor': 'Math tutor for high school students',
  'services/Salon': 'Home hairdressing and salon service',
  'services/Solar Installation': 'Solar panel installation and setup',
  'services/Generator Repair': 'Generator repair and maintenance',
  'services/Photography': 'Event and portrait photography',
  'furniture/Sofas': '3-seater leather sofa, barely used',
  'furniture/Beds': 'Queen size bed frame with mattress',
  'furniture/Tables & Chairs': '6-seater dining table set',
  'furniture/Wardrobes': '3-door wooden wardrobe',
  'furniture/Office Furniture': 'Office desk and chair set',
  'furniture/Outdoor Furniture': '4-piece patio furniture set',
  'kitchen/Cookware': 'Non-stick cookware set, 10 pieces',
  'kitchen/Appliances': 'Double-door fridge, energy saving',
  'kitchen/Utensils': 'Stainless steel utensil set',
  'kitchen/Storage': 'Airtight food storage containers, set of 5',
  'kitchen/Bakeware': 'Non-stick baking tray set',
  'construction/Building Materials': 'Steel rebar, 12mm, 50 pieces',
  'construction/Tools & Equipment': 'Bosch angle grinder, barely used',
  'construction/Cement & Blocks': '50 bags of cement, unopened',
  'construction/Electrical Supplies': 'Electrical cable, 100m roll',
  'construction/Plumbing Supplies': 'PVC pipes, 4 inch, 20 pieces',
  'construction/Roofing': 'Galvanized roofing sheets, 20 pieces',
  'construction/Steel & Metal Works': 'Welded steel gate frame',
  'agriculture/Livestock': 'Dairy cow, 3 years old',
  'agriculture/Seeds & Crops': 'Maize seeds, 50kg sack',
  'agriculture/Farm Equipment': 'Water pump for irrigation',
  'agriculture/Irrigation': 'Drip irrigation kit, covers 1 acre',
  'agriculture/Poultry Equipment': 'Automatic egg incubator, 100 capacity',
  'agriculture/Greenhouse & Nursery': 'Greenhouse kit, 20 sqm',
  'beauty/Skincare': 'Vitamin C serum, sealed',
  'beauty/Makeup': 'Full face makeup kit',
  'beauty/Haircare': 'Argan oil hair treatment set',
  'beauty/Fragrances': 'Designer perfume, 100ml, sealed',
  'beauty/Nails': 'Press-on nails set with glue',
  'beauty/Traditional & Henna': 'Natural henna cones, pack of 12',
  'sports/Fitness Equipment': 'Adjustable dumbbell set',
  'sports/Team Sports': 'Official size football',
  'sports/Outdoor & Camping': '4-person camping tent',
  'sports/Bicycles': 'Mountain bike, 21-speed',
  'sports/Swimming': 'Swimming goggles and cap set',
  'sports/Running & Athletics': 'Running shoes, size 43',
  'books/Textbooks': 'High school biology textbook',
  'books/Novels': 'Best-selling fiction novel',
  'books/Religious Books': 'Quran with translation',
  "books/Children's Books": 'Illustrated storybook, ages 4-8',
  'books/University & Exam Prep': 'University entrance exam prep guide',
  'baby/Baby Gear': 'Foldable baby stroller',
  'baby/Clothing': 'Baby clothes bundle, 0-6 months',
  'baby/Toys': 'Wooden building blocks set',
  'baby/Feeding': 'Baby bottle set with sterilizer',
  'baby/Baby Safety': 'Rear-facing car seat, barely used',
  'food/Groceries': 'Basmati rice, 25 kg bag',
  'food/Beverages': 'Bottled water, case of 24',
  'food/Snacks': 'Mixed nuts, 5 kg pack',
  'food/Bakery': 'Fresh bread, baked daily',
  'food/Fruits & Vegetables': 'Fresh bananas, 20 kg crate',
  'food/Frozen Foods': 'Frozen chicken, 10 kg pack',
  'business/Office Equipment': 'Photocopier, barely used',
  'business/POS & Retail': 'POS machine with receipt printer',
  'business/Industrial Machinery': 'Industrial sewing machine',
  'business/Generators': '5kVA diesel generator',
  'business/Restaurant Equipment': 'Commercial gas oven, 6-burner',
  'business/Solar & Power Backup': '5kW solar inverter kit',
  'animals/Pets': 'Persian cat, vaccinated',
  'animals/Livestock': 'Goat, healthy and vaccinated',
  'animals/Birds': 'Parrot with cage',
  'animals/Poultry': '20 laying hens',
  'animals/Fish & Aquarium': '60L aquarium with filter and fish',
  'property/Single Room for Rent': 'Single room for rent in 01',
  'jobs/Hotel Jobs': 'Hotel receptionist needed',
  'jobs/Restaurant Jobs': 'Cook needed for restaurant',
  'jobs/Office Jobs': 'Office assistant needed',
  'jobs/Construction Jobs': 'Mason needed for building site',
  'jobs/Driver Jobs': 'Driver needed, valid license',
  'jobs/Cleaner Jobs': 'Cleaner needed for office',
  'jobs/Healthcare Jobs': 'Nurse needed for clinic',
  'jobs/Education Jobs': 'Primary school teacher needed',
  'jobs/Security Jobs': 'Security guard needed, night shift',
  'jobs/Other Jobs': 'Shop assistant needed',
};

// Examples shown greyed-out inside empty text fields, so "Brand" on a motorcycle
// suggests Honda and on a fridge suggests Hisense — never a placeholder borrowed
// from another category. Keyed by the same scope as categoryFields (a bare
// category id applies to every subcategory that has no entry of its own for the
// field). Stored without the "e.g." prefix. Examples that are only brand names,
// model names or numbers need no translation; examples containing words are
// translated in locales/* under post.examples.<English text>.
export const fieldExamples: Record<string, Record<string, string>> = {
  'vehicles/Cars': { brand: 'Toyota', model: 'Corolla', mileage: '85000', engineSize: '1.6 L' },
  'vehicles/SUVs': { brand: 'Toyota', model: 'Prado', mileage: '120000', engineSize: '2.7 L' },
  'vehicles/Trucks': { brand: 'Isuzu', model: 'NPR', mileage: '150000', payload: '3 tons' },
  'vehicles/Motorcycles': { brand: 'Honda', model: 'CG 125', mileage: '25000', engineCC: '125' },
  'vehicles/Bajaj': { brand: 'Bajaj', model: 'RE', mileage: '40000' },
  'vehicles/Spare Parts': { partType: 'Brake pads', compatibleBrand: 'Toyota', compatibleModel: 'Corolla' },
  'vehicles/Buses': { brand: 'Toyota', model: 'Coaster', mileage: '200000' },
  'vehicles/Boats': { lengthMeters: '6' },

  phones: { battery: '90' },
  'phones/iPhone': { brand: 'Apple', model: 'iPhone 14 Pro' },
  'phones/Samsung': { brand: 'Samsung', model: 'Galaxy A55' },
  'phones/Tecno': { brand: 'Tecno', model: 'Camon 30' },
  'phones/Infinix': { brand: 'Infinix', model: 'Note 40' },
  'phones/Xiaomi': { brand: 'Xiaomi', model: 'Redmi Note 13' },
  'phones/Nokia': { brand: 'Nokia', model: 'G42' },
  'phones/Huawei': { brand: 'Huawei', model: 'Nova 11' },
  'phones/Oppo': { brand: 'Oppo', model: 'Reno 11' },
  'phones/Vivo': { brand: 'Vivo', model: 'V29' },
  'phones/Itel': { brand: 'Itel', model: 'A70' },
  'phones/Realme': { brand: 'Realme', model: '11 Pro' },
  'phones/Accessories': { accessoryType: 'Fast charger', compatibleBrand: 'Samsung' },

  'electronics/Laptops': { brand: 'Dell', model: 'Latitude 5420', processor: 'Intel Core i5', graphics: 'Intel UHD' },
  'electronics/TVs': { brand: 'Samsung', model: 'Crystal UHD' },
  'electronics/Cameras': { brand: 'Canon', model: 'EOS 200D', resolution: '24' },
  'electronics/Gaming': { storage: '1 TB', accessories: 'Extra controller, HDMI cable' },
  'electronics/Speakers': { brand: 'JBL', power: '20 W' },
  'electronics/Tablets': { brand: 'Samsung', model: 'Galaxy Tab A9' },
  'electronics/Printers & Scanners': { brand: 'HP' },

  'fashion/Men': { size: 'L', material: 'Cotton' },
  'fashion/Women': { size: 'M', material: 'Cotton' },
  'fashion/Kids': { size: 'Age 8', material: 'Cotton' },
  'fashion/Shoes': { size: '42', brand: 'Nike' },
  'fashion/Watches': { brand: 'Casio' },
  'fashion/Bags': { material: 'Leather' },
  'fashion/Jewelry': { material: 'Gold-plated' },

  property: { neighborhood: 'District 01', address: 'House 12, District 01', landmark: 'Near the main market', floor: 'Ground floor', size: '120' },
  'property/Apartment for Sale': { floor: '2nd floor' },
  'property/Apartment for Rent': { floor: '2nd floor' },
  'property/Land': { size: '500' },
  'property/Shop': { size: '40' },
  'property/Office': { size: '60' },
  'property/Commercial Property': { size: '300' },
  'property/Warehouse': { size: '500', ceilingHeight: '4' },

  jobs: { company: 'Your company name', salary: '300 USD per month', experience: '2 years' },
  services: { experience: '5 years' },

  'furniture/Beds': { material: 'Wood' },
  'furniture/Tables & Chairs': { material: 'Wood', seats: '6' },
  'furniture/Wardrobes': { material: 'Wood', dimensions: '200 x 100 x 60 cm' },
  'furniture/Office Furniture': { material: 'Wood', quantity: '1' },

  'kitchen/Cookware': { setPieces: '10', brand: 'Tefal' },
  'kitchen/Appliances': { brand: 'Hisense' },
  'kitchen/Utensils': { setPieces: '12' },
  'kitchen/Storage': { material: 'Plastic', setPieces: '5' },
  'kitchen/Bakeware': { setPieces: '4' },

  'construction/Building Materials': { materialType: 'Rebar 12 mm', quantity: '50' },
  'construction/Tools & Equipment': { toolType: 'Angle grinder', brand: 'Bosch' },
  'construction/Cement & Blocks': { quantity: '50' },
  'construction/Electrical Supplies': { itemType: 'Electrical cable', voltage: '220', quantity: '100' },
  'construction/Plumbing Supplies': { itemType: 'PVC pipe', pipeSize: '4 inch' },
  'construction/Roofing': { quantity: '20' },
  'construction/Steel & Metal Works': { quantity: '100' },

  'agriculture/Livestock': { quantity: '5', age: '3 years' },
  'agriculture/Seeds & Crops': { cropType: 'Maize', quantity: '50' },
  'agriculture/Farm Equipment': { equipmentType: 'Water pump', brand: 'Honda' },
  'agriculture/Irrigation': { coverageArea: '1 acre' },
  'agriculture/Poultry Equipment': { capacity: '100 eggs' },
  'agriculture/Greenhouse & Nursery': { size: '20 sqm' },

  'beauty/Skincare': { brand: 'CeraVe', expiry: '12/2027' },
  'beauty/Makeup': { brand: 'Maybelline', shade: 'Medium beige', expiry: '12/2027' },
  'beauty/Haircare': { brand: 'Dove', expiry: '12/2027' },
  'beauty/Fragrances': { brand: 'Dior', volume: '100 ml' },
  'beauty/Nails': { brand: 'OPI', shade: 'Red' },
  'beauty/Traditional & Henna': { brand: 'Local brand' },

  'sports/Fitness Equipment': { equipmentType: 'Dumbbell set', brand: 'Decathlon', weightCapacity: '120' },
  'sports/Team Sports': { itemType: 'Football', size: '5' },
  'sports/Outdoor & Camping': { itemType: 'Camping tent', capacity: '4 people', brand: 'Coleman' },
  'sports/Bicycles': { frameSize: '26 inch', gears: '21' },
  'sports/Swimming': { size: 'M', brand: 'Speedo' },
  'sports/Running & Athletics': { size: '43', brand: 'Adidas' },

  'books/Textbooks': { subject: 'Biology', gradeLevel: 'Grade 10', author: 'Campbell' },
  'books/Novels': { author: 'Nuruddin Farah', language: 'Somali' },
  'books/Religious Books': { language: 'Arabic' },
  "books/Children's Books": { ageRange: '4-8 years', language: 'Somali' },
  'books/University & Exam Prep': { subject: 'Mathematics', author: 'Pearson' },

  'baby/Baby Gear': { itemType: 'Stroller', ageRange: '0-3 years', brand: 'Chicco' },
  'baby/Clothing': { ageRange: '0-6 months', size: '62' },
  'baby/Toys': { ageRange: '1-3 years', brand: 'Fisher-Price' },
  'baby/Feeding': { itemType: 'Feeding bottle', brand: 'Philips Avent' },
  'baby/Baby Safety': { brand: 'Graco' },

  'food/Groceries': { itemType: 'Basmati rice', quantity: '25', expiry: '12/2027' },
  'food/Beverages': { itemType: 'Bottled water', volume: '500 ml', quantity: '24', expiry: '12/2027' },
  'food/Snacks': { itemType: 'Mixed nuts', quantity: '5', expiry: '12/2027' },
  'food/Bakery': { itemType: 'Fresh bread', quantity: '20', freshDate: 'Today' },
  'food/Fruits & Vegetables': { itemType: 'Bananas', quantity: '20' },
  'food/Frozen Foods': { itemType: 'Frozen chicken', quantity: '10', expiry: '12/2027' },

  'business/Office Equipment': { equipmentType: 'Photocopier', brand: 'Canon' },
  'business/POS & Retail': { equipmentType: 'POS terminal', brand: 'Epson' },
  'business/Industrial Machinery': { machineType: 'Sewing machine', capacity: '100 pieces per hour' },
  'business/Generators': { powerOutput: '5 kVA', brand: 'Perkins' },
  'business/Restaurant Equipment': { brand: 'Hobart' },
  'business/Solar & Power Backup': { capacity: '5 kW', brand: 'Growatt' },

  'animals/Pets': { breed: 'Persian', age: '1 year' },
  'animals/Livestock': { breed: 'Boran', age: '2 years', weight: '35 kg' },
  'animals/Birds': { species: 'Parrot', age: '6 months' },
  'animals/Poultry': { quantity: '20', age: '5 months' },
  'animals/Fish & Aquarium': { quantity: '10' },
};

export const DEFAULT_TITLE_EXAMPLE = 'Item name and key details';

// Things people also rent out. Each of these asks "For sale or for rent" first (and how often the rent is paid), exactly like the
// commercial property types do; a listing saved before this question existed has no answer and stays a sale.
const RENTABLE_SCOPES = [
  'vehicles/Cars', 'vehicles/SUVs', 'vehicles/Trucks', 'vehicles/Motorcycles', 'vehicles/Bajaj', 'vehicles/Buses', 'vehicles/Boats',
  'construction/Tools & Equipment', 'agriculture/Farm Equipment',
  'business/Office Equipment', 'business/POS & Retail', 'business/Industrial Machinery', 'business/Generators', 'business/Restaurant Equipment', 'business/Solar & Power Backup',
];
export const RENTABLE = new Set(RENTABLE_SCOPES);
for (const scope of RENTABLE_SCOPES) {
  const fields = categoryFields[scope];
  if (fields && !fields.some((f) => f.key === 'offer')) categoryFields[scope] = [{ ...offerField(), requiredForNew: true }, rentPeriodWhenRented(), ...fields];
}

const resolvedFields = new Map<string, CategoryField[]>();

/** The scope key (`category/Subcategory` or bare `category`) whose field list applies, or undefined when the category has no extra fields. */
export function categoryFieldScope(category?: string, subcategory?: string): string | undefined {
  if (!category) return undefined;
  if (subcategory && categoryFields[`${category}/${subcategory}`]) return `${category}/${subcategory}`;
  return categoryFields[category] ? category : undefined;
}

/** Resolves the field set for a category/subcategory, preferring a subcategory-specific override, with each text field's example filled in. */
export function getCategoryFields(category?: string, subcategory?: string): CategoryField[] {
  const scope = categoryFieldScope(category, subcategory);
  if (!category || !scope) return [];
  // Cached per exact category/subcategory: the field list can be shared by every brand of phone, but each brand has its own examples.
  const exact = subcategory ? `${category}/${subcategory}` : category;
  const cached = resolvedFields.get(exact);
  if (cached) return cached;
  const fields = categoryFields[scope].map((f) =>
    f.type === 'text' && !f.placeholder ? { ...f, placeholder: fieldExamples[exact]?.[f.key] ?? fieldExamples[scope]?.[f.key] ?? fieldExamples[category]?.[f.key] } : f
  );
  resolvedFields.set(exact, fields);
  return fields;
}

/**
 * The fields that apply to this listing right now: a field with a `showIf`
 * rule is dropped unless the controlling field has one of the listed values.
 * Validation and publishing both work from this list, so a hidden answer is
 * neither checked nor saved.
 */
export function visibleFields(fields: CategoryField[], attributes: Record<string, string | undefined>): CategoryField[] {
  return fields.filter((f) => !f.showIf || f.showIf.equals.includes((attributes[f.showIf.key] ?? '').trim()));
}

/** The title example key a category/subcategory resolves to (the key of titleExamples), if it has one. */
export function titleExampleKey(category?: string, subcategory?: string): string | undefined {
  if (!category) return undefined;
  if (subcategory && titleExamples[`${category}/${subcategory}`]) return `${category}/${subcategory}`;
  return titleExamples[category] ? category : undefined;
}

/** English title example (no "e.g." prefix) for a category/subcategory. */
export function getTitleExample(category?: string, subcategory?: string): string {
  const key = titleExampleKey(category, subcategory);
  return key ? titleExamples[key] : DEFAULT_TITLE_EXAMPLE;
}

/** English title placeholder with its "e.g." prefix — used by the web sell page; mobile builds this from the translated example. */
export function getTitlePlaceholder(category?: string, subcategory?: string): string {
  return `e.g. ${getTitleExample(category, subcategory)}`;
}
