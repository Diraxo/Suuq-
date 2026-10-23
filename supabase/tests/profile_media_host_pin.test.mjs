// 0062 — host pin for client-written avatar / logo / banner. Real Postgres (PGlite), the REAL migration chain 0001..0063 and the REAL rollback SQL.
// Proves: a key-bearing value is accepted only as exactly https://<host in storefront_media_hosts>/<key> (both enforcement modes), arbitrary
// and look-alike hosts are refused, malformed URLs are refused, unchanged legacy values never block an unrelated edit, URL-only
// values are no longer 0062's concern (0063 refuses new ones), first-login inserts, an EMPTY allowlist fails closed, non-client
// writers are untouched, and the rollback removes only the pin.
// Not proven here: PostgREST, the real R2_PUBLIC_URL host (an Edge Function secret), or what the bytes at a URL are.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, actors, seedUsers, ok, uuid } from './harness/db.mjs';

const dir = new URL('../', import.meta.url);
const sql = (rel) => readFileSync(new URL(rel, dir), 'utf8');
const refusedHost = /image_host_not_allowed|address is not allowed/;
const HOST = 'media.test';
const host = `https://${HOST}`;
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
const set = (uid, ucol, kcol, url, key) => q(uid, `update public.profiles set ${ucol}=$2, ${kcol}=$3 where id=$1`, [uid, url, key]);
const clear = async (uid) => {
  await db.query(`update public.profiles set avatar_url=null, avatar_public_id=null, business_logo_url=null, business_logo_public_id=null, business_banner_url=null, business_banner_public_id=null where id=$1`, [uid]);
  await db.query(`update public.storefronts set logo_url=null, logo_public_id=null, banner_url=null, banner_public_id=null where owner_id=$1`, [uid]);
};
// Logo / banner written through profiles are mirrored into storefronts by the 0054 legacy-sync trigger and cleared on profiles, so that is
// where a held business image is read back from.
const SF = { logo: ['logo_url', 'logo_public_id'], banner: ['banner_url', 'banner_public_id'] };
const held = async (uid, label, ucol, kcol) => {
  if (label === 'avatar') return (await db.query(`select ${ucol} u, ${kcol} k from public.profiles where id=$1`, [uid])).rows[0];
  const r = await db.query(`select ${SF[label][0]} u, ${SF[label][1]} k from public.storefronts where owner_id=$1`, [uid]);
  return r.rows[0] ?? { u: null, k: null };
};
const approve = (uid, kind, key) => db.query(`insert into public.business_media_scans(user_id, kind, sha256, status, public_key) values ($1,$2,'sha','approved',$3)`, [uid, kind, key]);

// ---- 0. shape of the control
assert.equal((await db.query(`select enforce from public.business_media_config`)).rows[0].enforce, false); // shipped state: explicit OFF
assert.equal((await db.query(`select count(*)::int n from public.storefront_media_hosts`)).rows[0].n, 0); // 0062 seeds no host
assert.equal((await db.query(`select count(*)::int n from pg_trigger where tgname='profiles_c_media_host_pin' and tgrelid='public.profiles'::regclass and not tgisinternal`)).rows[0].n, 1);
ok('0062 is installed, seeds NO host (storefront_media_hosts is empty after the chain) and the scan config is still the explicit OFF');

// privileges: helper callable by authenticated only (needed by the invoker trigger); the trigger function by nobody
const fnPriv = async (sig, role) => (await db.query(`select has_function_privilege('${role}', '${sig}', 'execute') p`)).rows[0].p;
assert.equal(await fnPriv('public._pmh_url_ok(text,text)', 'anon'), false);
assert.equal(await fnPriv('public._pmh_check_slot(text,boolean,text,text,text,text)', 'anon'), false);
assert.equal(await fnPriv('public.trg_profile_media_host_pin()', 'authenticated'), false);
assert.equal(await fnPriv('public.trg_profile_media_host_pin()', 'anon'), false);
ok('EXECUTE: anon cannot call the helpers; nobody can call the trigger function directly');

