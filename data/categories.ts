import { Category } from '@/types';

// Every subcategory carries its own icon — shown next to its name wherever
// subcategories are listed (post flow, category browse screen).
export const categories: Category[] = [
  {
    id: 'vehicles',
    name: 'Vehicles',
    icon: 'car-outline',
    subcategories: [
      { name: 'Cars', icon: 'car-outline' },
      { name: 'SUVs', icon: 'car-sport-outline' },
      { name: 'Trucks', icon: 'mci:truck-outline' },
      { name: 'Motorcycles', icon: 'mci:motorbike' },
      { name: 'Bajaj', icon: 'mci:rickshaw' },
      { name: 'Spare Parts', icon: 'construct-outline' },
      { name: 'Buses', icon: 'bus-outline' },
      { name: 'Boats', icon: 'boat-outline' },
    ],
  },
  {
    id: 'phones',
    name: 'Phones',
    icon: 'phone-portrait-outline',
    subcategories: [
      { name: 'iPhone', icon: 'phone-portrait-outline' },
      { name: 'Samsung', icon: 'phone-portrait-outline' },
      { name: 'Tecno', icon: 'phone-portrait-outline' },
      { name: 'Infinix', icon: 'phone-portrait-outline' },
      { name: 'Xiaomi', icon: 'phone-portrait-outline' },
      { name: 'Nokia', icon: 'phone-portrait-outline' },
      { name: 'Huawei', icon: 'phone-portrait-outline' },
      { name: 'Oppo', icon: 'phone-portrait-outline' },
      { name: 'Vivo', icon: 'phone-portrait-outline' },
      { name: 'Itel', icon: 'phone-portrait-outline' },
      { name: 'Realme', icon: 'phone-portrait-outline' },
      { name: 'Accessories', icon: 'flash-outline' },
    ],
  },
  {
    id: 'electronics',
    name: 'Electronics',
    icon: 'tv-outline',
    subcategories: [
      { name: 'TVs', icon: 'tv-outline' },
      { name: 'Laptops', icon: 'laptop-outline' },
      { name: 'Cameras', icon: 'camera-outline' },
      { name: 'Gaming', icon: 'game-controller-outline' },
      { name: 'Speakers', icon: 'volume-high-outline' },
      { name: 'Tablets', icon: 'tablet-portrait-outline' },
      { name: 'Printers & Scanners', icon: 'print-outline' },
    ],
  },
  {
    id: 'fashion',
    name: 'Fashion',
    icon: 'shirt-outline',
    subcategories: [
      { name: 'Men', icon: 'shirt-outline' },
      { name: 'Women', icon: 'shirt-outline' },
      { name: 'Kids', icon: 'happy-outline' },
      { name: 'Shoes', icon: 'footsteps-outline' },
      { name: 'Watches', icon: 'watch-outline' },
      { name: 'Bags', icon: 'bag-handle-outline' },
      { name: 'Jewelry', icon: 'diamond-outline' },
    ],
  },
  {
    id: 'property',
    name: 'Property',
    icon: 'home-outline',
    subcategories: [
      { name: 'House for Sale', icon: 'home-outline' },
      { name: 'House for Rent', icon: 'key-outline' },
      { name: 'Apartment for Sale', icon: 'business-outline' },
      { name: 'Apartment for Rent', icon: 'business-outline' },
      { name: 'Land', icon: 'map-outline' },
      { name: 'Shop', icon: 'storefront-outline' },
      { name: 'Office', icon: 'briefcase-outline' },
      { name: 'Commercial Property', icon: 'business-outline' },
      { name: 'Warehouse', icon: 'mci:warehouse' },
      { name: 'Guest House / Villa', icon: 'mci:home-city-outline' },
    ],
  },
  {
    id: 'jobs',
    name: 'Jobs',
    icon: 'briefcase-outline',
    subcategories: [
      { name: 'Hotel Jobs', icon: 'bed-outline' },
      { name: 'Restaurant Jobs', icon: 'restaurant-outline' },
      { name: 'Office Jobs', icon: 'business-outline' },
      { name: 'Construction Jobs', icon: 'hammer-outline' },
      { name: 'Driver Jobs', icon: 'car-outline' },
      { name: 'Cleaner Jobs', icon: 'sparkles-outline' },
      { name: 'Healthcare Jobs', icon: 'medkit-outline' },
      { name: 'Education Jobs', icon: 'school-outline' },
      { name: 'Security Jobs', icon: 'shield-checkmark-outline' },
      { name: 'NGO Jobs', icon: 'earth-outline' },
      { name: 'Sales & Marketing Jobs', icon: 'megaphone-outline' },
      { name: 'Other Jobs', icon: 'briefcase-outline' },
    ],
  },
  {
    id: 'services',
    name: 'Services',
    icon: 'construct-outline',
    subcategories: [
      { name: 'Electrician', icon: 'flash-outline' },
      { name: 'Plumber', icon: 'water-outline' },
      { name: 'Painter', icon: 'color-palette-outline' },
      { name: 'Cleaning', icon: 'sparkles-outline' },
      { name: 'Internet', icon: 'wifi-outline' },
      { name: 'Transport', icon: 'car-outline' },
      { name: 'Mechanic', icon: 'construct-outline' },
      { name: 'IT', icon: 'desktop-outline' },
      { name: 'Tutor', icon: 'school-outline' },
      { name: 'Salon', icon: 'cut-outline' },
      { name: 'Solar Installation', icon: 'sunny-outline' },
      { name: 'Generator Repair', icon: 'build-outline' },
      { name: 'Photography', icon: 'camera-outline' },
    ],
  },
  {
    id: 'animals',
    name: 'Animals',
    icon: 'paw-outline',
    subcategories: [
      { name: 'Pets', icon: 'paw-outline' },
      { name: 'Livestock', icon: 'mci:cow' },
      { name: 'Birds', icon: 'mci:bird' },
      { name: 'Poultry', icon: 'egg-outline' },
      { name: 'Fish & Aquarium', icon: 'mci:fish' },
    ],
  },
  {
    id: 'furniture',
    name: 'Furniture',
    icon: 'bed-outline',
    subcategories: [
      { name: 'Sofas', icon: 'mci:sofa-outline' },
      { name: 'Beds', icon: 'bed-outline' },
      { name: 'Tables & Chairs', icon: 'mci:table-chair' },
      { name: 'Wardrobes', icon: 'mci:wardrobe-outline' },
      { name: 'Office Furniture', icon: 'mci:desk' },
      { name: 'Outdoor Furniture', icon: 'mci:table-picnic' },
    ],
  },
  {
    id: 'kitchen',
    name: 'Kitchen',
    icon: 'restaurant-outline',
    subcategories: [
      { name: 'Cookware', icon: 'restaurant-outline' },
      { name: 'Appliances', icon: 'mci:fridge-outline' },
      { name: 'Utensils', icon: 'mci:silverware-fork-knife' },
      { name: 'Storage', icon: 'cube-outline' },
      { name: 'Bakeware', icon: 'mci:cupcake' },
    ],
  },
  {
    id: 'construction',
    name: 'Construction',
    icon: 'hammer-outline',
    subcategories: [
      { name: 'Building Materials', icon: 'cube-outline' },
      { name: 'Tools & Equipment', icon: 'mci:toolbox-outline' },
      { name: 'Cement & Blocks', icon: 'layers-outline' },
      { name: 'Electrical Supplies', icon: 'flash-outline' },
      { name: 'Plumbing Supplies', icon: 'mci:pipe-wrench' },
      { name: 'Roofing', icon: 'mci:home-roof' },
      { name: 'Steel & Metal Works', icon: 'mci:anvil' },
    ],
  },
  {
    id: 'agriculture',
    name: 'Agriculture',
    icon: 'leaf-outline',
    subcategories: [
      { name: 'Livestock', icon: 'mci:cow' },
      { name: 'Seeds & Crops', icon: 'leaf-outline' },
      { name: 'Farm Equipment', icon: 'mci:tractor' },
      { name: 'Irrigation', icon: 'mci:sprinkler-variant' },
      { name: 'Poultry Equipment', icon: 'egg-outline' },
      { name: 'Greenhouse & Nursery', icon: 'mci:greenhouse' },
    ],
  },
  {
    id: 'beauty',
    name: 'Beauty',
    icon: 'sparkles-outline',
    subcategories: [
      { name: 'Skincare', icon: 'mci:face-woman-outline' },
      { name: 'Makeup', icon: 'color-palette-outline' },
      { name: 'Haircare', icon: 'mci:hair-dryer-outline' },
      { name: 'Fragrances', icon: 'mci:spray-bottle' },
      { name: 'Nails', icon: 'mci:hand-back-right-outline' },
      { name: 'Traditional & Henna', icon: 'mci:flower-outline' },
    ],
  },
  {
    id: 'sports',
    name: 'Sports',
    icon: 'football-outline',
    subcategories: [
      { name: 'Fitness Equipment', icon: 'barbell-outline' },
      { name: 'Team Sports', icon: 'football-outline' },
      { name: 'Outdoor & Camping', icon: 'bonfire-outline' },
      { name: 'Bicycles', icon: 'bicycle-outline' },
      { name: 'Swimming', icon: 'mci:swim' },
      { name: 'Running & Athletics', icon: 'walk-outline' },
    ],
  },
  {
    id: 'books',
    name: 'Books',
    icon: 'book-outline',
    subcategories: [
      { name: 'Textbooks', icon: 'book-outline' },
      { name: 'Novels', icon: 'library-outline' },
      { name: 'Religious Books', icon: 'book-outline' },
      { name: "Children's Books", icon: 'happy-outline' },
      { name: 'University & Exam Prep', icon: 'school-outline' },
    ],
  },
  {
    id: 'baby',
    name: 'Baby',
    icon: 'fa5:baby',
    subcategories: [
      { name: 'Baby Gear', icon: 'mci:baby-carriage' },
      { name: 'Clothing', icon: 'shirt-outline' },
      { name: 'Toys', icon: 'mci:teddy-bear' },
      { name: 'Feeding', icon: 'mci:baby-bottle-outline' },
      { name: 'Baby Safety', icon: 'shield-checkmark-outline' },
    ],
  },
  {
    id: 'food',
    name: 'Food',
    icon: 'fast-food-outline',
    subcategories: [
      { name: 'Groceries', icon: 'basket-outline' },
      { name: 'Beverages', icon: 'cafe-outline' },
      { name: 'Snacks', icon: 'fast-food-outline' },
      { name: 'Bakery', icon: 'restaurant-outline' },
      { name: 'Fruits & Vegetables', icon: 'nutrition-outline' },
      { name: 'Frozen Foods', icon: 'mci:snowflake' },
    ],
  },
  {
    id: 'business',
    name: 'Business Equipment',
    icon: 'business-outline',
    subcategories: [
      { name: 'Office Equipment', icon: 'business-outline' },
      { name: 'POS & Retail', icon: 'mci:cash-register' },
      { name: 'Industrial Machinery', icon: 'cog-outline' },
      { name: 'Generators', icon: 'mci:generator-stationary' },
      { name: 'Restaurant Equipment', icon: 'restaurant-outline' },
      { name: 'Solar & Power Backup', icon: 'sunny-outline' },
    ],
  },
];

