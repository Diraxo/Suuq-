// Rollback security for the media migrations (0056 / 0057 / 0059). Real Postgres (PGlite), the REAL migration and rollback SQL files.
// Question answered: after a rollback, can a client (authenticated role) save an unscanned avatar / logo / banner URL?  Expected: NO.
// The rollbacks install an unconditional media FREEZE instead of dropping to the weaker 0056 rule (any https host + own key, or a
// Google/Cloudinary/picsum URL). Proves: new values refused for every slot (profile + storefront) and every URL shape, clearing and
// re-saving the held value still work, nothing existing is rewritten, non-client writers are untouched, signup stays avatar-free,
// the 0057 rollback is atomic (a refused rollback leaves the scan triggers in place), re-applying forward migrations lifts the freeze.
// Not proven here: PostgREST, the Worker, R2, or that r2-presign stays closed (see tests/businessMediaScan.test.ts for the presign gates).
// 0057 now seeds enforce=false (direct-upload policy, 2026-10-21). The freeze must hold in BOTH modes; the sections that exercise the scan
// layer itself (B, D and the re-applied chain in A) switch enforcement ON explicitly, as an operator would.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, actors, seedUsers, ok, uuid } from './harness/db.mjs';

const dir = new URL('../', import.meta.url);
const sql = (rel) => readFileSync(new URL(rel, dir), 'utf8');
const refused = /image_not_verified|has not been checked/;
const host = 'https://media.test';

