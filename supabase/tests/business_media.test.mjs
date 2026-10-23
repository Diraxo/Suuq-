// 0057 — business media scans. Real Postgres (PGlite), full chain 0001..0057.
// Proves: (A) the shipped state is an EXPLICIT enforce=false row (direct-upload policy, owner decision 2026-10-21) under which the scan
// triggers are inert and only 0056 applies; a missing row / NULL / the column default all read as ENFORCED (fail closed); (B) once an
// operator sets enforce=true, a CLIENT cannot save a new logo/banner key (profile or storefront) unless the scanner approved that exact
// key for that user and slot; legacy keys stay editable; non-client writers are untouched; clients cannot read or write the scan table
// or flip the flag.
// Not proven here: the Worker, R2, Vision, PostgREST.
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, uuid } from './harness/db.mjs';

const { db } = await boot();
const { q, fails } = actors(db);
const [alice, bob, carol, dave, erin] = await seedUsers(db, 5);
const host = 'https://media.test';
await db.query(`insert into public.storefront_media_hosts(host) values ('media.test') on conflict do nothing`); // 0054's managed-host allowlist (starts empty)
const k = (uid, kind, n) => `business/${uid}/${kind}/${uuid(n)}.jpg`;
const setLogo = (uid, key) => q(uid, `update public.profiles set business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [uid, `${host}/${key}`, key]);
const setBanner = (uid, key) => q(uid, `update public.profiles set business_banner_url=$2, business_banner_public_id=$3 where id=$1`, [uid, `${host}/${key}`, key]);
const notVerified = /image_not_verified|has not been checked/;
// The service role (Worker) writes scan rows; a superuser query is the stand-in here.
const scan = (uid, kind, key, status = 'approved') =>
  db.query(`insert into public.business_media_scans(user_id, kind, sha256, status, public_key) values ($1,$2,'sha',$3,$4)`, [uid, kind, status, status === 'approved' ? key : null]);

// ---- A. SHIPPED STATE: explicit OFF (direct-upload policy). OFF is visible and intentional; everything else fails closed.
const cfg = async () => (await db.query(`select id, enforce from public.business_media_config`)).rows;
const enforced = async () => (await db.query(`select public.business_media_enforced() e`)).rows[0].e;
assert.deepEqual(await cfg(), [{ id: true, enforce: false }]);
assert.equal(await enforced(), false);
ok('applying 0057 seeds ONE explicit row with enforce=false (OFF is a stated operator position, not an accident)');
{
  const dflt = await db.query(`select column_default d, is_nullable n from information_schema.columns where table_schema='public' and table_name='business_media_config' and column_name='enforce'`);
  assert.deepEqual([dflt.rows[0].d, dflt.rows[0].n], ['true', 'NO']);
  ok('the column default is TRUE and the column is NOT NULL: a row inserted without an explicit value is ENFORCED');
}
{
  const free = k(alice, 'logo', 1);
  await setLogo(alice, free);
  await q(alice, `update public.profiles set business_logo_url=null, business_logo_public_id=null where id=$1`, [alice]);
  ok('OFF: a client can save a managed-host logo with NO scan row (direct upload works; the 0056 rules still apply)');
  await fails(alice, `update public.profiles set business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [alice, `${host}/${k(bob, 'logo', 2)}`, k(bob, 'logo', 2)], /22023|own/);
  await fails(alice, `update public.profiles set business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [alice, `${host}/${k(alice, 'banner', 3)}`, k(alice, 'banner', 3)], /22023|own/);
  await fails(alice, `update public.profiles set business_logo_url=$2 where id=$1`, [alice, 'http://insecure.example/logo.jpg'], /22023|own/);
  ok("OFF: the 0056 guard still refuses another user's key, a key of the wrong slot and a non-https URL");
  // Formerly the KNOWN GAP "an own-key logo is accepted on ANY https host". Closed by 0062 (host pin, independent of enforcement): this
  // assertion was flipped on purpose. The full matrix is in profile_media_host_pin.test.mjs.
  const gap = k(alice, 'logo', 4);
  await fails(alice, `update public.profiles set business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [alice, `https://evil.example/${gap}`, gap], /image_host_not_allowed|address is not allowed/);
  ok('OFF: an own-key logo on a host that is not in storefront_media_hosts is refused (0062 host pin)');
}
await q(carol, `insert into public.storefronts(owner_id, name) values ($1,'Off Store')`, [carol]);
await q(carol, `update public.storefronts set logo_url=$2, logo_public_id=$3 where owner_id=$1`, [carol, `${host}/${k(carol, 'logo', 5)}`, k(carol, 'logo', 5)]);
await q(carol, `update public.storefronts set logo_url=null, logo_public_id=null where owner_id=$1`, [carol]);
ok('OFF: a storefront logo with no scan row is accepted too (0054 still validates the host/key shape)');
await db.query(`delete from public.storefronts where owner_id=$1`, [carol]);