// ---- 1. EMPTY allowlist fails closed, but clearing, URL-only legacy and unrelated edits still work
{
  const k = av(alice, 1);
  await fails(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `${host}/${k}`, k], refusedHost);
  await q(alice, `update public.profiles set bio='hello' where id=$1`, [alice]);
  await q(alice, `update public.profiles set avatar_url=null, avatar_public_id=null where id=$1`, [alice]);
  ok('empty storefront_media_hosts: every key-bearing save is refused (fail closed); unrelated edits and clearing still work');
}
await db.query(`insert into public.storefront_media_hosts(host) values ($1)`, [HOST]);

// ---- 2/3. the same matrix in BOTH modes (OFF = shipped, ON = scan layer active with approved rows)
for (const mode of ['OFF', 'ON']) {
  await db.query(`update public.business_media_config set enforce = $1`, [mode === 'ON']);
  let n = mode === 'ON' ? 500 : 100;

  for (const [label, ucol, kcol, mk] of SLOTS) {
    const kind = label;
    const approveIfOn = async (uid, key) => { if (mode === 'ON') await approve(uid, kind, key); };
    const good = mk(alice, n++);
    await approveIfOn(alice, good);
    await set(alice, ucol, kcol, `${host}/${good}`, good);
    ok(`${mode}: ${label}: own key on the registered host is accepted`);

    // re-saving the held pair (a no-change write) and an unrelated edit
    await set(alice, ucol, kcol, `${host}/${good}`, good);
    await q(alice, `update public.profiles set bio=$2 where id=$1`, [alice, `bio ${mode} ${label}`]);

    // everything below must be refused while the good value stays untouched
    const fresh = mk(alice, n++);
    await approveIfOn(alice, fresh);
    const bad = {
      'arbitrary https host': `https://evil.example/${fresh}`,
      'look-alike: registered host as a sub-label of another domain': `https://${HOST}.evil.example/${fresh}`,
      'look-alike: registered host as a prefix of the label': `https://${HOST}x/${fresh}`,
      'look-alike: sub-domain of the registered host': `https://cdn.${HOST}/${fresh}`,
      'userinfo trick': `https://${HOST}@evil.example/${fresh}`,
      'userinfo trick (registered host after @)': `https://evil.example@${HOST}/${fresh}`,
      'explicit port': `https://${HOST}:443/${fresh}`,
      'trailing dot': `https://${HOST}./${fresh}`,
      'plain http': `http://${HOST}/${fresh}`,
      'query appended': `${host}/${fresh}?x=1`,
      'fragment appended': `${host}/${fresh}#x`,
      'extra path prefix': `${host}/img/${fresh}`,
      'path suffix': `${host}/${fresh}/x`,
      'double slash': `${host}//${fresh}`,
      'scheme-relative': `//${HOST}/${fresh}`,
      'no scheme': `${HOST}/${fresh}`,
      'not a URL at all': 'not a url',
      'empty string': '',
      'scheme only': 'https://',
      'host only': host,
      'host with slash only': `${host}/`,
      'javascript:': `javascript:alert(1)//${fresh}`,
      'data:': `data:text/html,${fresh}`,
      'whitespace inside': `${host}/ ${fresh}`,
      'over 2048 chars': `${host}/${'a'.repeat(2100)}/${fresh}`,
    };
    for (const [name, url] of Object.entries(bad)) {
      try {
        // a URL that 0056 alone would ACCEPT (https, ends with the own key) must be stopped by the PIN specifically (OFF), or by the pin or the scan layer's own host rule (ON)
        const by0056 = url.startsWith('https://') && url.endsWith(`/${fresh}`);
        await fails(alice, `update public.profiles set ${ucol}=$2, ${kcol}=$3 where id=$1`, [alice, url, fresh], by0056 ? (mode === 'ON' ? /image_host_not_allowed|address is not allowed|has not been checked/ : refusedHost) : /22023|23514|address is not allowed|own uploaded|image_host_not_allowed/);
      } catch (e) {
        throw new Error(`${mode} ${label}: ${name}: ${e.message}`);
      }
    }
    // changing only ONE half of the held pair is a change and is checked
    await fails(alice, `update public.profiles set ${ucol}=$2 where id=$1`, [alice, `https://evil.example/${good}`], /22023|address is not allowed|own uploaded/);
    // the held value survived every refusal
    assert.deepEqual(await held(alice, label, ucol, kcol), { u: `${host}/${good}`, k: good });
    ok(`${mode}: ${label}: ${Object.keys(bad).length + 1} foreign / look-alike / malformed shapes are refused and the held value is untouched`);

    // another user's key and a key of another slot are still refused (0056 stays in charge)
    const theirs = mk(bob, n++);
    await fails(alice, `update public.profiles set ${ucol}=$2, ${kcol}=$3 where id=$1`, [alice, `${host}/${theirs}`, theirs], /22023|own|not been checked/);
    await clear(alice);
  }

  // host compare is case-insensitive on the HOST only (documented): uppercase host accepted, uppercase path is a different key
  {
    const k = av(alice, n++);
    if (mode === 'ON') await approve(alice, 'avatar', k);
    await set(alice, 'avatar_url', 'avatar_public_id', `https://MEDIA.TEST/${k}`, k);
    await clear(alice);
    ok(`${mode}: the host compare is case-insensitive (the table stores lower case); the key part is exact`);
  }
}
await db.query(`update public.business_media_config set enforce = false`);

