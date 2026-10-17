// Shared test harness: boots an in-memory PostgreSQL (PGlite = real Postgres compiled to WASM), stubs just
// enough of Supabase (roles, auth.uid(), auth.users, storage, realtime publication, pg_net, default table
// grants) and applies the REAL migration chain from supabase/migrations in order.
//
//   PGLITE_DIR=<dir containing node_modules/@electric-sql/pglite>   (npm i @electric-sql/pglite in a scratch dir)
//   node supabase/tests/<name>.test.mjs
//
// It proves SQL behaviour on a real engine. It does NOT prove Supabase-hosted behaviour (PostgREST, Realtime
// delivery, Auth, pg_cron, pg_net) — those stay marked BLOCKED in docs/SEARCH_MODERATION_CHECKLIST.md.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export const root = path.resolve(import.meta.dirname, '..', '..', '..');
const pgliteDir = process.env.PGLITE_DIR;
if (!pgliteDir) throw new Error('Set PGLITE_DIR to the folder containing node_modules/@electric-sql/pglite');
const pgl = await import(pathToFileURL(path.join(pgliteDir, 'dist', 'index.js')).href);
let trgm = null;
try {
  trgm = await import(pathToFileURL(path.join(pgliteDir, 'dist', 'contrib', 'pg_trgm.js')).href);
} catch {
  /* optional */
}

export const sqlFile = (rel) => fs.readFileSync(path.join(root, 'supabase', rel), 'utf8');

const SHIM = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end $$;
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
  -- Supabase reads the caller from the request.jwt.claim.sub GUC (PostgREST sets it per request).
  create or replace function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create or replace function auth.role() returns text language sql stable as $f$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $f$;
  create schema if not exists storage;
  create table if not exists storage.buckets (id text primary key, name text, public boolean);
  create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable as $f$ select string_to_array(name, '/') $f$;
  create schema if not exists net;
  create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds int default 1000) returns bigint language sql as $f$ select 1::bigint $f$;
  -- Supabase Realtime Broadcast from SQL. Recorded so tests can assert what would be sent (delivery itself is BLOCKED).
  create schema if not exists realtime;
  create table if not exists realtime.sent (id serial primary key, topic text, event text, payload jsonb, private boolean);
  create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void language sql as $f$ insert into realtime.sent(topic, event, payload, private) values (topic, event, payload, private) $f$;
  grant usage on schema realtime to anon, authenticated, service_role;
  create schema if not exists private;
  create table if not exists private.settings (key text primary key, value text);
  create schema if not exists extensions;
  -- Database-webhook trigger function (0012). Recorded instead of calling out, so tests can assert pushes.
  create schema if not exists supabase_functions;
  create table if not exists supabase_functions.calls (id serial primary key, args text[], new_row jsonb);
  create or replace function supabase_functions.http_request() returns trigger language plpgsql as $f$
  begin insert into supabase_functions.calls(args, new_row) values (tg_argv, to_jsonb(new)); return new; end $f$;
  drop publication if exists supabase_realtime;
  create publication supabase_realtime;
  -- Supabase grants every public table to the API roles by default (this is what makes column-level REVOKEs inert).
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  grant usage on schema public, auth, storage, net, private to anon, authenticated, service_role;
  grant select on all tables in schema storage to anon, authenticated;
`;

export async function boot({ upTo = '9999', extraMigrations = [] } = {}) {
  const db = new pgl.PGlite(trgm ? { extensions: { pg_trgm: trgm.pg_trgm } } : {});
  await db.exec(SHIM);
  const dir = path.join(root, 'supabase', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = [];
  for (const f of files) {
    if (f.slice(0, 4) > upTo) break;
    try {
      await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
      applied.push(f);
    } catch (e) {
      throw new Error(`migration ${f} failed on a fresh database: ${e.message}`);
    }
  }
  for (const f of extraMigrations) await db.exec(sqlFile(f));
  return { db, applied, hasTrgm: !!trgm };
}

// ---- helpers -------------------------------------------------------------------------------------------
export const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let passed = 0;
export const ok = (m) => console.log(`PASS  ${++passed}. ${m}`);
export const count = () => passed;

export function actors(db) {
  /** run `fn` as the Supabase `authenticated` role with the given user id (or as anon when uid is null). */
  const as = async (uid, fn) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid ?? ''}',false), set_config('request.jwt.claim.role','${uid ? 'authenticated' : 'anon'}',false); set role ${uid ? 'authenticated' : 'anon'};`);
    try {
      return await fn();
    } finally {
      await db.exec('reset role');
    }
  };
  const q = (uid, sql, params) => as(uid, () => db.query(sql, params));
  const fails = async (uid, sql, params, match) => {
    try {
      await q(uid, sql, params);
    } catch (e) {
      if (match) assert.match(`${e.code ?? ''} ${e.message}`, match, `wrong error: ${e.code} ${e.message}`);
      return e;
    }
    assert.fail(`expected failure: ${sql}`);
  };
  return { as, q, fails };
}

export async function seedUsers(db, n) {
  const ids = [];
  for (let i = 1; i <= n; i++) {
    const id = uuid(i);
    await db.query(`insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)`, [id, `u${i}@test.dev`, JSON.stringify({ full_name: `User ${i}` })]);
    ids.push(id);
  }
  return ids; // profiles are created by the on_auth_user_created trigger from 0001
}