const unscanned = k(alice, 'logo', 6);
const tryUnscanned = () => fails(alice, `update public.profiles set business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [alice, `${host}/${unscanned}`, unscanned], notVerified);
{
  // missing row => ENFORCED
  await db.query(`delete from public.business_media_config`);
  assert.equal(await enforced(), true);
  await tryUnscanned();
  ok('FAIL CLOSED: a MISSING config row is read as ENFORCED and an unscanned logo is refused');
  // row inserted without a value => column default TRUE => ENFORCED
  await db.query(`insert into public.business_media_config (id) values (true)`);
  assert.deepEqual(await cfg(), [{ id: true, enforce: true }]);
  await tryUnscanned();
  ok('FAIL CLOSED: a row created without an explicit value is ENFORCED');
  // NULL => ENFORCED (the NOT NULL constraint is the first defence; the function is the second)
  await assert.rejects(db.query(`update public.business_media_config set enforce = null`), /null value|not-null|23502/i);
  await db.exec(`alter table public.business_media_config alter column enforce drop not null`);
  await db.query(`update public.business_media_config set enforce = null`);
  assert.equal(await enforced(), true);
  await tryUnscanned();
  await db.query(`update public.business_media_config set enforce = true`);
  await db.exec(`alter table public.business_media_config alter column enforce set not null`);
  ok('FAIL CLOSED: a NULL enforce value (constraint removed by an operator) is read as ENFORCED, never as off');
  // the explicit statement is what turns it off
  await db.query(`update public.business_media_config set enforce = false`);
  assert.equal(await enforced(), false);
  await setLogo(alice, unscanned);
  await q(alice, `update public.profiles set business_logo_url=null, business_logo_public_id=null where id=$1`, [alice]);
  ok('only an explicit enforce=false turns the check off');
}

// ---- B. ENFORCED: the operator turns it on (what happens when the Worker, hosts and scan URL are live). Everything below runs ON.
await db.query(`update public.business_media_config set enforce = true`);
assert.equal(await enforced(), true);
const off = k(alice, 'logo', 7);
await fails(alice, `update public.profiles set business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [alice, `${host}/${off}`, off], notVerified);
ok('enforced: an unscanned logo key is refused');

// ---- profile: scanned vs unscanned
const logo = k(alice, 'logo', 2);
await fails(alice, `update public.profiles set business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [alice, `${host}/${logo}`, logo], notVerified);
ok('enforced: a logo key with no scan row is refused');
await scan(alice, 'logo', logo);
await setLogo(alice, logo);
ok('enforced: the same key is accepted once the scanner approved it');

const banner = k(alice, 'banner', 3);
await scan(alice, 'logo', banner.replace('/banner/', '/logo/')); // approved as a LOGO, different key
await fails(alice, `update public.profiles set business_banner_url=$2, business_banner_public_id=$3 where id=$1`, [alice, `${host}/${banner}`, banner], notVerified);
ok('a banner key the scanner never approved is refused');

// approved in the wrong slot / for another user / not approved
const asLogoOnly = k(alice, 'logo', 4);
await scan(alice, 'logo', asLogoOnly);
await fails(alice, `update public.profiles set business_banner_url=$2, business_banner_public_id=$3 where id=$1`, [alice, `${host}/${asLogoOnly}`, asLogoOnly], /22023|valid|own|check/);
ok('a scanned logo cannot be re-used in the banner slot');

const rejectedKey = k(alice, 'logo', 5);
await scan(alice, 'logo', rejectedKey, 'rejected');
await fails(alice, `update public.profiles set business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [alice, `${host}/${rejectedKey}`, rejectedKey], notVerified);
for (const st of ['held', 'unavailable', 'processing']) {
  await scan(alice, 'logo', null, st);
}
ok('rejected / held / unavailable / processing scans never authorise a key (they carry no key at all)');

