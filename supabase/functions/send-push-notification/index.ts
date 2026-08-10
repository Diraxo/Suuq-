// Suuq+ push delivery — invoked by the `on_notification_insert_push` trigger
// (supabase/migrations/0012_push_notifications.sql) once per new row inserted
// into public.notifications, for every notification type. Talks to Google's
// FCM HTTP v1 API directly (no legacy API, no Expo push relay) using a
// service-account JWT signed with Web Crypto — no npm/firebase-admin
// dependency needed in Deno. The service account JSON is read from an Edge
// Function secret (`supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON=...`)
// and never touches the client app. The FCM project id is read from that same
// JSON (`project_id`) rather than hardcoded.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

type NotificationRow = {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  type: string | null;
  data: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
};

type WebhookPayload = {
  type: string;
  table: string;
  record: NotificationRow;
  schema: string;
  old_record: NotificationRow | null;
};

type DeviceTokenRow = {
  id: string;
  token: string;
  platform: 'android' | 'ios';
};

// notification.type -> the notification_preferences boolean column it's
// gated by. Keyed by every type this function is asked to support, plus the
// legacy literals the existing DB triggers (0012_push_notifications.sql) and
// client (lib/push.ts) already use today, so both naming schemes work.
const TYPE_TO_CATEGORY: Record<string, string> = {
  chat_message: 'chat',
  message: 'chat',
  new_offer: 'offers',
  offer_new: 'offers',
  offer_accepted: 'offers',
  offer_declined: 'offers',
  offer_rejected: 'offers',
  offer_countered: 'offers',
  offer_cancelled: 'offers',
  offer_expired: 'offers',
  favorite: 'favorites',
  follow: 'followers',
  review: 'reviews',
  price_drop: 'price_drops',
  listing_sold: 'system',
  listing_reserved: 'system',
  report_result: 'system',
  system: 'system',
};

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlFromString(input: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(input));
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function loadServiceAccount(): ServiceAccount {
  const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON secret is not set');

  let serviceAccount: ServiceAccount;
  try {
    serviceAccount = JSON.parse(raw) as ServiceAccount;
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON secret is not valid JSON');
  }
  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing project_id, client_email, or private_key');
  }
  return serviceAccount;
}

