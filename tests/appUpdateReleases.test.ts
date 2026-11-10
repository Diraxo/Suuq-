import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANGELOG_ICONS, compareVersions, decideUpdate, DEFAULT_CHANGELOG_ICON, isReleaseActive, isSafeSupportUrl, localizeRelease,
  parseChangelog, parsePolicyRow, parseReleaseRow, policyToRow, resolveChangelogIcon, UpdatePolicy, UpdateRelease,
} from '../lib/appUpdate';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const PLAY = 'https://play.google.com/store/apps/details?id=suuqiye.com';
const APPSTORE = 'https://apps.apple.com/app/id123456789';

const releaseRow = (over: Record<string, unknown> = {}) => ({
  id: 'r1', platform: 'all', version: '1.2.0', version_code: null, release_type: 'important', title: 'New marketplace features',
  description: 'New marketplace features and improvements.', changelog: { items: [{ title: 'Faster images', description: 'Smoother.', icon: 'image' }] },
  translations: {}, mandatory: false, minimum_supported_version: null, target_version: '1.2.0', android_store_url: PLAY, ios_store_url: APPSTORE,
  support_url: 'mailto:support@suuqiye.com', published: true, expires_at: null, ...over,
});
const policyRow = (platform: 'ios' | 'android', over: Record<string, unknown> = {}) => ({
  platform, enabled: true, recommended_version: null, minimum_version: '1.0.0', store_url: null, message: {},
  reminder_interval_hours: null, first_reminder_delay_hours: 0, show_whats_new: true, support_url: null, release: releaseRow(), ...over,
});
const policy = (platform: 'ios' | 'android' = 'android', over: Record<string, unknown> = {}): UpdatePolicy => parsePolicyRow(policyRow(platform, over), platform)!;
const decide = (installed: string, p: UpdatePolicy | null, ctx = {}) => decideUpdate(installed, p, { now: NOW, ...ctx });

// ───────── semantic versions ─────────

test('1.9.0 vs 1.10.0, equal versions and double-digit components', () => {
  assert.equal(compareVersions('1.9.0', '1.10.0'), -1);
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('1.2.0', '1.2.0'), 0);
  assert.equal(compareVersions('1.2.9', '1.2.10'), -1);
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
});

// ───────── A. normal release ─────────

test('normal release: optional, normal tier, 72 h default reminder, shows What\'s New', () => {
  const d = decide('1.0.0', policy('android', { release: releaseRow({ release_type: 'normal', version: '1.1.0', target_version: '1.1.0' }) }));
  assert.equal(d.kind, 'optional');
  if (d.kind !== 'optional') return;
  assert.equal(d.tier, 'normal');
  assert.equal(d.reminderIntervalHours, 72);
  assert.equal(d.targetVersion, '1.1.0');
  assert.equal(d.release?.changelog.length, 1);
  assert.equal(d.storeUrl, PLAY, 'Android uses the Android listing');
});

test('stops once the installed version reaches the target (equal and newer)', () => {
  const p = policy('android', { release: releaseRow({ release_type: 'normal', target_version: '1.1.0' }) });
  assert.equal(decide('1.1.0', p).kind, 'ok');
  assert.equal(decide('1.10.0', p).kind, 'ok');
});

// ───────── B. important release ─────────

test('important release: optional, important tier, 24 h default, operator interval wins', () => {
  const d = decide('1.1.0', policy('android'));
  assert.ok(d.kind === 'optional' && d.tier === 'important' && d.reminderIntervalHours === 24);
  const custom = decide('1.1.0', policy('android', { reminder_interval_hours: 6, first_reminder_delay_hours: 2, show_whats_new: false }));
  assert.ok(custom.kind === 'optional' && custom.reminderIntervalHours === 6 && custom.firstReminderDelayHours === 2 && custom.showWhatsNew === false);
});

test('important release is never blocking unless explicitly mandatory', () => {
  assert.equal(decide('1.0.0', policy('android')).kind, 'optional');
});

test('important + mandatory blocks below its target (no minimum_supported_version -> target is required)', () => {
  const p = policy('android', { release: releaseRow({ mandatory: true, target_version: '1.2.0' }) });
  const d = decide('1.1.9', p);
  assert.ok(d.kind === 'required' && d.minimumVersion === '1.2.0' && d.targetVersion === '1.2.0');
  assert.equal(decide('1.2.0', p).kind, 'ok');
});

// ───────── C. critical release ─────────

test('critical mandatory: blocks every version below the minimum supported version, shows details', () => {
  const p = policy('android', { release: releaseRow({ release_type: 'critical', mandatory: true, minimum_supported_version: '1.2.0', target_version: '1.3.0', version: '1.3.0' }) });
  for (const v of ['1.0.0', '1.1.9', '1.1.10']) {
    const d = decide(v, p);
    assert.ok(d.kind === 'required', v);
    if (d.kind === 'required') {
      assert.equal(d.minimumVersion, '1.2.0');
      assert.equal(d.targetVersion, '1.3.0');
      assert.equal(d.release?.releaseType, 'critical');
      assert.equal(d.supportUrl, 'mailto:support@suuqiye.com');
      assert.equal(d.storeUrl, PLAY);
    }
  }
  // at/above the minimum but below the target: not blocked, only announced
  assert.equal(decide('1.2.0', p).kind, 'optional');
  assert.equal(decide('1.3.0', p).kind, 'ok');
});