// another user's approved key: key shape already forbids it (0056); the scan check refuses even if the shape matched
const bobKey = k(bob, 'logo', 6);
await scan(bob, 'logo', bobKey);
await fails(alice, `update public.profiles set business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [alice, `${host}/${bobKey}`, bobKey], /22023|own/);
ok("another user's scanned key cannot be saved by me");

// db constraints on the scan table
await assert.rejects(db.query(`insert into public.business_media_scans(user_id,kind,sha256,status,public_key) values ($1,'logo','x','approved',null)`, [alice]), /business_media_approved_has_key|check/);
await assert.rejects(db.query(`insert into public.business_media_scans(user_id,kind,sha256,status,public_key) values ($1,'logo','x','rejected',$2)`, [alice, k(alice, 'logo', 7)]), /business_media_approved_has_key|check/);
await assert.rejects(db.query(`insert into public.business_media_scans(user_id,kind,sha256,status,public_key) values ($1,'logo','x','approved',$2)`, [alice, k(alice, 'banner', 8)]), /business_media_key_shape|check/);
await assert.rejects(db.query(`insert into public.business_media_scans(user_id,kind,sha256,status,public_key) values ($1,'logo','x','approved',$2)`, [alice, k(bob, 'logo', 9)]), /business_media_key_shape|check/);
await assert.rejects(db.query(`insert into public.business_media_scans(user_id,kind,sha256,status,public_key) values ($1,'logo','x','approved',$2)`, [alice, logo]), /business_media_scans_public_key_uq|duplicate|unique/);
ok('scan table: approved ⇔ has a key; the key must match its user and kind; a key can be approved only once');

// ---- grandfathering
const legacy = k(carol, 'logo', 10);
await db.query(`update public.profiles set business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [carol, `${host}/${legacy}`, legacy]); // written by a non-client (pre-0057 data)
await q(carol, `update public.profiles set bio='hello' where id=$1`, [carol]);
await setLogo(carol, legacy);
ok('legacy: an unrelated edit and re-saving the same legacy key are not blocked');
await q(carol, `update public.profiles set business_logo_url=null, business_logo_public_id=null where id=$1`, [carol]);
ok('removing an image is always allowed');

await q(carol, `insert into public.storefronts(owner_id, name) values ($1,'Carol Store')`, [carol]);
await fails(carol, `update public.storefronts set logo_url=$2, logo_public_id=$3 where owner_id=$1`, [carol, `${host}/${k(carol, 'logo', 11)}`, k(carol, 'logo', 11)], notVerified);
ok('storefront: a new unscanned logo key is refused');
const sfKey = k(carol, 'logo', 12);
await scan(carol, 'logo', sfKey);
await q(carol, `update public.storefronts set logo_url=$2, logo_public_id=$3 where owner_id=$1`, [carol, `${host}/${sfKey}`, sfKey]);
const sfBanner = k(carol, 'banner', 13);
await fails(carol, `update public.storefronts set banner_url=$2, banner_public_id=$3 where owner_id=$1`, [carol, `${host}/${sfBanner}`, sfBanner], notVerified);
await scan(carol, 'banner', sfBanner);
await q(carol, `update public.storefronts set banner_url=$2, banner_public_id=$3 where owner_id=$1`, [carol, `${host}/${sfBanner}`, sfBanner]);
ok('storefront: scanned logo and banner keys are accepted');
const sfRow = (await db.query(`select logo_public_id from public.storefronts where owner_id=$1`, [carol])).rows[0];
assert.equal(sfRow.logo_public_id, sfKey);

