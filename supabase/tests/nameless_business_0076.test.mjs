// 0076 — business mode WITHOUT a business name (0075) must work with the 0068 listing guard and the 0066 direct chat.
// Real Postgres (PGlite), the REAL migration chain (0075 then 0076 in order) and the REAL rollback SQL. Listing writes run as the
// `authenticated` role (client triggers + RLS active), exactly like the apps' insert / upsert / bulk-import path.
// Proves: a nameless business-mode account publishes a business-presented listing (single, upsert and multi-row bulk); a personal-mode
// account does not gain that by having a blank name; legacy named accounts behave as before; unrelated restrictions (RLS owner check,
// suspension, check constraint, blank-name personal, update path) still fail; direct chat to a nameless business-mode account works
// without weakening mode / self / block / anon / participant rules; the 0076 rollback restores the 0068 + 0066 behaviour.
// Not proven here: PostgREST, the apps.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, actors, seedUsers, ok, uuid } from './harness/db.mjs';

const { db, applied } = await boot();
assert.ok(applied.indexOf('0075_unified_identity_name_limit.sql') >= 0 && applied.indexOf('0076_nameless_business_compat.sql') > applied.indexOf('0075_unified_identity_name_limit.sql'), '0075 then 0076');
const { q, fails } = actors(db);
const [nameless, personal, legacy, buyer, other] = await seedUsers(db, 5);
await db.exec("select set_config('suuqplus.skip_rate_limit','true',false)");

const BIZ = /business_profile_incomplete|business name/;
const insertListing = (uid, id, presentation, owner = uid) =>
  q(uid, `insert into public.listings (id,user_id,title,category,city,price,currency,status,images,seller_presentation) values ($1,$2,'Laptop','electronics','Hargeisa',100,'USD','available',array['https://x.test/a.jpg'],$3)`, [id, owner, presentation]);
const presentation = async (id) => (await db.query(`select seller_presentation s from public.listings where id=$1`, [id])).rows[0]?.s;
const listingCount = async (uid) => (await db.query(`select count(*)::int n from public.listings where user_id=$1`, [uid])).rows[0].n;

// legacy account keeps a business name; `nameless` is a post-0075 business account (no name), `personal` has no name and stays personal
await db.query(`update public.profiles set business_name='Old Shop', active_mode='business' where id=$1`, [legacy]);
await q(nameless, `select public.set_active_mode('business')`);
const np = (await db.query(`select active_mode, business_name from public.profiles where id=$1`, [nameless])).rows[0];
assert.deepEqual({ ...np }, { active_mode: 'business', business_name: null });
ok('setup: 0075 lets a nameless account into business mode');

// ---- listings ----
await insertListing(nameless, uuid(901), 'business');
assert.equal(await presentation(uuid(901)), 'business');
ok('a Business-mode account with a blank business_name publishes a business-presented listing');

await fails(personal, `insert into public.listings (id,user_id,title,category,city,price,currency,status,images,seller_presentation) values ($1,$2,'Laptop','electronics','Hargeisa',100,'USD','available',array['https://x.test/a.jpg'],'business')`, [uuid(902), personal], BIZ);
assert.equal(await listingCount(personal), 0);
await db.query(`update public.profiles set business_name='   ' where id=$1`, [personal]);
await fails(personal, `insert into public.listings (id,user_id,title,category,city,price,currency,status,images,seller_presentation) values ($1,$2,'Laptop','electronics','Hargeisa',100,'USD','available',array['https://x.test/a.jpg'],'business')`, [uuid(903), personal], BIZ);
await insertListing(personal, uuid(904), 'personal');
await fails(personal, `update public.listings set seller_presentation='business' where id=$1`, [uuid(904)], BIZ);
assert.equal(await presentation(uuid(904)), 'personal');
ok('a Personal-mode account (blank or whitespace name) is still refused: a blank name alone grants nothing, on insert or update');

await insertListing(legacy, uuid(905), 'business');
await insertListing(legacy, uuid(906), 'personal');
await q(legacy, `select public.set_active_mode('personal')`);
await insertListing(legacy, uuid(907), 'business');
assert.equal(await presentation(uuid(907)), 'business');
ok('a legacy account with a business name behaves exactly as before (including personal mode: the named rule is unchanged)');

