// 0079 — one discount rule for badge, "Discounted" filter and Discounts tab, on a REAL Postgres (PGlite).
// Proves: >=1% threshold on server filter + tab (exactly 1% in, 0.99% out), a raise back to the old price ends the
// discount, a currency change clears the stale "from" price, sold/reserved carry no discount, a still-below raise keeps it,
// the 14-day window applies to the tab, and the rollback restores the 0038/0043 behaviour.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, actors, seedUsers, ok, uuid } from './harness/db.mjs';

const { db, applied } = await boot({ upTo: '0079' });
assert.ok(applied.includes('0079_discount_rules.sql'));
const { q } = actors(db);
const [seller, buyer] = await seedUsers(db, 2);
await db.exec("select set_config('suuqplus.skip_rate_limit','true',false)");

let seq = 700;
async function listing(price, o = {}) {
  const id = uuid(++seq);
  await db.query(
    `insert into public.listings (id,user_id,title,category,city,price,currency,status,images) values ($1,$2,$3,'electronics','Hargeisa',$4,$5,$6,array['https://x.test/a.jpg'])`,
    [id, seller, 'Item ' + seq, price, o.currency ?? 'USD', o.status ?? 'available']
  );
  return id;
}
const edit = (id, set) => q(seller, `update public.listings set ${set} where id=$1`, [id]);
const tab = async () => (await q(buyer, `select listing->>'id' id from public.home_feed(p_tab => 'price_drops', p_limit => 60)`)).rows.map((r) => r.id);
const search = async () => (await q(buyer, `select listing->>'id' id, price_reduced from public.search_listings(p_price_reduced => true, p_limit => 60)`)).rows;
const badge = async (id) => (await q(buyer, `select price_reduced from public.search_listings(p_limit => 60) where listing->>'id'=$1`, [id])).rows[0]?.price_reduced;

const real = await listing(1000);          // 1000 -> 900  : 10%
const exact1 = await listing(1000);        // 1000 -> 990  : exactly 1%
const under1 = await listing(10000);       // 10000 -> 9901: 0.99%
await edit(real, 'price=900'); await edit(exact1, 'price=990'); await edit(under1, 'price=9901');

let t = await tab(); let s = (await search()).map((r) => r.id);
assert.ok(t.includes(real) && t.includes(exact1) && !t.includes(under1), 'tab: 10% and exactly 1% in, 0.99% out');
assert.ok(s.includes(real) && s.includes(exact1) && !s.includes(under1), 'filter: same threshold as the tab');
assert.equal(await badge(real), true); assert.equal(await badge(under1), false);
ok('Discounts tab, "Discounted" filter and badge flag share the 1% threshold (1% in, 0.99% out)');

// raised back to the old price: discount ends and the stored drop is cleared
await edit(real, 'price=1000');
const row = (await db.query(`select last_price_drop_at a, last_price_drop_from f from public.listings where id=$1`, [real])).rows[0];
assert.equal(row.a, null); assert.equal(row.f, null);
assert.ok(!(await tab()).includes(real) && !(await search()).some((r) => r.id === real));
ok('price raised back to the old price: not discounted anywhere, stored drop cleared');

// raised but still below the old price: stays discounted (it is still cheaper than before the cut)
const partial = await listing(1000); await edit(partial, 'price=800'); await edit(partial, 'price=900');
assert.ok((await tab()).includes(partial) && (await search()).some((r) => r.id === partial));
ok('price raised but still below the old price: still discounted');

// currency change clears the stale old-currency "from" price (before 0079: 100 ETB-ish vs 50 USD compared directly)
const cur = await listing(1000, { currency: 'ETB' }); await edit(cur, 'price=800');
assert.ok((await tab()).includes(cur));
await edit(cur, "currency='USD', price=900");
assert.ok(!(await tab()).includes(cur) && !(await search()).some((r) => r.id === cur));
assert.equal((await db.query(`select last_price_drop_from f from public.listings where id=$1`, [cur])).rows[0].f, null);
await edit(cur, "currency='ETB'");
assert.ok(!(await tab()).includes(cur), 'currency-only change also clears it');
ok('currency change: stale drop cleared, never compared across currencies (price+currency together, and currency alone)');

// status: sold / reserved carry no discount
const sold = await listing(1000); await edit(sold, 'price=800'); await db.query(`update public.listings set status='sold' where id=$1`, [sold]);
const res = await listing(1000); await edit(res, 'price=800'); await db.query(`update public.listings set status='reserved' where id=$1`, [res]);
assert.ok(!(await tab()).includes(sold) && !(await tab()).includes(res));
assert.ok(!(await search()).some((r) => r.id === sold || r.id === res));
assert.equal(await badge(res), false);
ok('sold and reserved listings: not in the Discounts tab, filter, or badge');

// 14-day window applies to the tab
const old = await listing(1000); await edit(old, 'price=800');
await db.query(`update public.listings set last_price_drop_at = now() - interval '15 days' where id=$1`, [old]);
assert.ok(!(await tab()).includes(old) && !(await search()).some((r) => r.id === old));
await db.query(`update public.listings set last_price_drop_at = now() - interval '13 days' where id=$1`, [old]);
assert.ok((await tab()).includes(old));
ok('14-day window: 15 days out, 13 days in, on both the tab and the filter');

// pagination of the tab is unaffected (all discounted rows, no dup/missing)
const all = []; let cursor = null;
for (let i = 0; i < 20; i++) {
  const r = (await q(buyer, `select listing->>'id' id, sort_rank from public.home_feed(p_tab=>'price_drops', p_limit=>2, p_cursor_rank=>$1, p_cursor_created_at=>$2, p_cursor_id=>$3)`,
    [cursor?.rank ?? null, cursor?.created ?? null, cursor?.id ?? null])).rows;
  const page = r.slice(0, 2); all.push(...page.map((x) => x.id));
  if (r.length <= 2) break;
  const last = page[1]; const c = (await db.query(`select created_at from public.listings where id=$1`, [last.id])).rows[0];
  cursor = { rank: last.sort_rank, created: c.created_at, id: last.id };
}
assert.deepEqual([...all].sort(), (await tab()).sort());
assert.equal(new Set(all).size, all.length);
ok('Discounts tab paginates cleanly (every discounted row once)');

// rollback restores 0038/0043 behaviour (0.99% cut shows again)
await db.exec(readFileSync(new URL('../rollback/0079_discount_rules_ROLLBACK.sql', import.meta.url), 'utf8'));
assert.equal((await db.query(`select to_regprocedure('public.listing_discount_active(numeric,numeric,timestamptz,text)') r`)).rows[0].r, null);
assert.ok((await tab()).includes(under1) && (await search()).some((r) => r.id === under1));
ok('rollback: predicate dropped, 0.99% cut visible again as before');
console.log('\nALL CHECKS PASSED');
