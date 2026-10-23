import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LocCoord, buildIndex, coordsFromRows, validCoord } from '../lib/locationTree';
import { BORDER_MARGIN_KM, MATCH_RADIUS_KM, distanceKm, matchPoint } from '../lib/geoMatch';
import { GEO_CITIES } from '../lib/geoCities';
import { node } from './fixtures';

// Directory shaped like the real seed: Somaliland is its own top-level app region, never under Somalia.
const nodes = [
  node('et', 'Ethiopia', 'country', null),
  node('sr', 'Somali Region', 'region', 'et'),
  node('jj', 'Jigjiga', 'city', 'sr'),
  node('dd', 'Dire Dawa', 'city', 'et'),
  node('sl', 'Somaliland', 'country', null),
  node('mj', 'Maroodi Jeex', 'region', 'sl'),
  node('hg', 'Hargeisa', 'city', 'mj'),
  node('gb', 'Gabiley', 'city', 'mj'),
  node('bo', 'Boorama', 'city', 'sl'),
  node('so', 'Somalia', 'country', null),
  node('bn', 'Banaadir', 'region', 'so'),
  node('mq', 'Muqdisho', 'city', 'bn'),
];
const index = buildIndex(nodes);
const at = (name: string) => {
  const c = GEO_CITIES.find((g) => g.name === name);
  assert.ok(c, `${name} missing from GEO_CITIES`);
  return c;
};

test('every reference coordinate is plausible and names are unique', () => {
  const seen = new Set<string>();
  for (const c of GEO_CITIES) {
    assert.ok(c.lat >= -2.5 && c.lat <= 15.5 && c.lng >= 32.5 && c.lng <= 52, c.name);
    assert.ok(!seen.has(c.name), `duplicate ${c.name}`);
    seen.add(c.name);
  }
});

test('Jijiga city centre → Jigjiga under Ethiopia', () => {
  const m = matchPoint(9.35, 42.8, index);
  assert.equal(m.kind, 'city');
  if (m.kind === 'city') assert.equal(m.node.id, 'jj');
});

test('Hargeisa → Hargeisa, whose country is Somaliland and not Somalia', () => {
  const m = matchPoint(9.57, 44.07, index);
  assert.equal(m.kind, 'city');
  if (m.kind === 'city') {
    assert.equal(m.node.id, 'hg');
    assert.equal(m.node.parentId, 'mj');
  }
});

test('Mogadishu → Muqdisho under Somalia', () => {
  const m = matchPoint(2.04, 45.34, index);
  assert.equal(m.kind, 'city');
  if (m.kind === 'city') assert.equal(m.node.id, 'mq');
});

test('a few km off-centre still matches; beyond the radius it does not', () => {
  const j = at('Jigjiga');
  assert.equal(matchPoint(j.lat + 0.1, j.lng, index).kind, 'city'); // ~11 km
  const far = matchPoint(j.lat + 0.4, j.lng, index); // ~44 km
  assert.equal(far.kind, 'none');
  if (far.kind === 'none') assert.equal(far.reason, 'no-city');
});

test('border area: a different country within the margin means no automatic match', () => {
  // Two synthetic towns ~30 km apart, one per country, with the user between them.
  const cities = [
    { name: 'Jigjiga', country: 'Ethiopia' as const, lat: 9.35, lng: 42.8 },
    { name: 'Gabiley', country: 'Somaliland' as const, lat: 9.35, lng: 43.07 },
  ];
  assert.ok(distanceKm(9.35, 42.8, 9.35, 43.07) < MATCH_RADIUS_KM + BORDER_MARGIN_KM);
  const m = matchPoint(9.35, 42.85, index, new Map(), cities);
  assert.equal(m.kind, 'none');
  if (m.kind === 'none') {
    assert.equal(m.reason, 'border');
    assert.equal(m.nearby.length, 2); // both sides offered for manual choice
  }
});

test('unsupported locations are never forced onto a market', () => {
  const nairobi = matchPoint(-1.29, 36.82, index);
  assert.equal(nairobi.kind, 'none');
  const kampala = matchPoint(0.35, 32.58 - 5, index);
  assert.equal(kampala.kind, 'none');
  if (kampala.kind === 'none') assert.equal(kampala.reason, 'outside');
  const london = matchPoint(51.5, -0.12, index);
  assert.equal(london.kind, 'none');
  if (london.kind === 'none') assert.equal(london.reason, 'outside');
});

