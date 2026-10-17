// WhatsApp-style blocking in the apps: the blocker keeps the conversation (read-only, with a "You blocked X" line and an
// Unblock banner), nobody gets a "conversation isn't available" dead end, the blocked profile shows name + photo only,
// presence/typing go quiet for the blocker, and mobile and web behave the same. The database half is covered by
// supabase/tests/chat_blocking.test.mjs (real Postgres).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');

test('mobile chat: no dead-end screen for a blocked chat; blocker sees history, event lines and an Unblock banner', () => {
  const chat = read('app', 'chat', '[id].tsx');
  assert.doesNotMatch(chat, /chat\.cantMessageUser/, 'the "You can\'t message this user" dead end is gone');
  assert.doesNotMatch(chat, /isBlockedEitherWaySync/, 'opening a chat is never refused client-side');
  assert.match(chat, /from\('block_events'\)/, 'the You blocked / unblocked lines come from the private log');
  assert.match(chat, /blockVersion/, 'the log is refetched after each completed block/unblock');
  assert.match(chat, /chat\.blockedBannerTitle/);
  assert.match(chat, /!blockedByMe && \(\s*<View style=\{\{ flexDirection: 'row', gap: spacing\.xs/, 'offer / pickup chips are hidden while blocked');
  assert.match(chat, /useConversationChannel\(resolved \? resolved\.id : null, meId \?\? null, withUserId, blockedByMe\)/, 'presence + typing go quiet for the blocker');
});

test('mobile chat list keeps blocked conversations (like WhatsApp)', () => {
  const list = read('app', '(tabs)', 'chats.tsx');
  assert.doesNotMatch(list, /useBlockedEitherWayIds/);
});

test('realtime hook: a blocker stops broadcasting presence / typing and ignores the other side\'s (mobile + web)', () => {
  for (const file of [['hooks', 'useConversationChannel.ts'], ['web', 'src', 'hooks', 'useConversationChannel.ts']]) {
    const hook = read(...file);
    assert.match(hook, /quiet = false/, file.join('/'));
    assert.match(hook, /if \(!quietRef\.current\) channel\.track/, file.join('/'));
    assert.match(hook, /quietRef\.current \|\| !otherUserId/, file.join('/'));
    assert.match(hook, /channel.untrack()/, file.join('/'));
  }
});

test('message list: event lines are merged into the thread on mobile and web', () => {
  const mobile = read('components', 'chat', 'MessageList.tsx');
  assert.match(mobile, /chat\.youBlockedEvent/);
  assert.match(mobile, /chat\.youUnblockedEvent/);
  assert.ok(fs.existsSync(path.join(root, 'components', 'chat', 'SystemNotice.tsx')));
  const web = read('web', 'src', 'components', 'chat', 'MessageList.tsx');
  assert.match(web, /You blocked \$\{peerName\}/);
  assert.match(web, /You unblocked \$\{peerName\}/);
});

test('web chat: same model as mobile', () => {
  const chat = read('web', 'src', 'app', 'chat', '[id]', 'page.tsx');
  assert.doesNotMatch(chat, /isn&apos;t available/);
  assert.match(chat, /from\('block_events'\)/);
  assert.match(chat, /blockedByMe \? \(/);
  assert.match(chat, /Unblock/);
  assert.match(chat, /useConversationChannel\(conversation \? conversation\.id : null, meId \?\? null, withUserId, blockedByMe\)/);
});

test('profile of someone I blocked: name + photo, a note, Unblock and the three-dots menu — no listings (mobile + web)', () => {
  const mobile = read('app', 'seller', '[id].tsx');
  const m = mobile.slice(mobile.indexOf('if (isBlocked) {'), mobile.indexOf('<KeyboardAvoidingView'));
  assert.match(m, /seller\.blockedProfileNote/);
  assert.match(m, /common\.unblock/);
  assert.match(m, /<UserSafetySheet/);
  assert.doesNotMatch(m, /ListingCard|FlatList|Stat /, 'no listings or stats');
  const web = read('web', 'src', 'app', 'seller', '[id]', 'page.tsx');
  const w = web.slice(web.indexOf('if (seller && meId !== id && blockedByMe)'), web.indexOf('if (seller === null'));
  assert.match(w, /Unblock/);
  assert.match(w, /<UserSafetyMenu/);
  assert.doesNotMatch(w, /ListingCard/);
});

test('block stores bump a version after the database write so an open chat refetches its log', () => {
  for (const file of [['store', 'blockedUsers.ts'], ['web', 'src', 'store', 'blockedUsers.ts']]) {
    const s = read(...file);
    assert.match(s, /version: number/, file.join('/'));
    assert.match(s, /set\(\(s\) => \(\{ version: s\.version \+ 1 \}\)\)/, file.join('/'));
  }
});

test('translations exist in every language for the new strings', () => {
  for (const l of ['en', 'so', 'am']) {
    const d = JSON.parse(read('locales', l, 'translation.json'));
    for (const k of ['youBlockedEvent', 'youUnblockedEvent', 'blockedBannerTitle', 'blockedBannerBody']) assert.ok(d.chat[k], `${l} chat.${k}`);
    assert.ok(d.seller.blockedProfileNote, `${l} seller.blockedProfileNote`);
    assert.match(d.chat.youBlockedEvent, /\{\{name\}\}/, `${l} keeps the name placeholder`);
    assert.match(d.chat.youUnblockedEvent, /\{\{name\}\}/);
    assert.match(d.chat.blockedBannerTitle, /\{\{name\}\}/);
  }
});

test('0046 migration: suppression is private, the guard accepts a blocked sender, the blocker cannot send, rollback ships', () => {
  const sql = read('supabase', 'migrations', '0046_whatsapp_style_blocking.sql');
  assert.match(sql, /create table if not exists private\.suppressed_messages/);
  assert.match(sql, /revoke all on table private\.suppressed_messages from public, anon, authenticated/);
  assert.match(sql, /raise exception 'unblock_to_send'/);
  assert.match(sql, /message_hidden_from_me/);
  assert.match(sql, /not private\.message_is_suppressed\(new\.id\)|if private\.message_is_suppressed\(new\.id\)/, 'a suppressed message never notifies');
  assert.match(sql, /revoke insert, update, delete on public\.block_events from anon, authenticated/);
  assert.ok(fs.existsSync(path.join(root, 'supabase', 'rollback', '0046_whatsapp_style_blocking_ROLLBACK.sql')));
});
