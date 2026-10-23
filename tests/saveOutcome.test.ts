import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretWrite, classifyThrown } from '../lib/saveOutcome';
import { BUSINESS_MEDIA_MESSAGES } from '../lib/businessMedia';

test('success needs at least one written row', () => {
  assert.deepEqual(interpretWrite({ data: [{ id: 'u1' }], error: null }), { ok: true });
});
test('error:null with zero rows is a failure (RLS refusal), never success', () => {
  assert.deepEqual(interpretWrite({ data: [], error: null }), { ok: false, code: 'permission' });
  assert.deepEqual(interpretWrite({ data: null, error: null }), { ok: false, code: 'permission' });
  assert.deepEqual(interpretWrite(null), { ok: false, code: 'failed' });
});
test('errors are classified', () => {
  const c = (error: object) => (interpretWrite({ data: null, error }) as { code: string }).code;
  assert.equal(c({ message: 'JWT expired', code: 'PGRST301' }), 'auth');
  assert.equal(c({ status: 401 }), 'auth');
  assert.equal(c({ code: '42501', message: 'new row violates row-level security policy' }), 'permission');
  assert.equal(c({ code: '23514', message: 'check violation' }), 'invalid');
  assert.equal(c({ message: 'TypeError: Failed to fetch' }), 'offline');
  assert.equal(c({ status: 503 }), 'unavailable');
  assert.equal(c({ message: 'boom' }), 'failed');
});
test('thrown fetch TypeError means offline', () => {
  assert.equal(classifyThrown(new TypeError('Network request failed')), 'offline');
  assert.equal(classifyThrown(Object.assign(new Error('x'), { name: 'AbortError' })), 'offline');
});
test('notConfigured no longer tells users to update the app', () => {
  assert.doesNotMatch(BUSINESS_MEDIA_MESSAGES.notConfigured, /update the app/i);
  assert.match(BUSINESS_MEDIA_MESSAGES.notConfigured, /temporarily unavailable/i);
});