// ---- 4. legacy values and old app versions (enforcement OFF = shipped state)
{
  // operator-set legacy rows: foreign-host own-key and URL-only Cloudinary / Google / unknown host
  const legacyAv = av(bob, 700), legacyLg = lg(bob, 701);
  await db.query(`update public.profiles set avatar_url=$2, avatar_public_id=$3, business_logo_url='https://old.example/l.png', business_banner_url='https://res.cloudinary.com/x/b.jpg' where id=$1`, [bob, `https://evil.example/${legacyAv}`, legacyAv]);
  await q(bob, `update public.profiles set bio='edit with legacy rows', city='Addis Ababa' where id=$1`, [bob]);
  await q(bob, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [bob, `https://evil.example/${legacyAv}`, legacyAv]); // re-save the unchanged pair
  const row = (await db.query(`select avatar_url, avatar_public_id, business_logo_url, business_banner_url from public.profiles where id=$1`, [bob])).rows[0];
  assert.deepEqual(row, { avatar_url: `https://evil.example/${legacyAv}`, avatar_public_id: legacyAv, business_logo_url: 'https://old.example/l.png', business_banner_url: 'https://res.cloudinary.com/x/b.jpg' });
  ok('legacy rows (foreign-host own-key avatar, unknown-host logo, Cloudinary banner) accept unrelated edits and an unchanged re-save; nothing is rewritten or deleted');

  // ...but changing the legacy slot to another foreign value is refused, and replacing it with a managed one is accepted
  await fails(bob, `update public.profiles set avatar_url=$2 where id=$1`, [bob, `https://other-evil.example/${legacyAv}`], /22023|address is not allowed|own uploaded/);
  const next = av(bob, 702);
  await set(bob, 'avatar_url', 'avatar_public_id', `${host}/${next}`, next);
  await q(bob, `update public.profiles set avatar_url=null, avatar_public_id=null, business_logo_url=null, business_banner_url=null where id=$1`, [bob]);
  ok('a legacy foreign-host avatar can be removed or replaced by a managed one, but not re-pointed to another foreign host');

  // URL-only values: 0062 deliberately does not look at them. Formerly the documented CARVE-OUT (Google / Cloudinary / picsum accepted for every
  // slot); closed by 0063, so this is flipped on purpose. 0063 has its own matrix in profile_url_only_block.test.mjs.
  for (const [ucol, kcol] of [['avatar_url', 'avatar_public_id'], ['business_logo_url', 'business_logo_public_id'], ['business_banner_url', 'business_banner_public_id']]) {
    for (const u of ['https://lh3.googleusercontent.com/a/photo', 'https://res.cloudinary.com/some-account/image/upload/x.jpg', 'https://picsum.photos/200']) {
      await fails(carol, `update public.profiles set ${ucol}=$2, ${kcol}=null where id=$1`, [carol, u], /url_only_not_allowed|must be uploaded again/);
    }
    await q(carol, `update public.profiles set ${ucol}=null where id=$1`, [carol]);
  }
  ok('URL-only Google / Cloudinary / picsum values are refused by an update for every slot (0063); clearing still works');
  for (const [ucol, kcol] of [['avatar_url', 'avatar_public_id'], ['business_logo_url', 'business_logo_public_id'], ['business_banner_url', 'business_banner_public_id']]) {
    await fails(carol, `update public.profiles set ${ucol}=$2, ${kcol}=null where id=$1`, [carol, 'https://evil.example/pixel.png'], /22023|own uploaded/);
    await fails(carol, `update public.profiles set ${ucol}=$2, ${kcol}=null where id=$1`, [carol, `${host}/x.jpg`], /22023|own uploaded/); // managed host but no key: still 0056-refused
  }
  ok('URL-only values on any other host (including the managed host without a key) are still refused by 0056');
}

