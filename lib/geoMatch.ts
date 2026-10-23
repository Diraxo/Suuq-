// Turns a one-off device position into a *suggested* directory place for
// "Find listings near me". Pure and offline: nothing here touches the network,
// and coordinates never leave the caller — only the matched directory node does.
//
// Where a city's coordinate comes from, in priority order:
//   1. an admin-verified row in public.location_coordinates, keyed by the city's
//      directory id (so renames and re-parenting never break it), else
//   2. the reviewed fallback table in geoCities.ts, resolved by name AND expected
//      country, and only when exactly one approved city matches.
// Conservative on purpose. A city is suggested only when
//   1. the point is inside the supported-markets envelope,
//   2. a reference city is within MATCH_RADIUS_KM,
//   3. no reference city of a *different* country is within BORDER_MARGIN_KM
//      (so border areas are never auto-attributed to one side), and
//   4. the directory lists that city as approved (a fallback entry must also still
//      sit under its expected country).
// A country is always the directory ancestor of the city, never a stored label.
// Everything else is `none`, with nearby supported cities offered as manual
// choices. A bounding box alone is never used to pick a country.
// The identical file lives at web/src/lib/geoMatch.ts — keep the copies in sync.
import { GEO_ENVELOPE, LocCoord, LocIndex, LocNode, countryOf, findCitiesByName, validCoord } from './locationTree';
import { GEO_CITIES, GeoCity } from './geoCities';

export const MATCH_RADIUS_KM = 25;
export const BORDER_MARGIN_KM = 40;
export const NEARBY_RADIUS_KM = 250;
export const NEARBY_LIMIT = 3;

export type GeoReason = 'invalid' | 'outside' | 'no-city' | 'border' | 'directory';

export type GeoMatch =
  | { kind: 'city'; node: LocNode; distanceKm: number }
  | { kind: 'none'; reason: GeoReason; nearby: { node: LocNode; distanceKm: number }[] };

/** Great-circle distance in km. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

type Candidate = { node: LocNode; countryId: string; km: number };

/** Every city we can place on the map, with its directory-derived country. Database coordinates win over the fallback. */
function candidates(lat: number, lng: number, index: LocIndex, coords: Map<string, LocCoord>, fallback: GeoCity[]) {
  const out: Candidate[] = [];
  let unresolvedClose = false;
  const dbIds = new Set<string>();
  for (const node of index.nodes) {
    if (node.kind !== 'city') continue;
    const c = coords.get(node.id);
    if (!c || !validCoord(c.lat, c.lng)) continue; // missing or invalid → fallback may still cover it
    const country = countryOf(index, node.id);
    if (!country) continue;
    dbIds.add(node.id);
    out.push({ node, countryId: country.id, km: distanceKm(lat, lng, c.lat, c.lng) });
  }
  for (const city of fallback) {
    if (!validCoord(city.lat, city.lng)) continue;
    const km = distanceKm(lat, lng, city.lat, city.lng);
    // The directory hierarchy decides the country; an entry that disagrees, or a name that is ambiguous, is ignored.
    const named = findCitiesByName(index, city.name).filter((n) => countryOf(index, n.id)?.name === city.country);
    if (named.length === 1) {
      const node = named[0];
      if (!dbIds.has(node.id)) out.push({ node, countryId: countryOf(index, node.id)!.id, km });
    } else if (km <= MATCH_RADIUS_KM) {
      unresolvedClose = true;
    }
  }
  return { usable: out, unresolvedClose };
}

export function matchPoint(
  lat: number,
  lng: number,
  index: LocIndex,
  coords: Map<string, LocCoord> = new Map(),
  fallback: GeoCity[] = GEO_CITIES
): GeoMatch {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { kind: 'none', reason: 'invalid', nearby: [] };
  }
  if (lat < GEO_ENVELOPE.minLat || lat > GEO_ENVELOPE.maxLat || lng < GEO_ENVELOPE.minLng || lng > GEO_ENVELOPE.maxLng) {
    return { kind: 'none', reason: 'outside', nearby: [] };
  }
  const { usable, unresolvedClose } = candidates(lat, lng, index, coords, fallback);
  usable.sort((a, b) => a.km - b.km);
  const nearby = usable.filter((c) => c.km <= NEARBY_RADIUS_KM).slice(0, NEARBY_LIMIT).map((c) => ({ node: c.node, distanceKm: Math.round(c.km) }));

  const best = usable[0];
  if (!best || best.km > MATCH_RADIUS_KM) return { kind: 'none', reason: unresolvedClose ? 'directory' : 'no-city', nearby };
  if (usable.some((c) => c.countryId !== best.countryId && c.km <= BORDER_MARGIN_KM)) {
    return { kind: 'none', reason: 'border', nearby };
  }
  return { kind: 'city', node: best.node, distanceKm: Math.round(best.km) };
}
