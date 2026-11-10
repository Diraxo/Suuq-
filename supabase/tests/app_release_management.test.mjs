// 0090 — app release management, on a REAL Postgres (PGlite) with the real migration chain.
// Proves: constraints (critical => mandatory, store link on publish, versions, changelog shape), RLS (drafts/expired invisible, anon reads active,
// nobody but the operator writes), platform isolation, dismissal privacy + uniqueness, the shipped example SQL, and rollback keeping 0078 intact.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, actors, seedUsers, ok } from './harness/db.mjs';

const { db, applied } = await boot();
assert.ok(applied.includes('0090_app_release_management.sql'));
const { q, fails } = actors(db);
const [alice, bob] = await seedUsers(db, 2);

const PLAY = 'https://play.google.com/store/apps/details?id=suuqiye.com';
const APPSTORE = 'https://apps.apple.com/app/id123456789';
const reset = async () => {
  await db.exec(`update public.app_update_policy set current_release_id=null, enabled=false, recommended_version=null, minimum_version='1.0.0', reminder_interval_hours=null, support_url=null`);
  await db.exec(`delete from public.app_update_dismissals; delete from public.app_releases`);
};
const insertRelease = (cols, vals) => db.query(`insert into public.app_releases (${cols}) values (${vals}) returning id`);
const BASE = `platform, version, release_type, title, description, target_version`;

// ── existing 0078 behaviour is untouched ──
assert.deepEqual((await q(null, `select platform, enabled, minimum_version from public.app_update_policy order by platform`)).rows.map((r) => [r.platform, r.enabled, r.minimum_version]), [['android', false, '1.0.0'], ['ios', false, '1.0.0']]);
assert.deepEqual((await q(null, `select reminder_interval_hours, first_reminder_delay_hours, show_whats_new, current_release_id from public.app_update_policy where platform='ios'`)).rows[0], { reminder_interval_hours: null, first_reminder_delay_hours: 0, show_whats_new: true, current_release_id: null });
ok('0078 rows survive, new policy columns default safely (disabled, no release, type-default interval)');

// ── release constraints ──
const bad = async (label, sql, re = /check constraint|violates|invalid input/i) => assert.rejects(() => db.exec(sql), re, label);
const ins = (cols, vals) => `insert into public.app_releases (${cols}) values (${vals})`;
await bad('critical must be mandatory', ins(`${BASE}, mandatory, android_store_url`, `'android','1.3.0','critical','Security','A critical security or compatibility update is required.','1.3.0', false, '${PLAY}'`));
await bad('mandatory needs a meaningful reason', ins(`${BASE}, mandatory`, `'android','1.3.0','important','Title','too short','1.3.0', true`));
await bad('unknown release type', ins(BASE, `'android','1.3.0','urgent','T','D','1.3.0'`));
await bad('unknown platform', ins(BASE, `'windows','1.3.0','normal','T','D','1.3.0'`));
await bad('non-semver version', ins(BASE, `'android','1.3','normal','T','D','1.3.0'`));
await bad('non-semver target', ins(BASE, `'android','1.3.0','normal','T','D','latest'`));
await bad('empty title', ins(BASE, `'android','1.3.0','normal','  ','D','1.3.0'`));
await bad('minimum above target', ins(`${BASE}, minimum_supported_version`, `'android','1.3.0','normal','T','D','1.3.0','1.4.0'`));
await bad('published without a store link', ins(`${BASE}, published`, `'android','1.3.0','normal','T','D','1.3.0', true`));
await bad('published ios release with only an android link', ins(`${BASE}, published, android_store_url`, `'ios','1.3.0','normal','T','D','1.3.0', true, '${PLAY}'`));
await bad("published 'all' release needs both links", ins(`${BASE}, published, android_store_url`, `'all','1.3.0','normal','T','D','1.3.0', true, '${PLAY}'`));
await bad('non-official android store url', ins(`${BASE}, android_store_url`, `'android','1.3.0','normal','T','D','1.3.0','https://evil.example.com/app'`));
await bad('ios url in the android column', ins(`${BASE}, android_store_url`, `'android','1.3.0','normal','T','D','1.3.0','${APPSTORE}'`));
await bad('javascript: support url', ins(`${BASE}, support_url`, `'android','1.3.0','normal','T','D','1.3.0','javascript:alert(1)'`));
await bad('changelog must be an object with an items array', ins(`${BASE}, changelog`, `'android','1.3.0','normal','T','D','1.3.0','[]'::jsonb`));
await bad('changelog items must be an array', ins(`${BASE}, changelog`, `'android','1.3.0','normal','T','D','1.3.0','{"items":"x"}'::jsonb`));
await bad('translations must be an object', ins(`${BASE}, translations`, `'android','1.3.0','normal','T','D','1.3.0','[]'::jsonb`));
await bad('expiry must follow publication', ins(`${BASE}, published, published_at, expires_at, android_store_url`, `'android','1.3.0','normal','T','D','1.3.0', true, now(), now() - interval '1 day', '${PLAY}'`));
ok('invalid types, versions, links, changelog shapes and contradictory mandatory/critical rows are rejected');

