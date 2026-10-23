'use client';

// Web twin of app/settings/blocked-users.tsx: everyone I have blocked, each row opens their profile and has an Unblock
// button. Unblocking restores chat both ways (messages sent while blocked stay undelivered — see docs/CHAT_BLOCKING.md).
import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Ban, ChevronLeft } from 'lucide-react';
import { Card } from '@/components/Card';
import { useAuthStore } from '@/store/auth';
import { useBlockedUsersStore } from '@/store/blockedUsers';
import { requireAuth } from '@/store/authPrompt';
import { useT } from '@/lib/i18n';

export default function BlockedUsersPage() {
  const t = useT();
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const blocked = useBlockedUsersStore((s) => s.blocked);
  const hasHydrated = useBlockedUsersStore((s) => s.hasHydrated);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!session) requireAuth(() => {}, { next: '/settings/blocked-users' });
    else void useBlockedUsersStore.getState().load();
  }, [session]);

  const unblock = async (id: string, name: string) => {
    if (!window.confirm(`Unblock ${name}?`)) return;
    await useBlockedUsersStore.getState().unblock(id);
    setNotice(t('web.m.unblockedCanMessage', { name }));
    setTimeout(() => setNotice(null), 4000);
  };

  return (
    <div className="px-4 pb-10 pt-4 md:px-6 md:pt-8">
      <div className="mb-4 flex items-center gap-2">
        <button onClick={() => router.back()} aria-label={t('common.back')} className="rounded-full p-1 hover:bg-inputBackground">
          <ChevronLeft size={22} />
        </button>
        <h1 className="text-xl font-bold text-textPrimary">{t('settings.blockedUsers.title')}</h1>
      </div>
      <div className="mx-auto max-w-2xl space-y-2">
        {notice && (
          <p role="status" className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
            {t.text(notice)}
          </p>
        )}
        {session && hasHydrated && blocked.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Ban size={32} className="text-textMuted" />
            <p className="font-medium text-textPrimary">{t('settings.blockedUsers.emptyTitle')}</p>
            <p className="text-sm text-textSecondary">{t('web.t.peopleYouBlockWillAppear')}</p>
          </div>
        )}
        {blocked.map((p) => (
          <Card key={p.id} className="flex items-center gap-3">
            <Link href={`/seller/${p.id}`} aria-label={`View ${p.name}'s profile`} className="flex min-w-0 flex-1 items-center gap-3">
              <Image src={p.avatar} alt="" width={44} height={44} className="rounded-full object-cover" />
              <span className="truncate text-sm font-medium text-textPrimary">{p.name}</span>
            </Link>
            <button
              onClick={() => void unblock(p.id, p.name)}
              aria-label={`Unblock ${p.name}`}
              className="rounded-pill border border-primary px-4 py-1.5 text-sm font-medium text-primary hover:bg-primary/5"
            >
              {t('common.unblock')}
            </button>
          </Card>
        ))}
      </div>
    </div>
  );
}
