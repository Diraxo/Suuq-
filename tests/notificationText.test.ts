import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { localizeServerNotification, Translator } from '../lib/notificationText';

function load(lang: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'locales', lang, 'translation.json'), 'utf8'));
}
function translator(dict: Record<string, any>): Translator {
  const get = (key: string): unknown => key.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), dict);
  return { t: (k) => String(get(k) ?? k), exists: (k) => typeof get(k) === 'string' };
}

const row = (type: string, data: Record<string, unknown>) => ({ title: 'ENGLISH TITLE', body: 'ENGLISH BODY', type, data });

test('verification, report outcome and every moderation kind are translated in en, so and am', () => {
  const kinds = ['listing_removed', 'listing_deactivated', 'listing_restored', 'warning', 'suspension', 'suspension_lifted', 'suspension_expired', 'ban', 'unban', 'appeal_approved', 'appeal_rejected'];
  for (const lang of ['en', 'so', 'am']) {
    const tr = translator(load(lang));
    for (const kind of ['verified', 'verification_revoked']) {
      const out = localizeServerNotification(row('verification', { kind }), tr);
      assert.notEqual(out.title, 'ENGLISH TITLE', `${lang} ${kind} title`);
      assert.notEqual(out.body, 'ENGLISH BODY', `${lang} ${kind} body`);
      assert.ok(!out.title.startsWith('notifications.') && !out.body.startsWith('notifications.'), 'never a raw key');
    }
    for (const status of ['reviewed', 'dismissed']) {
      const out = localizeServerNotification(row('report_result', { status }), tr);
      assert.notEqual(out.title, 'ENGLISH TITLE', `${lang} report_${status}`);
    }
    for (const kind of kinds) {
      const out = localizeServerNotification(row('moderation', { kind }), tr);
      assert.equal(out.title, 'ENGLISH TITLE', 'the brand label is kept');
      assert.notEqual(out.body, 'ENGLISH BODY', `${lang} moderation ${kind}`);
    }
  }
});

test('Somali and Amharic differ from English (not copied placeholders)', () => {
  const en = localizeServerNotification(row('verification', { kind: 'verified' }), translator(load('en')));
  for (const lang of ['so', 'am']) {
    const out = localizeServerNotification(row('verification', { kind: 'verified' }), translator(load(lang)));
    assert.notEqual(out.title, en.title);
  }
});

test('unknown types or kinds keep the server text and never leak a key', () => {
  const tr = translator(load('en'));
  assert.deepEqual(localizeServerNotification(row('moderation', { kind: 'brand_new_kind' }), tr), { title: 'ENGLISH TITLE', body: 'ENGLISH BODY' });
  assert.deepEqual(localizeServerNotification(row('verification', {}), tr), { title: 'ENGLISH TITLE', body: 'ENGLISH BODY' });
  assert.deepEqual(localizeServerNotification(row('verification', { kind: '../../x' }), tr), { title: 'ENGLISH TITLE', body: 'ENGLISH BODY' });
  assert.deepEqual(localizeServerNotification(row('message', { kind: 'verified' }), tr), { title: 'ENGLISH TITLE', body: 'ENGLISH BODY' });
  assert.deepEqual(localizeServerNotification({ title: 't', body: null, type: null, data: null }, tr), { title: 't', body: '' });
});
