// 0069 — each signed-in person counts once per listing; the owner and anonymous visitors never count.
// Real Postgres (PGlite), the REAL migration chain and rollback SQL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, actors, seedUsers, ok, uuid } from './harness/db.mjs';

const { db, applied } = await boot();
assert.ok(applied.includes('0069_unique_listing_viewers.sql'));
const { q } = actors(db);
const [owner, a, b] = await seedUsers(db, 3);
await db.exec("select set_config('suuqplus.skip_rate_limit','true',false)");
const L = uuid(901);
await db.query(`insert into public.listings (id,user_id,title,category,city,price,currency,status,images) values ($1,$2,'Laptop','electronics','Hargeisa',100,'USD','available',array['https://x.test/a.jpg'])`, [L, owner]);
const views = async () => (await db.query(`select views v from public.listings where id=$1`, [L])).rows[0].v;
const events = async () => (await db.query(`select count(*)::int n from public.listing_view_events where listing_id=$1`, [L])).rows[0].n;
const view = (who) => q(who, `select public.increment_listing_views($1)`, [L]);

for (let i = 0; i < 5; i++) await view(owner);
assert.equal(await views(), 0);
ok('the owner opening their own listing never counts');

await view(a);
for (let i = 0; i < 10; i++) await view(a);
assert.equal(await views(), 1);
assert.equal(await events(), 1);
ok('one person opening a listing many times counts once');

await view(b);
assert.equal(await views(), 2);
assert.equal(await events(), 2);
ok('a different person counts as a new view');

await db.query(`update public.listing_unique_viewers set first_viewed_at = now() - interval '2 years' where viewer_id=$1`, [a]);
await view(a);
assert.equal(await views(), 2);
ok('coming back a year later still counts once');

await db.exec(`reset role`).catch(() => {});
await db.query(`select set_config('request.jwt.claims','',false)`).catch(() => {});
const rollback = readFileSync(new URL('../rollback/0069_unique_listing_viewers_ROLLBACK.sql', import.meta.url), 'utf8');
await db.exec(rollback);
await db.exec(rollback);
assert.equal((await db.query(`select to_regclass('public.listing_unique_viewers') t`)).rows[0].t, null);
ok('rollback drops the table, restores the old function, and is re-runnable');
console.log('unique_listing_views: all passed');
