// Shared option lists reused across data/categoryFields.ts wherever a field
// has a known, finite set of values — so the seller picks instead of typing,
// and every category using e.g. "Color" offers the exact same list.

export const COLORS = [
  'Black',
  'White',
  'Blue',
  'Silver',
  'Gray',
  'Red',
  'Green',
  'Gold',
  'Purple',
  'Pink',
  'Brown',
  'Orange',
  'Yellow',
  'Beige',
  'Navy',
];

export const LAPTOP_SCREEN_SIZES = ['11"', '13"', '14"', '15.6"', '17"+'];
export const TV_SCREEN_SIZES = ['24"', '32"', '40"', '43"', '50"', '55"', '65"', '75"+'];

export const STORAGE_OPTIONS = ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB+'];
export const RAM_OPTIONS = ['2GB', '3GB', '4GB', '6GB', '8GB', '12GB', '16GB', '32GB+'];

export const BEDROOMS = ['1', '2', '3', '4', '5+'];
export const BATHROOMS = ['1', '2', '3', '4+'];
export const SEATS = ['2', '4', '5', '7', '8+'];

export const TRANSMISSION_OPTIONS = ['Automatic', 'Manual'];
export const FUEL_OPTIONS = ['Petrol', 'Diesel', 'Hybrid', 'Electric'];

export const YES_NO = ['Yes', 'No'];

export const ENGINE_SIZE_OPTIONS = ['1.0L', '1.2L', '1.5L', '1.8L', '2.0L', '2.5L', '3.0L', '4.0L', '5.0L', 'Other'];
export const REGISTRATION_OPTIONS = ['Registered', 'Not Registered', 'In Process'];
