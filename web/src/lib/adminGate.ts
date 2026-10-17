// What /admin/* may render, given only what the client knows. Pure so it can be unit-tested (tests/adminGate.test.ts).
//  - 'pending': auth or the role lookup is still in flight - render nothing (no admin text, no admin data).
//  - 'not-found': signed out, ordinary user, lookup failed, or this role may not use this page - the app's generic 404,
//    identical to an unknown route.
//  - 'allow': the database itself reported a staff role for this session (staff_role() RPC) and it covers this page.
// UX gate only: a tampered response (e.g. an intercepting proxy rewriting staff_role) can at most paint an empty
// shell - every admin query/RPC is independently enforced by RLS / staff_can() inside Postgres.
export type StaffRole = 'admin' | 'moderator' | 'support';
export type AdminGate = 'pending' | 'not-found' | 'allow';

/** What each role may do - mirrors staff_can() in migration 0039. */
export const STAFF_CAN: Record<StaffRole, ReadonlySet<string>> = {
  admin: new Set(['read', 'report_status', 'moderate_listing', 'warn', 'suspend', 'ban', 'verify', 'boost', 'support', 'locations', 'audit']),
  moderator: new Set(['read', 'report_status', 'moderate_listing', 'warn', 'suspend', 'support']),
  support: new Set(['read', 'support']),
};

// Permission needed per section (mirrors the nav). Longest matching prefix wins; unknown /admin/* paths have none.
const ROUTE_NEEDS: [string, string][] = [
  ['/admin/reports', 'report_status'],
  ['/admin/listings', 'read'],
  ['/admin/users', 'warn'],
  ['/admin/support', 'support'],
  ['/admin/locations', 'locations'],
  ['/admin/history', 'audit'],
];

export function routePermission(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/admin') return 'read'; // the overview only - other unknown /admin/* paths fall through to null
  for (const [prefix, needs] of ROUTE_NEEDS) {
    if (path === prefix || path.startsWith(prefix + '/')) return needs;
  }
  return null;
}

export function isStaffRole(value: unknown): value is StaffRole {
  return value === 'admin' || value === 'moderator' || value === 'support';
}

export function adminGate(input: {
  initializing: boolean;
  hasSession: boolean;
  roleChecked: boolean;
  role: string | null;
  pathname?: string;
}): AdminGate {
  if (input.initializing) return 'pending';
  if (!input.hasSession) return 'not-found';
  if (!input.roleChecked) return 'pending';
  if (!isStaffRole(input.role)) return 'not-found';
  if (input.pathname !== undefined) {
    const needs = routePermission(input.pathname);
    if (!needs || !STAFF_CAN[input.role].has(needs)) return 'not-found';
  }
  return 'allow';
}
