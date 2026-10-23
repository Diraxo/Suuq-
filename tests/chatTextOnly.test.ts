// Chat is text-only (migration 0037_chat_text_only.sql).
//
// IMPORTANT — what this does and does not prove: there is no Postgres in this
// repo's test harness. Two kinds of check live here, and NEITHER executes SQL:
//   (a) a JavaScript MODEL of the trigger and delete_message(), written
//       line-for-line from the migration, and
//   (b) STATIC checks that read the migration / client source files as text.
// The real database test is supabase/tests/0037_chat_text_only.sql — run it on a
// disposable database (it is NOT run yet).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const stripSqlComments = (sql: string) => sql.replace(/--[^\n]*/g, '');

const migration = read('supabase/migrations/0037_chat_text_only.sql');
const sql = stripSqlComments(migration);

// --- (a) JS model of the SQL -----------------------------------------------------
type Row = { images: string[]; image_keys: string[]; text: string | null; sender: string; deleted: boolean };

/** BEFORE INSERT / UPDATE OF images, image_keys trigger. Returns 'ok' or the SQLSTATE. */
function guard(op: 'INSERT' | 'UPDATE', next: Pick<Row, 'images' | 'image_keys'>, prev?: Pick<Row, 'images' | 'image_keys'>): 'ok' | '22023' {
  const differs = (a: string[], b: string[] | undefined) => JSON.stringify(a) !== JSON.stringify(b);
  if (op === 'INSERT') return next.images.length > 0 || next.image_keys.length > 0 ? '22023' : 'ok';
  const bad = (next.images.length > 0 && differs(next.images, prev?.images)) || (next.image_keys.length > 0 && differs(next.image_keys, prev?.image_keys));
  return bad ? '22023' : 'ok';
}

/** delete_message(): what the model sends to the webhook is, by construction, nothing. */
function deleteMessage(row: Row, caller: string | null): { row: Row; webhookCalls: number } {
  if (caller === null || row.sender !== caller || row.deleted) throw new Error('Message not found or not deletable');
  return { row: { ...row, deleted: true, text: null, images: [], image_keys: [] }, webhookCalls: 0 };
}

const FORGED = [
  'chat/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.jpg',
  'listings/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.jpg',
  'avatars/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.jpg',
  '../../etc/passwd',
  'https://evil.example/x.jpg',
  '',
];

test('model: text-only inserts succeed (what current AND old clients send for text)', () => {
  assert.equal(guard('INSERT', { images: [], image_keys: [] }), 'ok');
});

test('model: any attachment on insert is rejected, in either column', () => {
  for (const k of FORGED) {
    assert.equal(guard('INSERT', { images: [], image_keys: [k] }), '22023', `image_keys ${k}`);
    assert.equal(guard('INSERT', { images: [k], image_keys: [] }), '22023', `images ${k}`);
    assert.equal(guard('INSERT', { images: [k], image_keys: [k] }), '22023', `both ${k}`);
  }
});

test('model: update cannot attach or swap attachments; legacy rows may keep theirs or be cleared', () => {
  const legacy = { images: ['https://x/old.jpg'], image_keys: [FORGED[0]] };
  assert.equal(guard('UPDATE', { images: ['https://x/1.jpg'], image_keys: [] }, { images: [], image_keys: [] }), '22023');
  assert.equal(guard('UPDATE', { images: [], image_keys: [FORGED[1]] }, { images: [], image_keys: [] }), '22023');
  assert.equal(guard('UPDATE', { images: [], image_keys: [FORGED[1]] }, legacy), '22023', 'swap legacy key');
  assert.equal(guard('UPDATE', legacy, legacy), 'ok', 'untouched legacy values');
  assert.equal(guard('UPDATE', { images: [], image_keys: [] }, legacy), 'ok', 'clearing (delete_message)');
});

test('model: delete_message never calls the webhook, even for legacy rows with forged keys', () => {
  const sender = '11111111-1111-4111-8111-111111111111';
  for (const keys of [[], FORGED]) {
    const { row, webhookCalls } = deleteMessage({ images: keys.length ? ['https://x/1.jpg'] : [], image_keys: keys, text: 'hi', sender, deleted: false }, sender);
    assert.equal(webhookCalls, 0);
    assert.deepEqual([row.images, row.image_keys, row.text, row.deleted], [[], [], null, true]);
  }
});

