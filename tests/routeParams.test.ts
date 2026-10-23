import test from 'node:test';
import assert from 'node:assert/strict';
import { enumParam, idParam, indexParam, textParam } from '../lib/routeParams';

const UUID = '0b1c2d3e-0000-4000-8000-000000000001';

test('idParam accepts ids and rejects everything else', () => {
  assert.equal(idParam(UUID), UUID);
  assert.equal(idParam(' abc_123 '), 'abc_123');
  assert.equal(idParam([UUID, 'x']), UUID, 'an array (?id=a&id=b) uses the first value');
  for (const bad of [undefined, null, '', '   ', '../etc/passwd', 'a/b', 'a\b', 'a b', 'a\u0000b', 'a\nb', "x'; drop table listings;--", '%2e%2e', 'a'.repeat(65), '<script>', [], [''], 'a.b', 'id?x=1']) {
    assert.equal(idParam(bad as never), '', JSON.stringify(bad));
  }
});

test('textParam allows names in any script and rejects control characters and markup', () => {
  assert.equal(textParam('Hargeisa'), 'Hargeisa');
  assert.equal(textParam('Dire Dawa'), 'Dire Dawa');
  assert.equal(textParam('አዲስ አበባ'), 'አዲስ አበባ');
  assert.equal(textParam("Ba'ado"), "Ba'ado");
  for (const bad of [undefined, '', '<b>', 'a\u0000', 'a‮', 'x'.repeat(81), 'a,b', 'a;b', 'a(b)']) assert.equal(textParam(bad as never), '', JSON.stringify(bad));
});

test('enumParam only returns a listed word', () => {
  assert.equal(enumParam('active', ['active', 'sold'] as const), 'active');
  assert.equal(enumParam('ACTIVE', ['active', 'sold'] as const), undefined);
  assert.equal(enumParam(undefined, ['active'] as const), undefined);
  assert.equal(enumParam(['sold', 'active'], ['active', 'sold'] as const), 'sold');
});

test('indexParam is always a valid position', () => {
  assert.equal(indexParam('2', 5), 2);
  assert.equal(indexParam('99', 5), 4);
  assert.equal(indexParam('-1', 5), 0);
  assert.equal(indexParam('1.5', 5), 0);
  assert.equal(indexParam('NaN', 5), 0);
  assert.equal(indexParam('99999999999', 5), 0);
  assert.equal(indexParam('1', 0), 0);
  assert.equal(indexParam(undefined, 3), 0);
});

import { isSafeExternalUrl } from '../lib/safeUrl';

test('only web, phone and mail links may be opened', () => {
  for (const ok of ['https://suuqiye.com/x?y=1', 'http://example.com', 'tel:+251911223344', 'tel:0911 22 33 44', 'mailto:suuqiyesupport@gmail.com']) assert.equal(isSafeExternalUrl(ok), true, ok);
  for (const bad of ['javascript:alert(1)', 'intent://scan#Intent;scheme=zxing;end', 'file:///etc/passwd', 'data:text/html,<b>', 'market://details?id=x', 'sms:123', 'https://', 'https://a b.com', 'https://a.com/\n', 'tel:abc', 'mailto:nobody', '', null, undefined, 42, 'https://' + 'a'.repeat(2100)]) {
    assert.equal(isSafeExternalUrl(bad), false, String(bad));
  }
});
