'use client';

import { createContext, ReactNode, useContext } from 'react';
import { STAFF_CAN, StaffRole } from '@/services/admin';

// The signed-in staff member's role, provided by app/admin/layout.tsx. UX only: it decides which buttons and
// nav entries are shown. Authorization is enforced by the database (staff_can() in migration 0039) — a
// moderator who calls an admin-only RPC directly still gets a 42501.
const StaffRoleContext = createContext<StaffRole | null>(null);

export function StaffRoleProvider({ role, children }: { role: StaffRole; children: ReactNode }) {
  return <StaffRoleContext.Provider value={role}>{children}</StaffRoleContext.Provider>;
}

export function useStaffRole(): StaffRole | null {
  return useContext(StaffRoleContext);
}

export function useStaffCan(action: string): boolean {
  const role = useContext(StaffRoleContext);
  return !!role && STAFF_CAN[role].has(action);
}