await fails(nameless, `insert into public.listings (id,user_id,title,category,city,price,currency,status,images,seller_presentation) values ($1,$2,'Laptop','electronics','Hargeisa',100,'USD','available',array['https://x.test/a.jpg'],'business')`, [uuid(908), legacy], /row-level security|42501/);
await fails(nameless, `insert into public.listings (id,user_id,title,category,city,price,currency,status,images,seller_presentation) values ($1,$2,'Laptop','electronics','Hargeisa',100,'USD','available',array['https://x.test/a.jpg'],'team')`, [uuid(909), nameless], /listings_seller_presentation_check|check constraint/);
await fails(null, `insert into public.listings (id,user_id,title,category,city,price,currency,status,images,seller_presentation) values ($1,$2,'Laptop','electronics','Hargeisa',100,'USD','available',array['https://x.test/a.jpg'],'business')`, [uuid(910), nameless], /permission denied|row-level security|42501/);
assert.equal(await presentation(uuid(908)), undefined);
ok("business mode does not let anyone publish as another user; unknown values and anon are still refused");

// suspension still applies on top of the guard
await db.query(`select set_config('fursad.admin_write','true',false)`);
await db.query(`update public.profiles set account_status='suspended', suspended_until=now()+interval '1 day' where id=$1`, [nameless]);
await db.query(`select set_config('fursad.admin_write','',false)`);
await fails(nameless, `insert into public.listings (id,user_id,title,category,city,price,currency,status,images,seller_presentation) values ($1,$2,'Laptop','electronics','Hargeisa',100,'USD','available',array['https://x.test/a.jpg'],'business')`, [uuid(911), nameless], /suspended/i);
await db.query(`select set_config('fursad.admin_write','true',false)`);
await db.query(`update public.profiles set account_status='active', suspended_until=null where id=$1`, [nameless]);
await db.query(`select set_config('fursad.admin_write','',false)`);
ok('a suspended nameless business-mode account still cannot publish (account-status check untouched)');

// switching back to personal: published stays, new business listing refused, switching again re-enables
await q(nameless, `select public.set_active_mode('personal')`);
assert.equal(await presentation(uuid(901)), 'business');
await fails(nameless, `insert into public.listings (id,user_id,title,category,city,price,currency,status,images,seller_presentation) values ($1,$2,'Laptop','electronics','Hargeisa',100,'USD','available',array['https://x.test/a.jpg'],'business')`, [uuid(912), nameless], BIZ);
await q(nameless, `select public.set_active_mode('business')`);
await insertListing(nameless, uuid(913), 'business');
ok('leaving business mode keeps published listings and removes the permission to publish new business listings; returning restores it');

// existing personal listing flipped to business by the business-mode owner (update path)
await insertListing(nameless, uuid(914), 'personal');
await q(nameless, `update public.listings set seller_presentation='business' where id=$1`, [uuid(914)]);
assert.equal(await presentation(uuid(914)), 'business');
ok('the update path accepts the change for a business-mode owner');

// ---- bulk: same table, same trigger. Multi-row INSERT (one statement, like a bulk batch) and the app's upsert-on-id path ----
const rows = (owner, base) => [0, 1, 2].map((i) => `('${uuid(base + i)}','${owner}','Bulk ${i}','electronics','Hargeisa',10,'USD','available',array['https://x.test/a.jpg'],'business')`).join(',');
const cols = `(id,user_id,title,category,city,price,currency,status,images,seller_presentation)`;
await q(nameless, `insert into public.listings ${cols} values ${rows(nameless, 920)}`);
assert.equal((await db.query(`select count(*)::int n from public.listings where id between $1 and $2 and seller_presentation='business'`, [uuid(920), uuid(922)])).rows[0].n, 3);
await q(nameless, `insert into public.listings ${cols} values ${rows(nameless, 930)} on conflict (id) do update set title = excluded.title, seller_presentation = excluded.seller_presentation`);
await q(nameless, `insert into public.listings ${cols} values ${rows(nameless, 930)} on conflict (id) do update set title = 'Edited', seller_presentation = excluded.seller_presentation`);
assert.equal((await db.query(`select count(*)::int n from public.listings where id between $1 and $2 and title='Edited'`, [uuid(930), uuid(932)])).rows[0].n, 3);
await fails(personal, `insert into public.listings ${cols} values ${rows(personal, 940)}`, [], BIZ);
assert.equal((await db.query(`select count(*)::int n from public.listings where id between $1 and $2`, [uuid(940), uuid(942)])).rows[0].n, 0);
// mixed batch: a personal-mode owner's batch with ONE business row is refused as a whole (no partial publication)
await fails(personal, `insert into public.listings ${cols} values ('${uuid(950)}','${personal}','P','electronics','Hargeisa',10,'USD','available',array['https://x.test/a.jpg'],'personal'),('${uuid(951)}','${personal}','B','electronics','Hargeisa',10,'USD','available',array['https://x.test/a.jpg'],'business')`, [], BIZ);
assert.equal((await db.query(`select count(*)::int n from public.listings where id in ($1,$2)`, [uuid(950), uuid(951)])).rows[0].n, 0);
ok('bulk publication (multi-row insert, upsert on id) works for a nameless business-mode owner; a personal-mode batch is refused whole');

