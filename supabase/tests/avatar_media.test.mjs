// 0059 — avatars join the media scan. Real Postgres (PGlite), full chain 0001..0059.
// Proves: (A) in the shipped state (0057's explicit enforce=false row, direct-upload policy of 2026-10-21) the avatar scan check is inert and
// only 0056 applies, while the unconditional signup hardening still holds; (B) once an operator sets enforce=true, a CLIENT cannot save a new
// avatar unless the scanner approved that exact key for that user, with the URL pinned to a managed media host; legacy avatars stay
// editable/removable; a business key never authorises an avatar slot; signup metadata can no longer plant any avatar URL (a Google photo is
// untrusted too); the 0059 rollback restores the 0057 behaviour. The fail-closed reading of a missing/NULL flag is proven in business_media.test.mjs.
// Not proven here: the Worker, R2, Vision, PostgREST.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, actors, seedUsers, ok, uuid } from './harness/db.mjs';

const { db } = await boot();
const { q, fails } = actors(db);
const [alice, bob, carol, dave, erin] = await seedUsers(db, 5);
const host = 'https://media.test';
await db.query(`insert into public.storefront_media_hosts(host) values ('media.test') on conflict do nothing`);
const ak = (uid, n) => `avatars/${uid}/${uuid(n)}.jpg`;
const setAv = (uid, key, url = `${host}/${key}`) => q(uid, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [uid, url, key]);
const notVerified = /image_not_verified|has not been checked/;
const scan = (uid, kind, key, status = 'approved') =>
  db.query(`insert into public.business_media_scans(user_id, kind, sha256, status, public_key) values ($1,$2,'sha',$3,$4)`, [uid, kind, status, status === 'approved' ? key : null]);

// ---- A. SHIPPED STATE: explicit OFF (0057 seeds enforce=false). 0059 rides the same switch, so the avatar scan check is inert.
const setEnforce = (v) => db.query(`update public.business_media_config set enforce = $1`, [v]);
assert.deepEqual((await db.query(`select id, enforce from public.business_media_config`)).rows, [{ id: true, enforce: false }]);
{
  const k0 = ak(alice, 80);
  await setAv(alice, k0);
  await q(alice, `update public.profiles set avatar_url=null, avatar_public_id=null where id=$1`, [alice]);
  ok('OFF: a client can save a managed-host avatar with NO scan row (direct upload works; only the 0056 rules apply)');
  await fails(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `${host}/${ak(bob, 81)}`, ak(bob, 81)], /22023|own/);
  await fails(alice, `update public.profiles set avatar_url=$2 where id=$1`, [alice, 'https://evil.example/pixel.png'], /22023|own/);
  await fails(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `http://${'media.test'}/${k0}`, k0], /22023|own/);
  ok("OFF: 0056 still refuses another user's key, an arbitrary URL-only avatar and a non-https URL");
  // Formerly the KNOWN GAP "an own-key avatar is accepted on ANY https host". Closed by 0062 (host pin, independent of enforcement): this
  // assertion was flipped on purpose. The full matrix is in profile_media_host_pin.test.mjs.
  const gap = ak(alice, 82);
  await fails(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `https://evil.example/${gap}`, gap], /image_host_not_allowed|address is not allowed/);
  ok('OFF: an own-key avatar on a host that is not in storefront_media_hosts is refused (0062 host pin)');
  // Formerly the KNOWN GAP "a URL-only avatar on a legacy host (Cloudinary / Google / picsum: any account) is accepted". Closed by 0063 for
  // UPDATES, independent of enforcement; flipped on purpose. The full matrix is in profile_url_only_block.test.mjs.
  for (const u of ['https://res.cloudinary.com/attacker-account/pixel.png', 'https://lh3.googleusercontent.com/attacker', 'https://picsum.photos/200']) {
    await fails(alice, `update public.profiles set avatar_url=$2, avatar_public_id=null where id=$1`, [alice, u], /url_only_not_allowed|must be uploaded again/);
  }
  ok('OFF: a NEW URL-only avatar on a legacy host (Cloudinary / Google / picsum) is refused by an update (0063)');
  const ghost0 = uuid(910);
  await db.query(`insert into auth.users(id,email) values ($1,'ghost0@test.dev')`, [ghost0]);
  await db.query(`delete from public.profiles where id=$1`, [ghost0]);
  await q(ghost0, `insert into public.profiles(id, full_name, avatar_url) values ($1,'G','https://lh3.googleusercontent.com/a/photo')`, [ghost0]);
  assert.equal((await db.query(`select avatar_url from public.profiles where id=$1`, [ghost0])).rows[0].avatar_url, 'https://lh3.googleusercontent.com/a/photo');
  ok('OFF: a client first-login insert KEEPS the Google photo (the drop-to-NULL in 0059 runs only while enforced; the signup trigger itself still never copies one)');
}

