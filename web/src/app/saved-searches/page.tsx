'use client';

// Web port of app/saved-searches.tsx. Searches are saved from the Search page (Save this search) and shared with the app.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bookmark, X } from '@/lib/icons';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { useLiveReload } from '@/hooks/useLiveReload';
import { useAuthStore } from '@/store/auth';
import { listSavedSearches, removeSavedSearch, SavedSearch } from '@/services/account';
import { useT } from '@/lib/i18n';

export default function SavedSearchesPage() {
  const t = useT();
  const authed = useRequireAuthPage('/saved-searches');
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const [items, setItems] = useState<SavedSearch[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    if (!userId) return;
    listSavedSearches(userId)
      .then(setItems)
      .finally(() => setLoaded(true));
  }, [userId]);

  useEffect(load, [load]);
  useLiveReload(userId, [{ table: 'saved_searches', filter: `user_id=eq.${userId}` }], load);

  const remove = async (id: string) => {
    const before = items;
    setItems((cur) => cur.filter((s) => s.id !== id));
    if (!(await removeSavedSearch(id))) setItems(before);
  };

  if (!authed) return <div className="min-h-[50vh]" />;

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-2xl">
        <PageHeader title={t('profile.menu.savedSearches')} />
        {!loaded ? (
          <p className="py-10 text-center text-sm text-textSecondary">{t('common.loading')}</p>
        ) : items.length === 0 ? (
          <EmptyState icon={Bookmark} title={t('savedSearches.emptyTitle')} message={t('web.t.searchForSomethingAndChoose')} />
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((s) => (
              <Card key={s.id} className="flex items-center gap-3">
                <Link href={`/search?q=${encodeURIComponent(s.query)}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Bookmark size={18} className="text-primary" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-textPrimary">{s.query}</span>
                    {s.filter && <span className="block truncate text-xs text-textSecondary">{s.filter}</span>}
                  </span>
                </Link>
                <button onClick={() => remove(s.id)} aria-label={`Remove saved search ${s.query}`} className="shrink-0 rounded-full p-2 text-textMuted hover:bg-background">
                  <X size={18} />
                </button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
