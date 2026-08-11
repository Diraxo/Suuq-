import { useEffect, useMemo, useState } from 'react';
import { View, FlatList, Pressable, Linking, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { ListingCard } from '@/components/ListingCard';
import { Stat } from '@/components/Stat';
import { useTheme } from '@/theme/ThemeContext';
import { mockSellers, mockListings } from '@/data/mockListings';
import { useFollowStore } from '@/store/follow';
import { useBlockedUsersStore } from '@/store/blockedUsers';
import { useBlockedEitherWayIds } from '@/lib/blocking';
import { requireAuth } from '@/store/authPrompt';
import { showSnackbar } from '@/lib/snackbar';
import { useListingsStore } from '@/store/listings';
import { useAuthStore } from '@/store/auth';
import { useReviewsStore } from '@/store/reviews';
import { supabase } from '@/lib/supabase';
import { getSellerStats, profileToSeller } from '@/lib/sellerStats';
import { imageUrl } from '@/lib/r2';
import { Seller } from '@/types';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';

export default function SellerProfile() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useAuthStore((s) => s.session);
  const globalListings = useListingsStore((s) => s.listings);

  // Real profiles+listings take priority; fall back to the mock catalogue
  // (used by Dev QA links and listings whose seller isn't a real account).
  const [realSeller, setRealSeller] = useState<Seller | null>(null);
  const [profileLookupDone, setProfileLookupDone] = useState(false);
  // Followers/rating/reviewCount refreshed from Supabase (source of truth) on
  // mount and whenever a realtime change lands â€” listingsCount/soldCount are
  // deliberately left out of this and instead derived from `listings` below,
  // which is already reactive via the global listings store.
  const refreshStats = async (sellerId: string) => {
    const stats = await getSellerStats(sellerId);
    setRealSeller((prev) => (prev ? { ...prev, followers: stats.followers, rating: stats.rating, reviewCount: stats.reviewCount } : prev));
    setFollowBaseline({ count: stats.followers, wasFollowing: useFollowStore.getState().isFollowing(sellerId) });
  };

  useEffect(() => {
    let cancelled = false;
    setRealSeller(null);
    setProfileLookupDone(false);
    if (!id) {
      setProfileLookupDone(true);
      return;
    }
    (async () => {
      const { data: profile } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
      if (cancelled) return;
      if (!profile) {
        setProfileLookupDone(true);
        return;
      }
      const stats = await getSellerStats(id);
      if (cancelled) return;
      setRealSeller(profileToSeller(profile, stats));
      setFollowBaseline({ count: stats.followers, wasFollowing: useFollowStore.getState().isFollowing(id) });
      setProfileLookupDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const isRealSeller = !!realSeller;
  const mockMatch = mockSellers.find((s) => s.id === id);
  // A non-mock id with no real profile resolved yet is still loading, not
  // missing â€” falling back straight to mockSellers[0] would flash a wrong
  // seller's profile while the real one is in flight.
  const stillResolvingSeller = !realSeller && !mockMatch && !profileLookupDone;
  const sellerNotFound = !realSeller && !mockMatch && profileLookupDone;
  const seller = realSeller ?? mockMatch ?? mockSellers[0];
  const listings = useMemo(
    () => (isRealSeller ? globalListings.filter((l) => l.seller.id === seller.id) : mockListings.filter((l) => l.seller.id === seller.id)),
    [isRealSeller, globalListings, seller.id]
  );
  // Derived from the same reactive `listings` rather than the one-shot stats
  // fetch, so a new listing or a sale (by this device) shows up instantly.
  const displayListingsCount = isRealSeller
    ? listings.filter((l) => l.status === 'available' || l.status === 'reserved').length
    : seller.listingsCount;
  const displaySoldCount = isRealSeller ? listings.filter((l) => l.status === 'sold').length : seller.soldCount;
  const isFollowing = useFollowStore((s) => s.isFollowing(seller.id));
  const toggleFollow = useFollowStore((s) => s.toggle);
  const isSelf = session?.user.id === seller.id;

  const myBlockedList = useBlockedUsersStore((s) => s.blocked);
  const blockedByMe = myBlockedList.some((b) => b.id === seller.id);
  const blockedEitherWayIds = useBlockedEitherWayIds();
  const isBlocked = isRealSeller && !isSelf && blockedEitherWayIds.has(seller.id);

  // Baseline follower count captured alongside the last stats refresh, plus
  // whether *this device* was following at that moment â€” the displayed count
  // below is the baseline adjusted by any optimistic change since then, so a
  // follow/unfollow tap moves the number instantly instead of waiting on a
  // round trip, while still resyncing to Supabase whenever fresh data lands.
  const [followBaseline, setFollowBaseline] = useState<{ count: number; wasFollowing: boolean } | null>(null);
  const displayFollowers = followBaseline
    ? followBaseline.count + (isFollowing ? 1 : 0) - (followBaseline.wasFollowing ? 1 : 0)
    : seller.followers;

  const sellerReviews = useReviewsStore((s) => s.sellerReviews);
  const loadReviewsFor = useReviewsStore((s) => s.loadFor);
  const createReview = useReviewsStore((s) => s.create);
  const updateReview = useReviewsStore((s) => s.update);
  const removeReview = useReviewsStore((s) => s.remove);

  // Review list is reactive (loadFor replaces sellerReviews on every mutation),
  // so rating/review count are derived straight from it instead of the stale
  // one-shot fetch above â€” they update the instant a review is added, edited
  // or removed, with no separate refetch needed.
  const displayReviewCount = isRealSeller ? sellerReviews.length : seller.reviewCount;
  const displayRating = isRealSeller ? (sellerReviews.length > 0 ? sellerReviews.reduce((sum, r) => sum + r.rating, 0) / sellerReviews.length : 0) : seller.rating;

  useEffect(() => {
    if (isRealSeller) loadReviewsFor(seller.id);
  }, [isRealSeller, seller.id]);

  // Live sync for changes made by *other* users while this profile is open â€”
  // someone else following/unfollowing this seller, or leaving/editing/deleting
  // a review â€” without needing to leave and re-enter the screen.
  useEffect(() => {
    if (!isRealSeller) return;
    const channel = supabase
      .channel(`seller-profile-${seller.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'followers', filter: `following_id=eq.${seller.id}` }, () => refreshStats(seller.id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews', filter: `seller_id=eq.${seller.id}` }, () => {
        refreshStats(seller.id);
        loadReviewsFor(seller.id);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isRealSeller, seller.id]);

  const myReview = session ? sellerReviews.find((r) => r.reviewer.id === session.user.id) : undefined;

  const [composing, setComposing] = useState(false);
  const [draftRating, setDraftRating] = useState(0);
  const [draftComment, setDraftComment] = useState('');
  const [saving, setSaving] = useState(false);

  const startCompose = () => {
    setDraftRating(myReview?.rating ?? 0);
    setDraftComment(myReview?.comment ?? '');
    setComposing(true);
  };

  const submitReview = async () => {
    if (draftRating === 0) {
      Alert.alert(t('seller.chooseRatingTitle'), t('seller.chooseRatingMessage'));
      return;
    }
    setSaving(true);
    const result = myReview
      ? await updateReview(myReview.id, { rating: draftRating, comment: draftComment })
      : await createReview(seller.id, draftRating, draftComment);
    setSaving(false);
    if (result.error) {
      Alert.alert(t('seller.saveReviewFailedTitle'), result.error);
      return;
    }
    setComposing(false);
    refreshStats(seller.id);
  };

  const confirmDeleteReview = () => {
    if (!myReview) return;
    Alert.alert(t('seller.deleteReviewTitle'), t('seller.deleteReviewMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await removeReview(myReview.id);
          refreshStats(seller.id);
        },
      },
    ]);
  };

  const blockUser = () => {
    Alert.alert(t('seller.blockConfirmTitle', { name: seller.name }), t('seller.blockConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.block'),
        style: 'destructive',
        onPress: async () => {
          await useBlockedUsersStore.getState().block(seller.id);
          showSnackbar(t('seller.blockedSnackbar', { name: seller.name }));
        },
      },
    ]);
  };

  const unblockUser = () => {
    Alert.alert(t('seller.unblockConfirmTitle', { name: seller.name }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.unblock'),
        onPress: async () => {
          await useBlockedUsersStore.getState().unblock(seller.id);
          showSnackbar(t('seller.unblockedSnackbar', { name: seller.name }));
        },
      },
    ]);
  };

  if (stillResolvingSeller) {
    return (
      <Screen>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
          <BackButton onPress={() => router.back()} />
        </View>
        <View style={{ alignItems: 'center', gap: spacing.sm }}>
          <Skeleton width={88} height={88} radius={44} />
          <Skeleton width="40%" height={22} />
          <Skeleton width="60%" height={16} />
        </View>
      </Screen>
    );
  }
  if (sellerNotFound) {
    return (
      <Screen>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
          <BackButton onPress={() => router.back()} />
        </View>
        <EmptyState
          icon="person-remove-outline"
          title={t('seller.notFoundTitle')}
          message={t('seller.notFoundMessage')}
          actionLabel={t('listing.goBack')}
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  if (isBlocked) {
    return (
      <Screen>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
          <BackButton onPress={() => router.back()} />
        </View>
        <EmptyState
          icon="ban-outline"
          title={blockedByMe ? t('seller.youBlocked', { name: seller.name }) : t('seller.profileUnavailable')}
          message={blockedByMe ? t('seller.blockedHiddenMessage') : t('seller.profileUnavailableMessage')}
          actionLabel={blockedByMe ? t('common.unblock') : undefined}
          onAction={blockedByMe ? unblockUser : undefined}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        data={listings}
        keyExtractor={(l) => l.id}
        numColumns={2}
        showsVerticalScrollIndicator={false}
        columnWrapperStyle={{ gap: spacing.sm }}
        ListHeaderComponent={
          <View style={{ paddingTop: spacing.sm, paddingBottom: spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <BackButton onPress={() => router.back()} />
              <View style={{ flexDirection: 'row' }}>
                <Pressable
                  onPress={() => requireAuth(blockUser)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={t('seller.blockThisUser')}
                  style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Ionicons name="ban-outline" size={20} color={colors.textMuted} />
                </Pressable>
                <Pressable
                  onPress={() => requireAuth(() => router.push(`/report?type=user&id=${seller.id}` as any))}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={t('seller.reportThisUser')}
                  style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -12 }}
                >
                  <Ionicons name="flag-outline" size={20} color={colors.textMuted} />
                </Pressable>
              </View>
            </View>
            <View style={{ alignItems: 'center', marginTop: spacing.sm }}>
              <Image source={{ uri: imageUrl(seller.avatar, { width: 240 }) }} accessibilityLabel={t('listing.sellerPhotoAlt', { name: seller.name })} style={{ width: 88, height: 88, borderRadius: 44 }} cachePolicy="memory-disk" transition={200} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm }}>
                <Text variant="h2">{seller.name}</Text>
                {seller.verified && <Ionicons name="checkmark-circle" size={18} color={colors.primary} />}
              </View>
              <Text variant="caption" color="secondary">
                {t('seller.memberSince', { city: seller.city, date: seller.memberSince })}
              </Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                <Badge label={t('seller.ratingBadge', { rating: displayRating.toFixed(1), count: displayReviewCount })} tone="neutral" />
                {isRealSeller ? <Badge label={t('seller.suuqPlusMember')} tone="brand" /> : <Badge label={t('seller.trustedSeller')} tone="success" />}
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.xl, marginTop: spacing.md }}>
                <Stat label={t('myListings.stats.listings')} value={displayListingsCount} />
                <Stat label={t('myListings.stats.sold')} value={displaySoldCount} />
                <Stat label={t('myListings.stats.followers')} value={displayFollowers} />
              </View>

              {!isSelf && (
                <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md }}>
                  <Button
                    label={isFollowing ? t('common.following') : t('common.follow')}
                    variant={isFollowing ? 'outline' : 'primary'}
                    onPress={() => requireAuth(() => toggleFollow(seller.id))}
                    icon={isFollowing ? undefined : <Ionicons name="person-add-outline" size={16} color={colors.primaryText} />}
                  />
                  {seller.phone && (
                    <Button
                      label={t('seller.call')}
                      variant="outline"
                      onPress={() => Linking.openURL(`tel:${seller.phone}`)}
                      icon={<Ionicons name="call-outline" size={16} color={colors.primary} />}
                    />
                  )}
                  {isRealSeller && listings.length > 0 && (
                    <Button
                      label={t('seller.chat')}
                      variant="secondary"
                      onPress={() => requireAuth(() => router.push(`/chat/${listings[0].id}` as any))}
                      icon={<Ionicons name="chatbubble-outline" size={16} color={colors.primaryText} />}
                    />
                  )}
                </View>
              )}
            </View>

            {isRealSeller && !isSelf && (
              <View style={{ marginTop: spacing.lg }}>
                <Text variant="h3" style={{ marginBottom: spacing.xs }}>
                  {t('seller.reviews')}
                </Text>
                {!composing && (
                  <Button label={myReview ? t('seller.editYourReview') : t('seller.writeAReview')} variant="outline" size="sm" onPress={() => requireAuth(startCompose)} />
                )}
                {myReview && !composing && (
                  <Pressable onPress={confirmDeleteReview} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('seller.deleteYourReview')} style={{ marginTop: spacing.xs }}>
                    <Text variant="caption" color="error">
                      {t('seller.deleteYourReview')}
                    </Text>
                  </Pressable>
                )}
                {composing && (
                  <Card style={{ marginTop: spacing.sm }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Pressable key={n} onPress={() => setDraftRating(n)} hitSlop={6} accessibilityRole="button" accessibilityLabel={t('seller.rateStars', { count: n })}>
                          <Ionicons name={n <= draftRating ? 'star' : 'star-outline'} size={28} color={colors.warning} />
                        </Pressable>
                      ))}
                    </View>
                    <Input
                      placeholder={t('seller.reviewPlaceholder')}
                      value={draftComment}
                      onChangeText={setDraftComment}
                      multiline
                      numberOfLines={3}
                      style={{ height: 70, textAlignVertical: 'top' }}
                    />
                    <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
                      <Button label={t('common.cancel')} variant="ghost" size="sm" onPress={() => setComposing(false)} style={{ flex: 1 }} />
                      <Button label={t('seller.submit')} size="sm" onPress={submitReview} loading={saving} disabled={saving || draftRating === 0} style={{ flex: 1 }} />
                    </View>
                  </Card>
                )}
                {!composing && sellerReviews.length === 0 && (
                  <Text variant="caption" color="secondary" style={{ marginTop: spacing.xs }}>
                    {t('seller.noReviewsYet')}
                  </Text>
                )}
                {!composing &&
                  sellerReviews.slice(0, 5).map((r) => (
                    <Card key={r.id} style={{ marginTop: spacing.xs }} elevated={false}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Image source={{ uri: imageUrl(r.reviewer.avatar, { width: 80 }) }} accessibilityLabel={t('listing.sellerPhotoAlt', { name: r.reviewer.name })} style={{ width: 28, height: 28, borderRadius: 14 }} cachePolicy="memory-disk" recyclingKey={r.reviewer.avatar} transition={200} />
                        <Text variant="bodyMedium" style={{ marginLeft: spacing.xs, flex: 1 }}>
                          {r.reviewer.name}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Ionicons key={i} name={i < r.rating ? 'star' : 'star-outline'} size={16} color={colors.warning} />
                          ))}
                        </View>
                      </View>
                      {!!r.comment && (
                        <Text variant="caption" color="secondary" style={{ marginTop: 4 }}>
                          {r.comment}
                        </Text>
                      )}
                    </Card>
                  ))}
              </View>
            )}

            <Text variant="h3" style={{ marginTop: spacing.lg, marginBottom: spacing.xs }}>
              {t('sellerDashboard.activeListings')}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ flex: 1 }}>
            <ListingCard listing={item} />
          </View>
        )}
      />
      </KeyboardAvoidingView>
    </Screen>
  );
}
