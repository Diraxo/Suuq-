// 0072 (private account phone) on the REAL chain, real Postgres (PGlite).
// Proves:
//   * the move: numbers that exist before 0072 end up only in private.profile_phones, profiles.phone is NULL, no staff alert / updated_at churn;
//   * direct table access: anon and signed-in users get NULL from profiles (select phone, select *, joins, home_feed), cannot touch
//     private.profile_phones, and anon cannot call any of the new functions;
//   * write paths keep working (a written number is stored privately), a NULL write never erases it, clear_my_phone() does;
//   * get_contact_phone(): the full allow/deny matrix — personal vs business, the business_phone_public toggle, listing state,
//     chat direction, blocks (both ways), suspended parties, wrong owner/ref, unknown context, rate limit.
// Not proven here: PostgREST behaviour (select=* through the API), Realtime delivery, the apps (tests/*.test.ts cover the display rules).
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, uuid, sqlFile } from './harness/db.mjs';

const ALICE_PHONE = '+252611111111';
const BOB_PHONE = '+252622222222';

// ---- A. the move, on a database that already holds numbers (chain up to 0071, then 0072 by hand) ----------------------------------
{
  const { db } = await boot({ upTo: '0071' });
  const [a, b, c] = await seedUsers(db, 3);
  await db.query(`update public.profiles set phone=$1, phone_country='SO'  where id=$2`, [` ${ALICE_PHONE} `, a]);
  await db.query(`update public.profiles set phone=$1 where id=$2`, [BOB_PHONE, b]);
  await db.query(`update public.profiles set phone='   ' where id=$1`, [c]);
  const alerts0 = (await db.query(`select count(*)::int n from public.notifications`)).rows[0].n;
  await db.exec('alter table public.profiles disable trigger user');
  await db.query(`update public.profiles set updated_at='2020-06-15T12:00:00Z' where id=$1`, [a]);
  await db.exec('alter table public.profiles enable trigger user');

  await db.exec(sqlFile('migrations/0072_private_profile_phone.sql'));

  const pub = (await db.query(`select id, phone, phone_country, updated_at from public.profiles where id in ($1,$2,$3) order by id`, [a, b, c])).rows;
  assert.ok(pub.every((r) => r.phone === null), 'no number left in the public column');
  assert.equal(pub[0].phone_country, 'SO');
  assert.equal(new Date(pub[0].updated_at).toISOString(), '2020-06-15T12:00:00.000Z', 'the move did not touch updated_at');
  const priv = (await db.query(`select user_id, phone from private.profile_phones order by user_id`)).rows;
  assert.deepEqual(priv, [{ user_id: a, phone: ALICE_PHONE }, { user_id: b, phone: BOB_PHONE }], 'trimmed numbers moved; blank value dropped');
  assert.equal((await db.query(`select count(*)::int n from public.notifications`)).rows[0].n, alerts0, 'the move raised no staff alerts');
  // re-running is harmless
  await db.exec(sqlFile('migrations/0072_private_profile_phone.sql'));
  assert.equal((await db.query(`select count(*)::int n from private.profile_phones`)).rows[0].n, 2);
  const triggers = (await db.query(`select count(*)::int n from pg_trigger where tgrelid='public.profiles'::regclass and not tgisinternal and tgenabled <> 'O'`)).rows[0].n;
  assert.equal(triggers, 0, 'every profiles trigger is enabled again');
  ok('migration: existing numbers move to private storage, public column is NULL, re-run is a no-op, triggers re-enabled, no alerts');
}

// ---- B. behaviour on the full chain ------------------------------------------------------------------------------------------------
const { db, applied } = await boot();
assert.ok(applied.includes('0072_private_profile_phone.sql'));
const { q, fails } = actors(db);
const [admin, alice, bob, carol, dave, erin] = await seedUsers(db, 6);
await db.query(`insert into public.admin_users(user_id, role) values ($1,'admin')`, [admin]);

const L = { personal: uuid(901), business: uuid(902), sold: uuid(903), removed: uuid(904) };
const addListing = (id, owner, extra = {}) =>
  db.query(
    `insert into public.listings (id,user_id,title,category,city,price,currency,status,images,seller_presentation) values ($1,$2,'Laptop','electronics','Hargeisa',100,'USD',$3,array['https://x.test/a.jpg'],$4)`,
    [id, owner, extra.status ?? 'available', extra.presentation ?? 'personal']
  );
