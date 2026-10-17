// Builds the presigned R2 PUT URL for r2-presign. Kept separate so a Deno test
// can assert the generated URL without any network or Supabase.
//
// Two aws4fetch@1.0.20 behaviours this exists to get right (verified in its source):
//  * `aws.expires` is NOT an option. X-Amz-Expires is only read from the URL's
//    query string and otherwise defaults to 86400 (24 h). We set it explicitly.
//  * `content-type` is in aws4fetch's UNSIGNABLE_HEADERS, so it is silently left
//    out of X-Amz-SignedHeaders unless `allHeaders: true`. With it, the signature
//    covers content-type and R2 rejects a PUT that declares anything else.
// Only host + content-type are ever set as headers here, so allHeaders adds nothing else.

import type { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

export const PRESIGN_EXPIRES_SECONDS = 300;
export const UPLOAD_CONTENT_TYPE = 'image/jpeg';

// `datetime` (AWS basic ISO format) exists only so the throwaway-bucket probe can mint an already-expired URL.
export async function presignPut(client: AwsClient, objectUrl: string, datetime?: string): Promise<string> {
  const url = new URL(objectUrl);
  url.searchParams.set('X-Amz-Expires', String(PRESIGN_EXPIRES_SECONDS));
  const signed = await client.sign(url.toString(), {
    method: 'PUT',
    headers: { 'Content-Type': UPLOAD_CONTENT_TYPE },
    aws: { signQuery: true, allHeaders: true, ...(datetime ? { datetime } : {}) },
  });
  return signed.url;
}
