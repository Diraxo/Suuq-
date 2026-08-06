// Optional checklist of highlights shown as a "Features" section on the
// listing detail page and offered as toggle chips on the posting form. Same
// lookup convention as categoryFields.ts (bare category id, or
// "category/Subcategory" for a set specific to one subcategory) — categories
// with nothing meaningful to check off (jobs, services, food, ...) simply
// have no entry, and the Features section doesn't render for them.
export const categoryFeatures: Record<string, string[]> = {
  // Face ID is an iPhone-specific feature — every other phone brand only
  // offers a fingerprint sensor, never Face ID.
  'phones/iPhone': ['Face ID', 'Fingerprint sensor', 'Bluetooth 5.0', 'NFC', 'Fast charging', 'Water resistant', 'Stereo speakers'],
  phones: ['Fingerprint sensor', 'Bluetooth 5.0', 'NFC', 'Dual SIM', 'Fast charging', 'Water resistant', 'Stereo speakers'],

  'electronics/Laptops': ['Backlit keyboard', 'Touchscreen', 'Fingerprint sensor', 'Bluetooth', 'HDMI port', 'Webcam'],
  'electronics/TVs': ['Smart TV', 'HDR', 'Bluetooth', 'Voice remote', 'Wall-mountable'],
  'electronics/Cameras': ['Wi-Fi transfer', '4K video', 'Image stabilization', 'Flip screen'],
  'electronics/Gaming': ['Extra controller included', 'Online-ready', 'VR compatible'],
  'electronics/Speakers': ['Bluetooth', 'Waterproof', 'Rechargeable battery', 'Stereo pairing'],

  'vehicles/Cars': ['Air conditioning', 'Reverse camera', 'Leather seats', 'Cruise control', 'Sunroof', 'Alloy wheels', 'Power steering', 'Bluetooth'],
  'vehicles/SUVs': ['Air conditioning', 'Reverse camera', 'Leather seats', 'Cruise control', 'Sunroof', '4WD', 'Alloy wheels', 'Bluetooth'],
  'vehicles/Trucks': ['Air conditioning', 'Power steering', '4WD', 'Reverse camera'],
  'vehicles/Motorcycles': ['Electric start', 'Disc brakes', 'Alloy rims'],
  'vehicles/Bajaj': ['Electric start', 'Disc brakes'],
  'vehicles/Buses': ['Air conditioning', 'Reclining seats', 'Luggage compartment', 'PA system'],
  'vehicles/Boats': ['GPS', 'Life jackets included', 'Fish finder', 'Canopy/Roof'],

  'electronics/Tablets': ['Bluetooth', 'Backlit keyboard support', 'Stylus support', 'Fingerprint sensor'],

  'property/House for Sale': ['Parking', 'Balcony', 'Water tank', 'Security', 'Garden', 'Generator backup'],
  'property/House for Rent': ['Parking', 'Balcony', 'Water tank', 'Security', 'Garden', 'Generator backup'],
  'property/Apartment for Sale': ['Parking', 'Balcony', 'Water tank', 'Security', 'Elevator', 'Generator backup'],
  'property/Apartment for Rent': ['Parking', 'Balcony', 'Water tank', 'Security', 'Elevator', 'Generator backup'],
  'property/Shop': ['Parking', 'Security', 'Generator backup'],
  'property/Office': ['Parking', 'Security', 'Elevator', 'Generator backup'],
  'property/Commercial Property': ['Parking', 'Security', 'Generator backup'],

  'furniture/Sofas': ['Removable covers', 'Reclining', 'Pull-out bed'],
  'sports/Bicycles': ['Front suspension', 'Disc brakes', 'Rear rack'],
};

/** Resolves the feature checklist for a category/subcategory, preferring a subcategory-specific override. Empty for categories with no feature list. */
export function getCategoryFeatures(category?: string, subcategory?: string): string[] {
  if (!category) return [];
  if (subcategory) {
    const specific = categoryFeatures[`${category}/${subcategory}`];
    if (specific) return specific;
  }
  return categoryFeatures[category] ?? [];
}