test('1.10.0 is not blocked by a 1.9.0 minimum, 1.9.0 is blocked by a 1.10.0 minimum', () => {
  const crit = (min: string) => policy('android', { release: releaseRow({ release_type: 'critical', mandatory: true, minimum_supported_version: min, target_version: '1.10.0' }) });
  assert.equal(decide('1.10.0', crit('1.9.0')).kind, 'ok');
  assert.equal(decide('1.9.0', crit('1.10.0')).kind, 'required');
});

test('a critical release can never be downgraded to optional by its row (mandatory=false is ignored)', () => {
  const p = policy('android', { release: releaseRow({ release_type: 'critical', mandatory: false, target_version: '1.3.0' }) });
  assert.equal(parseReleaseRow(releaseRow({ release_type: 'critical', mandatory: false }), 'android')?.mandatory, true);
  assert.equal(decide('1.0.0', p).kind, 'required');
});

test('a release can raise the block but never lower the policy minimum', () => {
  const p = policy('android', { minimum_version: '1.5.0', release: releaseRow({ release_type: 'critical', mandatory: true, minimum_supported_version: '1.2.0', target_version: '1.6.0' }) });
  const d = decide('1.4.0', p);
  assert.ok(d.kind === 'required' && d.minimumVersion === '1.5.0' && d.targetVersion === '1.6.0');
});

test('the policy minimum still blocks with no release at all (0078 behaviour)', () => {
  const d = decide('1.0.0', policy('android', { minimum_version: '1.1.0', release: null }));
  assert.ok(d.kind === 'required' && d.release === null && d.targetVersion === '1.1.0');
});

// ───────── platform isolation, enabled, expiry, publish state ─────────

test('Android and iOS are independent: one platform\'s release never blocks the other', () => {
  const crit = releaseRow({ platform: 'android', release_type: 'critical', mandatory: true, minimum_supported_version: '1.2.0', target_version: '1.3.0', ios_store_url: null });
  assert.equal(decide('1.0.0', policy('android', { release: crit })).kind, 'required');
  // an android-only release embedded in the iOS row is rejected (and a mismatched row can never block)
  const iosPolicy = parsePolicyRow(policyRow('ios', { release: crit }), 'ios');
  assert.equal(iosPolicy?.release, null);
  assert.equal(decide('1.0.0', iosPolicy).kind, 'ok');
  // an 'all' release uses each platform's own store link
  const both = releaseRow({ platform: 'all' });
  assert.equal(parseReleaseRow(both, 'ios')?.storeUrl, APPSTORE);
  assert.equal(parseReleaseRow(both, 'android')?.storeUrl, PLAY);
});

test('enabled = false leaves users unaffected, even with a critical mandatory release', () => {
  const p = policy('android', { enabled: false, release: releaseRow({ release_type: 'critical', mandatory: true, minimum_supported_version: '9.0.0', target_version: '9.0.0' }) });
  assert.equal(decide('1.0.0', p).kind, 'ok');
});

test('expired releases are not announced and do not block; the policy minimum still applies', () => {
  const rel = releaseRow({ release_type: 'critical', mandatory: true, minimum_supported_version: '1.2.0', target_version: '1.3.0', expires_at: '2026-10-31T00:00:00Z' });
  const p = policy('android', { release: rel });
  assert.equal(isReleaseActive(p.release, NOW), false);
  assert.equal(decide('1.0.0', p).kind, 'ok');
  assert.equal(decide('1.0.0', policy('android', { minimum_version: '1.1.0', release: rel })).kind, 'required');
  // not yet expired -> active
  assert.equal(decide('1.0.0', policy('android', { release: { ...rel, expires_at: '2026-12-01T00:00:00Z' } })).kind, 'required');
});

test('unpublished, malformed or empty releases are ignored (never announced)', () => {
  for (const over of [{ published: false }, { release_type: 'urgent' }, { target_version: 'latest' }, { title: ' ' }, { description: '' }, { id: '' }, { minimum_supported_version: '1.x' }]) {
    assert.equal(parseReleaseRow(releaseRow(over), 'android'), null, JSON.stringify(over));
  }
  assert.equal(policy('android', { release: releaseRow({ published: false }) }).release, null);
});

test('missing / unverified states are not "ok"', () => {
  assert.deepEqual(decide('1.0.0', null), { kind: 'unverified', reason: 'no-policy' });
  assert.deepEqual(decide('garbage', policy()), { kind: 'unverified', reason: 'bad-installed-version' });
});

