// Suuq+ Stream Chat auth — mints a short-lived Stream user token for the
// calling Supabase user. This is the ONLY place a Stream Chat token is ever
// created; the client never signs its own token (STREAM_API_SECRET never
// leaves this function). Stream user tokens are just HS256 JWTs signed with
// the app's API secret (`{user_id}` claim) — same hand-rolled Web Crypto JWT
// approach already used for the Google service-account JWT in
// supabase/functions/send-push-notification/index.ts, so no stream-chat/node
// SDK dependency is needed in Deno.
//
// The secret is read from an Edge Function secret
// (`supabase secrets set STREAM_API_SECRET=...`) and never touches the client.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const STREAM_TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24h — client refetches via tokenProvider on expiry.

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlFromString(input: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(input));
}

async function signStreamToken(userId: string, secret: string): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const claims = { user_id: userId, iat: nowSec, exp: nowSec + STREAM_TOKEN_TTL_SECONDS };

  const unsigned = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401 });
    }
    const jwt = authHeader.slice('Bearer '.length);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(jwt);

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
    }

    const secret = Deno.env.get('STREAM_API_SECRET');
    if (!secret) throw new Error('STREAM_API_SECRET secret is not set');

    const token = await signStreamToken(user.id, secret);

    return new Response(JSON.stringify({ token, userId: user.id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[stream-token] error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
