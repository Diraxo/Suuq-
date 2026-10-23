// 0063 — refuse NEW URL-only (no storage key) avatar / logo / banner values from clients. Real Postgres (PGlite), the REAL migration chain
// 0001..0063 and the REAL rollback SQL.
// Proves: a new URL-only value is refused for every slot and every legacy host (both enforcement modes); an UNCHANGED legacy URL never blocks an
// unrelated edit and is never rewritten (including old-client full-row payloads that re-send it); keyed uploads, clearing and replacing a legacy
// value with a managed upload still work; the first-login INSERT exception is exactly "avatar + lh3.googleusercontent.com" and cannot be used
// to change an existing profile (upsert); logo/banner never accept a URL-only insert; non-client writers are untouched; the policy does not
// depend on storefront_media_hosts; the rollback removes only this block and is re-runnable.
// Not proven here: PostgREST, any real client build, the real R2_PUBLIC_URL host, or what the bytes at a URL are.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, actors, seedUsers, ok, uuid } from './harness/db.mjs';

const dir = new URL('../', import.meta.url);
const sql = (rel) => readFileSync(new URL(rel, dir), 'utf8');
const refusedUrlOnly = /url_only_not_allowed|must be uploaded again/;
const HOST = 'media.test';
const host = `https://${HOST}`;
const GOOGLE = 'https://lh3.googleusercontent.com/a/photo';
const CLOUD = 'https://res.cloudinary.com/some-account/image/upload/x.jpg';
const PICSUM = 'https://picsum.photos/200';
const av = (uid, n) => `avatars/${uid}/${uuid(n)}.jpg`;
const lg = (uid, n) => `business/${uid}/logo/${uuid(n)}.jpg`;
const bn = (uid, n) => `business/${uid}/banner/${uuid(n)}.jpg`;
const SLOTS = [
  ['avatar', 'avatar_url', 'avatar_public_id', av],
  ['logo', 'business_logo_url', 'business_logo_public_id', lg],
  ['banner', 'business_banner_url', 'business_banner_public_id', bn],
];

const { db } = await boot();
await db.exec(`select set_config('suuqplus.skip_rate_limit','true',false)`); // the profile-update rate limit is not under test
const { q, fails } = actors(db);
const [alice, bob, carol, dave] = await seedUsers(db, 4);
const setEnforce = (on) => db.query(`update public.business_media_config set enforce = $1`, [on]);
// Logo / banner written through profiles are mirrored into storefronts and cleared on profiles (0054), so read them back from there.
const SF = { logo: ['logo_url', 'logo_public_id'], banner: ['banner_url', 'banner_public_id'] };
const urlOf = async (uid, label, ucol) => {
  if (label === 'avatar') return (await db.query(`select ${ucol} u from public.profiles where id=$1`, [uid])).rows[0].u;
  return (await db.query(`select ${SF[label][0]} u from public.storefronts where owner_id=$1`, [uid])).rows[0]?.u ?? null;
};
const clear = async (uid) => {
  await db.query(`update public.profiles set avatar_url=null, avatar_public_id=null, business_logo_url=null, business_logo_public_id=null, business_banner_url=null, business_banner_public_id=null where id=$1`, [uid]);
  await db.query(`update public.storefronts set logo_url=null, logo_public_id=null, banner_url=null, banner_public_id=null where owner_id=$1`, [uid]);
};
// a profile row that does not exist yet, as at the first-login fallback upsert
const ghost = async (n) => {
  const id = uuid(n);
  await db.query(`insert into auth.users(id,email) values ($1,$2)`, [id, `uob${n}@test.dev`]);
  await db.query(`delete from public.profiles where id=$1`, [id]); // the signup trigger made one; simulate "trigger not committed yet"
  return id;
};

// ---- 0. shape of the control
assert.equal((await db.query(`select count(*)::int n from pg_trigger where tgname='profiles_c_url_only_block' and tgrelid='public.profiles'::regclass and not tgisinternal`)).rows[0].n, 1);
const fnPriv = async (sig, role) => (await db.query(`select has_function_privilege('${role}', '${sig}', 'execute') p`)).rows[0].p;
assert.equal(await fnPriv('public._uob_check_slot(text,boolean,boolean,text,text,text)', 'anon'), false);
assert.equal(await fnPriv('public.trg_profile_url_only_block()', 'authenticated'), false);
assert.equal(await fnPriv('public.trg_profile_url_only_block()', 'anon'), false);
ok('0063 is installed; anon cannot call the helper; nobody can call the trigger function directly');

