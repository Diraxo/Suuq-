import { create } from 'zustand';
import { accountPerson } from '@/lib/profileIdentity';
import { AppState } from 'react-native';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';
import { isBlockedEitherWaySync } from '@/lib/blocking';
import { showSnackbar } from '@/lib/snackbar';
import i18n from '@/lib/i18n';

export type Review = {
  id: string;
  rating: number;
  comment: string;
  createdAt: string;
  reviewer: { id: string; name: string; avatar: string };
};

function rowToReview(row: any): Review {
  return {
    id: row.id,
    rating: row.rating,
    comment: row.comment ?? '',
    createdAt: row.created_at,
    reviewer: {
      id: row.reviewer?.id ?? '',
      name: accountPerson(row.reviewer).name ?? i18n.t('profile.defaultUserName'),
      avatar: accountPerson(row.reviewer).avatarUrl ?? `https://picsum.photos/seed/${row.reviewer?.id ?? row.id}/200/200`,
    },
  };
}

const REVIEW_SELECT = 'id, rating, comment, created_at, reviewer:profiles!reviews_reviewer_id_fkey(id, full_name, avatar_url)';

type ReviewsState = {
  /** Reviews received by the signed-in user (as a seller) — feeds app/reviews.tsx. */
  reviews: Review[];
  hasHydrated: boolean;
  load: () => Promise<void>;
  reset: () => void;
  /** Reviews about any seller being viewed (e.g. app/seller/[id].tsx). */
  sellerId: string | null;
  sellerReviews: Review[];
  sellerReviewsHydrated: boolean;
  loadFor: (sellerId: string) => Promise<void>;
  create: (sellerId: string, rating: number, comment: string) => Promise<{ error?: string }>;
  update: (reviewId: string, patch: { rating: number; comment: string }) => Promise<{ error?: string }>;
  remove: (reviewId: string) => Promise<void>;
};

export const useReviewsStore = create<ReviewsState>((set, get) => ({
  reviews: [],
  hasHydrated: false,
  load: async () => {
    const session = useAuthStore.getState().session;
    if (!session) {
      set({ reviews: [], hasHydrated: true });
      return;
    }
    const { data } = await supabase
      .from('reviews')
      .select(REVIEW_SELECT)
      .eq('seller_id', session.user.id)
      .order('created_at', { ascending: false });
    set({ reviews: (data ?? []).map(rowToReview), hasHydrated: true });
  },
  reset: () => set({ reviews: [], hasHydrated: false }),

  sellerId: null,
  sellerReviews: [],
  sellerReviewsHydrated: false,
  loadFor: async (sellerId) => {
    const { data } = await supabase
      .from('reviews')
      .select(REVIEW_SELECT)
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });
    set({ sellerId, sellerReviews: (data ?? []).map(rowToReview), sellerReviewsHydrated: true });
  },
  create: async (sellerId, rating, comment) => {
    const session = useAuthStore.getState().session;
    if (!session) return { error: i18n.t('reviews.signInRequired') };
    if (isBlockedEitherWaySync(sellerId)) return { error: i18n.t('reviews.cannotReviewBlocked') };
    const { error } = await supabase
      .from('reviews')
      .insert({ reviewer_id: session.user.id, seller_id: sellerId, rating, comment: comment || null });
    if (error) {
      if (__DEV__) console.error('[reviews] create failed:', error.message);
      return { error: i18n.t('reviews.saveFailedMessage') };
    }
    await get().loadFor(sellerId);
    return {};
  },
  update: async (reviewId, patch) => {
    const { error } = await supabase.from('reviews').update({ rating: patch.rating, comment: patch.comment || null }).eq('id', reviewId);
    if (error) {
      if (__DEV__) console.error('[reviews] update failed:', error.message);
      return { error: i18n.t('reviews.saveFailedMessage') };
    }
    const sellerId = get().sellerId;
    if (sellerId) await get().loadFor(sellerId);
    return {};
  },
  remove: async (reviewId) => {
    const { error } = await supabase.from('reviews').delete().eq('id', reviewId);
    if (error) {
      if (__DEV__) console.error('[reviews] remove failed:', error.message);
      showSnackbar(i18n.t('reviews.deleteFailedSnackbar'));
      return;
    }
    const sellerId = get().sellerId;
    if (sellerId) await get().loadFor(sellerId);
  },
}));

// Keyed on profile.id, not session.user.id — see store/myListings.ts for why.
let lastUserId: string | null = null;
let reviewsRealtimeChannel: RealtimeChannel | null = null;
useAuthStore.subscribe((state) => {
  const uid = state.profile?.id ?? null;
  if (uid === lastUserId) return;
  lastUserId = uid;

  if (reviewsRealtimeChannel) {
    supabase.removeChannel(reviewsRealtimeChannel);
    reviewsRealtimeChannel = null;
  }

  if (uid) {
    useReviewsStore.getState().load();
    // Reviews received by this user can be created by anyone else at any
    // time — keep the Reviews screen (and any stat derived from `reviews`)
    // live without requiring a manual refresh.
    reviewsRealtimeChannel = supabase
      .channel(`reviews-received-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews', filter: `seller_id=eq.${uid}` }, () => useReviewsStore.getState().load())
      .subscribe();
  } else {
    useReviewsStore.getState().reset();
  }
});

// Coming back to the app after it sat in the background: realtime may have dropped while suspended, so re-read.
AppState.addEventListener('change', (next) => {
  if (next === 'active' && useAuthStore.getState().profile) useReviewsStore.getState().load();
});