const contact = async (viewer, owner, ctx, ref = null) => (await q(viewer, `select public.get_contact_phone($1,$2,$3) as p`, [owner, ctx, ref])).rows[0].p;
const setBusiness = (id, name, toggle) => db.query(`update public.profiles set business_name=$2, business_phone_public=$3 where id=$1`, [id, name, toggle]);

// Alice writes her number through the ordinary profile update (what every client does today).
await q(alice, `update public.profiles set phone=$1, phone_country='SO' where id=$2`, [ALICE_PHONE, alice]);
await q(bob, `update public.profiles set phone=$1 where id=$2`, [BOB_PHONE, bob]);
await addListing(L.personal, alice);
await setBusiness(alice, 'Alice Shop', false);
await addListing(L.business, alice, { presentation: 'business' });
assert.equal((await db.query(`select business_name from public.profiles where id=$1`, [alice])).rows[0].business_name, 'Alice Shop');

// ---- 1. every direct read path returns NULL ------------------------------------------------------------------------------------
for (const who of [null, bob, alice]) {
  const label = who === null ? 'anon' : who === alice ? 'the owner' : 'another user';
  const r1 = await q(who, `select phone from public.profiles where id=$1`, [alice]);
  assert.equal(r1.rows[0].phone, null, `${label}: select phone`);
  const r2 = await q(who, `select * from public.profiles where id=$1`, [alice]);
  assert.equal(r2.rows[0].phone, null, `${label}: select *`);
  const r3 = await q(who, `select to_jsonb(p)::text as j from public.profiles p`);
  assert.ok(r3.rows.every((x) => !x.j.includes('2526111') && !x.j.includes('2526222')), `${label}: row-to-json of every profile`);
}
ok('profiles.phone is NULL for anon, other users and the owner through select phone / select * / to_jsonb');

// joins used by the clients (conversation embeds, listing seller joins)
const conv = (await q(carol, `select * from public.find_or_create_conversation($1)`, [L.personal])).rows[0];
const joined = await q(carol, `select s.phone as sp, b.phone as bp from public.conversations c join public.profiles s on s.id=c.seller_id join public.profiles b on b.id=c.buyer_id where c.id=$1`, [conv.id]);
assert.deepEqual(joined.rows[0], { sp: null, bp: null });
const feed = await q(null, `select public.home_feed()::text as j`).catch(() => null);
if (feed) assert.ok(!feed.rows[0].j.includes('2526111'), 'home_feed output carries no number');
ok('conversation joins and the home feed RPC carry no number');

// the private table and the new functions are not reachable by direct means
for (const who of [null, bob, alice]) {
  await fails(who, `select * from private.profile_phones`, [], /permission denied|does not exist/i);
  await fails(who, `insert into private.profile_phones(user_id, phone) values ($1,'+1')`, [who ?? bob], /permission denied|does not exist/i);
  await fails(who, `update private.profile_phones set phone='+1'`, [], /permission denied|does not exist/i);
}
await fails(null, `select public.get_contact_phone($1,'personal_profile',null)`, [alice], /permission denied/i);
await fails(null, `select public.my_phone()`, [], /permission denied/i);
await fails(null, `select public.clear_my_phone()`, [], /permission denied/i);
await fails(bob, `select private.divert_profile_phone()`, [], /permission denied|does not exist|trigger/i);
ok('private.profile_phones is closed to anon and signed-in roles; the reveal functions are closed to anon');

