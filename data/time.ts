import i18n from '@/lib/i18n';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Formats a real timestamp (ms since epoch) as a relative string, e.g. "2 hours ago". */
export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < MINUTE) return i18n.t('time.justNow');
  if (diff < HOUR) return i18n.t('time.minutesAgo', { count: Math.floor(diff / MINUTE) });
  if (diff < DAY) return i18n.t('time.hoursAgo', { count: Math.floor(diff / HOUR) });
  const days = Math.floor(diff / DAY);
  if (days === 1) return i18n.t('time.yesterday');
  return i18n.t('time.daysAgo', { count: days });
}

/** Listings created with a real `createdAt` get a live relative time; older/mock listings fall back to their static label. */
export function listingPostedLabel(listing: { postedAt: string; createdAt?: number }): string {
  return listing.createdAt ? formatRelativeTime(listing.createdAt) : listing.postedAt;
}