test('outside the radius but near supported markets: offer them as manual choices', () => {
  const djibouti = matchPoint(11.59, 43.15, index);
  assert.equal(djibouti.kind, 'none');
  if (djibouti.kind === 'none') assert.deepEqual(djibouti.nearby.map((n) => n.node.id), ['bo', 'gb', 'hg']);
});

test('garbage input is rejected', () => {
  for (const [a, b] of [[NaN, 40], [9, Infinity], [95, 40], [9, 200]]) {
    const m = matchPoint(a, b, index);
    assert.equal(m.kind, 'none');
    if (m.kind === 'none') assert.equal(m.reason, 'invalid');
  }
});

test('the directory is the source of truth: a city re-parented to another country is not suggested', () => {
  // Hargeisa listed under Somalia would contradict the table (Somaliland) → ignored, not mislabelled.
  const moved = buildIndex(nodes.map((n) => (n.id === 'mj' ? { ...n, parentId: 'so' } : n)));
  const m = matchPoint(9.57, 44.07, moved);
  assert.equal(m.kind, 'none');
  if (m.kind === 'none') assert.equal(m.reason, 'directory');
});

test('cities missing or unapproved in the directory are never suggested', () => {
  const noHargeisa = buildIndex(nodes.filter((n) => n.id !== 'hg').map((n) => n));
  const m = matchPoint(9.56, 44.06, noHargeisa);
  assert.equal(m.kind, 'none');
  const pending = buildIndex(nodes.map((n) => (n.id === 'hg' ? { ...n, status: 'pending' } : n)));
  assert.equal(matchPoint(9.56, 44.06, pending).kind, 'none');
});

// ── Database coordinates (public.location_coordinates, keyed by directory id) ──
const coords = (entries: [string, number, number][]) => new Map<string, LocCoord>(entries.map(([id, lat, lng]) => [id, { lat, lng }]));
const cityId = (m: ReturnType<typeof matchPoint>) => (m.kind === 'city' ? m.node.id : null);

test('with no database coordinates the 38-city fallback behaves exactly as before', () => {
  assert.equal(GEO_CITIES.length, 38);
  assert.equal(cityId(matchPoint(9.57, 44.07, index, new Map())), 'hg');
  assert.deepEqual(matchPoint(9.57, 44.07, index), matchPoint(9.57, 44.07, index, new Map()));
});

test('a database coordinate is used by directory id and overrides the fallback point', () => {
  const moved = coords([['hg', 9.7, 44.3]]); // ~26 km from the built-in Hargeisa point
  assert.equal(cityId(matchPoint(9.7, 44.3, index, moved)), 'hg');
  assert.equal(cityId(matchPoint(9.56, 44.06, index, moved)), null); // the old point no longer counts for Hargeisa
});

test('a city with only a database coordinate (not in the fallback list) is matched', () => {
  const extended = buildIndex([...nodes, node('xx', 'Newtown', 'city', 'sl')]);
  const m = matchPoint(10.2, 43.5, extended, coords([['xx', 10.2, 43.5]]));
  assert.equal(cityId(m), 'xx');
});

test('renamed city: the fallback stops matching by name, the database coordinate keeps working by id', () => {
  const renamed = buildIndex(nodes.map((n) => (n.id === 'hg' ? { ...n, name: 'Hargeysa' } : n)));
  const none = matchPoint(9.56, 44.06, renamed);
  assert.equal(none.kind, 'none');
  if (none.kind === 'none') assert.equal(none.reason, 'directory');
  assert.equal(cityId(matchPoint(9.56, 44.06, renamed, coords([['hg', 9.56, 44.06]]))), 'hg');
});

test('changed country parent: the border check follows the directory, not the stored label', () => {
  // Hargeisa moved under Somalia. Its database coordinate is used, and now counts as Somalia.
  // (Gabiley is re-homed directly under Somaliland so only Hargeisa changes country.)
  const moved = buildIndex(nodes.map((n) => (n.id === 'mj' ? { ...n, parentId: 'so' } : n.id === 'gb' ? { ...n, parentId: 'sl' } : n)));
  assert.equal(cityId(matchPoint(9.57, 44.07, moved, coords([['hg', 9.56, 44.06]]))), 'hg');
  // Placed 30 km from Gabiley (Somaliland) it is now a cross-country neighbour → border.
  const near = coords([['hg', 9.56, 43.9], ['gb', 9.7, 43.62]]);
  const m = matchPoint(9.58, 43.85, moved, near);
  assert.equal(m.kind, 'none');
  if (m.kind === 'none') assert.equal(m.reason, 'border');
  // Same coordinates with Hargeisa still in Somaliland → same country, so it matches.
  assert.ok(cityId(matchPoint(9.58, 43.85, index, near)));
});

