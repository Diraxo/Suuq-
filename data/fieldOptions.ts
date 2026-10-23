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

// Utilities (electricity, water) are often unknown to the person listing —
// "Not sure" is a real answer, never a reason to block publishing.
export const AVAILABILITY_OPTIONS = ['Available', 'Not available', 'Not sure'];
export const YES_NO_NOT_SURE = ['Yes', 'No', 'Not sure'];

// How often the rent is charged — the amount itself is the listing price.
export const RENT_PERIODS = ['Per month', 'Per week', 'Per day', 'Per year'];
// Nightly is the normal way to rent a guest house or villa.
export const STAY_PERIODS = ['Per night', 'Per week', 'Per month'];
export const PROPERTY_OFFERS = ['For sale', 'For rent'];
// What a home rental includes. In the region many people rent out one room of the house they live in, so that is its own choice.
export const RENTAL_KINDS = ['Furnished home', 'Empty home', 'One room only'];
export const PROPERTY_AVAILABILITY = ['Available now', 'Available soon'];
export const LEASE_TERMS = ['Monthly', '6 months', 'Yearly'];
export const PACKAGING_OPTIONS = ['Sealed / packaged', 'Opened', 'Loose / bulk'];
