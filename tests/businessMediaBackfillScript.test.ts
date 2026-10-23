// The operator backfill script (scripts/business-media-backfill.js) driven through a fake fetch: what it refuses, what it sends where, and
// that it never deletes or logs anything identifying. The Worker route and the SQL it calls are covered in businessMediaScan.test.ts and
// supabase/tests/business_media_backfill.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const script = require(path.join(__dirname, '..', '..', 'scripts', 'business-media-backfill.js')) as {
  main: (argv: string[], env: Record<string, string>, fetchFn: (url: string, init?: any) => Promise<any>, log: (m: string) => void) => Promise<number>;
};

const OWNER = '11111111-1111-4111-8111-111111111111';
const KEY = `business/${OWNER}/logo/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
const ENV = { SUPABASE_URL: 'https://stg.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key', SCAN_URL: 'https://scan.example.workers.dev', BACKFILL_SECRET: 'op-secret' };
const HOST = ['--expect-host', 'stg.supabase.co'];

type Call = { url: string; method: string; body: any; headers: Record<string, string> };
function rig(handler: (call: Call) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const lines: string[] = [];
  const fetchFn = async (url: string, init: any = {}) => {
    const call: Call = { url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers ?? {} };
    calls.push(call);
    const r = handler(call);
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body };
  };
  return { calls, lines, run: (argv: string[], env: Record<string, string> = ENV) => script.main(argv, env, fetchFn, (m) => lines.push(m)) };
}

test('refuses to run without a matching --expect-host (a stale environment variable must never reach the wrong project)', async () => {
  for (const argv of [[], ['--expect-host', 'prod.supabase.co'], ['--expect-host', 'stg.supabase.co.evil.com'], ['--scan']]) {
    const r = rig(() => ({ body: [] }));
    assert.equal(await r.run(argv), 2, argv.join(' '));
    assert.equal(r.calls.length, 0, 'no network call was made');
  }
});

test('refuses missing configuration, unknown flags and bad limits before any call', async () => {
  const cases: [string[], Record<string, string>][] = [
    [[...HOST], { SUPABASE_URL: ENV.SUPABASE_URL } as any],
    [[...HOST, '--wat'], ENV],
    [[...HOST, '--limit', '0'], ENV],
    [[...HOST, '--limit', '9999'], ENV],
    [[...HOST, '--scan'], { ...ENV, BACKFILL_SECRET: '' }],
    [[...HOST, '--scan'], { ...ENV, SCAN_URL: 'http://insecure.example' }],
    [[...HOST, '--apply'], ENV], // no --confirm-apply
  ];
  for (const [argv, env] of cases) {
    const r = rig(() => ({ body: [] }));
    assert.equal(await r.run(argv, env), 2, argv.join(' '));
    assert.equal(r.calls.length, 0);
  }
});

test('the default mode is a read-only report: one call, the report function, nothing written', async () => {
  const r = rig(() => ({ body: [{ status: 'pending', rows: '3' }, { status: 'applied', rows: 1 }] }));
  assert.equal(await r.run([...HOST]), 0);
  assert.deepEqual(r.calls.map((c) => c.url), ['https://stg.supabase.co/rest/v1/rpc/business_media_backfill_report']);
  assert.deepEqual(JSON.parse(r.lines[0]).counts, { pending: 3, applied: 1 });
});

test('scan: sends the secret only to the Worker, records exactly what the Worker said, never trusts an incomplete approval', async () => {
  const rows = [1, 2, 3, 4, 5].map((n) => ({ id: `0000000${n}-0000-4000-8000-000000000000`, owner_id: OWNER, kind: 'logo', original_key: KEY, source: 'profile' }));
  const answers = [
    { outcome: 'approved', scanId: 's1', key: `business/${OWNER}/logo/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg`, url: 'https://media.test/x.jpg' },
    { outcome: 'rejected', scanId: 's2' },
    { outcome: 'approved' }, // incomplete
    { outcome: 'missing' },
    { outcome: 'something-new' },
  ];
  let w = 0;
  const r = rig((c) => {
    if (c.url.endsWith('/rpc/business_media_backfill_claim')) return { body: rows };
    if (c.url.endsWith('/v1/business-media/backfill')) return { body: answers[w++] };
    return { body: null };
  });
  assert.equal(await r.run([...HOST, '--scan', '--limit', '5']), 0);
  const worker = r.calls.filter((c) => c.url.includes('/v1/business-media/backfill'));
  assert.equal(worker.length, 5);
  assert.ok(worker.every((c) => c.headers['x-backfill-secret'] === 'op-secret'));
  assert.ok(r.calls.filter((c) => !c.url.includes('scan.example')).every((c) => !JSON.stringify(c.headers).includes('op-secret')), 'the Worker secret never goes to Supabase');
  assert.deepEqual(worker[0].body, { ownerId: OWNER, kind: 'logo', originalKey: KEY });
  const rec = r.calls.filter((c) => c.url.endsWith('/rpc/business_media_backfill_record')).map((c) => c.body);
  assert.deepEqual(rec.map((b) => b.p_status), ['approved', 'rejected', 'unavailable', 'missing', 'unavailable']);
  assert.equal(rec[0].p_scan_id, 's1');
  assert.equal(rec[2].p_new_key, null, 'an incomplete approval carries no key');
  assert.equal(r.calls.some((c) => c.method === 'DELETE' || /_apply$|\/rpc\/business_media_backfill_apply/.test(c.url)), false, 'scan never applies and never deletes');
});

test('scan: a Worker error or an unreachable Worker is recorded as unavailable (retryable), a failing record call does not stop the run', async () => {
  const rows = [1, 2, 3].map((n) => ({ id: `0000000${n}-0000-4000-8000-000000000000`, owner_id: OWNER, kind: 'banner', original_key: KEY, source: 'storefront' }));
  let n = 0;
  const r = rig((c) => {
    if (c.url.endsWith('/rpc/business_media_backfill_claim')) return { body: rows };
    if (c.url.includes('/v1/business-media/backfill')) { n++; if (n === 2) throw new Error('network'); return { status: 503, body: { code: 'unavailable' } }; }
    if (c.url.endsWith('/rpc/business_media_backfill_record') && c.body.p_id.startsWith('00000003')) return { status: 500, body: null };
    return { body: null };
  });
  assert.equal(await r.run([...HOST, '--scan']), 0);
  const rec = r.calls.filter((c) => c.url.endsWith('/rpc/business_media_backfill_record')).map((c) => c.body.p_status);
  assert.deepEqual(rec, ['unavailable', 'unavailable', 'unavailable']);
  assert.match(r.lines.join('\n'), /record_failed/);
});

test('apply: only rows the database lists as approved are applied, one call each, and only with --confirm-apply', async () => {
  const r = rig((c) => (c.url.includes('business_media_backfill?status=eq.approved') ? { body: [{ id: 'aaaaaaaa-0000-4000-8000-000000000000' }, { id: 'bbbbbbbb-0000-4000-8000-000000000000' }] } : { body: c.body?.p_id?.startsWith('aaaa') ? 'applied' : 'superseded' }));
  assert.equal(await r.run([...HOST, '--apply', '--confirm-apply', '--limit', '2']), 0);
  assert.match(r.calls[0].url, /status=eq\.approved.*limit=2/);
  assert.deepEqual(r.calls.slice(1).map((c) => c.url.split('/').pop()), ['business_media_backfill_apply', 'business_media_backfill_apply']);
  assert.deepEqual(JSON.parse(r.lines[r.lines.length - 1]).results, { applied: 1, superseded: 1 });
});

test('log lines never contain a user id, an object key or a URL', async () => {
  const rows = [{ id: '12345678-0000-4000-8000-000000000000', owner_id: OWNER, kind: 'logo', original_key: KEY, source: 'profile' }];
  const r = rig((c) => (c.url.endsWith('/rpc/business_media_backfill_claim') ? { body: rows } : c.url.includes('/v1/business-media/backfill') ? { body: { outcome: 'approved', scanId: 's', key: KEY, url: 'https://media.test/' + KEY } } : { body: null }));
  await r.run([...HOST, '--scan']);
  const out = r.lines.join('\n');
  assert.doesNotMatch(out, new RegExp(`${OWNER}|business/|https://media|op-secret|service-key`));
  assert.match(out, /row 12345678 logo: approved/);
});
