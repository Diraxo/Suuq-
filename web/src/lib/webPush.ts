// Browser / home-screen Web Push registration. The server side lives in supabase/functions/send-push-notification.
import { supabase } from '@/lib/supabase';

export type WebPushState = 'unsupported' | 'unconfigured' | 'denied' | 'off' | 'on';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function supported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function keyToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function webPushState(): Promise<WebPushState> {
  if (!supported()) return 'unsupported';
  if (!VAPID_PUBLIC_KEY) return 'unconfigured';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

async function save(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  const { error } = await supabase.rpc('register_web_push', {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh ?? '',
    p_auth: json.keys?.auth ?? '',
    p_user_agent: navigator.userAgent,
  });
  if (error) throw new Error(error.message);
}

/** Asks permission (must be called from a tap) and registers this device. */
export async function enableWebPush(): Promise<WebPushState> {
  if (!supported()) return 'unsupported';
  if (!VAPID_PUBLIC_KEY) return 'unconfigured';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(VAPID_PUBLIC_KEY) as BufferSource }));
  await save(sub);
  return 'on';
}

/** Re-saves an existing subscription for the signed-in account (e.g. after another account used this browser). */
export async function syncWebPush(): Promise<void> {
  if ((await webPushState()) !== 'on') return;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await save(sub);
}
