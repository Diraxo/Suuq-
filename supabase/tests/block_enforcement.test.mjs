// 0044 — one block rule across the base listings table, chat and offers — on a REAL Postgres (PGlite) with the real
// migration chain 0001..0043. Proves: (1) BEFORE 0044 the bypasses exist (pinned), (2) after it a block hides the other
// side's listings on direct table reads and stops new conversations / offers / counters / accepts / messages in BOTH
// directions, (3) existing non-blocked threads are untouched and history stays readable, (4) the error is the same as for
// a missing listing, (5) block rows and the guard helper stay private, (6) unblock restores everything, (7) rollback.
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, uuid, sqlFile } from './harness/db.mjs';

const { db } = await boot({ upTo: '0043' });
const { q, fails } = actors(db);
const [admin, alice, bob, carol] = await seedUsers(db, 4); // alice = seller; bob = buyer who gets blocked; carol = bystander buyer
await db.query(`insert into public.admin_users(user_id) values ($1)`, [admin]);
await db.exec("select set_config('suuqplus.skip_rate_limit','true',false)");

let seq = 700;
async function listing(owner, title) {
  const id = uuid(++seq);
  await db.query(`insert into public.listings (id,user_id,title,category,city,price,currency,status) values ($1,$2,$3,'electronics','Hargeisa',100,'USD','available')`, [id, owner, title]);
  return id;
}
const aliceL = await listing(alice, 'Alice laptop');
const aliceL2 = await listing(alice, 'Alice phone');
const bobL = await listing(bob, 'Bob laptop');

// ---- legitimate history BEFORE any block: bob chats with alice and has a pending offer; carol has her own thread
const conv = (await q(bob, `select * from public.find_or_create_conversation($1)`, [aliceL])).rows[0];
await q(bob, `insert into public.messages(conversation_id, sender_id, text) values ($1,$2,'hello')`, [conv.id, bob]);
await q(bob, `select * from public.create_offer($1, 80, 'can you do 80?')`, [aliceL]);
const carolConv = (await q(carol, `select * from public.find_or_create_conversation($1)`, [aliceL])).rows[0];
await db.query(`insert into public.blocked_users(blocker_id, blocked_id) values ($1,$2)`, [alice, bob]);

const direct = async (uid, id) => (await q(uid, `select id from public.listings where id = $1`, [id])).rows.length;
const offerOf = async (uid, listingId) => (await q(uid, `select id from public.offers where listing_id = $1 and buyer_id = $2 and status = 'pending'`, [listingId, bob])).rows[0]?.id;

// ---------------------------------------------------------------- BEFORE 0044: the bypasses, pinned
assert.equal(await direct(bob, aliceL), 1, 'BEFORE: blocked user reads the blocker\'s listing straight from the table');
await q(bob, `insert into public.messages(conversation_id, sender_id, text) values ($1,$2,'still messaging')`, [conv.id, bob]);
const sneaky = (await q(bob, `select * from public.find_or_create_conversation($1)`, [aliceL2])).rows[0];
assert.ok(sneaky.id, 'BEFORE: blocked user can open a NEW conversation on another of the blocker\'s listings via the RPC');
await q(bob, `select * from public.create_offer($1, 70, null)`, [aliceL2]);
ok('before 0044: a blocked user can still read listings directly, open new chats, send offers and messages (the gaps, pinned)');

// reset the pinned side effects so the after-state starts from the legitimate history only
await db.query(`delete from public.offers where listing_id = $1`, [aliceL2]);
await db.query(`delete from public.conversations where listing_id = $1 and buyer_id = $2`, [aliceL2, bob]);
await db.query(`delete from public.messages where text = 'still messaging'`);

// ---------------------------------------------------------------- apply (twice: idempotent)
await db.exec(sqlFile('migrations/0044_block_enforcement.sql'));
await db.exec(sqlFile('migrations/0044_block_enforcement.sql'));
ok('0044 applies on 0001..0043 and is re-runnable');

// ---------------------------------------------------------------- 1. base table, both directions
assert.equal(await direct(bob, aliceL), 0, 'blocked user cannot read the blocker (direct table)');
assert.equal(await direct(alice, bobL), 0, 'blocker cannot read the blocked user (direct table)');
assert.equal(await direct(carol, aliceL), 1, 'bystander unaffected');
assert.equal(await direct(carol, bobL), 1);
assert.equal(await direct(alice, aliceL), 1, 'owner always sees own');
assert.equal(await direct(bob, bobL), 1);
assert.equal(await direct(admin, aliceL), 1, 'staff always sees');
assert.equal(await direct(null, aliceL), 1, 'guest unaffected (no identity, no blocks)');
const same = async (uid) => (await q(uid, `select count(*)::int c from public.listings where id = any($1::uuid[])`, [[aliceL, uuid(999001)]])).rows[0].c;
assert.equal(await same(bob), 0, 'a blocked listing is indistinguishable from a missing one on a direct read');
ok('direct listings reads: block hides both directions; owner/staff/guest/bystander unaffected; blocked == missing');

