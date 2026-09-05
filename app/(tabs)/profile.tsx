import { useEffect, useState } from 'react';
import { View, Pressable, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Stat } from '@/components/Stat';
import { Button } from '@/components/Button';
import { AvatarViewerModal } from '@/components/AvatarViewerModal';
import { SignOutConfirmModal } from '@/components/SignOutConfirmModal';
import { ReviewerSignInModal } from '@/components/ReviewerSignInModal';
import { useTheme } from '@/theme/ThemeContext';
import { useAuthStore } from '@/store/auth';
import { useMyListingsStore } from '@/store/myListings';
import { useFollowStore } from '@/store/follow';
import { useReviewsStore } from '@/store/reviews';
import { requireAuth } from '@/store/authPrompt';
import { performGoogleSignIn, announceSignInSuccess } from '@/lib/authFlow';
import { ThemeToggle } from '@/components/ThemeToggle';
import { imageUrl } from '@/lib/r2';
import { useAvatarActions } from '@/hooks/useAvatarActions';
import { showSnackbar } from '@/lib/snackbar';

const MENU: { icon: keyof typeof Ionicons.glyphMap; labelKey: string; href: string; authRequired?: boolean }[] = [
  { icon: 'list-outline', labelKey: 'myListings', href: '/my-listings', authRequired: true },
  { icon: 'bar-chart-outline', labelKey: 'sellerDashboard', href: '/seller-dashboard', authRequired: true },
  { icon: 'heart-outline', labelKey: 'favorites', href: '/favorites', authRequired: true },
  { icon: 'time-outline', labelKey: 'recentlyViewed', href: '/recently-viewed' },
  { icon: 'trending-down-outline', labelKey: 'priceDrops', href: '/price-drops', authRequired: true },
  { icon: 'bookmark-outline', labelKey: 'savedSearches', href: '/saved-searches', authRequired: true },
  { icon: 'pricetag-outline', labelKey: 'offers', href: '/offers', authRequired: true },
  { icon: 'star-outline', labelKey: 'reviews', href: '/reviews', authRequired: true },
  { icon: 'people-outline', labelKey: 'followers', href: '/followers', authRequired: true },
  { icon: 'shield-checkmark-outline', labelKey: 'verification', href: '/verification', authRequired: true },
  { icon: 'business-outline', labelKey: 'businessDashboard', href: '/business/dashboard', authRequired: true },
  { icon: 'notifications-outline', labelKey: 'notifications', href: '/notifications', authRequired: true },
  { icon: 'settings-outline', labelKey: 'settings', href: '/settings' },
  { icon: 'help-circle-outline', labelKey: 'help', href: '/help' },
  { icon: 'information-circle-outline', labelKey: 'about', href: '/about' },
];

