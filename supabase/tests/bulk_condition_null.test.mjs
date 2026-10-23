// Bulk import of a condition-free listing (rental, food) end to end on a REAL Postgres (PGlite) with the full migration chain:
// CSV text -> parseCsv -> parseBulkRow (web parser, compiled by `npm test` into .test-build) -> the same condition normalization
// the publish paths apply (store/myListings listingToRow: `conditionApplies(...) ? condition : null`) -> INSERT into public.listings
// -> read back -> similarity scoring on the read-back rows.
//
// What this does NOT cover: the mobile parser/UI themselves (mobile listingToRow can't be imported without React Native, so its
// normalization expression is applied here by hand; tests/bulkUploadWeb.test.ts pins that the source contains it), PostgREST, or a device.
// Needs `npm test` to have been run once (builds .test-build). Nothing here touches a real database.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { boot, seedUsers, ok, root } from './harness/db.mjs';

const require = createRequire(import.meta.url);
const build = (p) => require(path.join(root, '.test-build', p));
const { parseBulkRow } = build('web/src/lib/bulkUpload.js');
const { parseCsv, csvRowsToObjects } = build('web/src/lib/csv.js');
const { buildIndex, rowToNode } = build('web/src/lib/locationTree.js');
const { conditionApplies } = build('data/sellRules.js');
const { similarityScore } = build('data/similarListings.js');

const loc = (o) => rowToNode({ name_so: null, name_am: null, parent_id: null, iso2: null, currency_codes: null, default_currency: null, aliases: [], is_featured: false, is_app_region: false, status: 'approved', ...o });
const index = buildIndex([
  loc({ id: 'c1', kind: 'country', name: 'Somalia', iso2: 'SO', currency_codes: ['USD', 'SOS'], default_currency: 'USD' }),
  loc({ id: 'city1', kind: 'city', name: 'Hargeisa', parent_id: 'c1' }),
]);

const { db } = await boot();
const [owner] = await seedUsers(db, 1);

const csv = [
  'title,description,price,category,condition,city,image_urls',
  '"Two bedroom flat","Bright flat near the market, water included.",300,property,,Hargeisa,https://example.com/a.jpg',
  '"Two bedroom flat B","Another bright flat close to the market.",320,property,,Hargeisa,https://example.com/b.jpg',
  '"Samsung phone","Clean phone, works perfectly, box included.",120,phones,used,Hargeisa,https://example.com/c.jpg',
  '"Samsung phone 2","Second phone, works perfectly, box included.",125,phones,used,Hargeisa,https://example.com/d.jpg',
  '"Fresh injera","Made fresh each morning, delivered in town.",5,food,,Hargeisa,https://example.com/e.jpg',
].join('\n');

const parsed = csvRowsToObjects(parseCsv(csv)).map((r) => parseBulkRow(r, index));
assert.deepEqual(parsed.map((p) => p.errors), [[], [], [], [], []]);
// The parser's in-memory placeholder for a blank condition is 'used'; that is exactly what must not reach the database.
assert.equal(parsed[0].condition, 'used');
ok('CSV with blank-condition rentals/food and condition-bearing phones parses with no errors (rental placeholder is "used" in memory)');

const insert = async (row) => {
  const condition = conditionApplies(row.categoryId) ? row.condition : null; // listingToRow's expression, applied to the real rule
  const r = await db.query(
    `insert into public.listings (user_id,title,description,category,condition,price,currency,city,images,status)
     values ($1,$2,$3,$4,$5,$6,'USD',$7,$8,'available') returning *`,
    [owner, row.title, row.description, row.categoryId, condition, row.price, row.city, row.images]
  );
  return r.rows[0];
};
const stored = [];
for (const row of parsed) stored.push(await insert(row));
ok('all five rows pass the real server-side validation triggers/constraints on insert');

assert.equal(stored[0].condition, null);
assert.equal(stored[1].condition, null);
assert.equal(stored[4].condition, null);
assert.equal(stored[2].condition, 'used');
assert.equal(stored[3].condition, 'used');
const readBack = (await db.query(`select title, condition from public.listings where condition is null order by title`)).rows;
assert.deepEqual(readBack.map((r) => r.title), ['Fresh injera', 'Two bedroom flat', 'Two bedroom flat B']);
ok('read-back: rental and food rows have condition IS NULL; phones keep "used"; no stored "used" on a condition-free row');

// Scoring on the read-back rows, shaped as Listing objects (condition null from the DB reads back as undefined/null, never 'used').
const asListing = (r) => ({ id: r.id, title: r.title, price: Number(r.price), category: r.category, subcategory: r.subcategory ?? undefined, condition: r.condition ?? undefined, city: r.city, attributes: {} });
const [flatA, flatB, phoneA, phoneB] = stored.map(asListing);
const noCondition = (l) => ({ ...l, condition: 'used' });
// Rentals: score must be identical whether or not the candidate's condition equals the primary's — no condition bonus.
assert.equal(similarityScore(flatA, flatB), similarityScore(flatA, { ...flatB, condition: 'new' }));
// Phones: a condition match is worth exactly 10 more than a mismatch.
assert.equal(similarityScore(phoneA, phoneB) - similarityScore(phoneA, { ...phoneB, condition: 'new' }), 10);
assert.ok(noCondition(flatA));
ok('similarity: no condition bonus for the imported rentals, +10 still awarded for matching phones');

console.log('\nbulk_condition_null: all passed');