// counts the profile/seller screens run (head+count on listings) now agree with seller_listings()
const cnt = async (uid, owner) => (await q(uid, `select count(*)::int c from public.listings where user_id = $1 and status in ('available','reserved')`, [owner])).rows[0].c;
assert.equal(await cnt(bob, alice), 0);
assert.equal(await cnt(carol, alice), 2);
assert.equal(await cnt(alice, alice), 2);
ok('seller listing counts (direct count queries) respect the block, so the count matches the cards');

// hidden_listing_ids() is SECURITY DEFINER and only reports removed/deactivated/gone ids: the new policy must not change it
assert.deepEqual((await q(bob, `select public.hidden_listing_ids($1::uuid[]) h`, [[aliceL, uuid(999003)]])).rows[0].h, [uuid(999003)], 'a blocked-but-live listing is not reported as removed; a missing one is');
ok('hidden_listing_ids (0041) is unaffected by the block policy');

// ---------------------------------------------------------------- 2. existing chat/offers: history intact, listing blanked
const threads = async (uid) => (await q(uid, `select c.id, l.id as listing_id from public.conversations c left join public.listings l on l.id = c.listing_id order by c.created_at`)).rows;
const bobThreads = await threads(bob);
assert.equal(bobThreads.length, 1, 'the thread is still listed for the blocked user (a left join, as PostgREST embeds do)');
assert.equal(bobThreads[0].listing_id, null, '... with the listing embed null (clients render "listing unavailable")');
assert.equal((await threads(alice)).length, 2, 'the blocker still sees both threads');
assert.equal((await q(bob, `select id from public.messages where conversation_id = $1`, [conv.id])).rows.length, 1, 'message history stays readable');
assert.equal((await q(bob, `select id from public.offers where buyer_id = $1`, [bob])).rows.length, 1, 'offer history stays readable');
const carolThreads = await threads(carol);
assert.equal(carolThreads[0].listing_id, aliceL, 'a non-blocked thread keeps its listing');
ok('existing threads: still listed and readable; only the listing embed of the blocked pair is null; unrelated threads untouched');

// ---------------------------------------------------------------- 3. new contact is refused in both directions, with the "missing listing" error
const missing = await fails(bob, `select * from public.find_or_create_conversation($1)`, [uuid(999002)], /Listing not found/);
const blockedErr = await fails(bob, `select * from public.find_or_create_conversation($1)`, [aliceL2], /Listing not found/);
assert.equal(blockedErr.message, missing.message, 'blocked and missing listings give the identical error');
await fails(alice, `select * from public.find_or_create_conversation($1)`, [bobL], /Listing not found/); // blocker -> blocked user's listing
await fails(bob, `select * from public.create_offer($1, 70, null)`, [aliceL2], /Listing not found/);
await fails(alice, `select * from public.create_offer($1, 70, null)`, [bobL], /Listing not found/);
assert.equal((await db.query(`select count(*)::int c from public.offers where listing_id = $1`, [aliceL2])).rows[0].c, 0, 'no offer row was created');
assert.equal((await db.query(`select count(*)::int c from public.conversations where listing_id = $1`, [aliceL2])).rows[0].c, 0, 'no conversation row was created');
await fails(bob, `insert into public.conversations(listing_id,buyer_id,seller_id) values ($1,$2,$3)`, [aliceL2, bob, alice], /row-level security|42501|Listing not found/); // direct insert is not a path either
ok('new conversation / new offer are refused in both directions; blocked looks exactly like not-found; nothing is written');

// ---------------------------------------------------------------- 4. messages
await fails(bob, `insert into public.messages(conversation_id, sender_id, text) values ($1,$2,'hi?')`, [conv.id, bob], /Conversation not available/);
await fails(alice, `insert into public.messages(conversation_id, sender_id, text) values ($1,$2,'hi?')`, [conv.id, alice], /Conversation not available/);
await q(carol, `insert into public.messages(conversation_id, sender_id, text) values ($1,$2,'unrelated')`, [carolConv.id, carol]);
await q(alice, `insert into public.messages(conversation_id, sender_id, text) values ($1,$2,'to carol')`, [carolConv.id, alice]);
ok('messages: blocked pair cannot message each other in either direction; other conversations of the same users keep working');

