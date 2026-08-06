const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Formats a real timestamp (ms since epoch) as a relative string, e.g. "2 hours ago". */
export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < MINUTE) return 'Just now';
  if (diff < HOUR) {
    const mins = Math.floor(diff / MINUTE);
    return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  }
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(diff / DAY);
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

/** Listings created with a real `createdAt` get a live relative time; older/mock listings fall back to their static label. */
export function listingPostedLabel(listing: { postedAt: string; createdAt?: number }): string {
  return listing.createdAt ? formatRelativeTime(listing.createdAt) : listing.postedAt;
}
