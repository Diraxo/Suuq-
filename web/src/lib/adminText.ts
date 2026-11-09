// Wording for the staff console: raw database values ("grant_boost", "awaiting_staff") become sentences a reviewer reads at a glance.
// Pure (no React), so it is tested in node.

/** "grant_boost" → "Grant boost"; "awaitingStaff" → "Awaiting staff". Used when a value has no hand-written label. */
export function sentenceCase(raw: string): string {
  const spaced = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : '';
}

const AUDIT_ACTIONS: Record<string, string> = {
  report_status_change: 'Updated report status',
  warn_user: 'Warned user',
  suspend_user: 'Suspended user',
  unsuspend_user: 'Lifted suspension',
  ban_user: 'Banned user',
  unban_user: 'Lifted ban',
  remove_listing: 'Removed listing',
  restore_listing: 'Restored listing',
  verify_user: 'Verified user',
  unverify_user: 'Removed verification',
  grant_boost: 'Granted a boost',
  revoke_boost: 'Revoked a boost',
};

/** The label of a moderation-history entry; an action nobody wrote a label for is still readable. */
export const auditActionLabel = (action: string): string => AUDIT_ACTIONS[action] ?? sentenceCase(action);

/** The kind of thing an action touched ("listing", "user", ...). */
export const targetLabel = (target: string): string => sentenceCase(target);

/** One line of "1 listing" / "3 listings". */
export const plural = (n: number, noun: string): string => `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`;

/** Result line under a filter bar: "123 listings · page 2 of 5", or just the count when everything fits on one page. */
export function resultLine(total: number, noun: string, page: number, pages: number): string {
  return pages > 1 ? `${plural(total, noun)} · page ${page + 1} of ${pages}` : plural(total, noun);
}

/** A list that silently stops at its query limit must say so, or a reviewer assumes the missing rows do not exist. */
export const cappedNotice = (shown: number, limit: number, noun: string): string | null =>
  shown >= limit ? `Showing the ${limit} newest ${noun}s. Search or filter to find a specific one.` : null;
