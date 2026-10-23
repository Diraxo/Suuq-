// 0046 — WhatsApp-style blocking for chat, on a REAL Postgres (PGlite) with the real migration chain 0001..0046.
// Proves: a blocked sender's message is accepted but never delivered (no row, no unread, no notification, no preview),
// the blocker keeps the conversation and history but cannot send, read receipts are hidden while blocked, reactions are
// dropped, the "you blocked / unblocked" log is private to its author, nothing leaks to the blocked side, and rollback works.
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, uuid, sqlFile } from './harness/db.mjs';

const { db } = await boot({ upTo: '0046' });
const { q, fails } = actors(db);
const [alice, bob, carol] = await seedUsers(db, 3); // alice = blocker/seller, bob = blocked buyer, carol = bystander
await db.exec("select set_config('suuqplus.skip_rate_limit','true',false)");

const listingId = uuid(901);
await db.query(`insert into public.listings (id,user_id,title,category,city,price,currency,status) values ($1,$2,'Alice laptop','electronics','Hargeisa',100,'USD','available')`, [listingId, alice]);
const conv = (await q(bob, `select * from public.find_or_create_conversation($1)`, [listingId])).rows[0];
const send = (uid, text, conversationId = conv.id) => q(uid, `insert into public.messages(conversation_id, sender_id, text) values ($1,$2,$3) returning id, created_at`, [conversationId, uid, text]);
const texts = async (uid) => (await q(uid, `select text from public.messages where conversation_id = $1 order by created_at, id`, [conv.id])).rows.map((r) => r.text);
const unread = async (uid) => Number((await q(uid, `select unread_count from public.get_conversation_unread_counts() where conversation_id = $1`, [conv.id])).rows[0]?.unread_count ?? 0);
const notifCount = async (uid) => (await db.query(`select count(*)::int c from public.notifications where user_id = $1 and type = 'message'`, [uid])).rows[0].c;
const preview = async () => (await db.query(`select last_message from public.conversations where id = $1`, [conv.id])).rows[0].last_message;

// ---- normal chat before any block
await send(bob, 'hello');
await send(alice, 'hi bob');
assert.deepEqual(await texts(alice), ['hello', 'hi bob']);
assert.equal(await unread(alice), 1);
const notifsBefore = await notifCount(alice);
ok('baseline: both sides chat, unread and notification work');

// ---- alice blocks bob
await q(alice, `insert into public.blocked_users(blocker_id, blocked_id) values ($1,$2)`, [alice, bob]);
await q(alice, `select public.mark_conversation_read($1)`, [conv.id]);

// 1. blocked sender: accepted, one tick, invisible to the blocker
const secret = await send(bob, 'are you there?');
assert.ok(secret.rows[0].id, 'the insert succeeds for the blocked sender (no "failed to send")');
assert.deepEqual(await texts(bob), ['hello', 'hi bob', 'are you there?'], 'the sender sees their own message');
assert.deepEqual(await texts(alice), ['hello', 'hi bob'], 'the blocker never sees it');
assert.equal(await unread(alice), 0, 'no unread count for the blocker');
assert.equal(await notifCount(alice), notifsBefore, 'no notification (and so no push) for the blocker');
assert.equal(await preview(), 'hi bob', 'the shared conversation preview is not bumped by a suppressed message');
await send(bob, 'hello??');
assert.equal((await q(alice, `select count(*)::int c from public.messages where conversation_id = $1 and sender_id = $2`, [conv.id, bob])).rows[0].c, 1, 'still only the pre-block message is visible to the blocker');
ok('blocked sender: insert succeeds, only the sender sees it; the blocker gets no row, unread, notification or preview');

// 2. the blocker keeps the conversation + history, cannot send
assert.equal((await q(alice, `select id from public.conversations where id = $1`, [conv.id])).rows.length, 1, 'the blocker still has the conversation');
const err = await fails(alice, `insert into public.messages(conversation_id, sender_id, text) values ($1,$2,'x')`, [conv.id, alice], /unblock_to_send/);
assert.equal(err.message, 'unblock_to_send');
ok('blocker keeps the conversation and history; sending is refused with unblock_to_send (only they can ever see it)');

// 3. the blocked side learns nothing: no oracle, no block rows, no events
assert.equal((await q(bob, `select count(*)::int c from public.blocked_users`)).rows[0].c, 0);
assert.equal((await q(bob, `select count(*)::int c from public.block_events`)).rows[0].c, 0, 'the blocked user cannot read the blocker\'s event log');
await fails(bob, `select private.message_is_suppressed($1)`, [secret.rows[0].id], /permission denied/);
assert.equal((await q(bob, `select private.message_hidden_from_me($1) h`, [secret.rows[0].id])).rows[0].h, false, 'the sender asking "is it hidden from me?" always gets false');
assert.equal((await q(alice, `select private.message_hidden_from_me($1) h`, [secret.rows[0].id])).rows[0].h, true, 'the recipient gets true (used by RLS)');
await fails(bob, `select * from private.suppressed_messages`, [], /permission denied/);
ok('privacy: no block row, no event, and the suppression helper never tells a sender they are blocked');

