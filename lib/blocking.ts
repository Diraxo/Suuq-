import { useMemo } from 'react';
import { useBlockedUsersStore } from '@/store/blockedUsers';

/** Ids blocked in either direction (people I blocked, and people who blocked
 *  me) — client-side gate used to hide profiles/listings and refuse
 *  chat/offers/reviews/follow in both directions. Only a UI convenience: the
 *  database is the authority (0043 read RPCs; proposed 0044 base-table policy + chat/offer guards). `blockedByIds` is
 *  always empty by design — blocked_users is private, so a blocked user can't learn who blocked them; the server just
 *  answers "not found" / refuses. */
export function useBlockedEitherWayIds(): Set<string> {
  const blocked = useBlockedUsersStore((s) => s.blocked);
  const blockedByIds = useBlockedUsersStore((s) => s.blockedByIds);
  return useMemo(() => new Set<string>([...blocked.map((b) => b.id), ...blockedByIds]), [blocked, blockedByIds]);
}

export function isBlockedEitherWaySync(userId: string): boolean {
  const { blocked, blockedByIds } = useBlockedUsersStore.getState();
  return blocked.some((b) => b.id === userId) || blockedByIds.includes(userId);
}

export function filterBlockedSellers<T extends { seller: { id: string } }>(items: T[], blockedIds: Set<string>): T[] {
  if (blockedIds.size === 0) return items;
  return items.filter((item) => !blockedIds.has(item.seller.id));
}
