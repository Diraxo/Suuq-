// Real `reviews` table reads/writes, mirroring store/reviews.ts on mobile.
import { supabase } from '@/lib/supabase';
import { Review } from '@/lib/types';

const REVIEW_SELECT = 'id, rating, comment, created_at, reviewer:profiles!reviews_reviewer_id_fkey(id, full_name, avatar_url)';

type ReviewRow = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  reviewer: { id: string; full_name: string | null; avatar_url: string | null } | null;
};

function rowToReview(row: ReviewRow): Review {
  return {
    id: row.id,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
    reviewer: {
      id: row.reviewer?.id ?? '',
      name: row.reviewer?.full_name ?? 'SUUQIYE user',
      avatar: row.reviewer?.avatar_url ?? `https://picsum.photos/seed/${row.reviewer?.id ?? 'user'}/200/200`,
    },
  };
}

export async function listReviewsForSeller(sellerId: string): Promise<Review[]> {
  const { data, error } = await supabase.from('reviews').select(REVIEW_SELECT).eq('seller_id', sellerId).order('created_at', { ascending: false });
  if (error || !data) return [];
  return (data as unknown as ReviewRow[]).map(rowToReview);
}

export async function createReview(reviewerId: string, sellerId: string, rating: number, comment?: string): Promise<boolean> {
  const { error } = await supabase.from('reviews').insert({ reviewer_id: reviewerId, seller_id: sellerId, rating, comment: comment || null });
  return !error;
}
