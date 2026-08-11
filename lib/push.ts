import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import messaging, { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { getLastPath } from '@/lib/lastRoute';

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

export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

const DEVICE_ID_KEY = 'push_device_id';
// Last time the user tapped "Not now" on the in-app permission nudge
// (components/NotificationPermissionBanner) — throttles re-showing it rather
// than gating the OS prompt itself (the OS already refuses to re-prompt on
// its own terms once denied).
const PROMPT_DISMISSED_KEY_PREFIX = 'push_prompt_dismissed_';
const UNDETERMINED_REMIND_MS = 4 * 24 * 60 * 60 * 1000;
const DENIED_REMIND_MS = 7 * 24 * 60 * 60 * 1000;

// TEMP QA LOGGING — pre-publish notification device testing only.
// Search "QA-LOG" to find every call site; delete this block and all call
// sites before the production release.
export function qaLog(stage: string, details?: Record<string, unknown>) {
  if (!__DEV__) return;
  console.log(`[QA-LOG] ${stage}`, details ?? '');
}

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

// Skips navigating if we're already sitting on the exact destination — tapping
// a notification whose destination is the screen you're already viewing (most
// commonly report_result/legacy notifications tapped from within Notifications
// itself) would otherwise slide the same screen in over itself for no reason.
// Query strings (e.g. /offers?listingId=…) can point at a materially
// different target even when the pathname matches, so only dedupe exact,
// query-less paths.
function navigate(path: string, { replace = false }: { replace?: boolean } = {}) {
  if (!path.includes('?') && getLastPath() === path) return;
  if (replace) router.replace(path as never);
  else router.push(path as never);
}

// Exported so the in-app Notifications list (app/notifications.tsx) can
// route a tap through the exact same type -> screen mapping remote push taps
// already use, instead of duplicating it.
export function navigateForPush(data: PushData) {
  qaLog('destination screen opened', { type: data.type, data });
  switch (data.type as PushType | undefined) {
    case 'message':
      if (data.conversationId) navigate(`/chat/${data.conversationId}`);
      break;
    case 'favorite':
    case 'price_drop':
      if (data.listingId) navigate(`/listing/${data.listingId}`);
      break;
    case 'follow':
      if (data.followerId) navigate(`/seller/${data.followerId}`);
      break;
    case 'review':
      // Always routes the recipient (the seller being reviewed) to their own
      // "reviews about me" list — not /seller/[sellerId], which is the
      // recipient's own profile page and hides the reviews block for isSelf.
      navigate('/reviews');
      break;
    case 'offer_new':
    case 'offer_accepted':
    case 'offer_rejected':
    case 'offer_countered':
    case 'offer_cancelled':
    case 'offer_expired':
      if (data.listingId) navigate(`/offers?listingId=${data.listingId}`);
      break;
    case 'listing_sold':
      navigate('/seller-dashboard');
      break;
    case 'report_result':
      navigate('/notifications');
      break;
    default:
      // Unrecognized/legacy (pre-type-column) rows have nowhere better to
      // go than the list itself — replace, not push, so tapping one while
      // already on Notifications (or a string of them from a killed-app
      // launch) never stacks duplicate Notifications screens.
      navigate('/notifications', { replace: true });
  }
}

// FCM messages are sent referencing android.notification.channel_id (see
// supabase/functions/send-push-notification) — Android silently drops any
// notification whose channel doesn't exist on-device, so this must run
// before a push can ever show a tray entry, sound, or vibration.
//
// Named 'default_v2', not 'default': Android channel importance is
// immutable once a channel id is created on a device — an app can never
// raise it later by calling setNotificationChannelAsync again, only the
// user can (Settings) or an uninstall can. Some installs created 'default'
// before this file consistently set importance: HIGH, so devices holding
// that channel are permanently capped below HIGH (no heads-up, tray-only)
// no matter what this code does. Shipping under a new channel id forces a
// fresh HIGH-importance channel on every device, including those already
// stuck on the old one. Do not rename this back to 'default'.
const ANDROID_CHANNEL_ID = 'default_v2';

let channelReady: Promise<void> | null = null;
function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  if (!channelReady) {
    channelReady = Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Fursad',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4F46E5',
    }).then(() => undefined);
  }
  return channelReady;
}

