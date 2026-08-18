'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { Search, Users as UsersIcon } from '@/lib/icons';
import { listUsers } from '@/services/admin';
import { AdminUserSummary } from '@/lib/types';

export default function AdminUsersPage() {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<AdminUserSummary[] | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setUsers(null);
      listUsers(search).then(setUsers);
    }, 250);
    return () => clearTimeout(timeout);
  }, [search]);

  return (
    <div>
      <h1 className="mb-5 text-2xl font-bold text-textPrimary">Users</h1>

      <div className="relative mb-5 max-w-sm">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email"
          className="w-full rounded-pill border border-border bg-inputBackground py-2 pl-9 pr-3 text-sm text-textPrimary outline-none focus:border-primary"
        />
      </div>

      {!users ? (
        <p className="text-sm text-textSecondary">Loading…</p>
      ) : users.length === 0 ? (
        <EmptyState icon={UsersIcon} title="No users found" message="Try a different search." />
      ) : (
        <Card elevated={false} className="divide-y divide-border p-0">
          {users.map((u) => (
            <Link key={u.id} href={`/admin/users/${u.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-inputBackground">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-textPrimary">{u.full_name ?? 'Fursad user'}</p>
                <p className="truncate text-xs text-textMuted">{u.email ?? '—'} · {u.listingsCount} listing{u.listingsCount === 1 ? '' : 's'}</p>
              </div>
              {u.account_status === 'suspended' && <Badge label="Suspended" tone="warning" />}
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
