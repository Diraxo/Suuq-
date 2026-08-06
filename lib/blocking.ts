import { useMemo } from 'react';
import { useBlockedUsersStore } from '@/store/blockedUsers';

/** Ids blocked in either direction (people I blocked, and people who blocked
 *  me) — client-side gate used to hide profiles/listings and refuse
 *  chat/offers/reviews/follow in both directions. Not a substitute for
 *  server-side RLS, which is out of scope for this pass. */
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
