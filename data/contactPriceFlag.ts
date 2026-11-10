// Local-only override for the Contact-for-price switch (see docs/CONTACT_PRICE_LOCAL_TEST.md). The shipped value stays false.
// The override needs ALL of: a development bundle, EXPO_PUBLIC_CONTACT_PRICE_LOCAL=true, and a Supabase URL that points at THIS machine or its LAN (allow-list, below) and is NOT the
// production project. A store/production build has no development bundle, so it can never turn this on, even if the variable leaks in.
export const PRODUCTION_PROJECT_REF = 'waksddinkjbrggxkfofk';

// Allow-list, not block-list: only a database on this machine or its LAN qualifies (localhost, 127.0.0.1, ::1, Android-emulator 10.0.2.2, private
// 10.x / 192.168.x / 172.16-31.x addresses, *.local). Any hosted Supabase project, custom domain or proxy fails, whatever its name or letter case.
// The production-ref check stays as a second, independent refusal. No URL parser: React Native's URL.hostname is not reliable on every engine.
const LOCAL_HOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|[a-z0-9-]+\.local)(?::\d{1,5})?(?:[/?#]|$)/i;

export function contactPriceLocalOverride(opts: { dev: boolean; flag?: string; supabaseUrl?: string }): boolean {
  const url = (opts.supabaseUrl ?? '').trim();
  return opts.dev && opts.flag === 'true' && LOCAL_HOST.test(url) && !url.toLowerCase().includes(PRODUCTION_PROJECT_REF);
}

export const CONTACT_PRICE_LOCAL_OVERRIDE = contactPriceLocalOverride({
  dev: (globalThis as { __DEV__?: boolean }).__DEV__ === true,
  flag: process.env.EXPO_PUBLIC_CONTACT_PRICE_LOCAL,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
});
