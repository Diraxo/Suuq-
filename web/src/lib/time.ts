import { getT } from './i18n';

// Web equivalent of data/time.ts on mobile. The wording comes from the same
// locale files (time.*) in the language chosen in the language store.
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatRelativeTime(timestamp: number): string {
  const t = getT();
  const diff = Date.now() - timestamp;
  if (diff < MINUTE) return t('time.justNow');
  if (diff < HOUR) return t('time.minutesAgo', { count: Math.floor(diff / MINUTE) });
  if (diff < DAY) return t('time.hoursAgo', { count: Math.floor(diff / HOUR) });
  const days = Math.floor(diff / DAY);
  if (days === 1) return t('time.yesterday');
  return t('time.daysAgo', { count: days });
}
