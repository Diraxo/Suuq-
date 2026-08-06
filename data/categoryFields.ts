import {
  COLORS,
  LAPTOP_SCREEN_SIZES,
  TV_SCREEN_SIZES,
  STORAGE_OPTIONS,
  RAM_OPTIONS,
  BEDROOMS,
  BATHROOMS,
  ENGINE_SIZE_OPTIONS,
  REGISTRATION_OPTIONS,
} from './fieldOptions';

export type CategoryField = {
  key: string;
  label: string;
  type: 'text' | 'select' | 'year';
  options?: string[];
  required?: boolean;
};

// Free-text fields whose values are always plain numbers, with no unit
// letters a numeric keypad would block the user from typing (unlike
// "Power Output" = "5kVA" or "Size" = "M"/"XL" on other fields sharing a key
// name across categories) — DynamicField uses this to switch to a numeric
// keyboard instead of the default alphabetic one.
export const NUMERIC_FIELD_KEYS = new Set(['mileage', 'engineCC', 'quantity', 'gears', 'resolution', 'lengthMeters', 'ceilingHeight', 'voltage', 'weightCapacity']);

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
    { key: 'engineSize', label: 'Engine Size', type: 'select', options: ENGINE_SIZE_OPTIONS },
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
    { key: 'engineSize', label: 'Engine Size', type: 'select', options: ENGINE_SIZE_OPTIONS },
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
    { key: 'battery', label: 'Battery Health', type: 'text' },
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

  // ---- Property: each listing type asks only for relevant fields ----
  'property/House for Sale': [
    { key: 'bedrooms', label: 'Bedrooms', type: 'select', options: BEDROOMS, required: true },
    { key: 'bathrooms', label: 'Bathrooms', type: 'select', options: BATHROOMS },
    { key: 'size', label: 'Size (sqm)', type: 'text' },
    { key: 'furnished', label: 'Furnished', type: 'select', options: ['Yes', 'No'] },
    { key: 'parking', label: 'Parking', type: 'select', options: ['Yes', 'No'] },
    { key: 'yearBuilt', label: 'Year Built', type: 'year' },
    { key: 'titleDeed', label: 'Title Deed', type: 'select', options: ['Yes', 'No'] },
  ],
  'property/House for Rent': [
    { key: 'bedrooms', label: 'Bedrooms', type: 'select', options: BEDROOMS, required: true },
    { key: 'bathrooms', label: 'Bathrooms', type: 'select', options: BATHROOMS },
    { key: 'size', label: 'Size (sqm)', type: 'text' },
    { key: 'furnished', label: 'Furnished', type: 'select', options: ['Yes', 'No'] },
    { key: 'parking', label: 'Parking', type: 'select', options: ['Yes', 'No'] },
    { key: 'leaseTerm', label: 'Lease Term', type: 'select', options: ['Monthly', '6 months', 'Yearly'] },
    { key: 'utilitiesIncluded', label: 'Utilities Included', type: 'select', options: ['Yes', 'No'] },
    { key: 'neighborhood', label: 'Neighborhood', type: 'text' },
  ],
  'property/Apartment for Sale': [
    { key: 'bedrooms', label: 'Bedrooms', type: 'select', options: BEDROOMS, required: true },
    { key: 'bathrooms', label: 'Bathrooms', type: 'select', options: BATHROOMS },
    { key: 'floor', label: 'Floor', type: 'text' },
    { key: 'size', label: 'Size (sqm)', type: 'text' },
    { key: 'furnished', label: 'Furnished', type: 'select', options: ['Yes', 'No'] },
    { key: 'parking', label: 'Parking', type: 'select', options: ['Yes', 'No'] },
    { key: 'titleDeed', label: 'Title Deed', type: 'select', options: ['Yes', 'No'] },
  ],
  'property/Apartment for Rent': [
    { key: 'bedrooms', label: 'Bedrooms', type: 'select', options: BEDROOMS, required: true },
    { key: 'bathrooms', label: 'Bathrooms', type: 'select', options: BATHROOMS },
    { key: 'floor', label: 'Floor', type: 'text' },
    { key: 'size', label: 'Size (sqm)', type: 'text' },
    { key: 'furnished', label: 'Furnished', type: 'select', options: ['Yes', 'No'] },
    { key: 'parking', label: 'Parking', type: 'select', options: ['Yes', 'No'] },
    { key: 'leaseTerm', label: 'Lease Term', type: 'select', options: ['Monthly', '6 months', 'Yearly'] },
    { key: 'utilitiesIncluded', label: 'Utilities Included', type: 'select', options: ['Yes', 'No'] },
  ],
  'property/Land': [
    { key: 'size', label: 'Area', type: 'text', required: true },
    { key: 'unit', label: 'Unit', type: 'select', options: ['sqm', 'Hectare', 'Acre'] },
    { key: 'landType', label: 'Purpose', type: 'select', options: ['Residential', 'Commercial', 'Agricultural'] },
    { key: 'titleDeed', label: 'Title', type: 'select', options: ['Yes', 'No'] },
    { key: 'roadAccess', label: 'Road Access', type: 'select', options: ['Yes', 'No'] },
    { key: 'water', label: 'Water', type: 'select', options: ['Yes', 'No'] },
    { key: 'electricity', label: 'Electricity', type: 'select', options: ['Yes', 'No'] },
  ],
  'property/Shop': [
    { key: 'size', label: 'Size (sqm)', type: 'text', required: true },
    { key: 'floor', label: 'Floor', type: 'text' },
    { key: 'parking', label: 'Parking', type: 'select', options: ['Yes', 'No'] },
  ],
  'property/Office': [
    { key: 'size', label: 'Size (sqm)', type: 'text', required: true },
    { key: 'floor', label: 'Floor', type: 'text' },
    { key: 'parking', label: 'Parking', type: 'select', options: ['Yes', 'No'] },
  ],
  'property/Commercial Property': [
    { key: 'size', label: 'Size (sqm)', type: 'text', required: true },
    { key: 'floor', label: 'Floor', type: 'text' },
    { key: 'parking', label: 'Parking', type: 'select', options: ['Yes', 'No'] },
  ],
  'property/Warehouse': [
    { key: 'size', label: 'Size (sqm)', type: 'text', required: true },
    { key: 'ceilingHeight', label: 'Ceiling Height (m)', type: 'text' },
    { key: 'loadingDock', label: 'Loading Dock', type: 'select', options: ['Yes', 'No'] },
    { key: 'parking', label: 'Parking', type: 'select', options: ['Yes', 'No'] },
  ],
  'property/Guest House / Villa': [
    { key: 'bedrooms', label: 'Bedrooms', type: 'select', options: BEDROOMS, required: true },
    { key: 'bathrooms', label: 'Bathrooms', type: 'select', options: BATHROOMS },
    { key: 'furnished', label: 'Furnished', type: 'select', options: ['Yes', 'No'] },
    { key: 'parking', label: 'Parking', type: 'select', options: ['Yes', 'No'] },
    { key: 'pool', label: 'Swimming Pool', type: 'select', options: ['Yes', 'No'] },
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

  // ---- Food ----
  'food/Groceries': [
    { key: 'itemType', label: 'Item Type', type: 'text', required: true },
    { key: 'quantity', label: 'Quantity', type: 'text' },
    { key: 'unit', label: 'Unit', type: 'select', options: ['kg', 'Piece', 'Bag', 'Carton'] },
  ],
  'food/Beverages': [
    { key: 'itemType', label: 'Item Type', type: 'text', required: true },
    { key: 'volume', label: 'Volume', type: 'text' },
    { key: 'quantity', label: 'Quantity', type: 'text' },
  ],
  'food/Snacks': [
    { key: 'itemType', label: 'Item Type', type: 'text', required: true },
    { key: 'quantity', label: 'Quantity', type: 'text' },
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
    { key: 'organic', label: 'Organic', type: 'select', options: ['Yes', 'No'] },
  ],
  'food/Frozen Foods': [
    { key: 'itemType', label: 'Item Type', type: 'text', required: true },
    { key: 'quantity', label: 'Quantity', type: 'text' },
    { key: 'unit', label: 'Unit', type: 'select', options: ['kg', 'Piece', 'Pack', 'Carton'] },
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

// Dynamic title placeholders — every subcategory (or category, when it has
// no subcategories) gets its own example instead of the generic phone one.
export const titlePlaceholders: Record<string, string> = {
  'vehicles/Cars': 'e.g. Toyota Corolla 2018',
  'vehicles/SUVs': 'e.g. Toyota Prado 2016',
  'vehicles/Trucks': 'e.g. Isuzu NPR 2015',
  'vehicles/Motorcycles': 'e.g. Honda CG 125 2020',
  'vehicles/Bajaj': 'e.g. TVS King 2024',
  'vehicles/Spare Parts': 'e.g. Genuine Toyota brake pads',
  'vehicles/Buses': 'e.g. Toyota Coaster 30-seater 2017',
  'vehicles/Boats': 'e.g. Fiberglass fishing boat, 6m',
  phones: 'e.g. iPhone 13 Pro Max 256GB',
  'phones/iPhone': 'e.g. iPhone 14 Pro 256GB',
  'phones/Samsung': 'e.g. Samsung Galaxy S24 Ultra',
  'phones/Tecno': 'e.g. Tecno Camon 20 Pro',
  'phones/Infinix': 'e.g. Infinix Note 30',
  'phones/Xiaomi': 'e.g. Xiaomi Redmi Note 12',
  'phones/Nokia': 'e.g. Nokia G42',
  'phones/Huawei': 'e.g. Huawei P50 Pro',
  'phones/Oppo': 'e.g. Oppo Reno 10',
  'phones/Vivo': 'e.g. Vivo V29',
  'phones/Itel': 'e.g. Itel A70 64GB',
  'phones/Realme': 'e.g. Realme 11 Pro+',
  'phones/Accessories': 'e.g. Fast charger with USB-C cable',
  'electronics/TVs': 'e.g. Samsung 55" 4K Smart TV',
  'electronics/Laptops': 'e.g. Dell Latitude 5420',
  'electronics/Cameras': 'e.g. Canon EOS 200D DSLR',
  'electronics/Gaming': 'e.g. PlayStation 5 with 2 controllers',
  'electronics/Speakers': 'e.g. JBL Flip 6 Bluetooth speaker',
  'electronics/Tablets': 'e.g. Samsung Galaxy Tab A9 64GB',
  'electronics/Printers & Scanners': 'e.g. HP LaserJet all-in-one printer',
  'fashion/Men': "e.g. Men's leather jacket, size L",
  'fashion/Women': "e.g. Women's abaya, size M",
  'fashion/Kids': "e.g. Kids' school uniform, age 8",
  'fashion/Shoes': 'e.g. Nike Air Max, size 42',
  'fashion/Watches': 'e.g. Rolex Datejust',
  'fashion/Bags': 'e.g. Leather handbag, barely used',
  'fashion/Jewelry': 'e.g. Gold-plated necklace set',
  'property/House for Sale': 'e.g. 4 Bedroom House for Sale',
  'property/House for Rent': 'e.g. 3 Bedroom House for Rent',
  'property/Apartment for Sale': 'e.g. 2 Bedroom Apartment for Sale',
  'property/Apartment for Rent': 'e.g. 2 Bedroom Apartment for Rent',
  'property/Land': 'e.g. 500 sqm Residential Plot',
  'property/Shop': 'e.g. Shop for Rent, Main Market',
  'property/Office': 'e.g. Office Space for Rent, City Center',
  'property/Commercial Property': 'e.g. Commercial Building for Sale',
  'property/Warehouse': 'e.g. 500 sqm Warehouse with Loading Dock',
  'property/Guest House / Villa': 'e.g. 4 Bedroom Villa with Pool',
  jobs: 'e.g. Receptionist Needed',
  'jobs/NGO Jobs': 'e.g. Program Officer, Humanitarian NGO',
  'jobs/Sales & Marketing Jobs': 'e.g. Sales Representative Needed',
  'services/Electrician': 'e.g. Licensed electrician for home wiring',
  'services/Plumber': 'e.g. Plumber for leak repair and installation',
  'services/Painter': 'e.g. Interior and exterior house painting',
  'services/Cleaning': 'e.g. Deep home cleaning service',
  'services/Internet': 'e.g. Home Wi-Fi installation and setup',
  'services/Transport': 'e.g. Pickup truck for hire, city and intercity',
  'services/Mechanic': 'e.g. Mobile car mechanic, all makes',
  'services/IT': 'e.g. Computer repair and network setup',
  'services/Tutor': 'e.g. Math tutor for high school students',
  'services/Salon': 'e.g. Home hairdressing and salon service',
  'services/Solar Installation': 'e.g. Solar panel installation and setup',
  'services/Generator Repair': 'e.g. Generator repair and maintenance',
  'services/Photography': 'e.g. Event and portrait photography',
  'furniture/Sofas': 'e.g. 3-seater leather sofa, barely used',
  'furniture/Beds': 'e.g. Queen size bed frame with mattress',
  'furniture/Tables & Chairs': 'e.g. 6-seater dining table set',
  'furniture/Wardrobes': 'e.g. 3-door wooden wardrobe',
  'furniture/Office Furniture': 'e.g. Office desk and chair set',
  'furniture/Outdoor Furniture': 'e.g. 4-piece patio furniture set',
  'kitchen/Cookware': 'e.g. Non-stick cookware set, 10 pieces',
  'kitchen/Appliances': 'e.g. Double-door fridge, energy saving',
  'kitchen/Utensils': 'e.g. Stainless steel utensil set',
  'kitchen/Storage': 'e.g. Airtight food storage containers, set of 5',
  'kitchen/Bakeware': 'e.g. Non-stick baking tray set',
  'construction/Building Materials': 'e.g. Steel rebar, 12mm, 50 pieces',
  'construction/Tools & Equipment': 'e.g. Bosch angle grinder, barely used',
  'construction/Cement & Blocks': 'e.g. 50 bags of cement, unopened',
  'construction/Electrical Supplies': 'e.g. Electrical cable, 100m roll',
  'construction/Plumbing Supplies': 'e.g. PVC pipes, 4 inch, 20 pieces',
  'construction/Roofing': 'e.g. Galvanized roofing sheets, 20 pieces',
  'construction/Steel & Metal Works': 'e.g. Welded steel gate frame',
  'agriculture/Livestock': 'e.g. Dairy cow, 3 years old',
  'agriculture/Seeds & Crops': 'e.g. Maize seeds, 50kg sack',
  'agriculture/Farm Equipment': 'e.g. Water pump for irrigation',
  'agriculture/Irrigation': 'e.g. Drip irrigation kit, covers 1 acre',
  'agriculture/Poultry Equipment': 'e.g. Automatic egg incubator, 100 capacity',
  'agriculture/Greenhouse & Nursery': 'e.g. Greenhouse kit, 20 sqm',
  'beauty/Skincare': 'e.g. Vitamin C serum, sealed',
  'beauty/Makeup': 'e.g. Full face makeup kit',
  'beauty/Haircare': 'e.g. Argan oil hair treatment set',
  'beauty/Fragrances': 'e.g. Designer perfume, 100ml, sealed',
  'beauty/Nails': 'e.g. Press-on nails set with glue',
  'beauty/Traditional & Henna': 'e.g. Natural henna cones, pack of 12',
  'sports/Fitness Equipment': 'e.g. Adjustable dumbbell set',
  'sports/Team Sports': 'e.g. Official size football',
  'sports/Outdoor & Camping': 'e.g. 4-person camping tent',
  'sports/Bicycles': 'e.g. Mountain bike, 21-speed',
  'sports/Swimming': 'e.g. Swimming goggles and cap set',
  'sports/Running & Athletics': 'e.g. Running shoes, size 43',
  'books/Textbooks': 'e.g. High school biology textbook',
  'books/Novels': 'e.g. Best-selling fiction novel',
  'books/Religious Books': 'e.g. Quran with translation',
  "books/Children's Books": 'e.g. Illustrated storybook, ages 4-8',
  'books/University & Exam Prep': 'e.g. University entrance exam prep guide',
  'baby/Baby Gear': 'e.g. Baby stroller, lightly used',
  'baby/Clothing': 'e.g. Baby clothes bundle, 0-6 months',
  'baby/Toys': 'e.g. Wooden building blocks set',
  'baby/Feeding': 'e.g. Baby bottle set with sterilizer',
  'baby/Baby Safety': 'e.g. Rear-facing car seat, barely used',
  'food/Groceries': 'e.g. Bulk rice, 25kg bag',
  'food/Beverages': 'e.g. Bottled water, case of 24',
  'food/Snacks': 'e.g. Mixed nuts, 5kg bulk pack',
  'food/Bakery': 'e.g. Fresh bread, baked daily',
  'food/Fruits & Vegetables': 'e.g. Fresh bananas, 20kg crate',
  'food/Frozen Foods': 'e.g. Frozen chicken, 10kg pack',
  'business/Office Equipment': 'e.g. Photocopier, barely used',
  'business/POS & Retail': 'e.g. POS machine with receipt printer',
  'business/Industrial Machinery': 'e.g. Industrial sewing machine',
  'business/Generators': 'e.g. 5kVA diesel generator',
  'business/Restaurant Equipment': 'e.g. Commercial gas oven, 6-burner',
  'business/Solar & Power Backup': 'e.g. 5kW solar inverter kit',
  'animals/Pets': 'e.g. Persian cat, vaccinated',
  'animals/Livestock': 'e.g. Goat, healthy and vaccinated',
  'animals/Birds': 'e.g. Parrot with cage',
  'animals/Poultry': 'e.g. 20 laying hens',
  'animals/Fish & Aquarium': 'e.g. 60L aquarium with filter and fish',
};

const DEFAULT_TITLE_PLACEHOLDER = 'e.g. Item name and key details';

/** Resolves the field set for a category/subcategory, preferring a subcategory-specific override. */
export function getCategoryFields(category?: string, subcategory?: string): CategoryField[] {
  if (!category) return [];
  if (subcategory) {
    const specific = categoryFields[`${category}/${subcategory}`];
    if (specific) return specific;
  }
  return categoryFields[category] ?? [];
}

/** Resolves the title placeholder for a category/subcategory, preferring a subcategory-specific example. */
export function getTitlePlaceholder(category?: string, subcategory?: string): string {
  if (!category) return DEFAULT_TITLE_PLACEHOLDER;
  if (subcategory) {
    const specific = titlePlaceholders[`${category}/${subcategory}`];
    if (specific) return specific;
  }
  return titlePlaceholders[category] ?? DEFAULT_TITLE_PLACEHOLDER;
}