// ── RLS: operator-only writes; drafts and expired releases invisible; anon reads active ──
await reset();
const pub = (await insertRelease(`${BASE}, published, android_store_url`, `'android','1.1.0','normal','Fixes','Performance improvements and bug fixes.','1.1.0', true, '${PLAY}'`)).rows[0].id;
const draft = (await insertRelease(BASE, `'android','1.2.0','normal','Draft','Not published yet.','1.2.0'`)).rows[0].id;
const expired = (await insertRelease(`${BASE}, published, published_at, expires_at, android_store_url`, `'android','1.0.5','normal','Old','Expired announcement.','1.0.5', true, now() - interval '10 days', now() - interval '1 day', '${PLAY}'`)).rows[0].id;
const visible = async (who) => (await q(who, `select id from public.app_releases`)).rows.map((r) => r.id).sort();
assert.deepEqual(await visible(null), [pub]);
assert.deepEqual(await visible(alice), [pub]);
assert.equal((await db.query(`select published_at is not null as p from public.app_releases where id=$1`, [pub])).rows[0].p, true, 'publishing stamps published_at');
for (const who of [null, alice]) {
  await fails(who, `insert into public.app_releases (${BASE}) values ('android','9.9.9','normal','T','D','9.9.9')`, [], /permission denied|row-level/i);
  await fails(who, `update public.app_releases set title='x'`, [], /permission denied|row-level/i);
  await fails(who, `delete from public.app_releases`, [], /permission denied|row-level/i);
}
ok('anon and signed-in users see only published, unexpired releases and cannot write');

// ── policy linkage: platform isolation ──
await db.exec(`update public.app_update_policy set current_release_id='${pub}' where platform='android'`);
await assert.rejects(() => db.exec(`update public.app_update_policy set current_release_id='${pub}' where platform='ios'`), /targets android/i);
const allRel = (await insertRelease(`${BASE}, published, android_store_url, ios_store_url`, `'all','1.4.0','normal','Both','Applies to both platforms.','1.4.0', true, '${PLAY}', '${APPSTORE}'`)).rows[0].id;
await db.exec(`update public.app_update_policy set current_release_id='${allRel}'`);
await assert.rejects(() => db.exec(`update public.app_releases set platform='ios' where id='${allRel}'`), /linked from another platform/i);
await db.exec(`update public.app_update_policy set current_release_id=null`);
ok("a release can only be linked from its own platform (or 'all'), and cannot be re-pointed from under another platform's policy");

const embedded = (await q(null, `select p.platform, r.id as rid from public.app_update_policy p left join public.app_releases r on r.id = p.current_release_id order by p.platform`)).rows;
assert.ok(embedded.every((r) => r.rid === null));
await db.exec(`update public.app_update_policy set current_release_id='${draft}' where platform='android'`);
assert.equal((await q(null, `select r.id from public.app_update_policy p left join public.app_releases r on r.id = p.current_release_id where p.platform='android'`)).rows[0].id, null);
await db.exec(`update public.app_update_policy set current_release_id='${expired}' where platform='android'`);
assert.equal((await q(null, `select r.id from public.app_update_policy p left join public.app_releases r on r.id = p.current_release_id where p.platform='android'`)).rows[0].id, null);
ok('a policy pointing at a draft or expired release shows no release to the app (the 0078 minimum still applies)');

// ── policy constraints ──
for (const badSet of [`reminder_interval_hours=0`, `reminder_interval_hours=99999`, `first_reminder_delay_hours=-1`, `support_url='http://insecure.example.com'`, `support_url='javascript:x'`]) {
  await assert.rejects(() => db.exec(`update public.app_update_policy set ${badSet} where platform='ios'`), /check constraint|violates/i, badSet);
}
for (const who of [null, alice]) await fails(who, `update public.app_update_policy set current_release_id=null`, [], /permission denied|row-level/i);
ok('reminder intervals and support links are bounded; app users cannot change the policy');