// Shared by register() (silent — only proceeds if permission is already
// granted) and requestPermissionAndRegister() (after the user has just
// granted it) — token upsert + foreground listeners are identical either way.
async function finishRegistration(userId: string) {
  const token = await messaging().getToken();
  await upsertToken(userId, token);

  unsubscribeTokenRefresh?.();
  unsubscribeTokenRefresh = messaging().onTokenRefresh((newToken) => {
    upsertToken(userId, newToken).catch(() => {});
  });

  unsubscribeOnMessage?.();
  unsubscribeOnMessage = messaging().onMessage(async (remoteMessage) => {
    const { notification, data } = remoteMessage;
    qaLog('notification received (foreground)', { type: data?.type, data });
    if (!notification) return;

    // useConversationChannel already updates this screen in realtime
    // (message list, read state) while it's open, so surfacing the push
    // banner on top of the conversation you're already looking at would
    // just be a duplicate alert for the same message.
    const pushData = data as PushData | undefined;
    if (pushData?.type === 'message' && pushData.conversationId && getLastPath() === `/chat/${pushData.conversationId}`) {
      qaLog('foreground banner suppressed (already viewing chat)', { conversationId: pushData.conversationId });
      return;
    }

    foregroundHandler?.(notification.title ?? '', notification.body ?? '');

    // RNFirebase's onMessage() intercepts FCM notification-payload
    // messages while the app is foregrounded — Android never
    // auto-presents those as a system notification in that state (unlike
    // background/killed, which the OS handles natively). The in-app
    // PushBanner above covers in-app UX, but the product requirement is a
    // real, visible Android system notification too, so present one
    // explicitly on the same HIGH-importance channel background pushes use.
    if (Platform.OS === 'android') {
      try {
        await ensureAndroidChannel();
        await Notifications.scheduleNotificationAsync({
          content: {
            title: notification.title ?? '',
            body: notification.body ?? '',
            data: pushData ?? {},
            sound: 'default',
          },
          trigger: { channelId: ANDROID_CHANNEL_ID },
        });
      } catch (err) {
        if (__DEV__) console.log('[push] foreground local notification failed:', err);
      }
    }
  });
}

