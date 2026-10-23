// Reference points for "Find listings near me". Each entry names a city that
// exists in the location directory (public.locations); the coordinates are the
// widely published city-centre points, rounded to 2 decimals (~1 km) — enough
// for a 25 km match radius. `country` is the directory country the city is
// expected to sit under: geoMatch refuses to suggest a city whose directory
// parent no longer agrees, so re-parenting a place in the admin directory can
// never make this table mislabel it (the directory hierarchy stays the source
// of truth for Somaliland vs Somalia).
//
// Deliberately NOT listed (too close to a border or to a same-named twin to
// pin down from a single point — those users pick manually):
//   Wajaale / Wajaale (Ethiopia)       — one town on the Ethiopia–Somaliland border
//   Gaalkacyo / Gaalkacyo (Puntland)   — one town split between Galmudug and Puntland
//   Laascaanood                        — contested administration; leave to manual choice
// To add a city: use its exact directory name, a published coordinate, and the
// country it is listed under. Wrong or unsure? Leave it out — no match is safer.
export type GeoCity = { name: string; country: 'Ethiopia' | 'Somaliland' | 'Somalia'; lat: number; lng: number };

export const GEO_CITIES: GeoCity[] = [
  // Ethiopia
  { name: 'Addis Ababa', country: 'Ethiopia', lat: 9.03, lng: 38.74 },
  { name: 'Dire Dawa', country: 'Ethiopia', lat: 9.6, lng: 41.85 },
  { name: 'Jigjiga', country: 'Ethiopia', lat: 9.35, lng: 42.8 },
  { name: 'Harar', country: 'Ethiopia', lat: 9.31, lng: 42.12 },
  { name: 'Adama', country: 'Ethiopia', lat: 8.54, lng: 39.27 },
  { name: 'Bishoftu', country: 'Ethiopia', lat: 8.75, lng: 38.98 },
  { name: 'Hawassa', country: 'Ethiopia', lat: 7.06, lng: 38.48 },
  { name: 'Shashamane', country: 'Ethiopia', lat: 7.2, lng: 38.6 },
  { name: 'Bahir Dar', country: 'Ethiopia', lat: 11.59, lng: 37.39 },
  { name: 'Gondar', country: 'Ethiopia', lat: 12.6, lng: 37.47 },
  { name: 'Mekelle', country: 'Ethiopia', lat: 13.5, lng: 39.47 },
  { name: 'Jimma', country: 'Ethiopia', lat: 7.67, lng: 36.83 },
  { name: 'Dessie', country: 'Ethiopia', lat: 11.13, lng: 39.63 },
  { name: 'Semera', country: 'Ethiopia', lat: 11.79, lng: 41.01 },
  { name: 'Gambela', country: 'Ethiopia', lat: 8.25, lng: 34.59 },
  { name: 'Godey', country: 'Ethiopia', lat: 5.95, lng: 43.45 },
  { name: 'Dhagaxbuur', country: 'Ethiopia', lat: 8.22, lng: 43.56 },
  { name: 'Qabridahare', country: 'Ethiopia', lat: 6.74, lng: 44.26 },
  // Somaliland
  { name: 'Hargeisa', country: 'Somaliland', lat: 9.56, lng: 44.06 },
  { name: 'Burco', country: 'Somaliland', lat: 9.52, lng: 45.53 },
  { name: 'Berbera', country: 'Somaliland', lat: 10.44, lng: 45.01 },
  { name: 'Boorama', country: 'Somaliland', lat: 9.94, lng: 43.18 },
  { name: 'Gabiley', country: 'Somaliland', lat: 9.7, lng: 43.62 },
  { name: 'Ceerigaabo', country: 'Somaliland', lat: 10.62, lng: 47.37 },
  // Somalia
  { name: 'Muqdisho', country: 'Somalia', lat: 2.05, lng: 45.32 },
  { name: 'Kismaayo', country: 'Somalia', lat: -0.36, lng: 42.55 },
  { name: 'Baydhabo', country: 'Somalia', lat: 3.11, lng: 43.65 },
  { name: 'Garoowe', country: 'Somalia', lat: 8.41, lng: 48.48 },
  { name: 'Boosaaso', country: 'Somalia', lat: 11.28, lng: 49.18 },
  { name: 'Beledweyne', country: 'Somalia', lat: 4.74, lng: 45.2 },
  { name: 'Jowhar', country: 'Somalia', lat: 2.78, lng: 45.5 },
  { name: 'Afgooye', country: 'Somalia', lat: 2.14, lng: 45.12 },
  { name: 'Marka', country: 'Somalia', lat: 1.72, lng: 44.77 },
  { name: 'Barawe', country: 'Somalia', lat: 1.11, lng: 44.03 },
  { name: 'Bardheere', country: 'Somalia', lat: 2.34, lng: 42.28 },
  { name: 'Dhuusamareeb', country: 'Somalia', lat: 5.53, lng: 46.39 },
  { name: 'Cadaado', country: 'Somalia', lat: 6.13, lng: 46.63 },
  { name: 'Qardho', country: 'Somalia', lat: 9.5, lng: 49.08 },
];