// ---- direct chat ----
await q(legacy, `select public.set_active_mode('business')`);
const start = (uid, target) => q(uid, `select * from public.start_business_conversation($1)`, [target]);
const c1 = (await start(buyer, nameless)).rows[0];
assert.deepEqual({ l: c1.listing_id, b: c1.buyer_id, s: c1.seller_id }, { l: null, b: buyer, s: nameless });
assert.equal((await start(buyer, nameless)).rows[0].id, c1.id);
assert.deepEqual((await db.query(`select user_id from public.conversation_participants where conversation_id=$1`, [c1.id])).rows.map((r) => r.user_id).sort(), [buyer, nameless].sort());
await q(buyer, `insert into public.messages(conversation_id, sender_id, text) values ($1,$2,'hello')`, [c1.id, buyer]);
await q(nameless, `insert into public.messages(conversation_id, sender_id, text) values ($1,$2,'hi')`, [c1.id, nameless]);
await fails(other, `insert into public.messages(conversation_id, sender_id, text) values ($1,$2,'intruder')`, [c1.id, other], /row-level security|42501|not a participant|violates/i);
ok('a nameless business-mode account can RECEIVE a direct conversation (idempotent, exactly two participants, outsiders cannot post)');

const c2 = (await start(nameless, legacy)).rows[0];
assert.equal(c2.buyer_id, nameless);
ok('a nameless business-mode account can also START one');

await fails(other, `select * from public.start_business_conversation($1)`, [personal], /Business not found|P0002/);
await fails(nameless, `select * from public.start_business_conversation($1)`, [nameless], /yourself/);
await fails(null, `select * from public.start_business_conversation($1)`, [nameless], /permission denied|42501|28000/);
await q(nameless, `select public.set_active_mode('personal')`);
await fails(other, `select * from public.start_business_conversation($1)`, [nameless], /Business not found|P0002/);
await q(nameless, `select public.set_active_mode('business')`);
await db.query(`insert into public.blocked_users(blocker_id, blocked_id) values ($1,$2)`, [nameless, other]);
await fails(other, `select * from public.start_business_conversation($1)`, [nameless], /Listing not found|P0002|block/i);
await db.query(`delete from public.blocked_users where blocker_id=$1`, [nameless]);
await db.query(`insert into public.blocked_users(blocker_id, blocked_id) values ($1,$2)`, [other, nameless]);
await fails(other, `select * from public.start_business_conversation($1)`, [nameless], /Listing not found|P0002|block/i);
await db.query(`delete from public.blocked_users where blocker_id=$1`, [other]);
ok('personal-mode targets, yourself, anon, a personal-mode switch-back and blocks in either direction are still refused');

// account-status parity: the function never checked status, so a nameless target behaves exactly like a named one (nothing relaxed)
await db.query(`select set_config('fursad.admin_write','true',false)`);
await db.query(`update public.profiles set account_status='suspended', suspended_until=now()+interval '1 day' where id=$1`, [other]);
await db.query(`select set_config('fursad.admin_write','',false)`);
const outcome = async (target) => { try { await start(other, target); return 'ok'; } catch (e) { return `${e.code}`; } };
const [oNamed, oNameless] = [await outcome(legacy), await outcome(nameless)];
assert.equal(oNamed, oNameless);
ok(`account-status behaviour of the chat starter is identical for named and nameless targets (suspended buyer -> ${oNamed})`);

// ---- 0076 rollback restores 0068 + 0066 ----
const rb = readFileSync(new URL('../rollback/0076_nameless_business_compat_ROLLBACK.sql', import.meta.url), 'utf8');
await db.exec(rb);
await db.exec(rb);
await fails(nameless, `insert into public.listings ${cols} values ${rows(nameless, 960)}`, [], BIZ);
assert.equal(await presentation(uuid(901)), 'business', 'published listing untouched');
await fails(buyer, `select * from public.start_business_conversation($1)`, [nameless], /Business not found|P0002/);
assert.equal((await start(buyer, legacy)).rows.length, 1, 'named business still reachable');
assert.equal((await db.query(`select count(*)::int n from public.conversations where id=$1`, [c1.id])).rows[0].n, 1, 'existing direct chat kept');
await insertListing(legacy, uuid(970), 'business');
ok('0076 rollback is re-runnable, restores the name requirement, keeps published listings and existing chats, named accounts unaffected');

console.log('nameless_business_0076: all passed');
