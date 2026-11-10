// PROPOSED 0088 (validate the two price constraints) and 0089 (grants hardening around price / offers / price_drops), on a REAL Postgres
// (PGlite) with the real chain + proposed 0085-0087. Proves: 0088 validates when no row violates, refuses (and leaves the constraints NOT VALID)
// when one does, and its rollback restores NOT VALID with identical definitions; 0089 removes the broad privileges, keeps every app flow working
// (price drop recorded, offers via RPC, price_drops readable, discounts), keeps the trigger function uncallable and un-attachable by API roles,
// and its rollback restores the original ACLs byte for byte.
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, uuid, sqlFile } from './harness/db.mjs';

const { db } = await boot({ extraMigrations: ['proposed/0085_service_contact_price.sql', 'proposed/0086_contact_price_safeguards.sql', 'proposed/0087_contact_price_pending_offers.sql'] });
const { q, fails } = actors(db);
const [seller, buyer] = await seedUsers(db, 2);
await db.exec("select set_config('suuqplus.skip_rate_limit','true',false)");
const CONTACT = JSON.stringify({ priceMode: 'Contact for price' });
let seq = 1900;
async function listing({ price = 500, category = 'electronics', attrs = '{}' } = {}) {
  const id = uuid(++seq);
  await db.query(`insert into public.listings (id,user_id,title,category,city,price,currency,status,images,attributes) values ($1,$2,$3,$4,'Hargeisa',$5,'USD','available',array['https://x.test/a.jpg'],$6::jsonb)`, [id, seller, 'L ' + seq, category, price, attrs]);
  await db.query(`update public.listings set created_at = now() - interval '60 days', price_changed_at = now() - interval '60 days' where id=$1`, [id]);
  return id;
}
const defs = async () => (await db.query(`select conname, convalidated v, regexp_replace(pg_get_constraintdef(oid), ' NOT VALID$', '') d from pg_constraint where conrelid='public.listings'::regclass and conname in ('listings_price_range','listings_price_zero_needs_mode') order by conname`)).rows;

// ---- 0088
await listing();
await listing({ price: 0, category: 'services', attrs: CONTACT });
let d = await defs();
assert.deepEqual(d.map((r) => r.v), [false, false], 'both start NOT VALID');
const before = d.map((r) => r.d);
await db.exec(sqlFile('proposed/0088_validate_price_constraints.sql'));
d = await defs();
assert.deepEqual(d.map((r) => r.v), [true, true]);
assert.deepEqual(d.map((r) => r.d), before, 'validation does not change the rule text');
ok('0088: with only valid rows both constraints become VALIDATED, rule text unchanged');

await db.exec(sqlFile('proposed/0088_validate_price_constraints_ROLLBACK.sql'));
d = await defs();
assert.deepEqual(d.map((r) => r.v), [false, false]);
assert.deepEqual(d.map((r) => r.d), before, '0088 rollback restores identical NOT VALID definitions');
ok('0088 rollback: back to NOT VALID with identical definitions');

// a violating row (inserted while the guards are temporarily off) must stop 0088 and leave everything NOT VALID
await db.exec('alter table public.listings drop constraint listings_price_zero_needs_mode; alter table public.listings drop constraint listings_price_range;');
const bad = await listing({ price: 0 }); // price 0, not services -> violates both
await db.exec(sqlFile('proposed/0088_validate_price_constraints_ROLLBACK.sql')); // re-adds both NOT VALID
await assert.rejects(db.exec(sqlFile('proposed/0088_validate_price_constraints.sql')), /0088 refused: 1 listing row/);
await db.exec('rollback'); // the file is begin..commit: under a session runner (PGlite here) an abort leaves the transaction aborted until the session ends it
assert.deepEqual((await defs()).map((r) => r.v), [false, false], 'a refused 0088 validates nothing');
await db.query('delete from public.listings where id=$1', [bad]);
await db.exec(sqlFile('proposed/0088_validate_price_constraints.sql'));
assert.deepEqual((await defs()).map((r) => r.v), [true, true]);
ok('0088: refuses with a clear message while a violating row exists, validates nothing, and succeeds once it is gone');

// atomicity: if the SECOND validation fails, the FIRST must not stay validated. Drop the preflight and point the second statement at a missing constraint.
await db.exec(sqlFile('proposed/0088_validate_price_constraints_ROLLBACK.sql'));
const noPreflight = sqlFile('proposed/0088_validate_price_constraints.sql').replace(/do \$\$[\s\S]*?end \$\$;/, '').replace('listings_price_zero_needs_mode;', 'listings_no_such_constraint;');
assert.ok(noPreflight.includes('listings_no_such_constraint') && !noPreflight.includes('0088 refused'));
await assert.rejects(db.exec(noPreflight), /listings_no_such_constraint/);
await db.exec('rollback');
assert.deepEqual((await defs()).map((r) => r.v), [false, false], 'first validation rolled back with the failed second one');
await db.exec(sqlFile('proposed/0088_validate_price_constraints.sql'));
assert.deepEqual((await defs()).map((r) => r.v), [true, true]);
ok('0088: the two validations are one transaction (a failing second step leaves the first NOT VALID); real file then validates both');