test('duplicate city names: the fallback needs exactly one city under the expected country', () => {
  const twins = buildIndex([...nodes, node('hg2', 'Hargeisa', 'city', 'so')]); // same name, other country
  assert.equal(cityId(matchPoint(9.56, 44.06, twins)), 'hg'); // the Somaliland one is the only match for the table's country
  const sameCountryTwins = buildIndex([...nodes, node('hg3', 'Hargeisa', 'city', 'mj')]);
  const m = matchPoint(9.56, 44.06, sameCountryTwins);
  assert.equal(m.kind, 'none');
  if (m.kind === 'none') assert.equal(m.reason, 'directory'); // ambiguous → never guess
  // Database coordinates are per id, so each twin is placed independently.
  assert.equal(cityId(matchPoint(9.56, 44.06, sameCountryTwins, coords([['hg3', 9.56, 44.06]]))), 'hg3');
});

test('unapproved cities with coordinates are never suggested or offered', () => {
  for (const status of ['pending', 'inactive', 'rejected']) {
    const idx = buildIndex(nodes.map((n) => (n.id === 'hg' ? { ...n, status } : n)));
    const m = matchPoint(9.56, 44.06, idx, coords([['hg', 9.56, 44.06]]));
    assert.equal(m.kind, 'none', status);
    if (m.kind === 'none') assert.ok(!m.nearby.some((x) => x.node.id === 'hg'), status);
  }
});

test('missing coordinates: a city with neither a database row nor a fallback entry is not matched', () => {
  const extended = buildIndex([...nodes, node('xx', 'Newtown', 'city', 'sl')]);
  assert.equal(matchPoint(10.2, 43.5, extended, new Map()).kind, 'none');
});

test('invalid database coordinates are ignored and the fallback is used instead', () => {
  const bad: [number, number][] = [[NaN, 44], [9.5, Infinity], [91, 44], [9.5, 181], [0, 0], [51.5, -0.12], [-30, 44]];
  for (const [lat, lng] of bad) {
    assert.equal(validCoord(lat, lng), false, `${lat},${lng}`);
    assert.equal(cityId(matchPoint(9.57, 44.07, index, coords([['hg', lat, lng]]))), 'hg', `${lat},${lng}`);
  }
  // …and an invalid row for a city with no fallback leaves it unmatched.
  const extended = buildIndex([...nodes, node('xx', 'Newtown', 'city', 'sl')]);
  assert.equal(matchPoint(10.2, 43.5, extended, coords([['xx', 0, 0]])).kind, 'none');
});

test('coordsFromRows drops malformed rows and keeps valid ones', () => {
  const map = coordsFromRows([
    { location_id: 'a', latitude: 9.5, longitude: 44.0 },
    { location_id: 'b', latitude: '9.5', longitude: 44.0 },
    { location_id: 7, latitude: 9.5, longitude: 44.0 },
    { location_id: 'c', latitude: 9.5, longitude: 0 },
    null,
    { location_id: 'd', latitude: 200, longitude: 44 },
  ]);
  assert.deepEqual([...map.keys()], ['a']); // 'c' is longitude 0: outside the supported area
  assert.equal(coordsFromRows('nope' as unknown).size, 0);
});

test('radius and border margin are unchanged', () => {
  assert.equal(MATCH_RADIUS_KM, 25);
  assert.equal(BORDER_MARGIN_KM, 40);
  // Database coordinates obey the same 25 km radius.
  const only = coords([['hg', 9.56, 44.06]]);
  assert.equal(cityId(matchPoint(9.56 + 0.2, 44.06, index, only)), 'hg'); // ~22 km from the database point
  assert.equal(matchPoint(9.56 + 0.3, 44.06, index, only).kind, 'none'); // ~33 km: beyond the radius
});

test('the web copies of the shared geo modules are identical', () => {
  for (const f of ['locationTree.ts', 'geoMatch.ts', 'geoCities.ts']) {
    const mobile = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', f), 'utf8');
    const web = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'src', 'lib', f), 'utf8');
    assert.equal(web, mobile, `${f} differs between lib/ and web/src/lib/`);
  }
});
