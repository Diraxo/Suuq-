// deno test supabase/functions/_shared/presign.test.ts
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';
import { presignPut } from './presign.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

Deno.test('presigned PUT: exactly one 300 s expiry, content-type signed', async () => {
  const client = new AwsClient({ accessKeyId: 'AKIATEST', secretAccessKey: 'secret', service: 's3', region: 'auto' });
  const u = new URL(await presignPut(client, 'https://acct.r2.cloudflarestorage.com/bucket/listings/u/x.jpg'));
  assert(u.searchParams.getAll('X-Amz-Expires').length === 1, 'exactly one X-Amz-Expires');
  assert(u.searchParams.get('X-Amz-Expires') === '300', 'expires is 300');
  assert(u.searchParams.get('X-Amz-SignedHeaders') === 'content-type;host', `signed headers: ${u.searchParams.get('X-Amz-SignedHeaders')}`);
  assert(u.searchParams.getAll('X-Amz-Signature').length === 1, 'one signature');
  assert(u.pathname === '/bucket/listings/u/x.jpg', 'path unchanged');
});

Deno.test('signature depends on content type (not the same as an unsigned-content-type URL)', async () => {
  const client = new AwsClient({ accessKeyId: 'AKIATEST', secretAccessKey: 'secret', service: 's3', region: 'auto' });
  const obj = 'https://acct.r2.cloudflarestorage.com/bucket/k.jpg';
  const a = new URL(await presignPut(client, obj)).searchParams.get('X-Amz-Signature');
  const b = new URL((await client.sign(obj + '?X-Amz-Expires=300', { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, aws: { signQuery: true } })).url).searchParams.get('X-Amz-Signature');
  assert(a !== b, 'content-type must change the signature');
});