// ---------------------------------------------------------------- 5. offers: accept/counter refused; reject/cancel still allowed
const pending = await offerOf(bob, aliceL);
assert.ok(pending);
await fails(alice, `select * from public.respond_to_offer($1,'accept')`, [pending], /Listing not found/);
await fails(alice, `select * from public.respond_to_offer($1,'counter',90,null)`, [pending], /Listing not found/);
assert.equal((await db.query(`select status from public.offers where id=$1`, [pending])).rows[0].status, 'pending', 'still pending after refused accept/counter');
await q(alice, `select * from public.respond_to_offer($1,'reject')`, [pending]);
assert.equal((await db.query(`select status from public.offers where id=$1`, [pending])).rows[0].status, 'rejected');
ok('offers: accept and counter are refused for a blocked pair, rejecting is still allowed (nobody is trapped in a pending offer)');

// a pending offer from the blocked side can be cancelled by its author
await db.query(`delete from public.blocked_users`);
const o2 = (await q(bob, `select * from public.create_offer($1, 60, null)`, [aliceL])).rows[0];
await db.query(`insert into public.blocked_users(blocker_id, blocked_id) values ($1,$2)`, [alice, bob]);
await q(bob, `select * from public.cancel_offer($1)`, [o2.id]);
assert.equal((await db.query(`select status from public.offers where id=$1`, [o2.id])).rows[0].status, 'cancelled');
ok('offers: the author can still cancel their own pending offer after being blocked');

// ---------------------------------------------------------------- 6. privacy
assert.equal((await q(bob, `select count(*)::int c from public.blocked_users`)).rows[0].c, 0, 'blocked user cannot read the block row');
assert.equal((await q(carol, `select count(*)::int c from public.blocked_users`)).rows[0].c, 0);
assert.equal((await q(alice, `select count(*)::int c from public.blocked_users`)).rows[0].c, 1, 'blocker manages own list');
await fails(bob, `select private.users_blocked($1,$2)`, [alice, bob], /permission denied/);
await fails(bob, `select private.guard_message_block()`, [], /permission denied/);
assert.equal((await db.query(`select count(*)::int c from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('users_blocked','guard_message_block','guard_offer_block','guard_conversation_block')`)).rows[0].c, 0, 'no guard helper is in the API-exposed schema');
ok('privacy: blocked_users unreadable by others; the pair-check helper and trigger functions are not callable by API roles and not in the public schema');

// ---------------------------------------------------------------- 7. block management still works; unblock restores everything
await q(alice, `delete from public.blocked_users where blocked_id = $1`, [bob]);
assert.equal((await q(alice, `select count(*)::int c from public.blocked_users`)).rows[0].c, 0, 'blocker can unblock');
assert.equal(await direct(bob, aliceL), 1);
assert.equal(await direct(alice, bobL), 1);
await q(bob, `insert into public.messages(conversation_id, sender_id, text) values ($1,$2,'back')`, [conv.id, bob]);
const o3 = (await q(bob, `select * from public.create_offer($1, 75, null)`, [aliceL2])).rows[0];
await q(alice, `select * from public.respond_to_offer($1,'accept')`, [o3.id]);
assert.equal((await db.query(`select status from public.offers where id=$1`, [o3.id])).rows[0].status, 'accepted');
await q(alice, `insert into public.blocked_users(blocker_id, blocked_id) values ($1,$2)`, [alice, bob]);
assert.equal(await direct(bob, aliceL), 0, 'a re-block applies on the next read');
await q(bob, `delete from public.blocked_users where blocker_id = $1`, [alice]);
assert.equal((await db.query(`select count(*)::int c from public.blocked_users`)).rows[0].c, 1, 'the blocked user cannot lift the block');
await q(bob, `insert into public.blocked_users(blocker_id, blocked_id) values ($1,$2)`, [bob, carol]); // the blocked user can still block others
assert.equal(await direct(carol, bobL), 0, 'blocks work in the other direction too (bob blocks carol)');
await q(bob, `delete from public.blocked_users where blocked_id = $1`, [carol]);
ok('unblock restores reads, chat and offers; re-block applies immediately; a block cannot be lifted by the blocked user; users can still manage their own list');

// ---------------------------------------------------------------- 8. rollback
await db.exec(sqlFile('rollback/0044_block_enforcement_ROLLBACK.sql'));
await db.exec(sqlFile('rollback/0044_block_enforcement_ROLLBACK.sql'));
assert.equal(await direct(bob, aliceL), 1, 'rollback restores the 0039 listings policy');
await q(bob, `insert into public.messages(conversation_id, sender_id, text) values ($1,$2,'after rollback')`, [conv.id, bob]);
assert.equal((await db.query(`select count(*)::int c from pg_trigger where tgname like '%block_guard%'`)).rows[0].c, 0);
ok('rollback is re-runnable and restores the previous behaviour');
await db.exec(sqlFile('migrations/0044_block_enforcement.sql'));
assert.equal(await direct(bob, aliceL), 0);
ok('0044 re-applies cleanly after a rollback');
process.exit(0);