test('model: unauthenticated users and non-senders cannot delete', () => {
  const sender = '11111111-1111-4111-8111-111111111111';
  const row: Row = { images: [], image_keys: [], text: 'hi', sender, deleted: false };
  assert.throws(() => deleteMessage(row, null));
  assert.throws(() => deleteMessage(row, '22222222-2222-4222-8222-222222222222'));
  assert.throws(() => deleteMessage({ ...row, deleted: true }, sender));
});

// --- (b) static checks on the migration text --------------------------------------
test('migration: guard trigger exists on insert and update of both attachment columns', () => {
  assert.match(sql, /before insert or update of images, image_keys on public\.messages/);
  assert.match(sql, /enforce_text_only_message\(\)/);
  assert.match(sql, /errcode = '22023'/);
});

test('migration: delete_message has no webhook / R2 / key handling and keeps the sender check', () => {
  const m = /create or replace function public\.delete_message[\s\S]*?\n\$\$;/.exec(sql)?.[0];
  assert.ok(m, 'delete_message definition not found');
  for (const forbidden of [/net\.http/i, /r2[-_]delete/i, /private\.settings/i, /unnest/i, /webhook/i, /functions\.supabase\.co/i]) {
    assert.doesNotMatch(m!, forbidden, String(forbidden));
  }
  assert.match(m!, /sender_id = auth\.uid\(\)/);
  assert.match(m!, /deleted_at is null/);
  assert.match(m!, /image_keys = '\{\}'/);
  assert.match(sql, /revoke execute on function public\.delete_message\(uuid\) from public, anon/);
  assert.match(sql, /grant execute on function public\.delete_message\(uuid\) to authenticated/);
});

test('migration: no production URL or webhook secret is referenced anywhere in executable SQL', () => {
  assert.doesNotMatch(sql, /waksddinkjbrggxkfofk|functions\.supabase\.co|net\.http_post|r2_delete_webhook_secret/);
});

test('real-DB test script is guarded, rolled back, and makes no production call', () => {
  const t = read('supabase/tests/0037_chat_text_only.sql');
  assert.match(t, /suuqiye\.allow_test/);
  assert.match(t, /\nrollback;\s*$/);
  assert.doesNotMatch(stripSqlComments(t), /waksddinkjbrggxkfofk|functions\.supabase\.co|net\.http_post/);
});

// --- (b) static checks on the clients: no attachment affordance in chat ----------
const CHAT_FILES = [
  'app/chat/[id].tsx',
  'components/chat/MessageComposer.tsx',
  'components/chat/MessageBubble.tsx',
  'components/chat/MessageList.tsx',
  'hooks/useConversationChannel.ts',
  'web/src/app/chat/[id]/page.tsx',
  'web/src/components/chat/MessageComposer.tsx',
  'web/src/components/chat/MessageBubble.tsx',
  'web/src/components/chat/MessageList.tsx',
  'web/src/hooks/useConversationChannel.ts',
];

test('clients: chat code has no image picker, upload, key, viewer or attachment references', () => {
  const banned = /expo-image-picker|ImagePicker|launchCamera|launchImageLibrary|type=["']file["']|uploadToR2|uploadImage|r2-presign|deleteR2Assets|image_keys|imageKeys|uploadFolder|MessageImageViewer|onImagePress|input\[type/;
  for (const f of CHAT_FILES) assert.doesNotMatch(read(f), banned, f);
  assert.equal(fs.existsSync(path.join(root, 'components/chat/MessageImageViewer.tsx')), false);
  assert.equal(fs.existsSync(path.join(root, 'web/src/components/chat/MessageImageViewer.tsx')), false);
});

test('clients: message inserts send only text fields (no images / image_keys columns)', () => {
  for (const f of ['hooks/useConversationChannel.ts', 'web/src/hooks/useConversationChannel.ts']) {
    const insert = /\.insert\(\{[^}]*\}\)/.exec(read(f))?.[0];
    assert.ok(insert, f);
    assert.doesNotMatch(insert!, /images|image_keys/, f);
    assert.match(insert!, /text/, f);
  }
});
