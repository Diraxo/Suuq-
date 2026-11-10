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

export const LAPTOP_SCREEN_SIZES = ['11"', '12"', '13"', '14"', '15"', '15.6"', '16"', '17"+'];
export const TABLET_SCREEN_SIZES = ['7"', '8"', '8.3"', '9"', '10"', '11"', '12"', '13"+'];
export const DESKTOP_SCREEN_SIZES = ['No screen included', '19"', '21.5"', '22"', '24"', '27"', '32"+'];
export const MONITOR_SIZES = ['19"', '22"', '24"', '27"', '32"', '34"+'];
export const TV_SCREEN_SIZES = ['24"', '32"', '40"', '43"', '50"', '55"', '65"', '75"+'];

export const STORAGE_OPTIONS = ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB+'];
export const RAM_OPTIONS = ['2GB', '3GB', '4GB', '6GB', '8GB', '12GB', '16GB', '32GB+'];

// Laptops, desktops and parts: bigger memory/storage than phones (Apple sells 18/24/36/48/96 GB laptops and up to 8 TB drives).
export const COMPUTER_RAM = ['4GB', '8GB', '12GB', '16GB', '18GB', '24GB', '32GB', '36GB', '48GB', '64GB', '96GB', '128GB+'];
export const COMPUTER_STORAGE = ['128GB', '256GB', '512GB', '1TB', '2TB', '4TB', '8TB'];
export const STORAGE_TYPES = ['SSD', 'HDD', 'SSD + HDD', 'eMMC'];
export const COMPUTER_OS = ['Windows 11', 'Windows 10', 'macOS', 'ChromeOS', 'Linux', 'No OS'];
// Processor families, newest generation last within each maker. Chip NAMES are the same in every language.
export const COMPUTER_PROCESSORS = [
  'Intel Celeron', 'Intel Pentium', 'Intel Core i3', 'Intel Core i5', 'Intel Core i7', 'Intel Core i9',
  'Intel Core 5', 'Intel Core 7', 'Intel Core Ultra 5', 'Intel Core Ultra 7', 'Intel Core Ultra 9',
  'AMD Athlon', 'AMD Ryzen 3', 'AMD Ryzen 5', 'AMD Ryzen 7', 'AMD Ryzen 9', 'AMD Ryzen AI 5', 'AMD Ryzen AI 7', 'AMD Ryzen AI 9', 'AMD Ryzen AI Max',
  'Snapdragon X', 'Snapdragon X Plus', 'Snapdragon X Elite',
  'Apple A18 Pro', 'Apple M1', 'Apple M1 Pro', 'Apple M1 Max', 'Apple M1 Ultra', 'Apple M2', 'Apple M2 Pro', 'Apple M2 Max', 'Apple M2 Ultra',
  'Apple M3', 'Apple M3 Pro', 'Apple M3 Max', 'Apple M3 Ultra', 'Apple M4', 'Apple M4 Pro', 'Apple M4 Max',
  'Apple M5', 'Apple M5 Pro', 'Apple M5 Max', 'Apple M6',
  'Other',
];
export const COMPUTER_GRAPHICS = [
  'Integrated graphics', 'Intel Arc', 'NVIDIA GeForce MX', 'NVIDIA GeForce GTX', 'NVIDIA GeForce RTX 20 series', 'NVIDIA GeForce RTX 30 series',
  'NVIDIA GeForce RTX 40 series', 'NVIDIA GeForce RTX 50 series', 'NVIDIA RTX Pro / Quadro', 'AMD Radeon (dedicated)',
];
export const KEYBOARD_LAYOUTS = ['English (QWERTY)', 'Arabic + English', 'Other layout'];

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
