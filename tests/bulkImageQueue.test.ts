import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBulkImageUrl, bulkBackoffMinutes, classifyHttpStatus, summarizeBatch, chooseBulkPath } from '../lib/bulkImageQueue';

test('URL guard accepts ordinary public https photo links', () => {
  for (const u of ['https://shop.example.com/a.jpg', 'https://cdn.shop.co.uk/img/1.png?x=1', 'https://shop.example.com:443/a.jpg', 'https://SHOP.example.com./a.jpg']) {
    assert.equal(validateBulkImageUrl(u).ok, true, u);
  }
});

test('URL guard refuses everything that is not a plain public https host', () => {
  const bad: [string, string][] = [
    ['http://shop.example.com/a.jpg', 'not_https'],
    ['ftp://shop.example.com/a.jpg', 'not_https'],
    ['file:///etc/passwd', 'not_https'],
    ['javascript:alert(1)', 'not_https'],
    ['data:image/png;base64,AAAA', 'not_https'],
    ['https://user:pw@shop.example.com/a.jpg', 'credentials'],
    ['https://shop.example.com@evil.example/a.jpg', 'credentials'],
    ['https://shop.example.com:8443/a.jpg', 'bad_port'],
    ['https://shop.example.com:80/a.jpg', 'bad_port'],
    ['https://127.0.0.1/a.jpg', 'ip_literal'],
    ['https://10.0.0.5/a.jpg', 'ip_literal'],
    ['https://169.254.169.254/latest/meta-data/', 'ip_literal'],
    ['https://0x7f.1/a.jpg', 'ip_literal'],
    ['https://2130706433/a.jpg', 'ip_literal'],
    ['https://017700000001/a.jpg', 'ip_literal'],
    ['https://[::1]/a.jpg', 'ip_literal'],
    ['https://[fe80::1]/a.jpg', 'ip_literal'],
    ['https://localhost/a.jpg', 'internal_name'],
    ['https://printer/a.jpg', 'internal_name'],
    ['https://nas.local/a.jpg', 'internal_name'],
    ['https://db.internal/a.jpg', 'internal_name'],
    ['https://x.corp/a.jpg', 'internal_name'],
    ['https://abc.onion/a.jpg', 'internal_name'],
    ['not a url', 'malformed'],
    ['', 'malformed'],
  ];
  for (const [u, reason] of bad) {
    const r = validateBulkImageUrl(u);
    assert.equal(r.ok, false, u);
    if (!r.ok) assert.equal(r.reason, reason, u);
  }
  assert.deepEqual(validateBulkImageUrl('https://shop.example.com/' + 'a'.repeat(2100)), { ok: false, reason: 'too_long' });
});

test('backoff doubles from 1 minute and caps at an hour (mirrors fail_bulk_row)', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(bulkBackoffMinutes), [1, 2, 4, 8, 16, 32, 60, 60, 60, 60]);
  assert.equal(bulkBackoffMinutes(0), 1);
});

test('HTTP failures: transient ones retry, dead/forbidden links are final', () => {
  for (const s of [408, 425, 429, 500, 502, 503, 504]) assert.equal(classifyHttpStatus(s).retryable, true, String(s));
  for (const s of [400, 401, 403, 404, 410, 415]) assert.equal(classifyHttpStatus(s).retryable, false, String(s));
  assert.equal(classifyHttpStatus(404).code, 'image_gone');
  assert.equal(classifyHttpStatus(403).code, 'image_forbidden');
});

test('batch summary: in-progress, to-publish, failed, needs-changes and percent', () => {
  assert.deepEqual(summarizeBatch({}), { total: 0, inProgress: 0, toPublish: 0, published: 0, failed: 0, needsChanges: 0, cancelled: 0, finished: true, percent: 0 });
  const mid = summarizeBatch({ queued: 3, processing: 2, ready: 4, ready_review: 1, published: 0, failed: 1, needs_changes: 1 });
  assert.deepEqual([mid.total, mid.inProgress, mid.toPublish, mid.failed, mid.needsChanges, mid.finished, mid.percent], [12, 5, 5, 1, 1, false, 58]);
  const done = summarizeBatch({ published: 8, failed: 1, needs_changes: 1 });
  assert.deepEqual([done.total, done.finished, done.percent], [10, true, 100]);
  assert.equal(summarizeBatch({ ready: 2 }).finished, false, 'ready rows still need the app to publish them');
});

test('bulk uses the queue only while photo checks are enforced', () => {
  assert.equal(chooseBulkPath({ mode: 'enforce' }), 'queue');
  for (const p of [{ mode: 'off' as const }, { mode: 'shadow' as const }, null]) assert.equal(chooseBulkPath(p), 'legacy');
});