// ---- URL bypasses (profile): the scan binds the KEY, so the URL must be pinned too (found in the 2026-10-19 completion audit)
{
  const dk = k(dave, 'logo', 20);
  await scan(dave, 'logo', dk);
  await fails(dave, `update public.profiles set business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [dave, `https://evil.example/${dk}`, dk], notVerified);
  await fails(dave, `update public.profiles set business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [dave, `https://res.cloudinary.com/attacker/${dk}`, dk], notVerified);
  ok('profile: an approved key cannot be paired with a URL on a host that is not a managed media host');
  await fails(dave, `update public.profiles set business_logo_url=$2, business_logo_public_id=null where id=$1`, [dave, 'https://res.cloudinary.com/attacker/logo.jpg'], notVerified);
  await fails(dave, `update public.profiles set business_banner_url=$2, business_banner_public_id=null where id=$1`, [dave, 'https://lh3.googleusercontent.com/attacker-banner'], notVerified);
  ok('profile: a NEW URL-only logo/banner (third-party host, no scan) is refused while enforced');
  await setLogo(dave, dk);
  // after the approved save, repointing only the URL (key unchanged) must also be refused
  await fails(dave, `update public.profiles set business_logo_url=$2 where id=$1`, [dave, `https://evil.example/${dk}`], /image_not_verified|has not been checked|own uploaded image/);
  ok('profile: repointing the URL of an already-approved key at another host is refused');
  const bk = k(dave, 'banner', 21);
  await scan(dave, 'banner', bk);
  await fails(dave, `update public.profiles set business_banner_url=$2, business_banner_public_id=$3 where id=$1`, [dave, `https://evil.example/${bk}`, bk], notVerified);
  await setBanner(dave, bk);
  ok('profile: the same URL pinning applies to banners');
  // a legacy URL-only value (written before 0057) is grandfathered while unchanged
  await db.query(`update public.profiles set business_logo_url=$2 where id=$1`, [erin, 'https://res.cloudinary.com/legacy/logo.jpg']);
  await q(erin, `update public.profiles set bio='still editable' where id=$1`, [erin]);
  await q(erin, `update public.profiles set business_logo_url=null where id=$1`, [erin]);
  ok('profile: an unchanged legacy URL-only value is grandfathered, and can still be removed');
}

// ---- non-client writers are untouched (mirror RPCs, backfills, operator SQL)
await db.query(`update public.profiles set business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [bob, `${host}/${k(bob, 'logo', 14)}`, k(bob, 'logo', 14)]);
ok('non-client writers (service role / definer RPCs / operator SQL) are not subject to the scan check');

// ---- the scan table is closed to clients
await fails(alice, `select * from public.business_media_scans`, [], /permission denied|row-level|42501/).catch(async () => {
  const rows = (await q(alice, `select * from public.business_media_scans`)).rows;
  assert.equal(rows.length, 0, 'RLS hides every row from a normal user');
});
await fails(alice, `insert into public.business_media_scans(user_id,kind,sha256,status,public_key) values ($1,'logo','x','approved',$2)`, [alice, k(alice, 'logo', 15)], /permission denied|row-level|42501/);
await fails(alice, `update public.business_media_scans set status='approved'`, [], /permission denied|row-level|42501/);
await fails(alice, `update public.business_media_config set enforce = false`, [], /permission denied|row-level|42501/);
await fails(alice, `delete from public.business_media_config`, [], /permission denied|row-level|42501/);
await fails(alice, `insert into public.business_media_config(id, enforce) values (true, false) on conflict (id) do update set enforce = false`, [], /permission denied|row-level|42501/);
await fails(null, `update public.business_media_config set enforce = false`, [], /permission denied|row-level|42501/);
assert.equal(await enforced(), true);
ok('clients (signed-in or anon) can neither read nor write scan rows, nor flip, delete or re-insert the enforcement flag');

// ---- account deletion: scan rows go with the profile
await db.query(`delete from auth.users where id=$1`, [bob]).catch(() => {});
const left = (await db.query(`select count(*)::int n from public.business_media_scans where user_id=$1`, [bob])).rows[0].n;
assert.equal(left, 0);
ok('deleting the account removes its scan rows (cascade)');

// ---- rollback on disposable data: the script restores pre-0057 behaviour and leaves business data alone; re-applying 0057 works
{
  const { readFileSync } = await import('node:fs');
  const dir = new URL('../', import.meta.url);
  const before = (await db.query(`select id, business_logo_public_id from public.profiles order by id`)).rows;
  const sfBefore = (await db.query(`select owner_id, logo_public_id from public.storefronts order by owner_id`)).rows;
  // 0059 (avatars) goes first: it extends 0057's trigger function and key checks.
  await db.exec(readFileSync(new URL('rollback/0059_avatar_media_scans_ROLLBACK.sql', dir), 'utf8'));
  // 0058 (backfill) references the scan table, so it must be rolled back first: 0057 cannot be dropped underneath it.
  await assert.rejects(db.exec(readFileSync(new URL('rollback/0057_business_media_scans_ROLLBACK.sql', dir), 'utf8')), /depend|business_media_backfill/i);
  ok('rollback order is enforced by the database: 0057 cannot be rolled back while 0058 is applied');
  await db.exec(readFileSync(new URL('rollback/0058_business_media_backfill_ROLLBACK.sql', dir), 'utf8'));
  await db.exec(readFileSync(new URL('rollback/0057_business_media_scans_ROLLBACK.sql', dir), 'utf8'));
  const gone = (await db.query(`select to_regclass('public.business_media_scans') s, to_regclass('public.business_media_config') c,
    (select count(*)::int from pg_proc where proname in ('_bm_key_ok','_bm_url_ok','_bm_check_slot','_bm_check_avatar','business_media_enforced','trg_profile_business_media_scan','trg_storefront_business_media_scan')) f,
    (select count(*)::int from pg_trigger where tgname in ('profiles_c_business_media_scan','storefronts_c_business_media_scan')) t`)).rows[0];
  assert.deepEqual([gone.s, gone.c, gone.f, gone.t], [null, null, 0, 2]);   // scan objects gone; the two FREEZE triggers replace the scan triggers
  assert.deepEqual((await db.query(`select id, business_logo_public_id from public.profiles order by id`)).rows, before);
  assert.deepEqual((await db.query(`select owner_id, logo_public_id from public.storefronts order by owner_id`)).rows, sfBefore);
  const loose = k(alice, 'logo', 30);
  await fails(alice, `update public.profiles set business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [alice, `${host}/${loose}`, loose], notVerified);
  await fails(alice, `update public.profiles set business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [alice, `https://evil.example/${loose}`, loose], notVerified);
  ok('rollback: no business image is changed or deleted, and an unscanned key is STILL refused (freeze), not accepted as under the 0056 rules');
  await db.exec(readFileSync(new URL('migrations/0057_business_media_scans.sql', dir), 'utf8'));
  await db.exec(readFileSync(new URL('migrations/0058_business_media_backfill.sql', dir), 'utf8'));
  await db.exec(readFileSync(new URL('migrations/0059_avatar_media_scans.sql', dir), 'utf8'));
  assert.deepEqual(await cfg(), [{ id: true, enforce: false }]); // the dropped table is re-created: the seeded row is the explicit OFF again
  await db.query(`update public.business_media_config set enforce = true`);
  await db.query(`update public.profiles set business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [alice, `${host}/${loose}`, loose]); // operator write (non-client)
  await setLogo(alice, loose); // grandfathered: alice now holds this key
  const fresh = k(alice, 'logo', 31);
  await fails(alice, `update public.profiles set business_logo_url=$2, business_logo_public_id=$3 where id=$1`, [alice, `${host}/${fresh}`, fresh], notVerified);
  ok('re-applying 0057 after a rollback replaces the freeze with the real scan check: seeded OFF again, then (operator ON) held key kept, a new unscanned one refused');
}

console.log('business_media: all assertions passed');