// ---- 2. write paths keep working and stay private -------------------------------------------------------------------------------------
assert.equal((await q(alice, `select public.my_phone() as p`)).rows[0].p, ALICE_PHONE);
assert.equal((await q(bob, `select public.my_phone() as p`)).rows[0].p, BOB_PHONE, 'each user sees only their own');
assert.equal((await q(carol, `select public.my_phone() as p`)).rows[0].p, null);
await q(alice, `update public.profiles set phone=null, city='Hargeisa' where id=$1`, [alice]);
assert.equal((await q(alice, `select public.my_phone() as p`)).rows[0].p, ALICE_PHONE, 'a NULL write (an old build saving its form) never erases the number');
await q(alice, `update public.profiles set phone='+252633333333' where id=$1`, [alice]);
assert.equal((await q(alice, `select public.my_phone() as p`)).rows[0].p, '+252633333333');
assert.equal((await q(alice, `select phone from public.profiles where id=$1`, [alice])).rows[0].phone, null);
await q(alice, `update public.profiles set phone=$1 where id=$2`, [ALICE_PHONE, alice]);
// nobody can write another user's number
const hit = await q(bob, `update public.profiles set phone='+999' where id=$1 returning id`, [alice]);
assert.equal(hit.rows.length, 0);
assert.equal((await q(alice, `select public.my_phone() as p`)).rows[0].p, ALICE_PHONE);
await q(erin, `select public.clear_my_phone()`);
assert.equal((await q(bob, `select public.my_phone() as p`)).rows[0].p, BOB_PHONE, "clear_my_phone() only touches the caller's own number");
await q(dave, `update public.profiles set phone=$1 where id=$2`, ['+252644444444', dave]);
await q(dave, `select public.clear_my_phone()`);
assert.equal((await q(dave, `select public.my_phone() as p`)).rows[0].p, null);
ok('writes are stored privately; a NULL write is ignored; clear_my_phone() clears only the caller; nobody writes another user\'s number');

// ---- 3. get_contact_phone: personal ----------------------------------------------------------------------------------------------
assert.equal(await contact(carol, alice, 'personal_profile'), ALICE_PHONE);
assert.equal(await contact(carol, alice, 'listing', L.personal), ALICE_PHONE);
assert.equal(await contact(carol, alice, 'chat', conv.id), ALICE_PHONE, 'buyer calls the seller of a personal listing');
assert.equal(await contact(alice, alice, 'personal_profile'), ALICE_PHONE, 'owner');
ok('personal context: a signed-in, non-blocked viewer gets the number on the profile, the listing and in chat');

// ---- 4. business: the toggle decides, per context, and takes effect at once ----------------------------------------------------------
assert.equal(await contact(carol, alice, 'listing', L.business), null, 'business listing, toggle off');
assert.equal(await contact(carol, alice, 'business_profile'), null, 'business profile, toggle off');
const convBiz = (await q(carol, `select * from public.find_or_create_conversation($1)`, [L.business])).rows[0];
assert.equal(await contact(carol, alice, 'chat', convBiz.id), null, 'chat about a business listing, toggle off');
await db.query(`update public.profiles set active_mode='business' where id=$1`, [alice]);
const direct = (await q(carol, `select * from public.start_business_conversation($1)`, [alice])).rows[0];
assert.equal(await contact(carol, alice, 'chat', direct.id), null, 'direct business inquiry, toggle off');
assert.equal(await contact(carol, alice, 'personal_profile'), ALICE_PHONE, 'the personal rule is separate: personal listing/profile is unaffected by the business toggle');
assert.equal(await contact(carol, alice, 'listing', L.personal), ALICE_PHONE);

await q(alice, `update public.profiles set business_phone_public=true where id=$1`, [alice]);
assert.equal(await contact(carol, alice, 'listing', L.business), ALICE_PHONE);
assert.equal(await contact(carol, alice, 'business_profile'), ALICE_PHONE);
assert.equal(await contact(carol, alice, 'chat', convBiz.id), ALICE_PHONE);
assert.equal(await contact(carol, alice, 'chat', direct.id), ALICE_PHONE);
await q(alice, `update public.profiles set business_phone_public=false where id=$1`, [alice]);
assert.equal(await contact(carol, alice, 'listing', L.business), null, 'turning the toggle off withdraws it immediately');
assert.equal(await contact(carol, alice, 'chat', direct.id), null);
// a business-presented listing whose owner has no business name any more is still business-gated (the number is not "falling back" to personal)
await db.query(`update public.profiles set business_name=null, active_mode='personal' where id=$1`, [alice]);
assert.equal(await contact(carol, alice, 'listing', L.business), null);
assert.equal(await contact(carol, alice, 'business_profile'), null, 'no business name = no business profile = nothing to call');
await setBusiness(alice, 'Alice Shop', false);
ok('business context: only with business_phone_public, per listing/chat/profile, withdrawn immediately, never falls back to the personal number');