// new writes are still refused after validation
await fails(seller, 'update public.listings set price=0 where id=$1', [await listing()], /listings_price_range|listings_price_zero_needs_mode/);

// ---- 0089
const aclOf = async () =>
  JSON.stringify((await db.query(`select c.relname, c.relacl::text a from pg_class c where c.oid in ('public.listings'::regclass,'public.offers'::regclass,'public.price_drops'::regclass) order by 1`)).rows) +
  JSON.stringify((await db.query(`select (select string_agg(x::text, ',' order by x::text) from unnest(proacl) x) a, proconfig::text c from pg_proc where oid='public.trg_listings_record_price_drop()'::regprocedure`)).rows[0]);
const original = await aclOf();
const maint = async (role, rel) => (await db.query(`select has_table_privilege($1,$2,'MAINTAIN') v`, [role, rel])).rows[0].v;
const has = async (role, rel, priv) => (await db.query('select has_table_privilege($1,$2,$3) v', [role, rel, priv])).rows[0].v;
for (const r of ['anon', 'authenticated']) for (const t of ['public.listings', 'public.offers', 'public.price_drops']) for (const p of ['TRUNCATE', 'TRIGGER', 'REFERENCES']) assert.equal(await has(r, t, p), true, `precondition ${r} ${t} ${p}`);

const pg17 = (await db.query(`select current_setting('server_version_num')::int >= 170000 v`)).rows[0].v;
if (pg17) assert.equal(await maint('authenticated', 'public.offers'), true, 'precondition MAINTAIN (PG17 default grant)');
await db.exec(sqlFile('proposed/0089_price_tables_grants_hardening.sql'));
if (pg17) for (const r of ['anon', 'authenticated']) for (const t of ['public.listings', 'public.offers', 'public.price_drops']) assert.equal(await maint(r, t), false, `MAINTAIN ${r} ${t}`);
for (const r of ['anon', 'authenticated']) {
  for (const t of ['public.listings', 'public.offers', 'public.price_drops']) for (const p of ['TRUNCATE', 'TRIGGER', 'REFERENCES']) assert.equal(await has(r, t, p), false, `${r} ${t} ${p}`);
  for (const t of ['public.offers', 'public.price_drops']) for (const p of ['INSERT', 'UPDATE', 'DELETE']) assert.equal(await has(r, t, p), false, `${r} ${t} ${p}`);
  assert.equal((await db.query(`select has_function_privilege($1,'public.trg_listings_record_price_drop()','execute') v`, [r])).rows[0].v, false);
  assert.equal(await has(r, 'public.listings', 'SELECT'), true, 'SELECT stays'); // reads go through RLS
}
assert.equal(await has('authenticated', 'public.listings', 'UPDATE'), true, 'listings keeps its normal INSERT/UPDATE/DELETE (RLS-guarded)');
assert.equal(await has('service_role', 'public.offers', 'UPDATE'), true, 'service_role untouched');
assert.match((await db.query(`select proconfig::text c from pg_proc where oid='public.trg_listings_record_price_drop()'::regprocedure`)).rows[0].c, /public, pg_temp/);
ok('0089: broad privileges removed from anon/authenticated; SELECT, listing writes and service_role untouched; search_path pinned');

// every app flow still works with the grants removed
const lst = await listing({ price: 1000 });
await q(seller, 'update public.listings set price=800 where id=$1', [lst]);
assert.equal((await db.query('select count(*)::int c from public.price_drops where listing_id=$1', [lst])).rows[0].c, 1, 'a real price drop is still recorded by the trigger');
assert.equal((await q(buyer, 'select * from public.price_drops where listing_id=$1', [lst])).rows.length, 1, 'price_drops stays readable');
const off = (await q(buyer, 'select (public.create_offer($1,700,null)).id id', [lst])).rows[0].id;
assert.equal((await q(seller, `select (public.respond_to_offer($1,'accept',null,null)).status s`, [off])).rows[0].s, 'accepted');
assert.equal((await q(buyer, 'select * from public.offers where id=$1', [off])).rows.length, 1, 'participants can still read their offers');
assert.equal((await q(seller, 'select public.set_listing_discount($1,600,7,null) r', [await listing({ price: 900 })])).rows.length, 1, 'discounts still work');
ok('0089: price drop recording, price_drops/offers reads, offer RPCs and discounts all still work');

// locked doors
await fails(buyer, 'insert into public.price_drops (listing_id, old_price, new_price) values ($1, 10, 5)', [lst], /./);
await fails(buyer, `update public.offers set status='accepted' where id=$1`, [off], /./);
await fails(seller, 'truncate public.price_drops', [], /./);
await fails(seller, 'create trigger t_probe before update on public.listings for each row execute function public.trg_listings_record_price_drop()', [], /./);
await fails(seller, 'select public.trg_listings_record_price_drop()', [], /./);
ok('0089: direct price_drops/offers writes, TRUNCATE, CREATE TRIGGER with the function, and a direct function call are all refused for API roles');

await db.exec(sqlFile('proposed/0089_price_tables_grants_hardening_ROLLBACK.sql'));
assert.equal(await aclOf(), original, 'ACL entries (as a set) and search_path restored exactly');
ok('0089 rollback: ACLs and function config identical to the original');

console.log('\nAll 0088 / 0089 review-file checks passed');
