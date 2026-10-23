'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { Search, Users as UsersIcon } from '@/lib/icons';
import { listUsers } from '@/services/admin';
import { AdminUserSummary } from '@/lib/types';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'banned', label: 'Banned' },
  { value: 'verified', label: 'Verified' },
];

function UsersInner() {
  const params = useSearchParams();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [users, setUsers] = useState<AdminUserSummary[] | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setUsers(null);
      listUsers(search, status || null).then(setUsers);
    }, 250);
    return () => clearTimeout(timeout);
  }, [search, status]);

  return (
    <div>
      <h1 className="mb-5 text-2xl font-bold text-textPrimary">Users</h1>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email"
            className="w-full rounded-pill border border-border bg-inputBackground py-2 pl-9 pr-3 text-sm text-textPrimary outline-none focus:border-primary"
          />
        </div>
        <div className="flex gap-2" role="group" aria-label="Filter">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatus(f.value)}
              aria-pressed={status === f.value}
              className={`rounded-pill border px-3 py-1.5 text-sm ${status === f.value ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-surface text-textSecondary'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {!users ? (
        <p className="text-sm text-textSecondary">Loading…</p>
      ) : users.length === 0 ? (
        <EmptyState icon={UsersIcon} title="No users found" message="Try a different search or filter." />
      ) : (
        <Card elevated={false} className="divide-y divide-border p-0">
          {users.map((u) => {
            const suspended = u.account_status === 'suspended' && (!u.suspended_until || new Date(u.suspended_until) > new Date());
            return (
              <Link key={u.id} href={`/admin/users/${u.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-inputBackground">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-textPrimary">{u.full_name ?? 'SUUQIYE user'}</p>
                  <p className="truncate text-xs text-textMuted">
                    {u.email ?? '—'} · {u.listingsCount} listing{u.listingsCount === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {u.verified_at && <Badge label="Verified" tone="success" />}
                  {suspended && <Badge label="Suspended" tone="warning" />}
                  {u.account_status === 'banned' && <Badge label="Banned" tone="warning" />}
                </div>
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}

export default function AdminUsersPage() {
  return (
    <Suspense>
      <UsersInner />
    </Suspense>
  );
}
