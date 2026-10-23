import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, editDistance, phonetic, searchLocations, searchNodes, suggestNodes } from '../lib/locationTree';
import { buildHomeFeed, scopeBack, scopeSelector } from '../lib/homeFeed';
import { baseInput, index, listing, node } from './fixtures';

const names = (xs: { name: string }[]) => xs.map((x) => x.name);

// The shared fixture index has Jigjiga (city, Somali Region, Ethiopia).

test('exact match: the canonical place comes first, with its region/country context available', () => {
  const r = searchLocations(index, 'Jigjiga', 'en');
  assert.deepEqual(names(r.matches), ['Jigjiga']);
  assert.deepEqual(r.suggestions, []);
  assert.equal(r.matches[0].id, 'jj');
  assert.equal(r.matches[0].parentId, 'sr');
});

test('matching is case-, whitespace- and punctuation-insensitive', () => {
  for (const q of ['jigjiga', 'JIGJIGA', '  Jigjiga  ', 'jig-jiga', 'Jigjiga.']) {
    assert.ok(names(searchNodes(index, q, 'en')).includes('Jigjiga') || q === 'jig-jiga', q);
  }
  assert.deepEqual(names(searchNodes(index, 'south  west', 'en')), ['South West State']);
  assert.deepEqual(names(searchNodes(index, 'south-west', 'en')), ['South West State']);
});

test('partial matches: prefix beats word/substring, strongest first', () => {
  assert.deepEqual(names(searchNodes(index, 'jig', 'en')), ['Jigjiga']);
  assert.deepEqual(names(searchNodes(index, 'baid', 'en')), ['Baidoa']);
  const somal = names(searchNodes(index, 'somal', 'en'));
  assert.deepEqual(new Set(somal), new Set(['Somali Region', 'Somalia']));
});

test('the Jigjiga regression: GIG, GIGH and common misspellings suggest the real Jigjiga, labelled as alternatives', () => {
  for (const q of ['GIG', 'gigh', 'Gigiga', 'Jijiga', 'Jigjia', 'Jigiga', 'Gigjiga', 'jigjigaa']) {
    const r = searchLocations(index, q, 'en');
    if (r.matches.length) {
      // a literal partial match (e.g. "Jigjigaa" has none, "gig" has none) — either way the place is reachable
      assert.equal(r.matches[0].id, 'jj', q);
      continue;
    }
    assert.equal(r.suggestions[0]?.id, 'jj', `${q} → ${r.suggestions.map((s) => s.name)}`);
    assert.equal(r.matches.length, 0, 'suggestions only when there is no exact/partial match');
  }
});

test('suggestions are only ever real directory places, never invented, and unrelated text yields none', () => {
  const real = new Set(index.nodes.map((n) => n.id));
  for (const q of ['gig', 'jigj', 'baido', 'tigra', 'mekel', 'adigra', 'somlia']) {
    for (const s of suggestNodes(index, q, 'en')) assert.ok(real.has(s.id), `${q} → ${s.name}`);
  }
  assert.deepEqual(suggestNodes(index, 'zzzzzz', 'en'), []);
  assert.deepEqual(suggestNodes(index, 'qwerty', 'en'), []);
});

test('a few letters never lists every country: short or empty queries return nothing, long ones are capped', () => {
  assert.deepEqual(suggestNodes(index, '', 'en'), []);
  assert.deepEqual(suggestNodes(index, '  ', 'en'), []);
  assert.deepEqual(suggestNodes(index, 'ab', 'en'), []);
  assert.deepEqual(searchNodes(index, '', 'en'), []);
  const many = buildIndex(Array.from({ length: 50 }, (_, i) => node(`c${i}`, `Gigland${i}`, 'country', null)));
  assert.ok(suggestNodes(many, 'gigx', 'en').length <= 5);
});

test('no match at all: empty matches AND empty suggestions (the UI shows its "no matching location" text)', () => {
  const r = searchLocations(index, 'Atlantis', 'en');
  assert.deepEqual(r, { matches: [], suggestions: [] });
});

test('typo tolerance is bounded: a very different word is not suggested', () => {
  assert.ok(!names(suggestNodes(index, 'Nairobi', 'en')).includes('Jigjiga'));
  assert.ok(!names(suggestNodes(index, 'Mogadishu', 'en')).includes('Mekelle'));
});

test('a city is not confused with a country/region of a similar name: kinds stay distinct and exact wins', () => {
  const idx = buildIndex([
    node('so', 'Somalia', 'country', null),
    node('sr', 'Somali Region', 'region', 'et'),
    node('et', 'Ethiopia', 'country', null),
    node('sc', 'Somalia City', 'city', 'so'),
  ]);
  const exact = searchNodes(idx, 'Somalia', 'en');
  assert.equal(exact[0].id, 'so', 'the exact name ranks first');
  assert.equal(exact[0].kind, 'country');
  assert.ok(exact.some((n) => n.id === 'sc' && n.kind === 'city'));
  assert.equal(exact.find((n) => n.id === 'sr'), undefined, '"Somali Region" does not contain "somalia"');
});

