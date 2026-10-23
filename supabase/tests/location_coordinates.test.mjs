// 0061 — admin-verified city coordinates. Real Postgres (PGlite), full chain 0001..0061 on the real 0033 directory seed.
// Proves: constraints, cities only, cascade on admin delete, ids stay stable across rename/re-parent, client read is
// approved-cities-only and column-limited, no client writes, admin RPCs are admin-only and audited, nothing is seeded.
// Not proven here: PostgREST, the real production data, the apps (see tests/geoMatch.test.ts for the matching logic).
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok } from './harness/db.mjs';

const { db, applied } = await boot();
assert.ok(applied.includes('0061_location_coordinates.sql'));
const { q, fails } = actors(db);
const [admin, user] = await seedUsers(db, 2);
await db.query(`insert into public.admin_users(user_id, role) values ($1,'admin')`, [admin]);

const idOf = async (kind, name) => (await db.query(`select id from public.locations where kind=$1 and name=$2`, [kind, name])).rows[0]?.id;
const hargeisa = await idOf('city', 'Hargeisa');
const jigjiga = await idOf('city', 'Jigjiga');
const somaliland = await idOf('country', 'Somaliland');
const ethiopia = await idOf('country', 'Ethiopia');
assert.ok(hargeisa && jigjiga && somaliland && ethiopia);
const setCoord = (uid, id, lat, lng, reason = null) => q(uid, `select public.admin_set_location_coordinates($1,$2,$3,$4)`, [id, lat, lng, reason]);
const countRows = async (id) => (await db.query(`select count(*)::int n from public.location_coordinates where location_id=$1`, [id])).rows[0].n;

// ---- nothing seeded
assert.equal((await db.query(`select count(*)::int n from public.location_coordinates`)).rows[0].n, 0);
ok('0061 applies on the full chain and seeds no coordinates');

// ---- admin-only
await fails(user, `select public.admin_set_location_coordinates($1, 9.56, 44.06, null)`, [hargeisa], /42501|Only an admin/);
await fails(null, `select public.admin_set_location_coordinates($1, 9.56, 44.06, null)`, [hargeisa], /permission denied|42501|Only an admin/);
await fails(user, `select * from public.admin_list_location_coordinates()`, [], /42501|Only an admin/);
ok('non-admins and anon cannot set or list coordinates through the RPCs');

await setCoord(admin, hargeisa, 9.5612345678, 44.0612345678, 'verified on map');
const row = (await db.query(`select * from public.location_coordinates where location_id=$1`, [hargeisa])).rows[0];
assert.equal(row.latitude, 9.56123);
assert.equal(row.longitude, 44.06123);
assert.equal(row.updated_by, admin);
const audit = (await db.query(`select * from public.admin_audit_log where action='set_location_coordinates' and target_id=$1`, [hargeisa])).rows;
assert.equal(audit.length, 1);
assert.equal(audit[0].reason, 'verified on map');
ok('an admin can set a city coordinate: rounded to 5 decimals, attributed, audited with a reason');

await setCoord(admin, hargeisa, 9.6, 44.1);
assert.equal(await countRows(hargeisa), 1);
assert.equal((await db.query(`select latitude from public.location_coordinates where location_id=$1`, [hargeisa])).rows[0].latitude, 9.6);
ok('setting again updates the one row (no duplicates)');

// ---- invalid values / non-cities
const bad = (lat, lng, re) => fails(admin, `select public.admin_set_location_coordinates($1,$2,$3,null)`, [hargeisa, lat, lng], re);
await bad(91, 44, /22023|-90 to 90/);
await bad(9, 181, /22023|-180 to 180/);
await bad(0, 0, /22023|not a real place/);
await bad(9.5, null, /22023|both/);
await bad(null, 44, /22023|both/);
await bad(NaN, 44, /22023|both/);
await bad(Infinity, 44, /22023|both/);
await fails(admin, `select public.admin_set_location_coordinates($1, 9.5, 44.0, null)`, [somaliland], /only be set on a city/);
await fails(admin, `select public.admin_set_location_coordinates($1, 9.5, 44.0, null)`, ['00000000-0000-4000-8000-0000000fffff'], /not found/);
assert.equal((await db.query(`select latitude from public.location_coordinates where location_id=$1`, [hargeisa])).rows[0].latitude, 9.6);
ok('out-of-range, 0/0, half-filled, NaN/Infinity, non-city and unknown ids are rejected and change nothing');

