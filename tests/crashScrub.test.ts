import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubBreadcrumb, scrubEvent, scrubText } from '../lib/crashScrub';

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';

test('scrubText removes emails, tokens, ids, phone numbers and URL queries', () => {
  const out = scrubText(`user a.b@mail.com id 0b1c2d3e-0000-4000-8000-000000000001 call +251 911 223 344 Bearer abcdefgh12345678 ${JWT} https://x.supabase.co/rest/v1/listings?select=*&apikey=secret#frag`);
  for (const leaked of ['a.b@mail.com', '0b1c2d3e', '911 223', 'abcdefgh12345678', 'eyJhbGci', 'apikey=secret', 'select=*']) assert.ok(!out.includes(leaked), `${leaked} leaked: ${out}`);
  assert.ok(out.includes('https://x.supabase.co/rest/v1/listings'));
});

test('scrubEvent drops user, request and device name, keeps the error and app version', () => {
  const event = scrubEvent({
    user: { id: 'u1', email: 'a@b.co', ip_address: '1.2.3.4' },
    request: { url: 'https://x/y?token=1', headers: { authorization: 'Bearer abc' } },
    server_name: 'My iPhone',
    extra: { draft: 'my secret title' },
    contexts: { device: { name: "Ali's iPhone", model: 'iPhone 14', family: 'iPhone' }, os: { name: 'iOS', version: '18' }, app: { app_version: '1.0.3', app_build: '9', app_name: 'x' } },
    exception: { values: [{ type: 'TypeError', value: 'Cannot read x for a.b@mail.com', stacktrace: { frames: [{ filename: 'app:///index.bundle', lineno: 1 }] } }] },
    breadcrumbs: [{ category: 'console', message: 'phone +251911223344', data: { url: 'https://x/y?token=1', body: 'secret' } }],
    tags: { context: 'render' },
  });
  assert.equal(event.user, undefined);
  assert.equal(event.request, undefined);
  assert.equal(event.server_name, undefined);
  assert.equal(event.extra, undefined);
  assert.equal(event.contexts.device.name, undefined);
  assert.equal(event.contexts.device.model, 'iPhone 14');
  assert.equal(event.contexts.app.app_version, '1.0.3');
  assert.equal(event.exception.values[0].type, 'TypeError');
  assert.ok(!JSON.stringify(event).includes('a.b@mail.com'));
  assert.ok(!JSON.stringify(event).includes('911223344'));
  assert.ok(!JSON.stringify(event).includes('secret'));
  assert.ok(!JSON.stringify(event).includes('token=1'));
});

test('scrubBreadcrumb keeps url/method/status only', () => {
  const c = scrubBreadcrumb({ category: 'xhr', data: { url: 'https://x/y?q=1', method: 'POST', status_code: 200, request_body: 'secret' } });
  assert.deepEqual(c.data, { url: 'https://x/y', status_code: 200, method: 'POST' });
});

test('an event that cannot be scrubbed is replaced, never passed through raw', () => {
  const evil: Record<string, unknown> = {};
  Object.defineProperty(evil, 'contexts', { enumerable: true, get() { throw new Error('boom'); } });
  const out = scrubEvent(evil) as { message?: string };
  assert.equal(out.message, 'event dropped: could not be scrubbed');
});
