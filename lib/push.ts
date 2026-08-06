import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import messaging, { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';

// Centralized push notification service — the single place that talks to
// @react-native-firebase/messaging and Supabase's device_tokens table. See
// supabase/functions/send-push-notification for the server side, and
// supabase/migrations/0012_push_notifications.sql for the schema.

export type PushType =
  | 'message'
  | 'offer_new'
  | 'offer_accepted'
  | 'offer_rejected'
  | 'offer_countered'
  | 'offer_cancelled'
  | 'offer_expired'
  | 'favorite'
  | 'follow'
  | 'review'
  | 'price_drop'
  | 'listing_sold'
  | 'report_result'
  | 'system';

export type PushData = { type?: string; id?: string; [key: string]: string | undefined };

const DEVICE_ID_KEY = 'push_device_id';
const ASKED_PERMISSION_KEY_PREFIX = 'push_asked_permission_';

type ForegroundHandler = (title: string, body: string) => void;
let foregroundHandler: ForegroundHandler | null = null;
let unsubscribeOnMessage: (() => void) | null = null;
let unsubscribeTokenRefresh: (() => void) | null = null;

function generateDeviceId(): string {
  // Stable per-install identifier — not cryptographic, just needs to be
  // unique enough to key one row per device in device_tokens.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const generated = generateDeviceId();
  await AsyncStorage.setItem(DEVICE_ID_KEY, generated);
  return generated;
}

async function upsertToken(userId: string, token: string) {
  const deviceId = await getDeviceId();
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  await supabase
    .from('device_tokens')
    .upsert(
      { user_id: userId, device_id: deviceId, token, platform, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,device_id' }
    );
}

// Exported so the in-app Notifications list (app/notifications.tsx) can
// route a tap through the exact same type -> screen mapping remote push taps
// already use, instead of duplicating it.
export function navigateForPush(data: PushData) {
  switch (data.type as PushType | undefined) {
    case 'message':
      if (data.conversationId) router.push(`/chat/${data.conversationId}` as never);
      break;
    case 'favorite':
    case 'price_drop':
      if (data.listingId) router.push(`/listing/${data.listingId}` as never);
      break;
    case 'follow':
      if (data.followerId) router.push(`/seller/${data.followerId}` as never);
      break;
    case 'review':
      // Always routes the recipient (the seller being reviewed) to their own
      // "reviews about me" list — not /seller/[sellerId], which is the
      // recipient's own profile page and hides the reviews block for isSelf.
      router.push('/reviews' as never);
      break;
    case 'offer_new':
    case 'offer_accepted':
    case 'offer_rejected':
    case 'offer_countered':
    case 'offer_cancelled':
    case 'offer_expired':
      if (data.listingId) router.push(`/offers?listingId=${data.listingId}` as never);
      break;
    case 'listing_sold':
      router.push('/seller-dashboard' as never);
      break;
    case 'report_result':
      router.push('/notifications' as never);
      break;
    default:
      // Unrecognized/legacy (pre-type-column) rows have nowhere better to
      // go than the list itself — replace, not push, so tapping one while
      // already on Notifications (or a string of them from a killed-app
      // launch) never stacks duplicate Notifications screens.
      router.replace('/notifications' as never);
  }
}

// FCM messages are sent referencing android.notification.channel_id: 'default'
// (see supabase/functions/send-push-notification) — Android silently drops
// any notification whose channel doesn't exist on-device, so this must run
// before a push can ever show a tray entry, sound, or vibration.
let channelReady: Promise<void> | null = null;
function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  if (!channelReady) {
    channelReady = Notifications.setNotificationChannelAsync('default', {
      name: 'Suuq+',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4F46E5',
    }).then(() => undefined);
  }
  return channelReady;
}

export const push = {
  /** Call once after a session exists (login, app-start-with-session). Safe to call repeatedly. */
  async register(userId: string) {
    if (Platform.OS === 'web') return;
    try {
      await ensureAndroidChannel();
      const askedKey = `${ASKED_PERMISSION_KEY_PREFIX}${userId}`;
      const alreadyAsked = await AsyncStorage.getItem(askedKey);

      let authStatus = await messaging().hasPermission();
      if (authStatus === messaging.AuthorizationStatus.NOT_DETERMINED && !alreadyAsked) {
        authStatus = await messaging().requestPermission();
        await AsyncStorage.setItem(askedKey, '1');
      }

      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;
      if (!enabled) return;

      const token = await messaging().getToken();
      await upsertToken(userId, token);

      unsubscribeTokenRefresh?.();
      unsubscribeTokenRefresh = messaging().onTokenRefresh((newToken) => {
        upsertToken(userId, newToken).catch(() => {});
      });

      unsubscribeOnMessage?.();
      unsubscribeOnMessage = messaging().onMessage(async (remoteMessage) => {
        const { notification } = remoteMessage;
        if (notification && foregroundHandler) {
          foregroundHandler(notification.title ?? '', notification.body ?? '');
        }
      });
    } catch (err) {
      if (__DEV__) console.log('[push] register failed:', err);
    }
  },

  /** Call on sign-out — removes only this device's token row. */
  async unregister(userId: string) {
    unsubscribeOnMessage?.();
    unsubscribeOnMessage = null;
    unsubscribeTokenRefresh?.();
    unsubscribeTokenRefresh = null;
    try {
      const deviceId = await getDeviceId();
      await supabase.from('device_tokens').delete().eq('user_id', userId).eq('device_id', deviceId);
    } catch (err) {
      if (__DEV__) console.log('[push] unregister failed:', err);
    }
  },

  /** Whether the OS notification permission was denied (not just "never asked"). */
  async isPermissionDenied(): Promise<boolean> {
    if (Platform.OS === 'web') return false;
    const status = await messaging().hasPermission();
    return status === messaging.AuthorizationStatus.DENIED;
  },

  /** Foreground pushes never trigger a system banner — call this once (e.g. from a root layout) to render your own. */
  onForegroundMessage(handler: ForegroundHandler) {
    foregroundHandler = handler;
    return () => {
      if (foregroundHandler === handler) foregroundHandler = null;
    };
  },

  handleTap(remoteMessage: FirebaseMessagingTypes.RemoteMessage) {
    const data = remoteMessage.data as PushData | undefined;
    if (data?.type) navigateForPush(data);
  },

  /** Call once at startup: handles the tap that launched the app from a killed state. */
  async consumeInitialNotification() {
    const remoteMessage = await messaging().getInitialNotification();
    if (remoteMessage) this.handleTap(remoteMessage);
  },

  /** Call once at startup: handles taps while the app is backgrounded (not killed). */
  listenForTaps() {
    return messaging().onNotificationOpenedApp((remoteMessage) => this.handleTap(remoteMessage));
  },

  async setBadge(count: number) {
    try {
      await Notifications.setBadgeCountAsync(Math.max(0, count));
    } catch {
      // Badge API unavailable (e.g. web) — non-fatal.
    }
  },
};