// 4. read receipts hidden while blocked (so a suppressed message can never get a second tick)
assert.equal((await q(bob, `select user_id from public.conversation_participants where conversation_id = $1`, [conv.id])).rows.map((r) => r.user_id).join(), bob, 'blocked user only sees their own membership row (no last_read_at of the blocker)');
assert.equal((await q(alice, `select user_id from public.conversation_participants where conversation_id = $1`, [conv.id])).rows.map((r) => r.user_id).join(), alice);
ok('read receipts: while blocked each side only sees their own participant row');

// 5. message edits / deletes by the blocked sender stay invisible
await q(bob, `select * from public.edit_message($1, 'edited secret')`, [secret.rows[0].id]);
assert.equal(await preview(), 'hi bob', 'editing a suppressed message does not change the preview');
await q(bob, `select public.delete_message($1)`, [secret.rows[0].id]);
assert.equal(await preview(), 'hi bob');
assert.deepEqual(await texts(alice), ['hello', 'hi bob']);
ok('editing / deleting a suppressed message never leaks into the preview or the blocker\'s view');

// 6. reactions between the pair are dropped without error
const firstMsg = (await q(alice, `select id from public.messages where conversation_id = $1 and sender_id = $2`, [conv.id, bob])).rows[0].id;
await q(bob, `insert into public.message_reactions(message_id, user_id, reaction) values ($1,$2,'like')`, [firstMsg, bob]);
assert.equal((await db.query(`select count(*)::int c from public.message_reactions`)).rows[0].c, 0, 'reaction by the blocked user was silently dropped');
ok('reactions between a blocked pair are dropped silently (no error for the sender)');

// 7. events log: written by the trigger, private
const aliceEvents = (await q(alice, `select kind, other_id from public.block_events order by created_at`)).rows;
assert.deepEqual(aliceEvents.map((e) => e.kind), ['blocked']);
assert.equal(aliceEvents[0].other_id, bob);
await fails(alice, `insert into public.block_events(user_id, other_id, kind) values ($1,$2,'unblocked')`, [alice, bob], /permission denied|row-level security/);
await fails(alice, `update public.block_events set kind = 'unblocked'`, [], /permission denied|row-level security/);
await fails(alice, `delete from public.block_events`, [], /permission denied|row-level security/);
assert.equal((await q(carol, `select count(*)::int c from public.block_events`)).rows[0].c, 0);
ok('block_events: "blocked" logged by the trigger; users cannot forge, edit or delete it; strangers cannot read it');

// 8. unblock: log row, chat works again, suppressed messages are NOT released
await q(alice, `delete from public.blocked_users where blocked_id = $1`, [bob]);
assert.deepEqual((await q(alice, `select kind from public.block_events order by created_at, id`)).rows.map((r) => r.kind).sort(), ['blocked', 'unblocked']);
assert.deepEqual(await texts(alice), ['hello', 'hi bob'], 'messages sent while blocked stay undelivered after unblock');
await send(bob, 'welcome back');
assert.deepEqual(await texts(alice), ['hello', 'hi bob', 'welcome back']);
assert.equal(await unread(alice), 1);
await send(alice, 'hey');
assert.equal((await q(bob, `select user_id from public.conversation_participants where conversation_id = $1`, [conv.id])).rows.length, 2, 'receipts return after unblock');
ok('unblock: logged, chat resumes both ways, earlier suppressed messages stay hidden');

// 9. the bystander's own chat is unaffected, and a mutual / reverse block behaves the same way
const carolConv = (await q(carol, `select * from public.find_or_create_conversation($1)`, [listingId])).rows[0];
await q(carol, `insert into public.blocked_users(blocker_id, blocked_id) values ($1,$2)`, [carol, alice]);
await send(alice, 'carol?', carolConv.id);
assert.equal((await q(carol, `select count(*)::int c from public.messages where conversation_id = $1`, [carolConv.id])).rows[0].c, 0, 'seller blocked by the buyer: same one-way suppression');
assert.equal((await q(alice, `select count(*)::int c from public.messages where conversation_id = $1`, [carolConv.id])).rows[0].c, 1);
ok('works in the other role too (a buyer blocking the seller)');

// 10. account deletion with blocks and events does not fail (cascade)
await db.query(`delete from public.profiles where id = $1`, [carol]);
ok('deleting a profile that has blocks / events cascades cleanly');

// 11. idempotent + rollback
await db.exec(sqlFile('migrations/0046_whatsapp_style_blocking.sql'));
await db.exec(sqlFile('rollback/0046_whatsapp_style_blocking_ROLLBACK.sql'));
await db.exec(sqlFile('rollback/0046_whatsapp_style_blocking_ROLLBACK.sql'));
await q(alice, `insert into public.blocked_users(blocker_id, blocked_id) values ($1,$2)`, [alice, bob]);
await fails(bob, `insert into public.messages(conversation_id, sender_id, text) values ($1,$2,'after rollback')`, [conv.id, bob], /Conversation not available/);
await db.exec(sqlFile('migrations/0046_whatsapp_style_blocking.sql'));
await send(bob, 'after reapply');
assert.ok(!(await texts(alice)).includes('after reapply'));
ok('0046 is re-runnable, rolls back to the 0044 behaviour, and re-applies cleanly');
process.exit(0);