// ---- B. ENFORCED: the operator turns it on. Everything below runs ON until a section says otherwise.
await setEnforce(true);
const off = ak(alice, 1);
await fails(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `https://anything.example/${off}`, off], notVerified);
ok('enforced: an unscanned avatar on any host is refused');
{
  const k2 = ak(alice, 90);
  await scan(alice, 'avatar', k2);
  await db.query(`delete from public.storefront_media_hosts`);
  await fails(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `${host}/${k2}`, k2], notVerified);
  ok('an APPROVED scan is still not enough while no managed media host is configured (empty allow-list fails closed)');
  await db.query(`insert into public.storefront_media_hosts(host) values ('media.test')`);
}

// ---- scanned vs unscanned
const key = ak(alice, 2);
await fails(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `${host}/${key}`, key], notVerified);
ok('enforced: an avatar key with no scan row is refused');
await scan(alice, 'avatar', key);
await setAv(alice, key);
ok('enforced: the same key is accepted once the scanner approved it');

for (const st of ['rejected', 'held', 'unavailable', 'processing']) await scan(alice, 'avatar', null, st); // these carry no key at all
const rej = ak(alice, 3);
await fails(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `${host}/${rej}`, rej], notVerified);
ok('rejected / held / unavailable / processing scans never authorise a key');

// ---- URL pinning: the scan binds the KEY, so the URL must be pinned as well
{
  const dk = ak(dave, 10);
  await scan(dave, 'avatar', dk);
  await fails(dave, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [dave, `https://evil.example/${dk}`, dk], notVerified);
  await fails(dave, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [dave, `https://res.cloudinary.com/x/${dk}`, dk], notVerified);
  await fails(dave, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [dave, `${host}/other/${dk}`, dk], notVerified);
  ok('an approved key cannot be paired with a foreign host or a rewritten path');
  await setAv(dave, dk);
  await fails(dave, `update public.profiles set avatar_url=$2 where id=$1`, [dave, `https://evil.example/${dk}`], notVerified);
  ok('repointing the URL of an already-approved key at another host is refused');
}

// ---- URL-only avatars (no key)
await fails(bob, `update public.profiles set avatar_url=$2 where id=$1`, [bob, 'https://res.cloudinary.com/attacker/a.jpg'], notVerified);
await fails(bob, `update public.profiles set avatar_url=$2 where id=$1`, [bob, 'https://lh3.googleusercontent.com/attacker'], notVerified);
await fails(bob, `update public.profiles set avatar_url=$2 where id=$1`, [bob, 'https://picsum.photos/200'], notVerified);
ok('a NEW URL-only avatar (Cloudinary, Google, picsum) is refused by an update while enforced');