let cachedToken: { token: string; projectId: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<{ accessToken: string; projectId: string }> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return { accessToken: cachedToken.token, projectId: cachedToken.projectId };
  }

  const serviceAccount = loadServiceAccount();

  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: serviceAccount.client_email,
    scope: FCM_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  };

  const unsigned = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${base64UrlFromBytes(new Uint8Array(signature))}`;

  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!resp.ok) throw new Error(`Google token exchange failed: ${resp.status} ${await resp.text()}`);
  const json = (await resp.json()) as { access_token: string; expires_in: number };

  cachedToken = {
    token: json.access_token,
    projectId: serviceAccount.project_id,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return { accessToken: cachedToken.token, projectId: cachedToken.projectId };
}

function stringifyDataValues(data: Record<string, unknown> | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

// Whoever triggered the notification — the raw `data` jsonb uses different key
// names per type (followerId, reviewerId, buyerId, ...); normalize the first
// one present into a single `senderId` field, without dropping the original key.
function pickSenderId(data: Record<string, unknown> | null): string | undefined {
  if (!data) return undefined;
  const candidate =
    data.senderId ?? data.followerId ?? data.reviewerId ?? data.buyerId ?? data.actorId ?? data.fromUserId;
  if (candidate === null || candidate === undefined) return undefined;
  return typeof candidate === 'string' ? candidate : JSON.stringify(candidate);
}

function buildDataPayload(notification: NotificationRow): Record<string, string> {
  const payload: Record<string, string> = {
    ...stringifyDataValues(notification.data),
    type: notification.type ?? 'system',
    notificationId: notification.id,
    title: notification.title ?? '',
    body: notification.body ?? '',
  };

  const senderId = pickSenderId(notification.data);
  if (senderId !== undefined) payload.senderId = senderId;

  return payload;
}

// FCM's HTTP v1 error body: { error: { status: 'UNREGISTERED' | 'INVALID_ARGUMENT' | ..., message, ... } }
function parseFcmErrorStatus(errText: string): string | null {
  try {
    const parsed = JSON.parse(errText) as { error?: { status?: string } };
    return parsed.error?.status ?? null;
  } catch {
    return null;
  }
}

// Constant-time comparison so a mismatched secret can't be brute-forced via
// response-time differences.
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  // Only the on_notification_insert_push DB trigger (supabase/migrations/
  // 0019_security_hardening.sql) is meant to call this function — it sends
  // this header with a secret only Postgres can read. Fails closed: if the
  // secret env var isn't set yet, every request is rejected rather than
  // trusted. See that migration's header comment for the one-time setup step.
  const expectedSecret = Deno.env.get('PUSH_WEBHOOK_SECRET');
  const providedSecret = req.headers.get('X-Push-Webhook-Secret');
  if (!expectedSecret || !providedSecret || !timingSafeEqual(providedSecret, expectedSecret)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: WebhookPayload;
  try {
    payload = (await req.json()) as WebhookPayload;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const notification = payload.record;
  if (!notification?.user_id || !notification?.id) {
    return new Response(JSON.stringify({ skipped: 'no user_id/id on record' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY secrets are not set');
    }
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const category = notification.type ? (TYPE_TO_CATEGORY[notification.type] ?? 'system') : 'system';

    const { data: prefs, error: prefsError } = await supabaseAdmin
      .from('notification_preferences')
      .select('*')
      .eq('user_id', notification.user_id)
      .maybeSingle();
    if (prefsError) throw new Error(`Failed to load notification_preferences: ${prefsError.message}`);

    // No preferences row yet = every category defaults to enabled.
    if (prefs && prefs[category] === false) {
      return new Response(JSON.stringify({ skipped: `category '${category}' disabled` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data: tokens, error: tokensError } = await supabaseAdmin
      .from('device_tokens')
      .select('id, token, platform')
      .eq('user_id', notification.user_id)
      .eq('active', true);
    if (tokensError) throw new Error(`Failed to load device_tokens: ${tokensError.message}`);

    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ skipped: 'no active device tokens' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { count: unreadCount } = await supabaseAdmin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', notification.user_id)
      .eq('read', false);

    const { accessToken, projectId } = await getAccessToken();
    const fcmSendUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
    const dataPayload = buildDataPayload(notification);
    const imageUrl =
      typeof notification.data?.imageUrl === 'string' ? notification.data.imageUrl : undefined;

    // TEMP QA LOGGING — pre-publish notification device testing only. Set the
    // PUSH_QA_LOGGING=1 secret to enable, unset it (or delete this block) once
    // the checklist in the pre-publish QA pass is done.
    const qaLogging = Deno.env.get('PUSH_QA_LOGGING') === '1';

    let sent = 0;
    let deactivated = 0;
    const failures: string[] = [];

    for (const row of tokens as DeviceTokenRow[]) {
      const message = {
        message: {
          token: row.token,
          notification: {
            title: notification.title,
            body: notification.body ?? '',
            ...(imageUrl ? { image: imageUrl } : {}),
          },
          data: dataPayload,
          android: {
            priority: 'high',
            notification: { channel_id: 'default', sound: 'default' },
          },
          apns: {
            payload: {
              aps: {
                sound: 'default',
                badge: unreadCount ?? 0,
              },
            },
          },
        },
      };

      const resp = await fetch(fcmSendUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      if (resp.ok) {
        sent++;
        if (qaLogging) {
          console.log('[QA-LOG] push sent', { tokenId: row.id, platform: row.platform, type: notification.type, notificationId: notification.id });
        }
        continue;
      }

      const errText = await resp.text();
      const status = parseFcmErrorStatus(errText);
      const isDeadToken =
        status === 'UNREGISTERED' || status === 'INVALID_ARGUMENT' || status === 'NOT_FOUND';

      if (isDeadToken) {
        const { error: deactivateError } = await supabaseAdmin
          .from('device_tokens')
          .update({ active: false })
          .eq('id', row.id);
        if (deactivateError) {
          console.error('[send-push-notification] failed to deactivate token', row.id, deactivateError.message);
        }
        deactivated++;
      } else {
        console.error('[send-push-notification] FCM send failed', {
          tokenId: row.id,
          status: resp.status,
          body: errText,
        });
        failures.push(errText);
      }
    }

    return new Response(JSON.stringify({ sent, deactivated, failed: failures.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[send-push-notification] error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