// every shape a legacy/hostile client could send directly to PostgREST
const shapes = (uid, n) => {
  const av = `avatars/${uid}/${uuid(n)}.jpg`;
  const lg = `business/${uid}/logo/${uuid(n + 1)}.jpg`;
  const bn = `business/${uid}/banner/${uuid(n + 2)}.jpg`;
  return [
    ['avatar: own key on a foreign host (valid under 0056)', `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [uid, `https://evil.example/${av}`, av]],
    ['avatar: own key on the managed host, never scanned', `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [uid, `${host}/${av}`, av]],
    ['avatar: Google URL only', `update public.profiles set avatar_url=$2, avatar_public_id=null where id=$1`, [uid, 'https://lh3.googleusercontent.com/a/x']],
    ['avatar: Cloudinary URL only', `update public.profiles set avatar_url=$2, avatar_public_id=null where id=$1`, [uid, 'https://res.cloudinary.com/x/y.jpg']],
    ['avatar: picsum URL only', `update public.profiles set avatar_url=$2, avatar_public_id=null where id=$1`, [uid, 'https://picsum.photos/200']],
    ['logo: own key on a foreign host', `update public.profiles set business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [uid, `https://evil.example/${lg}`, lg]],
    ['logo: own key, never scanned', `update public.profiles set business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [uid, `${host}/${lg}`, lg]],
    ['logo: URL only', `update public.profiles set business_logo_url=$2, business_logo_public_id=null where id=$1`, [uid, 'https://res.cloudinary.com/x/logo.jpg']],
    ['banner: own key on a foreign host', `update public.profiles set business_banner_url=$2, business_banner_public_id=$3 where id=$1`, [uid, `https://evil.example/${bn}`, bn]],
    ['banner: own key, never scanned', `update public.profiles set business_banner_url=$2, business_banner_public_id=$3 where id=$1`, [uid, `${host}/${bn}`, bn]],
    ['banner: URL only', `update public.profiles set business_banner_url=$2, business_banner_public_id=null where id=$1`, [uid, 'https://lh3.googleusercontent.com/b']],
  ];
};
const sfShapes = (uid, n) => {
  const lg = `business/${uid}/logo/${uuid(n)}.jpg`;
  const bn = `business/${uid}/banner/${uuid(n + 1)}.jpg`;
  return [
    ['storefront logo: own key', `update public.storefronts set logo_url=$2, logo_public_id=$3 where owner_id=$1`, [uid, `${host}/${lg}`, lg]],
    ['storefront banner: own key', `update public.storefronts set banner_url=$2, banner_public_id=$3 where owner_id=$1`, [uid, `${host}/${bn}`, bn]],
  ];
};

async function allRefused(fails, uid, list, label) {
  for (const [name, s, p] of list) {
    try {
      await fails(uid, s, p, refused);
    } catch (e) {
      throw new Error(`${label}: ${name}: ${e.message}`);
    }
  }
}

// ============================================================ A. full chain: 0059 -> 0058 -> 0057 rollback, then forward again
{
  const { db } = await boot();
  const { q, fails } = actors(db);
  const [alice, bob, carol] = await seedUsers(db, 3);
  await db.query(`insert into public.storefront_media_hosts(host) values ('media.test') on conflict do nothing`);
  assert.equal((await db.query(`select enforce from public.business_media_config`)).rows[0].enforce, false);
  await db.query(`update public.business_media_config set enforce = true`);
  const aAv = `avatars/${alice}/${uuid(900)}.jpg`, aLg = `business/${alice}/logo/${uuid(901)}.jpg`, aBn = `business/${alice}/banner/${uuid(902)}.jpg`;
  for (const [kind, key] of [['avatar', aAv], ['logo', aLg], ['banner', aBn]]) {
    await db.query(`insert into public.business_media_scans(user_id, kind, sha256, status, public_key) values ($1,$2,'sha','approved',$3)`, [alice, kind, key]);
  }
  await q(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3, business_logo_url=$4, business_logo_public_id=$5, business_banner_url=$6, business_banner_public_id=$7 where id=$1`,
    [alice, `${host}/${aAv}`, aAv, `${host}/${aLg}`, aLg, `${host}/${aBn}`, aBn]);
  const cLg = `business/${carol}/logo/${uuid(910)}.jpg`;
  await db.query(`insert into public.business_media_scans(user_id, kind, sha256, status, public_key) values ($1,'logo','sha','approved',$2)`, [carol, cLg]);
  await q(carol, `insert into public.storefronts(owner_id, name) values ($1,'Carol Store')`, [carol]);
  await q(carol, `update public.storefronts set logo_url=$2, logo_public_id=$3 where owner_id=$1`, [carol, `${host}/${cLg}`, cLg]);
  const snapshot = async () => ({
    p: (await db.query(`select id, avatar_url, avatar_public_id, business_logo_url, business_logo_public_id, business_banner_url, business_banner_public_id from public.profiles order by id`)).rows,
    s: (await db.query(`select owner_id, logo_url, logo_public_id, banner_url, banner_public_id from public.storefronts order by owner_id`)).rows,
  });
  const before = await snapshot();

  // --- step 1: roll back 0059 only
  await db.exec(sql('rollback/0059_avatar_media_scans_ROLLBACK.sql'));
  await allRefused(fails, bob, shapes(bob, 100), 'after 0059 rollback (enforce ON)');
  await db.query(`update public.business_media_config set enforce = false`);
  await allRefused(fails, bob, shapes(bob, 120).filter(([n]) => n.startsWith('avatar')), '0059 rollback, enforce OFF');
  await db.query(`update public.business_media_config set enforce = true`);
  ok('0059 rollback: every avatar shape (foreign host, managed host unscanned, Google/Cloudinary/picsum URL) is refused for a client, even with enforcement switched OFF; logo/banner shapes are still scan-checked');

  // --- step 2: 0058 then 0057 rollback
  await db.exec(sql('rollback/0058_business_media_backfill_ROLLBACK.sql'));
  await db.exec(sql('rollback/0057_business_media_scans_ROLLBACK.sql'));
  assert.equal((await db.query(`select to_regclass('public.business_media_scans') s, to_regclass('public.business_media_config') c`)).rows[0].s, null);
  assert.deepEqual(await snapshot(), before);
  ok('full rollback: scan tables gone, no profile or storefront image was rewritten or removed');
  await allRefused(fails, bob, shapes(bob, 200), 'after full rollback');
  await allRefused(fails, carol, sfShapes(carol, 300), 'storefront after full rollback');
  ok('full rollback: every avatar / logo / banner shape on profiles AND storefronts is refused for a client; the 0056 rule (foreign host + own key, third-party URLs) is NOT back');

  // legacy-client behaviours that must keep working
  await q(alice, `update public.profiles set bio='edited after rollback' where id=$1`, [alice]);
  await q(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `${host}/${aAv}`, aAv]); // re-save the held value
  await q(alice, `update public.profiles set business_logo_url=null, business_logo_public_id=null where id=$1`, [alice]); // clearing
  ok('full rollback: unrelated edits, re-saving the held image and removing an image still work (nobody is locked out of their profile)');
  await q(alice, `update public.profiles set avatar_url=null, avatar_public_id=null where id=$1`, [alice]);
  await fails(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `${host}/${aAv}`, aAv], refused);
  ok('full rollback: after removing a photo the user cannot put one back (that needs the scan pipeline again)');

  // non-client writers are not frozen
  const op = `avatars/${bob}/${uuid(950)}.jpg`;
  await db.query(`update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [bob, `${host}/${op}`, op]);
  ok('full rollback: operator / service-role / definer writes are not frozen (the freeze is client-only)');

  // signup trigger and client first-login insert
  const ghost = uuid(960);
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values ($1,'g@test.dev',$2)`, [ghost, JSON.stringify({ picture: 'https://lh3.googleusercontent.com/a/x', avatar_url: 'https://evil.example/t.png' })]);
  assert.equal((await db.query(`select avatar_url from public.profiles where id=$1`, [ghost])).rows[0].avatar_url, null);
  const ghost2 = uuid(961);
  await db.query(`insert into auth.users(id,email) values ($1,'g2@test.dev')`, [ghost2]);
  await db.query(`delete from public.profiles where id=$1`, [ghost2]);
  await q(ghost2, `insert into public.profiles(id, full_name, avatar_url) values ($1,'G2','https://lh3.googleusercontent.com/a/x')`, [ghost2]);
  assert.equal((await db.query(`select avatar_url from public.profiles where id=$1`, [ghost2])).rows[0].avatar_url, null);
  ok('full rollback: the signup trigger still creates no avatar, and a client first-login insert drops an external avatar URL');

  // --- forward again: freeze replaced by the real scan checks
  for (const f of ['0057_business_media_scans', '0058_business_media_backfill', '0059_avatar_media_scans']) await db.exec(sql(`migrations/${f}.sql`));
  assert.equal((await db.query(`select enforce from public.business_media_config`)).rows[0].enforce, false); // re-created table: the seeded explicit OFF
  await db.query(`update public.business_media_config set enforce = true`);
  const k2 = `avatars/${carol}/${uuid(970)}.jpg`;
  await fails(carol, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [carol, `${host}/${k2}`, k2], refused);
  await db.query(`insert into public.business_media_scans(user_id, kind, sha256, status, public_key) values ($1,'avatar','sha','approved',$2)`, [carol, k2]);
  await q(carol, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [carol, `${host}/${k2}`, k2]);
  assert.equal((await db.query(`select count(*)::int n from pg_trigger t join pg_proc p on p.oid = t.tgfoid where p.proname in ('profile_media_freeze','storefront_media_freeze')`)).rows[0].n, 0);
  ok('re-applying 0057/0058/0059 replaces the freeze with the scan check: an approved key is accepted again, an unscanned one is refused, no freeze trigger remains');
}

// ============================================================ B. atomic: a refused 0057 rollback leaves the scan layer intact
{
  const { db } = await boot();
  const { fails } = actors(db);
  const [alice] = await seedUsers(db, 1);
  await db.query(`insert into public.storefront_media_hosts(host) values ('media.test') on conflict do nothing`);
  await db.query(`update public.business_media_config set enforce = true`);
  await assert.rejects(db.exec(sql('rollback/0057_business_media_scans_ROLLBACK.sql')), /depend|business_media_backfill/i); // 0058 still applied
  const left = (await db.query(`select (select count(*)::int from pg_proc where proname in ('trg_profile_business_media_scan','_bm_key_ok')) f,
    to_regclass('public.business_media_scans') t, (select count(*)::int from pg_proc where proname='profile_media_freeze') z`)).rows[0];
  assert.deepEqual([left.f, left.t === null, left.z], [2, false, 0]);
  const k = `business/${alice}/logo/${uuid(5)}.jpg`;
  await fails(alice, `update public.profiles set business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [alice, `${host}/${k}`, k], refused);
  ok('a refused 0057 rollback (0058 still applied) leaves the scan tables, functions and triggers untouched: nothing half-rolled-back');
}

// ============================================================ C. 0056-only environment
{
  const { db } = await boot({ upTo: '0056' });
  const { q, fails } = actors(db);
  const [alice] = await seedUsers(db, 1);
  const av = `avatars/${alice}/${uuid(7)}.jpg`;
  await q(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `https://evil.example/${av}`, av]);
  ok('baseline (documents the weakness): with only 0056 a client CAN save an own-key avatar on a foreign host');
  await db.query(`update public.profiles set avatar_url=null, avatar_public_id=null where id=$1`, [alice]);
  await db.exec(sql('rollback/0056_profile_content_guard_ROLLBACK.sql'));
  await allRefused(fails, alice, shapes(alice, 20), '0056 rollback');
  await q(alice, `update public.profiles set business_website='javascript:alert(1)' where id=$1`, [alice]);
  assert.equal((await db.query(`select count(*)::int n from pg_proc where proname in ('guard_profile_content','profile_social_ok')`)).rows[0].n, 0);
  ok('0056 rollback: the website/social checks are removed as asked, but the image columns are FROZEN for clients instead of left unguarded');
  await db.exec(sql('rollback/0056_profile_content_guard_ROLLBACK.sql'));
  ok('the 0056 rollback is re-runnable');
}

