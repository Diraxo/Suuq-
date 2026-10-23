// 0056 — profile content guard. Real Postgres (PGlite), full chain 0001..0056.
// Proves: scheme/host/key rules on direct client writes, "only changed columns are checked" (legacy rows never block an
// unrelated edit), ownership of image keys, and that non-client (staff/service) writes are untouched.
// Not proven here: PostgREST, the real R2 host, r2-verify-images.
import assert from 'node:assert/strict';
import { boot, actors, seedUsers, ok, uuid } from './harness/db.mjs';

const { db } = await boot();
const { q, fails } = actors(db);
const [alice, bob] = await seedUsers(db, 2);
// This suite tests the 0056 content-guard layer on its own. The 0057/0059 scan layer (ON by default, fail closed) is covered by business_media / avatar_media, so it is switched off here only.
await db.query(`update public.business_media_config set enforce = false`);
// 0062 pins the host of a key-bearing image to storefront_media_hosts (empty after 0054, fail closed): the test host must be registered.
await db.query(`insert into public.storefront_media_hosts(host) values ('media.test') on conflict do nothing`);
const key = (folder, uid, n) => `${folder.replace('{uid}', uid)}/${uuid(n)}.jpg`.replace(/^(.*)$/, (m) => m);
const upd = (uid, set, params = []) => q(uid, `update public.profiles set ${set} where id='${uid}'`, params);
const bad = (uid, set, params) => fails(uid, `update public.profiles set ${set} where id='${uid}'`, params, /22023|23514|valid|own|check constraint/);

// ---- website
await upd(alice, `business_website='https://shop.example.com/a?b=1'`);
ok('a normal https website is accepted');
for (const w of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x.example.com', 'https://user:pw@x.example.com', 'https://localhost', 'https://x', 'https://a b.com']) {
  await bad(alice, `business_website=$1`, [w]);
}
ok('javascript:, data:, ftp:, credentials, single-label hosts and spaces are rejected');

// ---- social links
await upd(alice, `social_links='{"facebook":"https://www.facebook.com/shop","whatsapp":"https://wa.me/251911234567"}'::jsonb`);
ok('social links on their own network hosts are accepted');
for (const s of [
  '{"facebook":"https://evilfacebook.com/x"}', '{"facebook":"https://facebook.com.evil.io/x"}', '{"instagram":"https://facebook.com/x"}',
  '{"facebook":"http://facebook.com/x"}', '{"tiktok":"javascript:alert(1)"}', '{"myspace":"https://facebook.com/x"}', '["https://facebook.com"]', '{"facebook":5}',
]) await bad(alice, `social_links=$1::jsonb`, [s]);
ok('wrong host, look-alike host, http, scripts, unknown key, non-object, non-string are rejected');

// ---- hours
await bad(alice, `business_hours='[1]'::jsonb`);
await upd(alice, `business_hours='{"days":{"mon":{"closed":false,"open":"09:00","close":"18:00"}}}'::jsonb`);
ok('business_hours must be an object');

// ---- images: own key + matching url
const host = 'https://media.test';
const avKey = `avatars/${alice}/${uuid(901)}.jpg`;
await upd(alice, `avatar_url=$1, avatar_public_id=$2`, [`${host}/${avKey}`, avKey]);
ok('own avatar key + matching URL accepted');
await bad(alice, `avatar_url=$1, avatar_public_id=$2`, [`${host}/${avKey}`, `avatars/${bob}/${uuid(902)}.jpg`]);
await bad(alice, `avatar_url=$1, avatar_public_id=$2`, [`${host}/avatars/${bob}/${uuid(902)}.jpg`, `avatars/${bob}/${uuid(902)}.jpg`]);
await bad(alice, `avatar_url=$1, avatar_public_id=$2`, [`${host}/somewhere/else.jpg`, avKey]);
await bad(alice, `avatar_url=$1, avatar_public_id=null`, ['https://tracker.evil.example/p.gif']);
await bad(alice, `avatar_url=$1, avatar_public_id=$2`, [`http://media.test/${avKey}`, avKey]);
await bad(alice, `avatar_public_id=$1`, [`avatars/${alice}/../${bob}/${uuid(1)}.jpg`]);
ok("someone else's key, mismatched URL, foreign host without a key, http, and traversal are rejected");
// 0056 alone accepted a NEW URL-only Google avatar. 0063 closes that for updates (full matrix: profile_url_only_block.test.mjs); a legacy value
// (here written by operator SQL, as an old row would be) must still pass an unchanged re-save, and removal is always allowed.
await fails(alice, `update public.profiles set avatar_url='https://lh3.googleusercontent.com/a/xyz', avatar_public_id=null where id=$1`, [alice], /url_only_not_allowed|must be uploaded again/);
await db.query(`update public.profiles set avatar_url='https://lh3.googleusercontent.com/a/xyz', avatar_public_id=null where id=$1`, [alice]);
await upd(alice, `avatar_url='https://lh3.googleusercontent.com/a/xyz', avatar_public_id=null`);
await upd(alice, `avatar_url=null, avatar_public_id=null`);
ok('a NEW URL-only Google avatar is refused by an update (0063); an unchanged legacy one re-saves; removing the avatar (both null) always allowed');

const logo = `business/${alice}/logo/${uuid(903)}.jpg`;
const banner = `business/${alice}/banner/${uuid(904)}.jpg`;
await upd(alice, `business_logo_url=$1, business_logo_public_id=$2, business_banner_url=$3, business_banner_public_id=$4`, [`${host}/${logo}`, logo, `${host}/${banner}`, banner]);
await bad(alice, `business_logo_url=$1, business_logo_public_id=$2`, [`${host}/${banner}`, banner]); // banner key in the logo slot
await bad(alice, `business_banner_url=$1, business_banner_public_id=$2`, [`${host}/${logo}`, logo]);
await bad(alice, `business_logo_url=$1, business_logo_public_id=$2`, [`${host}/business/${bob}/logo/${uuid(905)}.jpg`, `business/${bob}/logo/${uuid(905)}.jpg`]);
ok('logo/banner: own slot only (no banner key in the logo slot, no other user\'s key)');

// ---- legacy rows never block an unrelated edit
await db.query(`update public.profiles set business_website='junk', social_links='{"x":"y"}'::jsonb, business_logo_url='https://old.example/l.png' where id=$1`, [bob]); // superuser = not a client write
await upd(bob, `bio='hello'`);
ok('a legacy row with invalid website/social/logo still accepts an unrelated edit (only changed columns are checked)');
await bad(bob, `business_website='still junk'`);
ok('...but re-writing the bad column with another bad value is rejected');

// ---- length constraints
await bad(alice, `business_description=$1`, ['d'.repeat(1001)]);
await bad(alice, `business_address=$1`, ['a'.repeat(251)]);
ok('description / address length limits enforced');

// ---- staff/service writes untouched
await db.query(`update public.profiles set business_website='whatever', avatar_url='https://x.example/a.png' where id=$1`, [alice]);
ok('non-client (staff / service role) writes bypass the guard');
console.log('profile_guard: all passed');