// ── dismissals: private, one per user+release+platform, own rows only ──
await reset();
const rel = (await insertRelease(`${BASE}, published, android_store_url`, `'android','1.1.0','normal','Fixes','Performance improvements and bug fixes.','1.1.0', true, '${PLAY}'`)).rows[0].id;
const dismiss = (who, extra = '') => q(who, `insert into public.app_update_dismissals (user_id, release_id, platform, remind_after) values ($1, $2, 'android', now() + interval '3 days') ${extra}`, [who.id ?? who, rel]);
await dismiss(alice);
await fails(alice, `insert into public.app_update_dismissals (user_id, release_id, platform, remind_after) values ($1, $2, 'android', now())`, [alice.id ?? alice, rel], /duplicate|unique/i);
await dismiss(alice, `on conflict (user_id, release_id, platform) do update set remind_after = excluded.remind_after`);
assert.equal((await q(alice, `select 1 from public.app_update_dismissals`)).rows.length, 1);
assert.equal((await q(bob, `select 1 from public.app_update_dismissals`)).rows.length, 0, "another user cannot read alice's history");
assert.equal((await q(null, `select 1 from public.app_update_dismissals`).catch(() => ({ rows: [] }))).rows.length, 0);
await fails(bob, `insert into public.app_update_dismissals (user_id, release_id, platform, remind_after) values ($1, $2, 'android', now())`, [alice.id ?? alice, rel], /row-level/i);
await fails(alice, `delete from public.app_update_dismissals`, [], /permission denied|row-level/i);
await fails(alice, `insert into public.app_update_dismissals (user_id, release_id, platform, dismissed_at, remind_after) values ($1, $2, 'ios', now(), now() - interval '1 day')`, [alice.id ?? alice, rel], /check|violates|row-level/i);
ok('dismissals are private to their owner, unique per user+release+platform, upsertable, and never deletable from the app');

// ── the shipped examples run as written and do what they say ──
const examples = readFileSync(new URL('../examples/app_release_examples.sql', import.meta.url), 'utf8');
const blocks = examples.split(/-- ─+ \d\) /).slice(1);
assert.equal(blocks.length, 3);
const run = async (n) => {
  await reset();
  await db.exec(blocks[n].replace(/^[^\n]*\n/, ''));
  return (await db.query(`select p.enabled, p.reminder_interval_hours as h, p.minimum_version as m, r.release_type t, r.mandatory, r.minimum_supported_version ms, r.target_version tv from public.app_update_policy p join public.app_releases r on r.id = p.current_release_id where p.platform='android'`)).rows[0];
};
assert.deepEqual(await run(0), { enabled: true, h: 72, m: '1.0.0', t: 'normal', mandatory: false, ms: null, tv: '1.1.0' });
assert.deepEqual(await run(1), { enabled: true, h: 24, m: '1.0.0', t: 'important', mandatory: false, ms: null, tv: '1.2.0' });
assert.deepEqual(await run(2), { enabled: true, h: null, m: '1.0.0', t: 'critical', mandatory: true, ms: '1.2.0', tv: '1.3.0' });
assert.equal((await db.query(`select enabled from public.app_update_policy where platform='ios'`)).rows[0].enabled, false, 'the example never touches the other platform');
ok('the three example blocks (normal 72h, important 24h, critical mandatory min 1.2.0) execute and touch only Android');

// ── tuple helper compares numerically ──
assert.equal((await db.query(`select public.app_version_tuple('1.9.0') < public.app_version_tuple('1.10.0') as lt`)).rows[0].lt, true);
assert.equal((await db.query(`select public.app_version_tuple('1.10') is null as n`)).rows[0].n, true);
ok('version tuples compare numerically (1.9.0 < 1.10.0) and reject non-semver');

// ── rollback keeps 0078 ──
await reset();
await db.exec(readFileSync(new URL('../rollback/0090_app_release_management_ROLLBACK.sql', import.meta.url), 'utf8'));
for (const t of ['app_releases', 'app_update_dismissals']) assert.equal((await db.query(`select to_regclass('public.${t}') r`)).rows[0].r, null);
const cols = (await db.query(`select column_name from information_schema.columns where table_name='app_update_policy'`)).rows.map((r) => r.column_name).sort();
assert.deepEqual(cols, ['enabled', 'message', 'minimum_version', 'platform', 'recommended_version', 'store_url', 'updated_at']);
assert.equal((await db.query(`select count(*)::int c from public.app_update_policy`)).rows[0].c, 2);
ok('rollback removes only 0090 objects; the 0078 table, columns and rows remain');

console.log(`\nALL 10 CHECKS PASSED`);