// ---- a business key / another slot / another user never authorises an avatar
{
  const bizKey = `business/${carol}/logo/${uuid(20)}.jpg`;
  await scan(carol, 'logo', bizKey);
  await fails(carol, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [carol, `${host}/${bizKey}`, bizKey], /22023|own|check|valid/);
  ok('a scanned business logo key cannot be saved as an avatar');
  const av = ak(carol, 21);
  await scan(carol, 'avatar', av);
  await fails(carol, `update public.profiles set business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [carol, `${host}/${av}`, av], /22023|own|check|valid|image_not_verified/);
  ok('a scanned avatar key cannot be saved as a business logo');
  const bobKey = ak(bob, 22);
  await scan(bob, 'avatar', bobKey);
  await fails(carol, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [carol, `${host}/${bobKey}`, bobKey], /22023|own|check|valid/);
  ok("another user's scanned avatar key cannot be saved by me");
}

// ---- scan table constraints
await assert.rejects(db.query(`insert into public.business_media_scans(user_id,kind,sha256,status,public_key) values ($1,'avatar','x','approved',$2)`, [alice, `business/${alice}/logo/${uuid(30)}.jpg`]), /business_media_key_shape|check/);
await assert.rejects(db.query(`insert into public.business_media_scans(user_id,kind,sha256,status,public_key) values ($1,'logo','x','approved',$2)`, [alice, ak(alice, 31)]), /business_media_key_shape|check/);
await assert.rejects(db.query(`insert into public.business_media_scans(user_id,kind,sha256,status,public_key) values ($1,'avatar','x','approved',$2)`, [alice, ak(bob, 32)]), /business_media_key_shape|check/);
await assert.rejects(db.query(`insert into public.business_media_scans(user_id,kind,sha256,status,public_key) values ($1,'selfie','x','processing',null)`, [alice]), /kind_check|check/);
ok('scan table: an avatar row needs an avatars/{own uid}/{uuid}.jpg key; business keys fit only logo/banner; unknown kinds are refused');

// ---- grandfathering
{
  const legacy = ak(erin, 40);
  await db.query(`update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [erin, `https://old.example/${legacy}`, legacy]); // pre-0059 data, any host
  await q(erin, `update public.profiles set bio='hello' where id=$1`, [erin]);
  await q(erin, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [erin, `https://old.example/${legacy}`, legacy]);
  ok('legacy: an unrelated edit and re-saving the same avatar are not blocked');
  await q(erin, `update public.profiles set avatar_url=null, avatar_public_id=null where id=$1`, [erin]);
  ok('removing an avatar is always allowed');
  await db.query(`update public.profiles set avatar_url='https://res.cloudinary.com/legacy/a.jpg', avatar_public_id=null where id=$1`, [erin]);
  await q(erin, `update public.profiles set bio='still editable' where id=$1`, [erin]);
  await q(erin, `update public.profiles set avatar_url=null where id=$1`, [erin]);
  ok('legacy: an unchanged URL-only avatar is grandfathered and can be removed');
}

// ---- first-login profile insert (the app's fallback for the signup trigger): an external photo is never kept, and never locks the user out
{
  const ghost = uuid(900);
  await db.query(`insert into auth.users(id,email) values ($1,'ghost@test.dev')`, [ghost]);
  const avatarOf = async () => (await db.query(`select avatar_url, avatar_public_id from public.profiles where id=$1`, [ghost])).rows[0];
  for (const url of ['https://lh3.googleusercontent.com/a/photo', 'https://res.cloudinary.com/x/a.jpg']) {
    await db.query(`delete from public.profiles where id=$1`, [ghost]);
    await q(ghost, `insert into public.profiles(id, full_name, avatar_url) values ($1,'G',$2)`, [ghost, url]);
    assert.deepEqual(await avatarOf(), { avatar_url: null, avatar_public_id: null }, url);
  }
  await fails(ghost, `insert into public.profiles(id, full_name, avatar_url) values ($1,'G',$2)`, [ghost, 'https://evil.example/pixel.png'], /own uploaded photo|image_not_verified|22023/);
  ok('first-login insert: a Google / other external photo is dropped (profile created without avatar), the insert itself still succeeds');
  await db.query(`delete from public.profiles where id=$1`, [ghost]);
  const forged = ak(ghost, 901);
  await fails(ghost, `insert into public.profiles(id, full_name, avatar_url, avatar_public_id) values ($1,'G',$2,$3)`, [ghost, `${host}/${forged}`, forged], notVerified);
  await fails(ghost, `insert into public.profiles(id, full_name, avatar_url, avatar_public_id) values ($1,'G',$2,$3)`, [ghost, `https://evil.example/${forged}`, forged], notVerified);
  ok('first-login insert: a forged key (no approved scan) or a foreign host with a key is refused');
  // A scan row references the profile, so a first-login INSERT can never carry an approved key; the photo is added afterwards by an update.
  await db.query(`insert into public.profiles(id, full_name) values ($1,'G')`, [ghost]);
  const good = ak(ghost, 902);
  await scan(ghost, 'avatar', good);
  await setAv(ghost, good);
  assert.equal((await avatarOf()).avatar_public_id, good);
  ok('a new profile gets its avatar only by a later update that references an approved scan');
}

