'use client';

// Web port of app/followers.tsx: people who follow the signed-in user, and people they follow.
import { Suspense, useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Users } from '@/lib/icons';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { useLiveReload } from '@/hooks/useLiveReload';
import { useAuthStore } from '@/store/auth';
import { followUser, listFollowers, listFollowing, Person, unfollowUser } from '@/services/account';

function FollowersInner() {
  const authed = useRequireAuthPage('/followers');
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const params = useSearchParams();
  const [tab, setTab] = useState<'followers' | 'following'>(params.get('initial') === 'following' ? 'following' : 'followers');
  const [followers, setFollowers] = useState<Person[]>([]);
  const [following, setFollowing] = useState<Person[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!userId) return;
    Promise.all([listFollowers(userId), listFollowing(userId)])
      .then(([a, b]) => {
        setFollowers(a);
        setFollowing(b);
      })
      .finally(() => setLoaded(true));
  }, [userId]);

  useEffect(load, [load]);
  useLiveReload(userId, [
    { table: 'followers', filter: `following_id=eq.${userId}` },
    { table: 'followers', filter: `follower_id=eq.${userId}` },
  ], load);

  if (!authed) return <div className="min-h-[50vh]" />;

  const followingIds = new Set(following.map((p) => p.id));
  const people = tab === 'followers' ? followers : following;

  const toggle = async (id: string) => {
    if (!userId || busyId) return;
    setBusyId(id);
    const ok = followingIds.has(id) ? await unfollowUser(userId, id) : await followUser(userId, id);
    setBusyId(null);
    if (ok) load();
  };

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-2xl">
        <PageHeader title={tab === 'followers' ? 'Followers' : 'Following'} />
        <div className="mb-4 flex gap-6">
          {(['followers', 'following'] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)} className={`text-sm font-medium capitalize ${tab === k ? 'text-primary' : 'text-textMuted'}`}>
              {k} ({k === 'followers' ? followers.length : following.length})
            </button>
          ))}
        </div>
        {!loaded ? (
          <p className="py-10 text-center text-sm text-textSecondary">Loading…</p>
        ) : people.length === 0 ? (
          <EmptyState icon={Users} title={tab === 'followers' ? 'No followers yet' : 'Not following anyone yet'} message={tab === 'followers' ? 'When someone follows you, they appear here.' : 'Follow sellers from their profile to see them here.'} />
        ) : (
          <div className="flex flex-col gap-3">
            {people.map((p) => (
              <div key={p.id} className="flex items-center gap-3">
                <Link href={`/seller/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <Image src={p.avatar} alt={p.name} width={44} height={44} className="h-11 w-11 rounded-full object-cover" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-textPrimary">{p.name}</span>
                    <span className="block truncate text-xs text-textSecondary">{p.city}</span>
                  </span>
                </Link>
                <Button size="sm" variant={followingIds.has(p.id) ? 'outline' : 'primary'} loading={busyId === p.id} onClick={() => toggle(p.id)}>
                  {followingIds.has(p.id) ? 'Following' : 'Follow'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function FollowersPage() {
  return (
    <Suspense fallback={<div className="min-h-[50vh]" />}>
      <FollowersInner />
    </Suspense>
  );
}
