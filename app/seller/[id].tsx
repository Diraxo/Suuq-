import { useEffect, useMemo, useState } from 'react';
import { openExternal } from '@/lib/openLink';
import { View, FlatList, Pressable, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { idParam } from '@/lib/routeParams';
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
import { UserSafetySheet } from '@/components/UserSafetySheet';
import { useBlockedEitherWayIds } from '@/lib/blocking';
import { requireAuth } from '@/store/authPrompt';
import { showSnackbar } from '@/lib/snackbar';
import { useSellerListings } from '@/hooks/useSellerListings';
import { useAuthStore } from '@/store/auth';
import { usePublicStorefront } from '@/hooks/usePublicStorefrontId';
import { useReviewsStore } from '@/store/reviews';
import { supabase } from '@/lib/supabase';
import { getSellerStats, profileToSeller } from '@/lib/sellerStats';
import { startBusinessConversation } from '@/lib/businessChat';
import { imageUrl } from '@/lib/r2';
import { Seller, Profile } from '@/types';
import { UserAvatar } from '@/components/UserAvatar';
import { BusinessProfileCard } from '@/components/BusinessProfileCard';
import { activeMode, hasBusinessDetails } from '@/lib/profileIdentity';
import { ProfileHeaderCover } from '@/components/ProfileHeaderCover';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { useContactPhone } from '@/lib/contactPhone';

// A render error in this route shows a friendly retry screen instead of closing the app.
export { ErrorFallback as ErrorBoundary } from '@/components/ErrorFallback';

export default function SellerProfile() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = idParam(rawId);
  const session = useAuthStore((s) => s.session);
  // This seller's listings come from one targeted request (not the whole catalogue).
  const sellerListings = useSellerListings(id);

  // Real profiles+listings take priority; fall back to the mock catalogue
  // (used by Dev QA links and listings whose seller isn't a real account).
  const [realSeller, setRealSeller] = useState<Seller | null>(null);
  const [profileLookupDone, setProfileLookupDone] = useState(false);
  const [rawProfile, setRawProfile] = useState<Profile | null>(null);
  // Followers/rating/reviewCount refreshed from Supabase (source of truth) on
  // mount and whenever a realtime change lands â€” listingsCount/soldCount are
  // deliberately left out of this and instead derived from `listings` below,
  // which is already reactive via the global listings store.
  const refreshStats = async (sellerId: string) => {
    const stats = await getSellerStats(sellerId);
    setRealSeller((prev) => (prev ? { ...prev, followers: stats.followers, rating: stats.rating, reviewCount: stats.reviewCount } : prev));
    setFollowBaseline({ count: stats.followers, wasFollowing: useFollowStore.getState().isFollowing(sellerId) });
  };

  // Re-reads the profile row (identity mode, names, photos, business fields) and re-derives the displayed seller, keeping the stats already loaded.
  const refreshProfile = async (sellerId: string) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', sellerId).maybeSingle();
    if (!data) return;
    setRawProfile(data as Profile);
    setRealSeller((prev) => (prev ? profileToSeller(data as Profile, { listingsCount: prev.listingsCount, soldCount: prev.soldCount, followers: prev.followers, rating: prev.rating, reviewCount: prev.reviewCount }) : prev));
  };

  useEffect(() => {
    let cancelled = false;
    setRealSeller(null);
    setRawProfile(null);
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
      setRawProfile(profile as Profile);
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
    () => (isRealSeller ? sellerListings.listings : mockListings.filter((l) => l.seller.id === seller.id)),
    [isRealSeller, sellerListings.listings, seller.id]
  );
  // Derived from the same reactive `listings` rather than the one-shot stats
  // fetch, so a new listing or a sale (by this device) shows up instantly.
  // (Only while the whole list was fetched: a seller with more listings than the page falls back to the server-side counts.)
  const countsFromList = isRealSeller && !sellerListings.loading && !sellerListings.failed && !sellerListings.hasMore;
  const displayListingsCount = countsFromList ? listings.filter((l) => l.status === 'available' || l.status === 'reserved').length : seller.listingsCount;
  const displaySoldCount = countsFromList ? listings.filter((l) => l.status === 'sold').length : seller.soldCount;
  const isFollowing = useFollowStore((s) => s.isFollowing(seller.id));
  const toggleFollow = useFollowStore((s) => s.toggle);
  const isSelf = session?.user.id === seller.id;
  const storefront = usePublicStorefront(isRealSeller ? seller.id : undefined);
  const storefrontId = storefront?.id ?? null;
  // One account, one identity: the same avatar, name and bio in both modes. In business mode the banner goes behind that header and the
  // business details follow below it. Gold comes only from a staff-verified storefront.
  const viewMode = isRealSeller && rawProfile ? activeMode(rawProfile) : 'personal';
  const showBusiness = viewMode === 'business' && (isSelf || hasBusinessDetails(rawProfile));
  // ONE Call button per profile, from ONE private number (0072): the business card carries it when the profile has a business section (and
  // only if the owner shares the number under the business); otherwise the personal header does. The database applies the matching rule.
  const sellerPhone = useContactPhone(isRealSeller ? seller.id : null, { kind: showBusiness ? 'business_profile' : 'personal_profile' }, isRealSeller && !isSelf && !!session);

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
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${seller.id}` }, () => refreshProfile(seller.id))
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

  const [safetyOpen, setSafetyOpen] = useState(false);
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

  // With a listing, chat opens on it (works on every database). With none, a direct conversation is started (migration 0066).
  const messageBusiness = async () => {
    if (listings.length > 0) {
      router.push(`/chat/${listings[0].id}` as any);
      return;
    }
    const conversationId = await startBusinessConversation(seller.id);
    if (!conversationId) {
      showSnackbar(t('business.messageFailed'));
      return;
    }
    router.push(`/chat/${conversationId}` as any);
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
    // Blocked by me: name + photo only (no listings, stats, reviews or contact buttons), with the safety menu for Unblock.
    return (
      <Screen>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.sm }}>
          <BackButton onPress={() => router.back()} />
          <Pressable
            onPress={() => setSafetyOpen(true)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('safety.menuLabel')}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -12 }}
          >
            <Ionicons name="ellipsis-vertical" size={20} color={colors.textPrimary} />
          </Pressable>
        </View>
        <View style={{ alignItems: 'center', marginTop: spacing.lg, paddingHorizontal: spacing.md }}>
          <UserAvatar uri={imageUrl(seller.avatar, { width: 240 })} name={seller.name} size={88} accessibilityLabel={t('listing.sellerPhotoAlt', { name: seller.name })} />
          <Text variant="h2" style={{ marginTop: spacing.sm, textAlign: 'center' }}>
            {seller.name}
          </Text>
          <Text variant="caption" color="secondary" style={{ marginTop: spacing.xs, textAlign: 'center' }}>
            {t('seller.blockedProfileNote')}
          </Text>
          <Button label={t('common.unblock')} variant="outline" onPress={unblockUser} style={{ marginTop: spacing.md }} />
        </View>
        <UserSafetySheet visible={safetyOpen} onClose={() => setSafetyOpen(false)} userId={seller.id} userName={seller.name} source="profile" hideViewProfile />
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
              {!isSelf && (
              <Pressable
                onPress={() => requireAuth(() => setSafetyOpen(true))}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('safety.menuLabel')}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -12 }}
              >
                <Ionicons name="ellipsis-vertical" size={20} color={colors.textPrimary} />
              </Pressable>
              )}
            </View>
              {/* Same avatar, name and bio in both modes. A business owner's banner goes behind them; nothing is duplicated below. */}
              <ProfileHeaderCover mode={viewMode} bannerUrl={rawProfile?.business_banner_url}>
                {(c) => (
                  <View style={{ alignItems: 'center' }}>
                    <View style={{ borderRadius: 48, borderWidth: c.ringed ? 4 : 0, borderColor: colors.surface }}>
                      <UserAvatar uri={imageUrl(seller.avatar, { width: 240 })} name={seller.name} size={88} accessibilityLabel={t('listing.sellerPhotoAlt', { name: seller.name })} />
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm }}>
                      <Text variant="h2" style={{ color: c.primary }}>{seller.name}</Text>
                      {seller.verified && <Ionicons name="checkmark-circle" size={18} color={colors.primary} />}
                    </View>
                    <Text variant="caption" style={{ color: c.secondary }}>
                      {seller.city?.trim() ? t('seller.memberSince', { city: seller.city.trim(), date: seller.memberSince }) : t('seller.memberSinceOnly', { date: seller.memberSince })}
                    </Text>
                    {isRealSeller && rawProfile?.bio?.trim() ? (
                      <Text variant="body" style={{ marginTop: spacing.xs, textAlign: 'center', paddingHorizontal: spacing.md, color: c.secondary }}>
                        {rawProfile.bio.trim()}
                      </Text>
                    ) : null}
                    <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                      <Badge label={t('seller.ratingBadge', { rating: displayRating.toFixed(1), count: displayReviewCount })} tone="neutral" />
                      {isRealSeller ? <Badge label={showBusiness ? t('seller.businessBadge') : t('seller.suuqPlusMember')} tone="brand" /> : <Badge label={t('seller.trustedSeller')} tone="success" />}
                    </View>
                  </View>
                )}
              </ProfileHeaderCover>
              <View style={{ alignItems: 'center' }}>
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
                    {!showBusiness && sellerPhone && (
                      <Button
                        label={t('seller.call')}
                        variant="outline"
                        onPress={() => openExternal(`tel:${sellerPhone}`)}
                        icon={<Ionicons name="call-outline" size={16} color={colors.primary} />}
                      />
                    )}
                    {/* A business profile already has its Message button in the business card below; one way to message, not two. */}
                    {isRealSeller && listings.length > 0 && !showBusiness && (
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
            {showBusiness && rawProfile ? (
              <BusinessProfileCard
                profile={rawProfile}
                phone={sellerPhone}
                verified={storefront?.verified === true}
                isSelf={isSelf}
                onContact={isRealSeller ? () => requireAuth(() => messageBusiness()) : undefined}
                onVisitStorefront={storefrontId ? () => router.push(`/storefront/${storefrontId}` as any) : undefined}
                onEdit={() => router.push('/settings/business-profile' as any)}
              />
            ) : null}

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
        ListEmptyComponent={
          sellerListings.loading ? (
            <View style={{ gap: spacing.sm }}>
              <Skeleton height={120} />
              <Skeleton height={120} />
            </View>
          ) : sellerListings.failed ? (
            <EmptyState icon="cloud-offline-outline" title={t('listing.loadError.title')} message={t('listing.loadError.message')} actionLabel={t('listing.loadError.retry')} onAction={sellerListings.retry} />
          ) : (
            <EmptyState icon="pricetags-outline" title={t('business.noListingsTitle')} message={isSelf ? t('business.noListingsSelf') : t('business.noListingsMessage')} />
          )
        }
      />
      </KeyboardAvoidingView>
      {!isSelf && <UserSafetySheet visible={safetyOpen} onClose={() => setSafetyOpen(false)} userId={seller.id} userName={seller.name} source="profile" hideViewProfile />}
    </Screen>
  );
}