// ---- signup hardening: NO user-editable metadata can plant an avatar URL (unconditional, even with enforcement off)
{
  await setEnforce(false);
  const mk = async (n, meta) => {
    const id = uuid(n);
    await db.query(`insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)`, [id, `s${n}@test.dev`, JSON.stringify(meta)]);
    return (await db.query(`select avatar_url, avatar_public_id, full_name from public.profiles where id=$1`, [id])).rows[0];
  };
  for (const [n, meta] of [
    [901, { picture: 'https://lh3.googleusercontent.com/a/me' }],
    [902, { avatar_url: 'https://lh3.googleusercontent.com/a/me2' }],
    [903, { avatar_url: 'https://evil.example/tracker.png' }],
    [904, { picture: 'http://lh3.googleusercontent.com/a/x' }],
    [905, { picture: 'https://lh3.googleusercontent.com.evil.io/a' }],
    [906, { full_name: 'No Photo' }],
    [907, { avatar_url: `${host}/avatars/${uuid(907)}/${uuid(1)}.jpg`, avatar_public_id: `avatars/${uuid(907)}/${uuid(1)}.jpg` }],
  ]) {
    const r = await mk(n, meta);
    assert.deepEqual([r.avatar_url, r.avatar_public_id], [null, null], JSON.stringify(meta));
  }
  assert.equal((await mk(908, { full_name: 'Keeps Name' })).full_name, 'Keeps Name');
  ok('signup: no avatar is ever copied from user metadata (Google photo, other host, http, look-alike host, even a managed-host URL); the name still is');
  await setEnforce(true);
}

// ---- non-client writers are untouched
await db.query(`update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [bob, `${host}/${ak(bob, 50)}`, ak(bob, 50)]);
ok('non-client writers (service role / definer RPCs / operator SQL) are not subject to the avatar check');

// ---- rollback restores the 0057 behaviour and leaves avatars alone
{
  const dir = new URL('../', import.meta.url);
  const before = (await db.query(`select id, avatar_url, avatar_public_id from public.profiles order by id`)).rows;
  await db.exec(readFileSync(new URL('rollback/0059_avatar_media_scans_ROLLBACK.sql', dir), 'utf8'));
  assert.deepEqual((await db.query(`select id, avatar_url, avatar_public_id from public.profiles order by id`)).rows, before);
  const loose = ak(carol, 60);
  await fails(carol, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [carol, `https://anything.example/${loose}`, loose], notVerified);
  await fails(carol, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [carol, `${host}/${loose}`, loose], notVerified);
  await fails(carol, `update public.profiles set avatar_url=$2, avatar_public_id=null where id=$1`, [carol, 'https://lh3.googleusercontent.com/a/me'], notVerified);
  await db.query(`update public.business_media_config set enforce = false`);
  await fails(carol, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [carol, `https://anything.example/${loose}`, loose], notVerified);
  await db.query(`update public.business_media_config set enforce = true`);
  const bk = `business/${carol}/logo/${uuid(61)}.jpg`;
  await fails(carol, `update public.profiles set business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [carol, `${host}/${bk}`, bk], notVerified);
  ok('rollback: avatars are untouched, and a NEW avatar is still refused at the DATABASE level (freeze: foreign host, managed host, Google URL) even with enforcement switched off; business slots are still scan-checked');
  await db.exec(readFileSync(new URL('migrations/0059_avatar_media_scans.sql', dir), 'utf8'));
  const afterRb = uuid(950);
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values ($1,'rb@test.dev',$2)`, [afterRb, JSON.stringify({ picture: 'https://evil.example/x.png' })]);
  assert.equal((await db.query(`select avatar_url from public.profiles where id=$1`, [afterRb])).rows[0].avatar_url, null);
  await fails(alice, `update public.profiles set avatar_url=$2, avatar_public_id=$3 where id=$1`, [alice, `${host}/${ak(alice, 62)}`, ak(alice, 62)], notVerified);
  ok('re-applying 0059 after a rollback works and enforces again');
}

console.log('avatar_media: all assertions passed');