// ---- 1. the policy must not depend on the 0062 host list: it is EMPTY here and the URL-only rule still applies
assert.equal((await db.query(`select count(*)::int n from public.storefront_media_hosts`)).rows[0].n, 0);
for (const [label, ucol, kcol] of SLOTS) {
  for (const u of [GOOGLE, CLOUD, PICSUM]) {
    await fails(alice, `update public.profiles set ${ucol}=$2, ${kcol}=null where id=$1`, [alice, u], refusedUrlOnly);
  }
}
await q(alice, `update public.profiles set bio='unrelated edit with an empty host list' where id=$1`, [alice]);
ok('with storefront_media_hosts EMPTY: a new URL-only value is refused for every slot and legacy host, unrelated edits still work (no host-list apply-order dependency)');
await db.query(`insert into public.storefront_media_hosts(host) values ($1)`, [HOST]);

// ---- 2. NEW URL-only values on UPDATE, both enforcement modes
for (const mode of ['OFF', 'ON']) {
  await setEnforce(mode === 'ON');
  // ON: the scan layer (0057/0059) refuses first; either refusal is correct, the value must simply never land
  const refused = mode === 'ON' ? /url_only_not_allowed|must be uploaded again|image_not_verified|has not been checked/ : refusedUrlOnly;
  for (const [label, ucol, kcol] of SLOTS) {
    for (const [name, u] of [['Google', GOOGLE], ['Cloudinary (any account)', CLOUD], ['picsum', PICSUM]]) {
      await fails(alice, `update public.profiles set ${ucol}=$2, ${kcol}=null where id=$1`, [alice, u], refused);
      await fails(alice, `update public.profiles set ${ucol}=$2 where id=$1`, [alice, u], refused); // old client that does not send the key column at all
    }
    // other hosts / shapes remain refused by 0056 (this layer is not the only one)
    for (const u of ['https://evil.example/pixel.png', `${host}/x.jpg`, 'http://lh3.googleusercontent.com/a', 'not a url']) {
      await fails(alice, `update public.profiles set ${ucol}=$2, ${kcol}=null where id=$1`, [alice, u], /22023|23514|own uploaded|uploaded|image_not_verified|has not been checked/);
    }
    assert.equal(await urlOf(alice, label, ucol), null);
  }
  ok(`${mode}: avatar / logo / banner: a NEW URL-only Google / Cloudinary / picsum value is refused (key sent as null and key column omitted); nothing lands`);
}
await setEnforce(false);

