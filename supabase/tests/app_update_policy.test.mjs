// 0078 — mandatory-update policy table, on a REAL Postgres (PGlite) with the real migration chain.
// Proves: ships disabled with both platforms; anon + signed-in users can only READ; nobody but the service role can write;
// bad versions / non-official store URLs are rejected by constraints; rollback drops it cleanly.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, actors, seedUsers, ok } from './harness/db.mjs';

const { db, applied } = await boot();
assert.ok(applied.includes('0078_app_update_policy.sql'));
const { q, fails } = actors(db);
const [user] = await seedUsers(db, 1);

const rows = (await q(null, `select platform, enabled, minimum_version, store_url from public.app_update_policy order by platform`)).rows;
assert.deepEqual(rows.map((r) => [r.platform, r.enabled]), [['android', false], ['ios', false]]);
assert.equal(rows[0].store_url, 'https://play.google.com/store/apps/details?id=suuqiye.com');
ok('ships with both platforms present and DISABLED, readable by anon');

assert.equal((await q(user, `select 1 from public.app_update_policy where platform='ios'`)).rows.length, 1);
ok('signed-in users can read it too');

for (const who of [null, user]) {
  await fails(who, `update public.app_update_policy set minimum_version='9.9.9'`, [], /permission denied|row-level/i);
  await fails(who, `insert into public.app_update_policy(platform, minimum_version) values ('ios','1.0.0')`, [], /permission denied|row-level|duplicate/i);
  await fails(who, `delete from public.app_update_policy`, [], /permission denied|row-level/i);
}
assert.equal((await db.query(`select minimum_version v from public.app_update_policy where platform='ios'`)).rows[0].v, '1.0.0');
ok('app users (anon and signed-in) cannot insert, update or delete');

await db.exec(`update public.app_update_policy set enabled=true, minimum_version='1.10.0', recommended_version='1.10.1', store_url='https://apps.apple.com/app/id123456789', message='{"en":"Please update","so":"Fadlan cusboonaysii"}' where platform='ios'`);
const ios = (await q(null, `select * from public.app_update_policy where platform='ios'`)).rows[0];
assert.equal(ios.minimum_version, '1.10.0');
assert.equal(ios.message.so, 'Fadlan cusboonaysii');
ok('an operator (owner/service role) can set a policy and anon sees it');

for (const bad of [
  `minimum_version='1.1'`, `minimum_version='v1.1.0'`, `minimum_version='1.1.0-beta'`, `recommended_version='latest'`,
  `store_url='https://evil.example.com/app'`, `store_url='https://apps.apple.com.evil.com/x'`, `store_url='javascript:alert(1)'`,
  `message='[]'::jsonb`, `platform='windows'`,
]) {
  await assert.rejects(() => db.exec(`update public.app_update_policy set ${bad} where platform='ios'`), /check constraint|violates/i, bad);
}
ok('malformed versions, non-official store URLs, non-object messages and unknown platforms are rejected');

await db.exec(readFileSync(new URL('../rollback/0078_app_update_policy_ROLLBACK.sql', import.meta.url), 'utf8'));
assert.equal((await db.query(`select to_regclass('public.app_update_policy') r`)).rows[0].r, null);
ok('rollback drops the table');
console.log(`\nALL ${6} CHECKS PASSED`);