// ---- 5. state, ownership and context checks -------------------------------------------------------------------------------------------
await addListing(L.sold, alice);
await addListing(L.removed, alice);
// New listings are always created 'available' by the sanitising trigger; move them to their final state afterwards.
await db.query(`update public.listings set status='sold' where id=$1`, [L.sold]);
await db.query(`update public.listings set status='removed' where id=$1`, [L.removed]);
assert.deepEqual((await db.query(`select id, status from public.listings where id in ($1,$2) order by status`, [L.sold, L.removed])).rows.map((r) => r.status), ['removed', 'sold']);
assert.equal(await contact(carol, alice, 'listing', L.sold), null, 'sold');
assert.equal(await contact(carol, alice, 'listing', L.removed), null, 'removed by staff');
assert.equal(await contact(carol, bob, 'listing', L.personal), null, "another owner's id with Alice's listing");
assert.equal(await contact(carol, alice, 'listing', uuid(999)), null, 'unknown listing');
assert.equal(await contact(carol, alice, 'listing', null), null, 'listing context without a listing');
assert.equal(await contact(carol, alice, 'nonsense', L.personal), null, 'unknown context');
assert.equal(await contact(carol, alice, null, L.personal), null);
assert.equal(await contact(carol, uuid(998), 'personal_profile'), null, 'unknown owner');
assert.equal(await contact(carol, null, 'personal_profile'), null);
ok('closed/removed listings, wrong owner, wrong ref, unknown context and unknown owner all return NULL');

// chat: direction and membership
assert.equal(await contact(alice, carol, 'chat', conv.id), null, "the seller is never given the buyer's number");
assert.equal(await contact(alice, alice, 'chat', conv.id), null, 'the conversation does not make the owner the other party');
assert.equal(await contact(dave, alice, 'chat', conv.id), null, 'a third party with a real conversation id');
assert.equal(await contact(carol, alice, 'chat', uuid(997)), null, 'unknown conversation');
await q(carol, `update public.profiles set phone='+252655555555' where id=$1`, [carol]);
assert.equal(await contact(alice, carol, 'personal_profile'), '+252655555555', 'personal profile context is the only way to a person number, and it is the owner-published one');
ok('chat: only the buyer can ask for the seller\'s number; seller, third parties and unknown conversations get NULL');

// ---- 6. blocks and account standing ------------------------------------------------------------------------------------------------
await db.query(`insert into public.blocked_users(blocker_id, blocked_id) values ($1,$2)`, [alice, carol]);
assert.equal(await contact(carol, alice, 'personal_profile'), null, 'blocked by the owner');
assert.equal(await contact(carol, alice, 'listing', L.personal), null);
await db.query(`delete from public.blocked_users`);
await db.query(`insert into public.blocked_users(blocker_id, blocked_id) values ($1,$2)`, [carol, alice]);
assert.equal(await contact(carol, alice, 'personal_profile'), null, 'the viewer blocked the owner');
await db.query(`delete from public.blocked_users`);
assert.equal(await contact(carol, alice, 'personal_profile'), ALICE_PHONE, 'unblocked again');

await db.query(`update public.profiles set account_status='suspended' where id=$1`, [alice]);
assert.equal(await contact(carol, alice, 'personal_profile'), null, 'suspended owner');
await db.query(`update public.profiles set account_status='active' where id=$1`, [alice]);
await db.query(`update public.profiles set account_status='banned' where id=$1`, [carol]);
assert.equal(await contact(carol, alice, 'personal_profile'), null, 'banned viewer cannot harvest numbers');
await db.query(`update public.profiles set account_status='active' where id=$1`, [carol]);
ok('blocked either way, suspended or banned parties: NULL');

// ---- 7. rate limit ------------------------------------------------------------------------------------------------------------------------
await db.query(`delete from public.rate_limit_events`);
let denied = null;
for (let i = 0; i < 205 && !denied; i++) {
  try {
    await contact(erin, alice, 'personal_profile');
  } catch (e) {
    denied = { i, e };
  }
}
assert.ok(denied && denied.i === 200 && /Rate limit/.test(denied.e.message), `limit hit at call ${denied?.i}`);
ok('reveal_phone is rate limited (200 per hour per viewer) so the function cannot be used to harvest numbers');

console.log('\nphone_privacy: all checks passed');