export default function Profile() {
  const { colors, spacing, radius } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const session = useAuthStore((s) => s.session);
  const signOut = useAuthStore((s) => s.signOut);
  const [signingIn, setSigningIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutModalVisible, setSignOutModalVisible] = useState(false);
  // Hidden entry point for the app-store review teams — see ReviewerSignInModal.
  const [reviewerModalVisible, setReviewerModalVisible] = useState(false);

  // Derived straight from the already-reactive stores (each keeps itself in
  // sync via realtime + optimistic local writes) instead of a one-shot fetch,
  // so Listings/Sold/Followers/Rating update instantly after any action that
  // changes them â€” no refresh or app restart needed.
  const myListings = useMyListingsStore((s) => s.listings);
  const followers = useFollowStore((s) => s.followers);
  const reviews = useReviewsStore((s) => s.reviews);
  const { openAvatarMenu, uploading: uploadingAvatar, viewerVisible, closeViewer } = useAvatarActions();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const avatarUri = profile?.avatar_url ? imageUrl(profile.avatar_url, { width: 240 }) : `https://picsum.photos/seed/${profile?.id ?? 'me'}/200/200`;
  const stats = {
    listingsCount: myListings.filter((l) => l.status === 'available' || l.status === 'reserved').length,
    soldCount: myListings.filter((l) => l.status === 'sold').length,
    followers: followers.length,
    rating: reviews.length > 0 ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0,
    reviewCount: reviews.length,
  };

  const confirmSignOut = () => {
    if (signingOut) return;
    setSignOutModalVisible(true);
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      setSignOutModalVisible(false);
      router.replace('/(tabs)/home');
    } catch {
      setSignOutModalVisible(false);
      showSnackbar(t('profile.signOutError'));
    } finally {
      setSigningOut(false);
    }
  };

  const handleMenuPress = (item: (typeof MENU)[number]) => {
    const go = () => router.push(item.href as any);
    if (item.authRequired) requireAuth(go);
    else go();
  };

  useEffect(() => {
    setAvatarFailed(false);
  }, [avatarUri]);

  const handleGuestGoogleSignIn = async () => {
    setSigningIn(true);
    let error: string | undefined;
    try {
      ({ error } = await performGoogleSignIn());
    } catch {
      error = t('profile.signInIncomplete');
    } finally {
      setSigningIn(false);
    }
    if (error) {
      Alert.alert(t('profile.signInFailedTitle'), error);
      return;
    }
    if (useAuthStore.getState().session) {
      announceSignInSuccess();
    }
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.xs }}>
          <ThemeToggle />
        </View>
        {session ? (
          <>
            <View style={{ alignItems: 'center', marginTop: spacing.lg }}>
              <Pressable onPress={openAvatarMenu} accessibilityRole="button" accessibilityLabel={t('profile.avatarOptions')} style={{ position: 'relative' }}>
                <Image
                  source={{ uri: avatarUri }}
                  accessibilityLabel={t('profile.yourPhoto')}
                  style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: colors.skeleton }}
                  cachePolicy="memory-disk"
                  transition={200}
                  onError={(e) => {
                    if (__DEV__) console.error('[Profile] failed to load avatar', avatarUri, e.error);
                    setAvatarFailed(true);
                  }}
                />
                {avatarFailed && (
                  <View
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: 84,
                      height: 84,
                      borderRadius: 42,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: colors.skeleton,
                    }}
                    pointerEvents="none"
                  >
                    <Ionicons name="person" size={36} color={colors.textMuted} />
                  </View>
                )}
                <View
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: colors.primary,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 2,
                    borderColor: colors.background,
                  }}
                >
                  {uploadingAvatar ? <ActivityIndicator size="small" color={colors.primaryText} /> : <Ionicons name="camera" size={14} color={colors.primaryText} />}
                </View>
              </Pressable>
              <Text variant="h2" style={{ marginTop: spacing.sm }}>
                {profile?.full_name ?? t('profile.defaultUserName')}
              </Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4 }}>
                <Badge label={t('profile.newSeller')} tone="success" />
              </View>
              <Button
                label={t('profile.editProfile')}
                variant="outline"
                size="sm"
                onPress={() => router.push('/settings/edit-profile' as any)}
                style={{ marginTop: spacing.sm }}
              />
            </View>

            <Card style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: spacing.lg }}>
              <Pressable onPress={() => router.push('/my-listings')} accessibilityRole="button" accessibilityLabel={t('profile.viewListings')}>
                <Stat label={t('profile.stats.listings')} value={stats.listingsCount} />
              </Pressable>
              <Pressable onPress={() => router.push('/my-listings?tab=sold' as any)} accessibilityRole="button" accessibilityLabel={t('profile.viewSold')}>
                <Stat label={t('profile.stats.sold')} value={stats.soldCount} />
              </Pressable>
              <Pressable onPress={() => router.push('/followers')} accessibilityRole="button" accessibilityLabel={t('profile.viewFollowers')}>
                <Stat label={t('profile.stats.followers')} value={stats.followers} />
              </Pressable>
              <Pressable onPress={() => router.push('/reviews')} accessibilityRole="button" accessibilityLabel={t('profile.viewReviews')}>
                <Stat label={t('profile.stats.rating')} value={stats.rating.toFixed(1)} />
              </Pressable>
            </Card>
          </>
        ) : (
          <View style={{ alignItems: 'center', marginTop: spacing.lg }}>
            <Pressable
              onLongPress={() => setReviewerModalVisible(true)}
              delayLongPress={800}
              accessibilityRole="image"
              accessibilityLabel={t('profile.guestUser')}
              style={{
                width: 84,
                height: 84,
                borderRadius: 42,
                backgroundColor: colors.skeleton,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="person" size={36} color={colors.textMuted} />
            </Pressable>
            <Text variant="h2" style={{ marginTop: spacing.sm }}>
              {t('profile.guestUser')}
            </Text>
            <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xxs, paddingHorizontal: spacing.lg }}>
              {t('profile.guestPrompt')}
            </Text>
            <View style={{ gap: spacing.sm, marginTop: spacing.md, alignSelf: 'stretch' }}>
              <Button
                label={t('components.authPrompt.continueWithGoogle', { provider: 'Google' })}
                onPress={handleGuestGoogleSignIn}
                loading={signingIn}
                disabled={signingIn}
                fullWidth
                icon={<Image source={require('@/assets/images/google-logo.png')} style={{ width: 18, height: 18 }} />}
              />
            </View>
          </View>
        )}

        <View style={{ marginTop: spacing.lg, gap: 2 }}>
          {MENU.map((item) => (
            <Pressable
              key={item.href}
              onPress={() => handleMenuPress(item)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.xs,
              }}
            >
              <Ionicons name={item.icon} size={20} color={colors.textSecondary} />
              <Text variant="body" style={{ marginLeft: spacing.sm, flex: 1 }}>
                {t(`profile.menu.${item.labelKey}`)}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          ))}
          {session && (
            <Pressable
              onPress={confirmSignOut}
              disabled={signingOut}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.xs,
                opacity: signingOut ? 0.6 : 1,
              }}
            >
              {signingOut ? (
                <ActivityIndicator size="small" color={colors.error} />
              ) : (
                <Ionicons name="log-out-outline" size={20} color={colors.error} />
              )}
              <Text variant="body" color="error" style={{ marginLeft: spacing.sm, flex: 1 }}>
                {t('profile.signOut')}
              </Text>
            </Pressable>
          )}
        </View>
      </ScrollView>

      {session && (
        <AvatarViewerModal
          visible={viewerVisible}
          uri={profile?.avatar_url ? imageUrl(profile.avatar_url, { width: 800 }) : `https://picsum.photos/seed/${profile?.id ?? 'me'}/200/200`}
          onClose={closeViewer}
        />
      )}

      <SignOutConfirmModal
        visible={signOutModalVisible}
        loading={signingOut}
        onCancel={() => setSignOutModalVisible(false)}
        onConfirm={handleSignOut}
      />

      <ReviewerSignInModal visible={reviewerModalVisible} onClose={() => setReviewerModalVisible(false)} />
    </Screen>
  );
}