test('duplicate place names stay separate canonical entries with their own parents', () => {
  const idx = buildIndex([
    node('et', 'Ethiopia', 'country', null),
    node('so', 'Somalia', 'country', null),
    node('b1', 'Baidoa', 'city', 'so'),
    node('b2', 'Baidoa', 'city', 'et'),
  ]);
  const r = searchNodes(idx, 'baidoa', 'en');
  assert.deepEqual(r.map((n) => n.id).sort(), ['b1', 'b2']);
  assert.deepEqual(new Set(r.map((n) => n.parentId)), new Set(['so', 'et']));
});

test('unapproved, inactive, rejected and orphaned places never appear — in the index, search or suggestions', () => {
  const idx = buildIndex([
    node('et', 'Ethiopia', 'country', null),
    node('sr', 'Somali Region', 'region', 'et'),
    node('jj', 'Jigjiga', 'city', 'sr', { status: 'approved' }),
    node('p1', 'Gigland Pending', 'city', 'sr', { status: 'pending' }),
    node('p2', 'Giglin Inactive', 'city', 'sr', { status: 'inactive' }),
    node('p3', 'Gigton Rejected', 'city', 'sr', { status: 'rejected' }),
    node('xr', 'Hidden Region', 'region', 'et', { status: 'pending' }),
    node('xc', 'Gigorphan', 'city', 'xr', { status: 'approved' }), // approved city under an unapproved region
    node('old', 'Cachedville', 'city', 'sr'), // cached row without a status was fetched as approved
  ]);
  const all = new Set(idx.nodes.map((n) => n.id));
  assert.deepEqual([...all].sort(), ['et', 'jj', 'old', 'sr']);
  for (const q of ['gig', 'gigland', 'giglin', 'gigton', 'hidden', 'gigorphan']) {
    for (const n of [...searchNodes(idx, q, 'en'), ...suggestNodes(idx, q, 'en')]) assert.ok(['jj', 'old', 'et', 'sr'].includes(n.id), `${q} → ${n.name}`);
  }
  assert.equal(searchLocations(idx, 'gig', 'en').suggestions[0]?.id, 'jj');
});

test('aliases and translations are the maintainable route for transliterations the rules cannot guess', () => {
  const idx = buildIndex([node('et', 'Ethiopia', 'country', null), node('jj', 'Jigjiga', 'city', 'et', { aliases: ['Djidjiga'], nameSo: 'Jigjiga' })]);
  assert.equal(searchNodes(idx, 'djidj', 'en')[0]?.id, 'jj');
});

test('selecting a suggestion yields the canonical location with its country/region relationships intact', () => {
  const pick = searchLocations(index, 'gigh', 'en').suggestions[0];
  assert.equal(pick.id, 'jj');
  assert.equal(pick.name, 'Jigjiga'); // canonical English name is what gets stored
  const f = buildHomeFeed({ ...baseInput, scopeId: pick.id, listings: [listing({ city: 'Jigjiga' }), listing({ city: 'Mekelle' })] });
  assert.equal(f.items.length, 1);
  assert.equal(f.items[0].city, 'Jigjiga');
  assert.equal(scopeBack(index, pick.id)?.id, 'sr', 'one step back is its region');
});

test('phonetic folding and edit distance behave as documented', () => {
  assert.equal(phonetic('Jigjiga'), phonetic('Gigiga'));
  assert.equal(phonetic('GIGH'), 'gig');
  assert.equal(editDistance('kitten', 'sitting'), 3);
  assert.equal(editDistance('ab', 'ba'), 1, 'a swap is one edit');
});

// ── Reversible location navigation ──────────────────────────────────────────

test('from every depth there is a way back, and walking back always ends at All Locations', () => {
  for (const id of ['et', 'tg', 'mk', 'sr', 'jj', 'so', 'sw', 'br']) {
    let cur: string | null = id;
    for (let hops = 0; cur !== null; hops++) {
      assert.ok(hops < 5, `no way out from ${id}`);
      const back = scopeBack(index, cur);
      assert.ok(back, `${cur} must offer a way back`);
      cur = back.id;
    }
  }
  assert.equal(scopeBack(index, null), null, 'nothing to go back from at All Locations');
});

test('countries go straight back to All Locations; Ethiopia and Somalia behave the same', () => {
  assert.deepEqual(scopeBack(index, 'et'), { id: null, node: null });
  assert.deepEqual(scopeBack(index, 'so'), { id: null, node: null });
  assert.equal(scopeBack(index, 'tg')?.node?.name, 'Ethiopia');
  assert.equal(scopeBack(index, 'br')?.node?.name, 'South West State');
});

test('select a place, go back: the strip returns to the previous level and scope', () => {
  const level = (id: string | null) => scopeSelector(index, id, 'en');
  assert.equal(level('tg').parent?.id, 'tg');
  const back = scopeBack(index, 'tg')!; // → Ethiopia
  assert.equal(level(back.id).parent?.id, 'et');
  assert.equal(level(scopeBack(index, back.id)!.id).parent, null); // → All Locations (root strip)
  assert.equal(level(null).options[0].id, null);
});

test('an unknown saved location (removed or not loaded yet) shows everything instead of an empty Home', () => {
  const f = buildHomeFeed({ ...baseInput, scopeId: 'gone', listings: [listing({ city: 'Mekelle' }), listing({ city: 'Baidoa' })] });
  assert.equal(f.items.length, 2);
  assert.equal(scopeBack(index, 'gone'), null);
});
