'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { checkIsAdmin } from '@/services/admin';
import { EmptyState } from '@/components/EmptyState';
import { ShieldAlert, BarChart3, Flag, Users, List, History } from '@/lib/icons';

const NAV = [
  { href: '/admin', label: 'Overview', icon: BarChart3 },
  { href: '/admin/reports', label: 'Reports', icon: Flag },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/listings', label: 'Listings', icon: List },
  { href: '/admin/history', label: 'History', icon: History },
];

// This gate is UX only — it hides the console from people who obviously
// shouldn't see it, but the real authorization boundary is Postgres: every
// query/RPC in src/services/admin.ts is itself gated by is_admin() via RLS
// or a SECURITY DEFINER check, so a user who bypasses this layout entirely
// (e.g. by navigating to /admin/reports with devtools) still gets empty
// results or a raised exception, never real data.
export default function AdminLayout({ children }: { children: ReactNode }) {
  const session = useAuthStore((s) => s.session);
  const initializing = useAuthStore((s) => s.initializing);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const pathname = usePathname();
  const [adminChecked, setAdminChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!session) {
      setIsAdmin(false);
      setAdminChecked(true);
      return;
    }
    setAdminChecked(false);
    checkIsAdmin()
      .then((result) => setIsAdmin(result))
      .catch(() => setIsAdmin(false)) // never leave this screen stuck on "Loading…"
      .finally(() => setAdminChecked(true));
  }, [session]);

  if (initializing || !adminChecked) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-textSecondary">Loading…</div>;
  }

  if (!session) {
    return (
      <div className="px-4 py-16">
        <EmptyState
          icon={ShieldAlert}
          title="Admin sign-in required"
          message="Sign in with the Google account that has admin access to Fursad."
          actionLabel="Continue with Google"
          onAction={() => signInWithGoogle('/admin')}
        />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="px-4 py-16">
        <EmptyState icon={ShieldAlert} title="Not authorized" message="This account doesn't have admin access to Fursad." />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-content flex-col gap-6 px-4 py-6 md:flex-row md:px-6 md:py-8">
      <aside className="shrink-0 md:w-56">
        <p className="mb-3 px-2 text-xs font-semibold uppercase tracking-wide text-textMuted">Admin</p>
        <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {NAV.map(({ href, label, icon: Icon }) => {
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
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