// ============================================================ D. 0056 rollback must not disturb the 0057 scan layer
{
  const { db } = await boot();
  const { q, fails } = actors(db);
  const [alice] = await seedUsers(db, 1);
  await db.query(`insert into public.storefront_media_hosts(host) values ('media.test') on conflict do nothing`);
  await db.query(`update public.business_media_config set enforce = true`);
  await db.exec(sql('rollback/0056_profile_content_guard_ROLLBACK.sql'));
  assert.equal((await db.query(`select count(*)::int n from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgname='profiles_c_business_media_scan' and p.proname='trg_profile_business_media_scan'`)).rows[0].n, 1); // the scan trigger stays in charge
  const k = `avatars/${alice}/${uuid(9)}.jpg`;
  await fails(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `${host}/${k}`, k], refused);
  await db.query(`insert into public.business_media_scans(user_id, kind, sha256, status, public_key) values ($1,'avatar','sha','approved',$2)`, [alice, k]);
  await q(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `${host}/${k}`, k]);
  ok('0056 rollback on top of 0057/0059 leaves the real scan trigger in charge: approved keys still work, unscanned ones are still refused');
}

// ============================================================ E. the complete reverse order including 0062 / 0063, then forward again
// Question: with the host pin (0062) and the URL-only block (0063) in the chain, does rolling back 0063 -> 0062 -> 0059 -> 0058 -> 0057 -> 0056 ever
// leave a client able to save an unscanned / foreign / URL-only value once the freeze exists, and does re-applying the chain restore every layer?
{
  const { db } = await boot();
  const { q, fails } = actors(db);
  const [alice, bob] = await seedUsers(db, 2);
  await db.exec(`select set_config('suuqplus.skip_rate_limit','true',false)`);
  await db.query(`insert into public.storefront_media_hosts(host) values ('media.test') on conflict do nothing`);
  const urlOnly = [
    ['avatar Cloudinary URL only', `update public.profiles set avatar_url=$2, avatar_public_id=null where id=$1`, 'https://res.cloudinary.com/x/y.jpg'],
    ['logo Google URL only', `update public.profiles set business_logo_url=$2, business_logo_public_id=null where id=$1`, 'https://lh3.googleusercontent.com/l'],
    ['banner picsum URL only', `update public.profiles set business_banner_url=$2, business_banner_public_id=null where id=$1`, 'https://picsum.photos/200'],
  ];
  const urlOnlyAllRefused = async (uid, re, label) => {
    for (const [name, stmt, u] of urlOnly) {
      try { await fails(uid, stmt, [uid, u], re); } catch (e) { throw new Error(`${label}: ${name}: ${e.message}`); }
    }
  };
  const urlOnlyAccepted = async (uid, label) => {
    for (const [name, stmt, u] of urlOnly) {
      try { await q(uid, stmt, [uid, u]); } catch (e) { throw new Error(`${label}: ${name}: expected accepted: ${e.message}`); }
    }
    await db.query(`update public.profiles set avatar_url=null, avatar_public_id=null, business_logo_url=null, business_logo_public_id=null, business_banner_url=null, business_banner_public_id=null where id=$1`, [uid]);
    await db.query(`update public.storefronts set logo_url=null, logo_public_id=null, banner_url=null, banner_public_id=null where owner_id=$1`, [uid]);
  };
  const urlRe = /url_only_not_allowed|must be uploaded again/;
  const keyed = (uid, n) => `avatars/${uid}/${uuid(n)}.jpg`;

  // with the whole chain applied (enforcement OFF = shipped): URL-only refused by 0063, foreign host refused by 0062
  await urlOnlyAllRefused(alice, urlRe, 'full chain');
  const fk = keyed(alice, 1000);
  await fails(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `https://evil.example/${fk}`, fk], /image_host_not_allowed|address is not allowed/);
  const heldKey = keyed(bob, 1001);
  await q(bob, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [bob, `${host}/${heldKey}`, heldKey]); // a held managed avatar
  const heldBefore = (await db.query(`select avatar_url, avatar_public_id from public.profiles where id=$1`, [bob])).rows[0];

  // 1. 0063 rollback only: URL-only is back (documented); the pin still refuses a foreign host
  await db.exec(sql('rollback/0063_profile_url_only_block_ROLLBACK.sql'));
  await fails(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `https://evil.example/${fk}`, fk], /image_host_not_allowed|address is not allowed/);
  await urlOnlyAccepted(alice, 'after 0063 rollback only');
  ok('E1: 0063 rollback alone reopens ONLY the URL-only carve-out (documented); the 0062 pin still refuses a foreign host');

  // 2. 0062 rollback: the foreign-host gap is back too (still documented), nothing else changed
  await db.exec(sql('rollback/0062_profile_media_host_pin_ROLLBACK.sql'));
  await q(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `https://evil.example/${fk}`, fk]);
  await q(alice, `update public.profiles set avatar_url=null, avatar_public_id=null where id=$1`, [alice]);
  ok('E2: after 0063 + 0062 are rolled back the pre-0062/0063 weak spots return exactly as documented (this is the state those rollbacks are for)');

  // 3. the media rollbacks install the freeze, which must close BOTH gaps even though 0062/0063 are gone
  await db.query(`update public.business_media_config set enforce = false`);
  await db.exec(sql('rollback/0059_avatar_media_scans_ROLLBACK.sql'));
  await db.exec(sql('rollback/0058_business_media_backfill_ROLLBACK.sql'));
  await db.exec(sql('rollback/0057_business_media_scans_ROLLBACK.sql'));
  await db.exec(sql('rollback/0056_profile_content_guard_ROLLBACK.sql'));
  await urlOnlyAllRefused(alice, refused, 'after the 0059/0058/0057/0056 rollbacks');
  await fails(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `https://evil.example/${fk}`, fk], refused);
  await q(bob, `update public.profiles set bio='after full reverse rollback' where id=$1`, [bob]);
  await q(bob, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [bob, heldBefore.avatar_url, heldBefore.avatar_public_id]);
  assert.deepEqual((await db.query(`select avatar_url, avatar_public_id from public.profiles where id=$1`, [bob])).rows[0], heldBefore);
  ok('E3: full reverse order 0063,0062,0059,0058,0057,0056: the freeze refuses every URL-only and foreign-host shape; the held avatar is untouched and unrelated edits / re-saving it still work');

  // 4. forward again in file order: 0056,0057,0058,0059, then 0062, 0063
  for (const f of ['0056_profile_content_guard', '0057_business_media_scans', '0058_business_media_backfill', '0059_avatar_media_scans', '0062_profile_media_host_pin', '0063_profile_url_only_block']) {
    await db.exec(sql(`migrations/${f}.sql`));
  }
  assert.equal((await db.query(`select count(*)::int n from pg_trigger t join pg_proc p on p.oid = t.tgfoid where p.proname in ('profile_media_freeze','storefront_media_freeze')`)).rows[0].n, 0);
  assert.equal((await db.query(`select enforce from public.business_media_config`)).rows[0].enforce, false); // re-seeded explicit OFF
  await urlOnlyAllRefused(alice, urlRe, 're-applied chain');
  await fails(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `https://evil.example/${fk}`, fk], /image_host_not_allowed|address is not allowed/);
  const ok1 = keyed(alice, 1002);
  await q(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `${host}/${ok1}`, ok1]);
  ok('E4: re-applying 0056..0059, 0062, 0063 in file order lifts the freeze and restores every layer (URL-only refused, host pinned, a managed upload on the registered host saves; enforcement re-seeded OFF)');
}

console.log('media_rollback: all assertions passed');