test('android build number: same version, older versionCode -> optional; unknown build -> ok', () => {
  const p = policy('android', { release: releaseRow({ release_type: 'normal', version: '1.1.0', target_version: '1.1.0', version_code: 12 }) });
  assert.equal(decide('1.1.0', p, { installedBuild: 11 }).kind, 'optional');
  assert.equal(decide('1.1.0', p, { installedBuild: 12 }).kind, 'ok');
  assert.equal(decide('1.1.0', p, { installedBuild: null }).kind, 'ok');
  // the build number never creates a mandatory block
  const crit = policy('android', { release: releaseRow({ release_type: 'critical', mandatory: true, minimum_supported_version: '1.1.0', target_version: '1.1.0', version_code: 12 }) });
  assert.equal(decide('1.1.0', crit, { installedBuild: 3 }).kind, 'optional');
});

// ───────── changelog + icons: safe by construction ─────────

test('changelog: only the predefined icon names resolve; anything else falls back', () => {
  assert.equal(resolveChangelogIcon('image'), CHANGELOG_ICONS.image);
  assert.equal(resolveChangelogIcon('message-circle'), 'chatbubble-ellipses-outline');
  for (const evil of ['<script>', 'constructor', '__proto__', 'toString', 'hasOwnProperty', '', null, 5, {}, 'IMAGE']) {
    assert.equal(resolveChangelogIcon(evil), DEFAULT_CHANGELOG_ICON, String(evil));
  }
});

test('changelog: malformed structures are dropped, never thrown', () => {
  assert.deepEqual(parseChangelog(null), []);
  assert.deepEqual(parseChangelog([]), []);
  assert.deepEqual(parseChangelog({ items: 'x' }), []);
  const items = parseChangelog({ items: [{ title: 'A', description: 'a', icon: 'zap' }, { title: '', description: 'x' }, 'str', null, { title: 'B' }, { title: 'T'.repeat(81) }, { title: 'C', icon: 'nope' }] });
  assert.deepEqual(items.map((i) => i.title), ['A', 'B', 'C']);
  assert.equal(items[2].icon, DEFAULT_CHANGELOG_ICON);
  assert.equal(parseChangelog({ items: Array.from({ length: 50 }, (_, i) => ({ title: `t${i}` })) }).length, 20);
});

test('support links: https and mailto only', () => {
  for (const ok of ['https://suuqiye.com/support', 'mailto:support@suuqiye.com']) assert.equal(isSafeSupportUrl(ok), true, ok);
  for (const bad of ['javascript:alert(1)', 'http://suuqiye.com', 'intent://x#Intent;end', 'file:///etc/passwd', 'tel:123', '', null, 'https://' + 'a'.repeat(600)]) assert.equal(isSafeSupportUrl(bad), false, String(bad));
  assert.equal(parseReleaseRow(releaseRow({ support_url: 'javascript:alert(1)' }), 'android')?.supportUrl, null);
});

test('translations: per-language overrides with base fallback, items align by index', () => {
  const rel = parseReleaseRow(releaseRow({
    changelog: { items: [{ title: 'Faster images', description: 'Smoother.', icon: 'image' }, { title: 'Chat', description: 'Better.', icon: 'message-circle' }] },
    translations: { so: { title: 'Cusub', items: [{ title: 'Sawirro' }] }, xx_bad: { title: 'x' }, am: 'oops' },
  }), 'android') as UpdateRelease;
  const so = localizeRelease(rel, 'so');
  assert.equal(so.title, 'Cusub');
  assert.equal(so.description, rel.description, 'no description override -> base text');
  assert.deepEqual(so.changelog.map((i) => i.title), ['Sawirro', 'Chat']);
  assert.equal(so.changelog[0].description, 'Smoother.');
  assert.equal(localizeRelease(rel, 'am').title, rel.title);
  assert.deepEqual(Object.keys(rel.translations), ['so']);
});

// ───────── cache round trip + backward compatibility ─────────

test('policyToRow round-trips (the on-device cache keeps release details)', () => {
  const p = policy('android', { reminder_interval_hours: 12, support_url: 'https://suuqiye.com/help', message: { en: 'Hi' }, release: releaseRow({ platform: 'android', translations: { so: { title: 'Cusub' } }, expires_at: '2027-01-01T00:00:00Z', version_code: 7, ios_store_url: null }) });
  assert.deepEqual(parsePolicyRow(policyToRow(p), 'android'), p);
  const noRelease = policy('ios', { release: null });
  assert.deepEqual(parsePolicyRow(policyToRow(noRelease), 'ios'), noRelease);
});

test('rows from before migration 0090 (no new columns) still parse and keep blocking', () => {
  const legacy = { platform: 'ios', enabled: true, recommended_version: null, minimum_version: '1.1.0', store_url: null, message: {} };
  const p = parsePolicyRow(legacy, 'ios')!;
  assert.ok(p && p.release === null && p.reminderIntervalHours === null && p.firstReminderDelayHours === 0 && p.showWhatsNew === true);
  assert.equal(decide('1.0.0', p).kind, 'required');
  // PostgREST may embed a to-one relation as a one-element array
  assert.equal(parsePolicyRow({ ...legacy, release: [releaseRow()] }, 'ios')?.release?.id, 'r1');
});