// ---- 5. first-login inserts (client upsert fallback)
{
  const mk = async (n) => {
    const id = uuid(n);
    await db.query(`insert into auth.users(id,email) values ($1,$2)`, [id, `ins${n}@test.dev`]);
    await db.query(`delete from public.profiles where id=$1`, [id]); // the signup trigger made one; simulate "trigger not committed yet"
    return id;
  };
  const a = await mk(800);
  await q(a, `insert into public.profiles(id, full_name, email) values ($1,'No Image','a@test.dev')`, [a]);
  ok('first-login insert without images is accepted');

  const b = await mk(801);
  await q(b, `insert into public.profiles(id, full_name, avatar_url) values ($1,'Old App','https://lh3.googleusercontent.com/a/photo')`, [b]);
  assert.equal((await db.query(`select avatar_url from public.profiles where id=$1`, [b])).rows[0].avatar_url, 'https://lh3.googleusercontent.com/a/photo');
  ok('OFF: an old app build\'s first-login insert with a Google photo (URL-only) is NOT locked out');

  const c = await mk(802);
  const ck = av(c, 803);
  await q(c, `insert into public.profiles(id, full_name, avatar_url, avatar_public_id) values ($1,'Managed',$2,$3)`, [c, `${host}/${ck}`, ck]);
  ok('first-login insert with an own key on the registered host is accepted');

  const d = await mk(804);
  const dk = av(d, 805);
  await fails(d, `insert into public.profiles(id, full_name, avatar_url, avatar_public_id) values ($1,'Foreign',$2,$3)`, [d, `https://evil.example/${dk}`, dk], refusedHost);
  await fails(d, `insert into public.profiles(id, full_name, business_logo_url, business_logo_public_id) values ($1,'Foreign',$2,$3)`, [d, `https://evil.example/${lg(d, 806)}`, lg(d, 806)], refusedHost);
  await fails(d, `insert into public.profiles(id, full_name, business_banner_url, business_banner_public_id) values ($1,'Foreign',$2,$3)`, [d, `https://evil.example/${bn(d, 807)}`, bn(d, 807)], refusedHost);
  assert.equal((await db.query(`select count(*)::int n from public.profiles where id=$1`, [d])).rows[0].n, 0);
  ok('first-login insert with an own key on a foreign host is refused for avatar, logo and banner (no row is created)');

  // ON: 0059 drops the external photo on first login (runs before the pin), the pin must not break that
  await db.query(`update public.business_media_config set enforce = true`);
  const e = await mk(808);
  await q(e, `insert into public.profiles(id, full_name, avatar_url) values ($1,'Old App ON','https://lh3.googleusercontent.com/a/photo')`, [e]);
  assert.equal((await db.query(`select avatar_url from public.profiles where id=$1`, [e])).rows[0].avatar_url, null);
  const f = await mk(809);
  await fails(f, `insert into public.profiles(id, full_name, avatar_url, avatar_public_id) values ($1,'Forged',$2,$3)`, [f, `${host}/${av(f, 810)}`, av(f, 810)], /image_not_verified|has not been checked/);
  await db.query(`update public.business_media_config set enforce = false`);
  ok('ON: first-login Google photo is still dropped to NULL by 0059 (not refused); a forged unscanned key is still refused by the scan layer, not masked by the pin');
}

