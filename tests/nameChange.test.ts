// Display-name change limit (migration 0075): the pure client rules, plus source-level checks that mobile and web use them the same way.
// The enforcement itself is in the database: supabase/tests/name_change_limit.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { formatNextAvailable, isNameChange, isNameChangeLimitError, nameChangeLimitUntil, parseNameChangeStatus, wouldExceedNameLimit } from '../lib/nameChangeRules';

const root = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

test('web copy of nameChangeRules is byte-identical to the original', () => {
  assert.equal(read('lib/nameChangeRules.ts'), read('web/src/lib/nameChangeRules.ts'));
});

test('the status the server returns is parsed; anything malformed means unknown', () => {
  const s = parseNameChangeStatus({ limit: 2, window_days: 7, used: 2, remaining: 0, next_available_at: '2026-10-29T10:00:00+00:00' });
  assert.ok(s);
  assert.equal(s!.remaining, 0);
  assert.equal(s!.windowDays, 7);
  assert.equal(s!.nextAvailableAt!.toISOString(), '2026-10-29T10:00:00.000Z');
  assert.equal(parseNameChangeStatus({ limit: 2, window_days: 7, used: 0, remaining: 2, next_available_at: null })!.nextAvailableAt, null);
  for (const bad of [null, undefined, 'x', 3, {}, { limit: 2 }, { limit: '2', window_days: 7, used: 0, remaining: 2 }]) assert.equal(parseNameChangeStatus(bad), null);
  assert.equal(parseNameChangeStatus({ limit: 2, window_days: 7, used: 2, remaining: 0, next_available_at: 'not a date' })!.nextAvailableAt, null);
});

test('the database refusal is recognised and its time is read; other errors are not mistaken for it', () => {
  const err = { message: 'name_change_limit', hint: 'name_change_limit', details: '2026-10-29 10:00:00+00', code: 'P0001' };
  assert.equal(isNameChangeLimitError(err), true);
  assert.equal(nameChangeLimitUntil(err)!.toISOString(), '2026-10-29T10:00:00.000Z');
  assert.equal(isNameChangeLimitError({ message: 'permission denied', code: '42501' }), false);
  assert.equal(isNameChangeLimitError(null), false);
  assert.equal(nameChangeLimitUntil({ message: 'name_change_limit', details: null }), null);
  assert.equal(nameChangeLimitUntil({ message: 'name_change_limit', details: 'garbage' }), null);
});

test('only a real change of the trimmed name counts, like the database', () => {
  assert.equal(isNameChange('Abdi Ali', 'Abdi Ali'), false);
  assert.equal(isNameChange('Abdi Ali', '  Abdi Ali '), false);
  assert.equal(isNameChange('Abdi Ali', 'Abdi Aly'), true);
  assert.equal(isNameChange(null, 'Abdi'), true);
});

test('a save is predicted to fail only when no changes are left, the old name exists and the name really changes', () => {
  const out = parseNameChangeStatus({ limit: 2, window_days: 7, used: 2, remaining: 0, next_available_at: '2026-10-29T10:00:00Z' });
  const some = parseNameChangeStatus({ limit: 2, window_days: 7, used: 1, remaining: 1, next_available_at: null });
  assert.equal(wouldExceedNameLimit(out, 'Abdi Ali', 'Abdi Aly'), true);
  assert.equal(wouldExceedNameLimit(out, 'Abdi Ali', ' Abdi Ali'), false);
  assert.equal(wouldExceedNameLimit(out, null, 'Abdi'), false, 'setting a first name is free');
  assert.equal(wouldExceedNameLimit(some, 'Abdi Ali', 'Abdi Aly'), false);
  assert.equal(wouldExceedNameLimit(null, 'Abdi Ali', 'Abdi Aly'), false, 'unknown status never blocks; the database decides');
});

test('the next-available time is formatted for the viewer without throwing', () => {
  assert.ok(formatNextAvailable(new Date('2026-10-29T10:00:00Z'), 'en').length > 6);
  assert.ok(formatNextAvailable(new Date('2026-10-29T10:00:00Z'), 'not-a-locale-@@').length > 6);
});

test('mobile and web edit-profile enforce nothing locally: they read the status, lock the name when out, and handle the database refusal', () => {
  for (const f of ['app/settings/edit-profile.tsx', 'web/src/app/settings/edit-profile/page.tsx']) {
    const src = read(f);
    assert.match(src, /useNameChangeStatus\(/, f);
    assert.match(src, /nameStatus\.remaining <= 0/, `${f} locks the name fields when no changes are left`);
    assert.match(src, /isNameChangeLimitError\(/, `${f} handles the database refusal`);
    assert.match(src, /nameChange\.hint/, `${f} shows the remaining changes`);
    assert.match(src, /nameChange\.exhausted/, `${f} says when the next change is allowed`);
    assert.match(src, /replace\(\/\\s\+\/g, ' '\)/, `${f} does not send a name that only differs by spaces`);
  }
  for (const f of ['hooks/useNameChangeStatus.ts', 'web/src/hooks/useNameChangeStatus.ts']) assert.match(read(f), /rpc\('my_name_change_status'\)/, f);
});

test('the name-change strings exist in English, Somali and Amharic', () => {
  for (const lang of ['en', 'so', 'am']) {
    const t = JSON.parse(read(`locales/${lang}/translation.json`));
    for (const k of ['hint', 'exhausted', 'limitSnackbar', 'limitSnackbarNoDate']) assert.ok(t.settings.editProfile.nameChange[k], `${lang} nameChange.${k}`);
    assert.ok(t.settings.businessProfile.identityNote && t.settings.businessProfile.identityNoteLink, `${lang} identityNote`);
    assert.match(t.settings.editProfile.nameChange.hint, /\{\{limit\}\}.*\{\{days\}\}.*\{\{remaining\}\}|\{\{days\}\}.*\{\{limit\}\}.*\{\{remaining\}\}/, `${lang} hint placeholders`);
  }
  assert.notEqual(JSON.parse(read('locales/so/translation.json')).settings.editProfile.nameChange.hint, JSON.parse(read('locales/en/translation.json')).settings.editProfile.nameChange.hint);
});

test('migration 0075 states the limits in one place and the rollback exists', () => {
  const sql = read('supabase/migrations/0075_unified_identity_name_limit.sql');
  assert.match(sql, /name_change_limit\(\) returns int language sql immutable as \$\$ select 2 \$\$/);
  assert.match(sql, /interval '7 days'/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.ok(fs.existsSync(path.join(root, 'supabase/rollback/0075_unified_identity_name_limit_ROLLBACK.sql')));
});
