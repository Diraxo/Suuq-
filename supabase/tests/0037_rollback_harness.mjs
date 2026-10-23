// Migration/rollback cycle for 0037 on a real PostgreSQL engine (PGlite = Postgres compiled to WASM,
// in-memory, no server, no network, nothing persists). Supabase pieces are STUBBED (auth.uid(), private.settings,
// net.http_post, roles) — it proves the 0037 + rollback SQL, not the whole production schema (0001–0036).
//
//   mkdir <scratch>; cd <scratch>; npm init -y; npm i @electric-sql/pglite
//   $env:PGLITE_DIR="<scratch>\node_modules\@electric-sql\pglite"
//   node supabase/tests/0037_rollback_harness.mjs        (Node >= 22.18/24: runs .ts imports natively)
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..', '..');
const { PGlite } = await import(pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href);
const { handleR2Delete } = await import(pathToFileURL(path.join(root, 'supabase/functions/_shared/r2DeleteHandler.ts')).href);
const { isOwnedKey } = await import(pathToFileURL(path.join(root, 'supabase/functions/_shared/uploadPaths.ts')).href);
const sql = (f) => fs.readFileSync(path.join(root, 'supabase', f), 'utf8');

const db = new PGlite();
const U = '11111111-1111-4111-8111-111111111111';
const V = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const F = '44444444-4444-4444-8444-444444444444.jpg';
const M = (i) => `aaaaaaaa-0000-4000-8000-00000000000${i}`;
let n = 0;
const ok = (m) => console.log(`PASS  ${++n}. ${m}`);
const as = async (uid, q, p) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.sub','${uid}',false)`);
  try {
    return await db.query(q, p);
  } finally {
    await db.exec('reset role');
  }
};
const fails = async (code, f) => {
  try {
    await f();
  } catch (e) {
    assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`);
    return;
  }
  assert.fail(`expected error ${code}`);
};
const fnDef = async () => (await db.query(`select pg_get_functiondef('public.delete_message(uuid)'::regprocedure) d`)).rows[0].d;
const calls = async () => (await db.query('select url, body, headers from net.calls order by id')).rows;

// --- stubs for the Supabase environment ---
await db.exec(`
  create role authenticated; create role anon;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  create schema private; create table private.settings (key text primary key, value text);
  create schema net; create table net.calls (id serial primary key, url text, body jsonb, headers jsonb);
  create function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds int default 1000) returns bigint language sql as $$ insert into net.calls(url, body, headers) values (url, body, headers) returning id $$;
  create table public.conversations (id uuid primary key, last_message text);
  create table public.messages (id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations(id),
    sender_id uuid not null, text text, images text[] not null default '{}', created_at timestamptz not null default now(), deleted_at timestamptz);
  create function public.message_preview(t text, i text[], d timestamptz) returns text language sql as $$ select case when d is not null then 'deleted' when t is not null then t else 'Photo' end $$;
  grant usage on schema public, auth, private, net to authenticated, anon;
  grant select, insert on public.messages to authenticated; grant select, update on public.conversations to authenticated;
  insert into public.conversations values ('${C}', null);
`);

// 1. PRE-0037 state = 0025 (delete_message forwards image_keys to r2-delete)
await db.exec(sql('migrations/0025_chat_image_r2_cleanup.sql'));
const defPre = await fnDef();
assert.match(defPre, /net\.http_post/);
ok('0025 applied; delete_message forwards keys via net.http_post');

// legacy rows planted before 0037: one real own photo, one forged key pointing at another user's object
const own = `chat/${C}/${U}/${F}`;
const forged = `listings/${V}/${F}`;
await db.query(
  `insert into public.messages(id, conversation_id, sender_id, images, image_keys) values
   ('${M(1)}', $1, $2, array['https://x/1'], array[$3]),
   ('${M(2)}', $1, $2, array['https://x/2'], array[$4])`,
  [C, U, own, forged]
);

// the NEW r2-delete handler wired exactly like supabase/functions/r2-delete/index.ts
const secret = 'test-secret';
const deleted = [];
const handler = (req) =>
  handleR2Delete(req, {
    isAuthorizedKey: (key, uid) => (uid ? isOwnedKey(key, uid) : false),
    isTrustedWebhook: (v) => v === secret,
    verifyJwt: async () => null,
    deleteObject: async (k) => {
      deleted.push(k);
      return true;
    },
  });
async function replayWebhook() {
  const results = [];
  for (const c of await calls()) {
    results.push((await handler(new Request(c.url, { method: 'POST', headers: c.headers, body: JSON.stringify(c.body) }))).status);
  }
  await db.exec('truncate net.calls');
  return results;
}
await db.exec(`update private.settings set value = '${secret}' where key = 'r2_delete_webhook_secret'`);
await as(U, `select public.delete_message('${M(1)}')`);
await as(U, `select public.delete_message('${M(2)}')`);
assert.deepEqual(await replayWebhook(), [403, 403]);
assert.deepEqual(deleted, []);
ok('old delete_message + new r2-delete: webhook requests (own and forged key) both 403, nothing deleted');

// 2. apply 0037
await db.exec(sql('migrations/0037_chat_text_only.sql'));
await fails('22023', () => as(U, `insert into public.messages(conversation_id, sender_id, text, images) values ($1,$2,'hi',array['u'])`, [C, U]));
await fails('22023', () => as(U, `insert into public.messages(conversation_id, sender_id, text, image_keys) values ($1,$2,'hi',array['k'])`, [C, U]));
await as(U, `insert into public.messages(conversation_id, sender_id, text) values ($1,$2,'plain text')`, [C, U]);
ok('0037: photo inserts rejected (22023), text insert accepted');
assert.doesNotMatch(await fnDef(), /net\.http|r2-delete|private\.settings/);
await db.query(`insert into public.messages(id, conversation_id, sender_id, text) values ('${M(3)}',$1,$2,'x')`, [C, U]);
await as(U, `select public.delete_message('${M(3)}')`);
assert.equal((await calls()).length, 0);
ok('0037: delete_message makes no webhook call');

// 3. ROLLBACK
const rb = sql('rollback/0037_chat_text_only_ROLLBACK.sql');
await db.exec(rb);
assert.equal(await fnDef(), defPre);
ok('rollback: delete_message definition is identical to the pre-0037 (0025) definition');
const trg = await db.query(`select count(*)::int c from pg_trigger where tgname='enforce_text_only_trg' and not tgisinternal`);
const fn = await db.query(`select count(*)::int c from pg_proc where proname='enforce_text_only_message'`);
assert.equal(trg.rows[0].c + fn.rows[0].c, 0);
ok('rollback: guard trigger and function are gone');
const priv = async (r) => (await db.query(`select has_function_privilege('${r}','public.delete_message(uuid)','execute') p`)).rows[0].p;
assert.equal(await priv('authenticated'), true);
assert.equal(await priv('anon'), false);
ok('rollback: authenticated keeps EXECUTE, anon stays revoked (deliberate: not re-widened)');
await as(U, `insert into public.messages(id, conversation_id, sender_id, images, image_keys) values ('${M(4)}',$1,$2,array['u'],array[$3])`, [C, U, forged]);
ok('rollback: photo inserts (incl. forged key) accepted again - the B2 hole is back at the DB layer');

// 4. rolled-back function + NEW r2-delete: forged key still not deleted
await as(U, `select public.delete_message('${M(4)}')`);
const rows = await calls();
assert.equal(rows.length, 1);
assert.deepEqual(rows[0].body.keys, [forged]);
assert.deepEqual(await replayWebhook(), [403]);
assert.deepEqual(deleted, []);
ok('rolled-back delete_message forwards the forged key; new r2-delete answers 403, nothing deleted');
assert.equal((await db.query(`select value from private.settings where key='r2_delete_webhook_secret'`)).rows[0].value, secret);
ok('rollback leaves private.settings webhook secret untouched');

// 5. irreversibility: keys cleared by a 0037-era delete are gone
const gone = await db.query(`select image_keys, images from public.messages where id='${M(3)}'`);
assert.deepEqual(gone.rows[0], { image_keys: [], images: [] });
ok('documented loss confirmed: a message deleted under 0037 has no image_keys after rollback');

// 6. idempotent + full cycle
await db.exec(rb);
assert.equal(await fnDef(), defPre);
await db.exec(sql('migrations/0037_chat_text_only.sql'));
await fails('22023', () => as(U, `insert into public.messages(conversation_id, sender_id, images) values ($1,$2,array['u'])`, [C, U]));
await db.exec(rb);
ok('rollback is re-runnable; 0037 -> rollback -> 0037 -> rollback cycle works');
console.log(`\nALL ${n} CHECKS PASSED`);