// table-level protection even for a privileged direct insert
await assert.rejects(db.query(`insert into public.location_coordinates(location_id, latitude, longitude) values ($1, 95, 44)`, [jigjiga]), /check constraint|23514/);
await assert.rejects(db.query(`insert into public.location_coordinates(location_id, latitude, longitude) values ($1, 0, 0)`, [jigjiga]), /check constraint|23514/);
await assert.rejects(db.query(`insert into public.location_coordinates(location_id, latitude, longitude) values ($1, 9, 44)`, [ethiopia]), /only be set on a city/);
ok('table constraints and the cities-only trigger hold even for direct inserts');

// ---- client reads: approved cities only, limited columns, no writes
await setCoord(admin, jigjiga, 9.35, 42.8);
const anonRows = (await q(null, `select location_id, latitude, longitude from public.location_coordinates`)).rows;
assert.deepEqual(anonRows.map((r) => r.location_id).sort(), [hargeisa, jigjiga].sort());
ok('anon and signed-in clients can read approved cities coordinates');
await fails(user, `select updated_by from public.location_coordinates`, [], /permission denied|42501/);
await fails(user, `select updated_at from public.location_coordinates`, [], /permission denied|42501/);
ok('who/when stay private (column grant)');

for (const w of [
  `insert into public.location_coordinates(location_id, latitude, longitude) values ('${jigjiga}', 9, 44)`,
  `update public.location_coordinates set latitude = 1`,
  `delete from public.location_coordinates`,
]) {
  for (const who of [user, null]) await fails(who, w, [], /permission denied|42501|row-level/);
}
assert.equal((await db.query(`select count(*)::int n from public.location_coordinates`)).rows[0].n, 2);
ok('clients cannot insert, update or delete coordinates');

for (const status of ['inactive', 'pending', 'rejected']) {
  await db.query(`update public.locations set status=$2 where id=$1`, [jigjiga, status]);
  assert.deepEqual((await q(user, `select location_id from public.location_coordinates`)).rows.map((r) => r.location_id), [hargeisa], status);
}
assert.equal((await q(admin, `select * from public.admin_list_location_coordinates()`)).rows.length, 2);
await db.query(`update public.locations set status='approved' where id=$1`, [jigjiga]);
ok('inactive, pending and rejected cities are hidden from clients but visible to the admin list');

// ---- stable ids: rename and re-parent keep the coordinate
const before = (await db.query(`select latitude, longitude from public.location_coordinates where location_id=$1`, [hargeisa])).rows[0];
const parentOf = (await db.query(`select parent_id from public.locations where id=$1`, [hargeisa])).rows[0].parent_id;
await db.query(`update public.locations set name='Hargeysa' where id=$1`, [hargeisa]);
await db.query(`update public.locations set parent_id=$2 where id=$1`, [hargeisa, ethiopia]);
assert.deepEqual((await db.query(`select latitude, longitude from public.location_coordinates where location_id=$1`, [hargeisa])).rows[0], before);
await db.query(`update public.locations set parent_id=$2, name='Hargeisa' where id=$1`, [hargeisa, parentOf]);
ok('renaming and re-parenting a city keep its coordinate (keyed by id)');

// ---- merge does NOT copy coordinates
const mergeSrc = (await db.query(`insert into public.locations(kind,name,parent_id,status) values ('city','Hargeisa North',$1,'pending') returning id`, [somaliland])).rows[0].id;
await setCoord(admin, mergeSrc, 9.7, 44.2); // pending city: admins may pre-fill, clients never see it
await q(admin, `select public.admin_merge_location($1,$2,'dup')`, [mergeSrc, hargeisa]);
assert.deepEqual((await db.query(`select latitude, longitude from public.location_coordinates where location_id=$1`, [hargeisa])).rows[0], before);
assert.equal((await q(user, `select 1 from public.location_coordinates where location_id=$1`, [mergeSrc])).rows.length, 0);
ok('merging a city into another leaves the target coordinate untouched and the merged-away one hidden');

// ---- clear
await setCoord(admin, jigjiga, null, null, 'wrong');
assert.equal(await countRows(jigjiga), 0);
assert.equal((await db.query(`select count(*)::int n from public.admin_audit_log where action='clear_location_coordinates'`)).rows[0].n, 1);
ok('both values null clears the row, audited');

// ---- admin delete cascades
await q(admin, `select public.admin_delete_location($1,'test')`, [hargeisa]);
assert.equal(await countRows(hargeisa), 0);
ok('deleting a city (0035 admin delete) removes its coordinate');

console.log('location_coordinates: all assertions passed');