// ---- 6. updates: image fields unchanged vs changed (the trigger must not look at untouched slots)
{
  const k = av(dave, 900);
  await set(dave, 'avatar_url', 'avatar_public_id', `${host}/${k}`, k);
  // simulate the registered host being retired later: unchanged slots keep working, changed ones are refused
  await db.query(`delete from public.storefront_media_hosts`);
  await q(dave, `update public.profiles set bio='after host removal', city='Hargeisa' where id=$1`, [dave]);
  await set(dave, 'avatar_url', 'avatar_public_id', `${host}/${k}`, k); // identical pair
  await fails(dave, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [dave, `${host}/${av(dave, 901)}`, av(dave, 901)], refusedHost);
  await q(dave, `update public.profiles set avatar_url=null, avatar_public_id=null where id=$1`, [dave]);
  await db.query(`insert into public.storefront_media_hosts(host) values ($1)`, [HOST]);
  ok('image fields unchanged: any edit passes even if the host list changes later; changed: checked against the list at write time; clearing always passes');
}

// ---- 7. non-client writers are not checked (staff RPCs, mirror, service role, operator SQL)
{
  const k = av(alice, 950);
  await db.query(`update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `https://evil.example/${k}`, k]); // operator / postgres
  await db.exec(`set role service_role`);
  await db.query(`update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `https://evil2.example/${k}`, k]);
  await db.exec(`reset role`);
  ok('operator SQL and the service role are not checked (the pin is for client writes only)');
  await clear(alice);
}

// ---- 8. rollback removes ONLY the pin; re-applying the migration restores it
{
  const k = av(alice, 960);
  await db.exec(sql('rollback/0062_profile_media_host_pin_ROLLBACK.sql'));
  assert.equal((await db.query(`select count(*)::int n from pg_proc where proname in ('trg_profile_media_host_pin','_pmh_check_slot','_pmh_url_ok')`)).rows[0].n, 0);
  const still = (await db.query(`select tgname from pg_trigger where tgrelid='public.profiles'::regclass and not tgisinternal and tgname in ('profiles_b_guard_content','profiles_c_business_media_scan') order by 1`)).rows.map((r) => r.tgname);
  assert.deepEqual(still, ['profiles_b_guard_content', 'profiles_c_business_media_scan']);
  assert.equal((await db.query(`select count(*)::int n from public.storefront_media_hosts`)).rows[0].n, 1);
  // pre-0062 behaviour is back (the documented gap), the 0056 rules are not
  await set(alice, 'avatar_url', 'avatar_public_id', `https://evil.example/${k}`, k);
  await fails(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `${host}/${av(bob, 961)}`, av(bob, 961)], /22023|own/);
  await clear(alice);
  await db.exec(sql('rollback/0062_profile_media_host_pin_ROLLBACK.sql'));
  ok('0062 rollback: only the pin is removed (0056 + scan triggers and the host list untouched, no data changed); it is re-runnable; the pre-0062 foreign-host gap is back as documented');
  await db.exec(sql('migrations/0062_profile_media_host_pin.sql'));
  await fails(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `https://evil.example/${k}`, k], refusedHost);
  ok('re-applying 0062 restores the pin (the migration is re-runnable)');
}

console.log('profile_media_host_pin: all assertions passed');
