import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, decideUpdate, isOfficialStoreUrl, parsePolicyRow, parseVersion, pickMessage, resolveStoreUrl, UpdatePolicy } from '../lib/appUpdate';

const policy = (over: Partial<UpdatePolicy> = {}): UpdatePolicy => ({
  platform: 'ios', enabled: true, recommendedVersion: null, minimumVersion: '1.1.0', storeUrl: null, message: {}, ...over,
});

test('equal, older and newer versions', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0', '1.1.0'), -1);
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
});

test('components compare numerically, not as strings (1.9.0 < 1.10.0)', () => {
  assert.equal(compareVersions('1.9.0', '1.10.0'), -1);
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('1.0.9', '1.0.10'), -1);
  assert.equal(compareVersions('10.0.0', '9.0.0'), 1);
});

test('anything that is not strictly major.minor.patch is rejected, never guessed', () => {
  for (const bad of ['1.0', '1', '1.0.0.0', 'v1.0.0', '1.0.0-beta', '1.a.0', '', ' ', null, undefined, 1.1, {}]) {
    assert.equal(parseVersion(bad), null, String(bad));
    assert.equal(compareVersions(bad, '1.0.0'), null);
  }
  assert.deepEqual(parseVersion(' 1.2.3 '), [1, 2, 3]);
});

test('installed 1.0.0 against minimum 1.1.0 requires an update', () => {
  assert.equal(decideUpdate('1.0.0', policy()).kind, 'required');
});

test('installed at or above the minimum is fine; below the recommended version only suggests', () => {
  assert.equal(decideUpdate('1.1.0', policy()).kind, 'ok');
  assert.equal(decideUpdate('1.10.0', policy({ minimumVersion: '1.9.0' })).kind, 'ok');
  assert.equal(decideUpdate('1.9.0', policy({ minimumVersion: '1.10.0' })).kind, 'required');
  assert.deepEqual(decideUpdate('1.1.0', policy({ recommendedVersion: '1.2.0' })), { kind: 'recommended', recommendedVersion: '1.2.0' });
});

test('a disabled policy never blocks, even with a high minimum', () => {
  assert.equal(decideUpdate('1.0.0', policy({ enabled: false, minimumVersion: '9.0.0' })).kind, 'ok');
});

test('no policy or an unreadable installed version is "unverified", not "ok"', () => {
  assert.deepEqual(decideUpdate('1.0.0', null), { kind: 'unverified', reason: 'no-policy' });
  assert.deepEqual(decideUpdate(null, policy()), { kind: 'unverified', reason: 'bad-installed-version' });
  assert.deepEqual(decideUpdate('garbage', policy()), { kind: 'unverified', reason: 'bad-installed-version' });
});

test('iOS and Android policies are independent', () => {
  const ios = policy({ platform: 'ios', minimumVersion: '1.1.0' });
  const android = policy({ platform: 'android', minimumVersion: '1.0.0' });
  assert.equal(decideUpdate('1.0.0', ios).kind, 'required');
  assert.equal(decideUpdate('1.0.0', android).kind, 'ok');
  // a row for the other platform is not accepted as this platform's policy
  const row = { platform: 'android', enabled: true, recommended_version: null, minimum_version: '5.0.0', store_url: null, message: {} };
  assert.equal(parsePolicyRow(row, 'ios'), null);
  assert.equal(parsePolicyRow(row, 'android')?.minimumVersion, '5.0.0');
});

test('malformed rows are rejected', () => {
  const good = { platform: 'ios', enabled: true, recommended_version: '1.2.0', minimum_version: '1.1.0', store_url: 'https://apps.apple.com/app/id123456789', message: { en: 'Please update' } };
  assert.ok(parsePolicyRow(good, 'ios'));
  for (const bad of [
    null, 'x', 42, [], {},
    { ...good, enabled: 'yes' },
    { ...good, enabled: null },
    { ...good, minimum_version: '1.1' },
    { ...good, minimum_version: null },
    { ...good, minimum_version: '99999999999.0.0' },
    { ...good, recommended_version: 'latest' },
    { ...good, store_url: 'https://evil.example.com/app' },
    { ...good, store_url: 'javascript:alert(1)' },
    { ...good, store_url: 'https://apps.apple.com.evil.com/x' },
  ]) {
    assert.equal(parsePolicyRow(bad, 'ios'), null, JSON.stringify(bad));
  }
});

test('message overrides keep only short non-empty strings and ignore bad shapes', () => {
  const base = { platform: 'ios', enabled: true, recommended_version: null, minimum_version: '1.1.0', store_url: null };
  assert.deepEqual(parsePolicyRow({ ...base, message: { en: ' Hi ', so: '', am: 3, x: 'y'.repeat(501) } }, 'ios')?.message, { en: 'Hi' });
  assert.deepEqual(parsePolicyRow({ ...base, message: ['a'] }, 'ios')?.message, {});
  assert.deepEqual(parsePolicyRow({ ...base, message: null }, 'ios')?.message, {});
  assert.equal(pickMessage({ en: 'E', so: 'S' }, 'so'), 'S');
  assert.equal(pickMessage({ en: 'E' }, 'am'), 'E');
  assert.equal(pickMessage({}, 'en'), null);
});

test('only the platform own official store can be opened', () => {
  assert.ok(isOfficialStoreUrl('ios', 'https://apps.apple.com/us/app/suuqiye/id123456789'));
  assert.ok(isOfficialStoreUrl('ios', 'itms-apps://apps.apple.com/app/id123456789'));
  assert.ok(isOfficialStoreUrl('android', 'https://play.google.com/store/apps/details?id=suuqiye.com'));
  assert.ok(isOfficialStoreUrl('android', 'market://details?id=suuqiye.com'));
  assert.equal(isOfficialStoreUrl('ios', 'https://play.google.com/store/apps/details?id=suuqiye.com'), false);
  assert.equal(isOfficialStoreUrl('android', 'https://apps.apple.com/app/id1'), false);
  assert.equal(isOfficialStoreUrl('android', 'http://play.google.com/store'), false);
  assert.equal(isOfficialStoreUrl('ios', 'https://apps.apple.com@evil.com/'), false);
  assert.equal(isOfficialStoreUrl('ios', undefined), false);
});

test('store URL resolution falls back safely', () => {
  assert.equal(resolveStoreUrl('android', null), 'https://play.google.com/store/apps/details?id=suuqiye.com');
  assert.equal(resolveStoreUrl('ios', 'https://evil.example.com'), 'https://apps.apple.com/');
  assert.equal(resolveStoreUrl('ios', 'https://apps.apple.com/app/id1'), 'https://apps.apple.com/app/id1');
});
