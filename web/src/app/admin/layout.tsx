'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { notFound, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { getStaffRole, StaffRole, STAFF_CAN } from '@/services/admin';
import { StaffRoleProvider } from '@/lib/staffRole';
import { adminGate } from '@/lib/adminGate';
import { STOREFRONTS_ENABLED } from '@/lib/storefrontFlag';
import { getStaffUnreadByType, markTypeRead, subscribeToNotifications } from '@/services/notifications';
import { enableWebPush, syncWebPush, webPushState, WebPushState } from '@/lib/webPush';
import { BarChart3, Flag, Users, List, History, MapPin, MessageSquare, ShieldCheck } from '@/lib/icons';

// Each entry lists the permission needed to see it (mirrors staff_can() in migration 0039).
const NAV: { href: string; label: string; icon: typeof BarChart3; needs: string; alert?: string }[] = [
  { href: '/admin', label: 'Overview', icon: BarChart3, needs: 'read', alert: 'activity_staff' },
  { href: '/admin/reports', label: 'Reports', icon: Flag, needs: 'report_status', alert: 'report_staff' },
  { href: '/admin/listings', label: 'Listings', icon: List, needs: 'read', alert: 'listing_staff' },
  { href: '/admin/users', label: 'Users', icon: Users, needs: 'warn', alert: 'user_staff' },
  { href: '/admin/support', label: 'Support', icon: MessageSquare, needs: 'support', alert: 'support_staff' },
  { href: '/admin/locations', label: 'Locations', icon: MapPin, needs: 'locations' },
  { href: '/admin/businesses', label: 'Businesses', icon: ShieldCheck, needs: 'business_review' },
  { href: '/admin/history', label: 'History', icon: History, needs: 'audit' },
];

// This gate is UX only — it hides the console from people who obviously
// shouldn't see it, but the real authorization boundary is Postgres: every
// query/RPC in src/services/admin.ts is itself gated by staff_can()/is_admin() via RLS
// or a SECURITY DEFINER check, so a user who bypasses this layout entirely
// (e.g. by navigating to /admin/reports with devtools) still gets empty
// results or a raised exception, never real data.
export default function AdminLayout({ children }: { children: ReactNode }) {
  const session = useAuthStore((s) => s.session);
  const initializing = useAuthStore((s) => s.initializing);
  const pathname = usePathname();
  // The role is looked up per user id (not per session object), so a token refresh doesn't unmount the console, and
  // a role fetched for one user can never be read as the answer for another.
  const userId = session?.user.id ?? null;
  const [lookup, setLookup] = useState<{ userId: string; role: StaffRole | null } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getStaffRole()
      .catch(() => null) // never leave this screen stuck on a blank page
      .then((r) => {
        if (!cancelled) setLookup({ userId, role: r });
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const [unread, setUnread] = useState<Record<string, number>>({});
  const [push, setPush] = useState<WebPushState | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  const isStaff = lookup?.userId === userId && !!lookup.role;
  useEffect(() => {
    if (!userId || !isStaff) return;
    const refresh = () => getStaffUnreadByType(userId).then(setUnread).catch(() => {});
    refresh();
    const stop = subscribeToNotifications(userId, refresh);
    webPushState().then(setPush).catch(() => setPush('unsupported'));
    syncWebPush().catch(() => {});
    return stop;
  }, [userId, isStaff]);

  // Opening a section clears its alerts (the list itself is what the staff member came to read).
  useEffect(() => {
    if (!userId || !isStaff) return;
    const section = NAV.find((n) => n.alert && (n.href === '/admin' ? pathname === n.href : pathname.startsWith(n.href)));
    if (section?.alert) markTypeRead(userId, section.alert).then(() => getStaffUnreadByType(userId)).then(setUnread).catch(() => {});
  }, [userId, isStaff, pathname]);

  const roleChecked = lookup?.userId === userId;
  const role = roleChecked ? lookup.role : null;

  // Unauthorized visitors get the app's generic 404 — no admin wording, sign-in prompt or redirect — and children
  // (the admin pages, which fetch on mount) are never mounted until the database has confirmed a staff role.
  const gate = adminGate({ initializing, hasSession: !!session, roleChecked, role, pathname });
  if (gate === 'pending') return null;
  if (gate === 'not-found' || !role) notFound();

  // Business verification is part of the storefront feature: hidden (like its page) while the storefront flag is off.
  const nav = NAV.filter((n) => STAFF_CAN[role].has(n.needs) && (n.needs !== 'business_review' || STOREFRONTS_ENABLED));

  return (
    <StaffRoleProvider role={role}>
      <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-6 md:flex-row md:px-6 md:py-8">
        <aside className="shrink-0 md:w-56">
          <p className="mb-3 px-2 text-xs font-semibold uppercase tracking-wide text-textMuted">
            {role === 'admin' ? 'Admin' : role === 'moderator' ? 'Moderator' : 'Support'}
          </p>
          <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            {nav.map(({ href, label, icon: Icon, alert }) => {
              const count = alert ? (unread[alert] ?? 0) : 0;
              const active = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${
                    active ? 'bg-primary text-primaryText' : 'text-textSecondary hover:bg-inputBackground'
                  }`}
                >
                  <Icon size={16} />
                  {label}
                  {count > 0 && (
                    <span className="ml-auto rounded-full bg-error px-1.5 text-xs font-semibold text-white" aria-label={`${count} unread`}>
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
          {push === 'off' && (
            <button
              type="button"
              onClick={() => {
                setPushError(null);
                enableWebPush().then(setPush).catch((e) => setPushError(e instanceof Error ? e.message : 'Could not turn on notifications'));
              }}
              className="mt-3 w-full rounded-md border border-border px-3 py-2 text-left text-sm font-medium text-textPrimary hover:bg-inputBackground"
            >
              Turn on alerts on this device
            </button>
          )}
          {push === 'denied' && <p className="mt-3 px-2 text-xs text-textMuted">Notifications are blocked for this site in your browser settings.</p>}
          {push === 'unconfigured' && <p className="mt-3 px-2 text-xs text-textMuted">Web alerts are not set up on the server yet.</p>}
          {pushError && <p className="mt-2 px-2 text-xs text-error">{pushError}</p>}
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </StaffRoleProvider>
  );
}