// The full list of cities Suuq+ supports, used everywhere a city is chosen or
// filtered on (CityPicker, LocationSwitcher, post/location, city/[name], home
// and search filtering). Adding a new launch city later is just adding it
// here (plus its currency/region below) — no screen needs to change.
export const regions = ['Addis Ababa', 'Dire Dawa', 'Jigjiga', 'Harar', 'Wajaale', 'Hargeisa'];

// The 3 cities getting concentrated marketing focus at launch
export const featuredCities = ['Jigjiga', 'Hargeisa', 'Addis Ababa'];

// Currency is derived automatically from the seller's chosen city (post/location runs
// before post/price) — never shown as a manual selector.
export const currencies = ['USD', 'ETB'] as const;

// City selection (post/location) determines currency for post/price automatically.
export const cityCurrency: Record<string, (typeof currencies)[number]> = {
  Hargeisa: 'USD',
  Wajaale: 'USD',
  Jigjiga: 'ETB',
  'Addis Ababa': 'ETB',
  'Dire Dawa': 'ETB',
  Harar: 'ETB',
};

// Matches the region grouping already used in data/mockListings.ts.
export const cityRegion: Record<string, string> = {
  Hargeisa: 'Somaliland',
  Wajaale: 'Somaliland',
  Jigjiga: 'Somali Region',
  'Addis Ababa': 'Ethiopia',
  'Dire Dawa': 'Ethiopia',
  Harar: 'Ethiopia',
};
