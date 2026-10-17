// Throwaway-bucket probe for r2-presign's URL signing. NEVER point this at the
// production bucket or production credentials.
//
//   $env:R2_ACCOUNT_ID=...; $env:R2_ACCESS_KEY_ID=...; $env:R2_SECRET_ACCESS_KEY=...
//   $env:R2_BUCKET_NAME=suuqiye-throwaway-test; $env:PROBE_CONFIRM_THROWAWAY='yes'
//   deno run --allow-net --allow-env --node-modules-dir=none scripts/r2-presign-probe.ts
//
// Expected: 4 PASS lines. Uploads one tiny object under probe/ and deletes it.
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';
import { presignPut } from '../supabase/functions/_shared/presign.ts';

const env = (k: string): string => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`${k} not set`);
  return v;
};
if (Deno.env.get('PROBE_CONFIRM_THROWAWAY') !== 'yes') throw new Error('Set PROBE_CONFIRM_THROWAWAY=yes (throwaway bucket + credentials only)');
const bucket = env('R2_BUCKET_NAME');
if (!/throwaway|test|probe/i.test(bucket)) throw new Error(`Refusing: "${bucket}" does not look like a throwaway bucket (name must contain throwaway/test/probe)`);

const endpoint = `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`;
const client = new AwsClient({ accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY'), service: 's3', region: 'auto' });
const body = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // content is irrelevant to the signing test
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${detail}`);
  if (!ok) failed++;
};
const objUrl = (n: string) => `${endpoint}/${bucket}/probe/${crypto.randomUUID()}-${n}.jpg`;
const put = (url: string, ct: string) => fetch(url, { method: 'PUT', headers: { 'Content-Type': ct }, body });

const u1 = await presignPut(client, objUrl('ok'));
const p = new URL(u1).searchParams;
check('URL has one X-Amz-Expires=300 and signs content-type', p.getAll('X-Amz-Expires').length === 1 && p.get('X-Amz-Expires') === '300' && p.get('X-Amz-SignedHeaders') === 'content-type;host');
const r1 = await put(u1, 'image/jpeg');
check('PUT image/jpeg accepted', r1.ok, `(status ${r1.status})`);
await r1.body?.cancel();
const r2 = await put(await presignPut(client, objUrl('html')), 'text/html');
check('PUT text/html rejected', r2.status === 403, `(status ${r2.status})`);
await r2.body?.cancel();
const old = new Date(Date.now() - 10 * 60_000).toISOString().replace(/[:-]|\.\d{3}/g, '');
const r3 = await put(await presignPut(client, objUrl('expired'), old), 'image/jpeg');
check('PUT with URL minted 10 min ago (300 s expiry) rejected', r3.status === 403, `(status ${r3.status})`);
await r3.body?.cancel();

const del = await fetch(await client.sign(`${endpoint}${new URL(u1).pathname}`, { method: 'DELETE' }));
console.log(`cleanup DELETE ${del.status}`);
Deno.exit(failed ? 1 : 0);
