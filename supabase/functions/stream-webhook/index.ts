// Suuq+ Stream Chat -> push notification bridge.
//
// Stream now owns message storage (see supabase/migrations/0013_chat_stream_cutover.sql),
// so the old `on_message_insert` trigger that turned a `public.messages` insert
// into a `public.notifications` row (-> real FCM push, via
// supabase/functions/send-push-notification) no longer fires. This function
// re-points the same pipeline at Stream: configure a webhook in the Stream
// dashboard for the `message.new` event pointing at this function's URL, and
// every chat message keeps producing exactly the notification row
// handle_new_message() used to (same title/body/type/data shape), so the
// existing FCM delivery is unaffected.
//
// Every request is verified against Stream's HMAC-SHA256 `X-Signature` header
// (hex digest over the raw body, per https://getstream.io/chat/docs/php/webhooks-overview/)
// before anything in the payload is trusted.

import { createClient } from 'jsr:@supabase/supabase-js@2';

type StreamMember = { user_id: string };
type StreamWebhookEvent = {
  type: string;
  channel_id?: string;
  message?: { text?: string; user?: { id?: string } };
  user?: { id?: string };
  members?: StreamMember[];
};

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('X-Signature') ?? req.headers.get('x-signature');
    const secret = Deno.env.get('STREAM_API_SECRET');
    if (!secret) throw new Error('STREAM_API_SECRET secret is not set');

    if (!signature) {
      return new Response(JSON.stringify({ error: 'Missing X-Signature header' }), { status: 401 });
    }
    const expected = await hmacSha256Hex(secret, rawBody);
    if (!timingSafeEqual(expected, signature)) {
      return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401 });
    }

    const event = JSON.parse(rawBody) as StreamWebhookEvent;

    if (event.type !== 'message.new') {
      return new Response(JSON.stringify({ skipped: `event type '${event.type}' ignored` }), { status: 200 });
    }

    const conversationId = event.channel_id;
    const senderId = event.message?.user?.id ?? event.user?.id;
    const text = event.message?.text ?? '';
    const recipientId = event.members?.find((m) => m.user_id !== senderId)?.user_id;

    if (!conversationId || !senderId || !recipientId) {
      return new Response(JSON.stringify({ skipped: 'incomplete event payload' }), { status: 200 });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const [{ data: sender }, { data: conversation }] = await Promise.all([
      supabaseAdmin.from('profiles').select('full_name').eq('id', senderId).maybeSingle(),
      supabaseAdmin.from('conversations').select('listing_id').eq('id', conversationId).maybeSingle(),
    ]);

    let listingTitle: string | null = null;
    if (conversation?.listing_id) {
      const { data: listing } = await supabaseAdmin
        .from('listings')
        .select('title')
        .eq('id', conversation.listing_id)
        .maybeSingle();
      listingTitle = listing?.title ?? null;
    }

    const senderName = sender?.full_name ?? 'Someone';

    await supabaseAdmin.from('notifications').insert({
      user_id: recipientId,
      title: `${senderName} sent you a message`,
      body: listingTitle ?? text,
      type: 'message',
      data: { conversationId },
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[stream-webhook] error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 200 });
  }
});
