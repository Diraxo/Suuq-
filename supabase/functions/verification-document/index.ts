// Gives staff with `business_review` a short-lived signed URL for ONE verification document. This is the only staff path to the
// bytes: the Storage policy lets only the owner read their folder. Order matters: the audited RPC runs under the CALLER's JWT
// (it checks staff_can('business_review') and that the path belongs to the request, and writes the audit row); only after it
// succeeds does the service role sign the URL. A staff client calling Storage directly gets nothing.
// All request handling lives in _shared/verificationDocumentHandler.ts (unit-tested); this file only wires the real clients.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleVerificationDocument } from '../_shared/verificationDocumentHandler.ts';

const BUCKET = 'storefront-verification';

Deno.serve((req) => {
  const url = Deno.env.get('SUPABASE_URL')!;
  return handleVerificationDocument(req, {
    authorize: async (authHeader, requestId, path) => {
      const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
      const { data, error } = await asCaller.rpc('admin_authorize_verification_document', { p_request: requestId, p_path: path });
      return { data, error: error ? { code: error.code, message: error.message, status: (error as { status?: number }).status } : null };
    },
    sign: async (path, ttl) => {
      const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, ttl);
      return { signedUrl: data?.signedUrl ?? null, error };
    },
    log: (event, data) => console.log(JSON.stringify({ scope: 'verification-document', event, ...data })),
  });
});
