'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { AdminAvatar } from '@/components/AdminAvatar';
import { AdminList, AdminListRow, AdminPageHeader, FilterChips, ListSkeleton } from '@/components/AdminUI';
import { Search, Users as UsersIcon } from '@/lib/icons';
import { listUsers } from '@/services/admin';
import { AdminUserSummary } from '@/lib/types';
import { cappedNotice, plural } from '@/lib/adminText';
import { formatRelativeTime } from '@/lib/time';

const USER_LIMIT = 100; // listUsers() returns at most this many

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

  const capped = users ? cappedNotice(users.length, USER_LIMIT, 'user') : null;

  return (
    <div>
      <AdminPageHeader title="Users" description="Sellers and buyers. Open someone to see their listings, reports, warnings and to take action." />

      <div className="mb-3">
        <FilterChips options={FILTERS} value={status} onChange={setStatus} label="Filter" />
      </div>
      <div className="relative mb-5 w-full max-w-sm">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email"
          aria-label="Search users"
          className="w-full rounded-pill border border-border bg-inputBackground py-2 pl-9 pr-3 text-sm text-textPrimary outline-none focus:border-primary"
        />
      </div>

      {!users ? (
        <ListSkeleton label="Loading users" />
      ) : users.length === 0 ? (
        <EmptyState icon={UsersIcon} title="No users found" message="Try a different search or filter." />
      ) : (
        <>
          <AdminList>
            {users.map((u) => {
              const suspended = u.account_status === 'suspended' && (!u.suspended_until || new Date(u.suspended_until) > new Date());
              const name = u.full_name ?? 'SUUQIYE user';
              return (
                <AdminListRow
                  key={u.id}
                  href={`/admin/users/${u.id}`}
                  lead={<AdminAvatar name={name} url={u.avatar_url} size={44} />}
                  title={name}
                  badges={
                    <>
                      {u.verified_at && <Badge label="Verified" tone="success" />}
                      {suspended && <Badge label="Suspended" tone="warning" />}
                      {u.account_status === 'banned' && <Badge label="Banned" tone="sale" />}
                    </>
                  }
                  meta={
                    <>
                      <span className="truncate">{u.email ?? 'No email'}</span>
                      <span>{plural(u.listingsCount, 'listing')}</span>
                      {u.city && <span>{u.city}</span>}
                      <span>Joined {formatRelativeTime(new Date(u.created_at).getTime())}</span>
                    </>
                  }
                />
              );
            })}
          </AdminList>
          <p className="mt-3 text-sm text-textSecondary">{capped ?? plural(users.length, 'user')}</p>
        </>
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