// ---- 3. unchanged legacy values and old-client payloads (OFF = shipped state)
{
  // legacy rows exactly as pre-R2 / pre-0056 history could have left them (operator SQL, not a client write): Google, Cloudinary with a
  // stale Cloudinary public id, picsum, plus a foreign-host own-key avatar
  const legacyKey = av(bob, 100);
  await db.query(
    `update public.profiles set avatar_url=$2, avatar_public_id='sample/old_cloudinary_id', business_logo_url=$3, business_banner_url=$4 where id=$1`,
    [bob, CLOUD, GOOGLE, PICSUM],
  );
  const snap = async () => (await db.query(`select avatar_url, avatar_public_id, business_logo_url, business_banner_url from public.profiles where id=$1`, [bob])).rows[0];
  const before = await snap();

  await q(bob, `update public.profiles set bio='edit with legacy rows', city='Hargeisa' where id=$1`, [bob]);
  // old-client full-row save: re-sends every image column it read, unchanged
  await q(bob, `update public.profiles set full_name='Bob', avatar_url=$2, avatar_public_id=$3, business_logo_url=$4, business_banner_url=$5 where id=$1`,
    [bob, before.avatar_url, before.avatar_public_id, before.business_logo_url, before.business_banner_url]);
  // old-client save that sends only the url column (key column omitted) with the unchanged URL
  await q(bob, `update public.profiles set avatar_url=$2 where id=$1`, [bob, before.avatar_url]);
  assert.deepEqual(await snap(), before);
  ok('legacy URL-only avatar (+ stale Cloudinary id), logo and banner: unrelated edits, an old-client full-row payload and an unchanged URL-only re-save all pass; nothing is rewritten');

  // dropping only the stale key while the URL stays the same introduces no new URL
  await q(bob, `update public.profiles set avatar_public_id=null where id=$1`, [bob]);
  assert.equal((await snap()).avatar_url, CLOUD);
  ok('dropping only a stale key (URL unchanged) is allowed: no new URL is introduced');

  // ...but re-pointing a legacy slot to a different unmanaged URL is a NEW URL and is refused
  await fails(bob, `update public.profiles set avatar_url=$2 where id=$1`, [bob, 'https://res.cloudinary.com/other-account/y.jpg'], refusedUrlOnly);
  await fails(bob, `update public.profiles set business_logo_url=$2 where id=$1`, [bob, 'https://lh3.googleusercontent.com/other'], refusedUrlOnly);
  assert.equal((await snap()).avatar_url, CLOUD);
  ok('a legacy slot cannot be re-pointed to a different unmanaged URL');

  // replacing a legacy slot with a managed upload (every build from d22fe4a on) works; removing works
  const nk = av(bob, 101);
  await q(bob, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [bob, `${host}/${nk}`, nk]);
  await q(bob, `update public.profiles set avatar_url=null, avatar_public_id=null where id=$1`, [bob]);
  const lk = lg(bob, 102), bk = bn(bob, 103);
  await q(bob, `update public.profiles set business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [bob, `${host}/${lk}`, lk]);
  await q(bob, `update public.profiles set business_banner_url=$2, business_banner_public_id=$3 where id=$1`, [bob, `${host}/${bk}`, bk]);
  ok('replacing a legacy value with a managed (keyed) upload, and removing it, still work for avatar, logo and banner');
  void legacyKey;
}

// ---- 4. keyed uploads of the committed (HEAD) client are untouched: url+key pair, plus an unrelated-column payload
{
  for (const [label, ucol, kcol, mk] of SLOTS) {
    const k = mk(carol, 200);
    await q(carol, `update public.profiles set ${ucol}=$2, ${kcol}=$3 where id=$1`, [carol, `${host}/${k}`, k]);
    assert.ok((await urlOf(carol, label, ucol)).endsWith(k), label);
  }
  await q(carol, `update public.profiles set full_name='Carol', phone='+252611111111' where id=$1`, [carol]);
  await clear(carol);
  ok('HEAD client payloads (avatar/logo/banner url+key pairs, profile-field edits) are unaffected');
}

// ---- 5. first-login inserts (client upsert fallback)
{
  const a = await ghost(300);
  await q(a, `insert into public.profiles(id, full_name, email) values ($1,'No Image','a@test.dev')`, [a]);
  ok('first-login insert without images is accepted (the working-copy client sends avatar_url null)');

  const b = await ghost(301);
  await q(b, `insert into public.profiles(id, full_name, avatar_url) values ($1,'Old App','${GOOGLE}')`, [b]);
  assert.equal((await db.query(`select avatar_url from public.profiles where id=$1`, [b])).rows[0].avatar_url, GOOGLE);
  ok('OFF: an old build\'s first-login insert with a Google photo (URL-only, lh3.googleusercontent.com) is NOT locked out');

  const c = await ghost(302);
  for (const u of [CLOUD, PICSUM, 'https://lh4.googleusercontent.com/a/photo', 'http://lh3.googleusercontent.com/a/p', 'https://lh3.googleusercontent.com.evil.io/a', 'https://evil.example/p.png']) {
    await fails(c, `insert into public.profiles(id, full_name, avatar_url) values ($1,'X',$2)`, [c, u], /url_only_not_allowed|must be uploaded again|22023|own uploaded/);
  }
  await fails(c, `insert into public.profiles(id, full_name, business_logo_url) values ($1,'X',$2)`, [c, GOOGLE], refusedUrlOnly);
  await fails(c, `insert into public.profiles(id, full_name, business_banner_url) values ($1,'X',$2)`, [c, GOOGLE], refusedUrlOnly);
  assert.equal((await db.query(`select count(*)::int n from public.profiles where id=$1`, [c])).rows[0].n, 0);
  ok('first-login insert: the exception is avatar + lh3.googleusercontent.com ONLY (Cloudinary, picsum, other Google subdomains, http, look-alikes, and any URL-only logo/banner are refused; no row created)');

  const d = await ghost(303);
  const dk = av(d, 304);
  await q(d, `insert into public.profiles(id, full_name, avatar_url, avatar_public_id) values ($1,'Managed',$2,$3)`, [d, `${host}/${dk}`, dk]);
  ok('first-login insert with an own key on the registered host is accepted (keyed, not this layer)');

  // supabase upsert = INSERT .. ON CONFLICT DO UPDATE: the BEFORE INSERT trigger runs first, then the BEFORE UPDATE trigger on conflict
  const e = await ghost(305);
  await q(e, `insert into public.profiles(id, full_name, avatar_url) values ($1,'Upsert New',$2) on conflict (id) do update set avatar_url = excluded.avatar_url`, [e, GOOGLE]);
  assert.equal((await db.query(`select avatar_url from public.profiles where id=$1`, [e])).rows[0].avatar_url, GOOGLE);
  ok('upsert for a genuinely missing row (the real fallback) with a Google photo works');

  // an existing user cannot use the first-login exception to change a photo
  await q(alice, `update public.profiles set avatar_url=null, avatar_public_id=null where id=$1`, [alice]);
  await fails(alice, `insert into public.profiles(id, full_name, avatar_url) values ($1,'Alice',$2) on conflict (id) do update set avatar_url = excluded.avatar_url`, [alice, GOOGLE], refusedUrlOnly);
  assert.equal((await db.query(`select avatar_url from public.profiles where id=$1`, [alice])).rows[0].avatar_url, null);
  ok('upsert on an EXISTING profile cannot smuggle in a Google photo: the INSERT step passes, the UPDATE step refuses the new URL-only value');

  // existing user, unchanged legacy photo, old client upserts the same row again: no new URL, passes
  await db.query(`update public.profiles set avatar_url=$2 where id=$1`, [dave, GOOGLE]);
  await q(dave, `insert into public.profiles(id, full_name, avatar_url) values ($1,'Dave',$2) on conflict (id) do update set avatar_url = excluded.avatar_url, full_name = excluded.full_name`, [dave, GOOGLE]);
  ok('upsert on an existing profile that already holds that same legacy URL passes (unchanged slot)');
  await clear(dave);

  // ON: 0059 drops the external first-login photo BEFORE this trigger runs; both layers together must still create the row
  await setEnforce(true);
  const f = await ghost(306);
  await q(f, `insert into public.profiles(id, full_name, avatar_url) values ($1,'Old App ON','${GOOGLE}')`, [f]);
  assert.equal((await db.query(`select avatar_url from public.profiles where id=$1`, [f])).rows[0].avatar_url, null);
  await setEnforce(false);
  ok('ON: the first-login Google photo is still dropped to NULL by 0059 and the insert succeeds (this layer does not interfere)');
}

// ---- 6. non-client writers are not checked (staff RPCs, mirror, service role, operator SQL)
{
  await db.query(`update public.profiles set avatar_url=$2 where id=$1`, [alice, CLOUD]);
  await db.exec(`set role service_role`);
  await db.query(`update public.profiles set avatar_url=$2 where id=$1`, [alice, PICSUM]);
  await db.exec(`reset role`);
  assert.equal((await db.query(`select avatar_url from public.profiles where id=$1`, [alice])).rows[0].avatar_url, PICSUM);
  await clear(alice);
  ok('operator SQL and the service role are not checked (the block is for client writes only)');
}

// ---- 7. rollback removes ONLY this block; re-applying restores it
{
  await db.exec(sql('rollback/0063_profile_url_only_block_ROLLBACK.sql'));
  assert.equal((await db.query(`select count(*)::int n from pg_proc where proname in ('trg_profile_url_only_block','_uob_check_slot')`)).rows[0].n, 0);
  const still = (await db.query(`select tgname from pg_trigger where tgrelid='public.profiles'::regclass and not tgisinternal and tgname in ('profiles_b_guard_content','profiles_c_business_media_scan','profiles_c_media_host_pin') order by 1`)).rows.map((r) => r.tgname);
  assert.deepEqual(still, ['profiles_b_guard_content', 'profiles_c_business_media_scan', 'profiles_c_media_host_pin']);
  assert.equal((await db.query(`select count(*)::int n from public.storefront_media_hosts`)).rows[0].n, 1);
  // pre-0063 behaviour is back (the documented carve-out); the 0056 rules and the 0062 pin are not
  await q(alice, `update public.profiles set avatar_url=$2, avatar_public_id=null where id=$1`, [alice, CLOUD]);
  await fails(alice, `update public.profiles set avatar_url=$2, avatar_public_id=null where id=$1`, [alice, 'https://evil.example/p.png'], /22023|own uploaded/);
  const ek = av(alice, 400);
  await fails(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `https://evil.example/${ek}`, ek], /image_host_not_allowed|address is not allowed/);
  await clear(alice);
  await db.exec(sql('rollback/0063_profile_url_only_block_ROLLBACK.sql'));
  ok('0063 rollback: only the block is removed (0056, 0062 pin, scan trigger and host list untouched, no data changed); it is re-runnable; the pre-0063 URL-only carve-out is back as documented');
  await db.exec(sql('migrations/0063_profile_url_only_block.sql'));
  await fails(alice, `update public.profiles set avatar_url=$2, avatar_public_id=null where id=$1`, [alice, CLOUD], refusedUrlOnly);
  await db.exec(sql('migrations/0063_profile_url_only_block.sql')); // idempotent re-apply
  ok('re-applying 0063 restores the block (the migration is re-runnable)');
}

console.log('profile_url_only_block: all assertions passed');