export const push = {
  /**
   * Call once after a session exists (login, app-start-with-session). Safe to
   * call repeatedly. Never shows the OS permission dialog — it only finishes
   * token registration if permission was already granted in an earlier
   * session. To actually ask the user, call requestPermissionAndRegister()
   * from an explicit "Allow"/"Turn on" tap (see NotificationPermissionBanner).
   */
  async register(userId: string) {
    if (Platform.OS === 'web') return;
    try {
      await ensureAndroidChannel();
      const enabled = (await this.getPermissionStatus()) === 'granted';
      if (!enabled) return;
      await finishRegistration(userId);
    } catch (err) {
      if (__DEV__) console.log('[push] register failed:', err);
    }
  },

  /**
   * Shows the native OS permission dialog (only actually prompts when status
   * is 'undetermined' — otherwise the OS just returns the existing state).
   * Call this only from an explicit user action, never automatically.
   */
  async requestPermissionAndRegister(userId: string): Promise<PermissionStatus> {
    if (Platform.OS === 'web') return 'denied';
    try {
      await ensureAndroidChannel();
      let status: PermissionStatus;

      // Android: RNFirebase's hasPermission()/requestPermission() doesn't
      // reliably drive the OS POST_NOTIFICATIONS prompt (Android 13+), so it
      // can report "denied" when the user was never actually asked. Use
      // expo-notifications for the Android OS permission instead; getToken()
      // below still goes through RNFirebase messaging either way.
      if (Platform.OS === 'android') {
        const { status: osStatus } = await Notifications.requestPermissionsAsync();
        status = osStatus === 'granted' ? 'granted' : osStatus === 'denied' ? 'denied' : 'undetermined';
      } else {
        const authStatus = await messaging().requestPermission();
        status =
          authStatus === messaging.AuthorizationStatus.AUTHORIZED || authStatus === messaging.AuthorizationStatus.PROVISIONAL
            ? 'granted'
            : authStatus === messaging.AuthorizationStatus.DENIED
              ? 'denied'
              : 'undetermined';
      }

      if (status === 'granted') await finishRegistration(userId);
      return status;
    } catch (err) {
      if (__DEV__) console.log('[push] requestPermissionAndRegister failed:', err);
      return 'denied';
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

  /** Reads the current OS permission state without prompting. */
  async getPermissionStatus(): Promise<PermissionStatus> {
    if (Platform.OS === 'web') return 'denied';
    if (Platform.OS === 'android') {
      const { status } = await Notifications.getPermissionsAsync();
      return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
    }
    const authStatus = await messaging().hasPermission();
    if (authStatus === messaging.AuthorizationStatus.AUTHORIZED || authStatus === messaging.AuthorizationStatus.PROVISIONAL) {
      return 'granted';
    }
    return authStatus === messaging.AuthorizationStatus.DENIED ? 'denied' : 'undetermined';
  },

  /** Whether the OS notification permission was denied (not just "never asked"). */
  async isPermissionDenied(): Promise<boolean> {
    return (await this.getPermissionStatus()) === 'denied';
  },

  /**
   * Whether the in-app permission nudge (NotificationPermissionBanner) should
   * show right now, and if so, which state it should render for. Returns null
   * when permission is already granted, or when the user dismissed the nudge
   * recently enough that it shouldn't reappear yet.
   */
  async shouldShowPermissionPrompt(userId: string): Promise<PermissionStatus | null> {
    if (Platform.OS === 'web') return null;
    const status = await this.getPermissionStatus();
    if (status === 'granted') return null;

    const dismissedAt = await AsyncStorage.getItem(`${PROMPT_DISMISSED_KEY_PREFIX}${userId}`);
    if (dismissedAt) {
      const threshold = status === 'denied' ? DENIED_REMIND_MS : UNDETERMINED_REMIND_MS;
      if (Date.now() - Number(dismissedAt) < threshold) return null;
    }
    return status;
  },

  /** Call when the user taps "Not now" (or acts on) the in-app permission nudge, to throttle its reappearance. */
  async dismissPermissionPrompt(userId: string) {
    await AsyncStorage.setItem(`${PROMPT_DISMISSED_KEY_PREFIX}${userId}`, String(Date.now()));
  },

  /** Foreground pushes never trigger a system banner — call this once (e.g. from a root layout) to render your own. */
  onForegroundMessage(handler: ForegroundHandler) {
    foregroundHandler = handler;
    return () => {
      if (foregroundHandler === handler) foregroundHandler = null;
    };
  },

  handleTap(remoteMessage: FirebaseMessagingTypes.RemoteMessage, source: 'killed' | 'background') {
    const data = remoteMessage.data as PushData | undefined;
    qaLog(`notification tapped (${source})`, { type: data?.type, data });
    if (data?.type) navigateForPush(data);
  },

  /** Call once at startup: handles the tap that launched the app from a killed state. */
  async consumeInitialNotification() {
    const remoteMessage = await messaging().getInitialNotification();
    if (remoteMessage) this.handleTap(remoteMessage, 'killed');
  },

  /** Call once at startup: handles taps while the app is backgrounded (not killed). */
  listenForTaps() {
    return messaging().onNotificationOpenedApp((remoteMessage) => this.handleTap(remoteMessage, 'background'));
  },

  async setBadge(count: number) {
    try {
      await Notifications.setBadgeCountAsync(Math.max(0, count));
    } catch {
      // Badge API unavailable (e.g. web) — non-fatal.
    }
  },
};
