'use client';

// Mirrors lib/blocking.ts on mobile — client-side gate used to hide/refuse
// chat and offers in both directions. Not a substitute for server-side RLS.
import { useMemo } from 'react';
import { useBlockedUsersStore } from '@/store/blockedUsers';

export function useBlockedEitherWayIds(): Set<string> {
  const blocked = useBlockedUsersStore((s) => s.blocked);
  const blockedByIds = useBlockedUsersStore((s) => s.blockedByIds);
  return useMemo(() => new Set<string>([...blocked.map((b) => b.id), ...blockedByIds]), [blocked, blockedByIds]);
}

export function isBlockedEitherWaySync(userId: string): boolean {
  const { blocked, blockedByIds } = useBlockedUsersStore.getState();
  return blocked.some((b) => b.id === userId) || blockedByIds.includes(userId);
}
