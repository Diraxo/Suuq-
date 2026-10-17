'use client';

// Web port of app/reviews.tsx: reviews other people left for the signed-in seller.
import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { Star } from '@/lib/icons';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { useLiveReload } from '@/hooks/useLiveReload';
import { useAuthStore } from '@/store/auth';
import { Review } from '@/lib/types';
import { listReviewsForSeller } from '@/services/reviews';

export default function ReviewsPage() {
  const authed = useRequireAuthPage('/reviews');
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    if (!userId) return;
    listReviewsForSeller(userId)
      .then(setReviews)
      .finally(() => setLoaded(true));
  }, [userId]);

  useEffect(load, [load]);
  useLiveReload(userId, [{ table: 'reviews', filter: `seller_id=eq.${userId}` }], load);

  if (!authed) return <div className="min-h-[50vh]" />;

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Reviews" />
        {!loaded ? (
          <p className="py-10 text-center text-sm text-textSecondary">Loading…</p>
        ) : reviews.length === 0 ? (
          <EmptyState icon={Star} title="No reviews yet" message="Reviews from buyers will appear here." />
        ) : (
          <div className="flex flex-col gap-3">
            {reviews.map((r) => (
              <Card key={r.id}>
                <div className="flex items-center gap-3">
                  <Image src={r.reviewer.avatar} alt={r.reviewer.name} width={36} height={36} className="h-9 w-9 rounded-full object-cover" />
                  <div>
                    <p className="text-sm font-medium text-textPrimary">{r.reviewer.name}</p>
                    <div className="mt-0.5 flex gap-0.5" aria-label={`${r.rating} out of 5 stars`}>
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} size={14} className={i < r.rating ? 'fill-warning text-warning' : 'text-textMuted'} />
                      ))}
                    </div>
                  </div>
                </div>
                {!!r.comment && <p className="mt-2 text-sm text-textSecondary">{r.comment}</p>}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
