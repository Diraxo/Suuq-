import { useState } from 'react';
import { View, Pressable, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { Stat } from '@/components/Stat';
import { Button } from '@/components/Button';
import { UserAvatar } from '@/components/UserAvatar';
import i18n from '@/lib/i18n';
import { AvatarViewerModal } from '@/components/AvatarViewerModal';
import { SignOutConfirmModal } from '@/components/SignOutConfirmModal';
import { ReviewerSignInModal } from '@/components/ReviewerSignInModal';
import { useTheme } from '@/theme/ThemeContext';
import { useAuthStore } from '@/store/auth';
import { useMyListingsStore } from '@/store/myListings';
import { useFollowStore } from '@/store/follow';
import { useReviewsStore } from '@/store/reviews';
import { requireAuth } from '@/store/authPrompt';
import { performGoogleSignIn, performAppleSignIn, announceSignInSuccess } from '@/lib/authFlow';
import { AppleSignInButton } from '@/components/AppleSignInButton';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { imageUrl } from '@/lib/r2';
import { useAvatarActions } from '@/hooks/useAvatarActions';
import { showSnackbar } from '@/lib/snackbar';
import { ActiveIdentitySwitch } from '@/components/ActiveIdentitySwitch';
import { BusinessProfileCard } from '@/components/BusinessProfileCard';
import { ProfileHeaderCover } from '@/components/ProfileHeaderCover';
import { showModeSwitch } from '@/lib/profileIdentity';
import { useActiveMode } from '@/hooks/useActiveMode';
import { usePublicStorefront } from '@/hooks/usePublicStorefrontId';

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
  { icon: 'chatbubbles-outline', labelKey: 'support', href: '/support', authRequired: true },
  { icon: 'settings-outline', labelKey: 'settings', href: '/settings' },
  { icon: 'help-circle-outline', labelKey: 'help', href: '/help' },
  { icon: 'information-circle-outline', labelKey: 'about', href: '/about' },
];

export default function Profile() {
  const { colors, spacing } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const session = useAuthStore((s) => s.session);
  const signOut = useAuthStore((s) => s.signOut);
  const [signingIn, setSigningIn] = useState(false);
  const [signingProvider, setSigningProvider] = useState<'google' | 'apple' | null>(null);
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
  const { openViewer, viewerVisible, closeViewer } = useAvatarActions();
  // Gold only for a storefront staff have verified; a profile with no (published) storefront never shows it.
  const ownStorefront = usePublicStorefront(session?.user.id);
  // Which profile the owner is working in. The person above never changes; only the section below it does.
  const { mode } = useActiveMode();
  // The real sign-up date (profiles.created_at), shown in the user's language - not a made-up "new seller" label.
  const memberSince = profile?.created_at ? new Date(profile.created_at).toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' }) : null;
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

  const runGuestSignIn = async (provider: 'google' | 'apple', perform: () => Promise<{ error?: string }>) => {
    setSigningProvider(provider);
    setSigningIn(true);
    let error: string | undefined;
    try {
      ({ error } = await perform());
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

  const handleGuestGoogleSignIn = () => runGuestSignIn('google', performGoogleSignIn);
  const handleGuestAppleSignIn = () => runGuestSignIn('apple', performAppleSignIn);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.xs }}>
          <ThemeToggle />
        </View>
        {session ? (
          <>
            {/* One account, one identity: the same avatar, name and bio in both modes. Business mode only puts the business banner behind them
                and adds the business details below; there is never a second name or photo. */}
            <ProfileHeaderCover mode={mode} bannerUrl={profile?.business_banner_url}>
              {(c) => (
                <View style={{ alignItems: 'center' }}>
                  <Pressable
                    onPress={() => (profile?.avatar_url ? openViewer() : router.push('/settings/edit-profile' as any))}
                    accessibilityRole="button"
                    accessibilityLabel={t('profile.viewPhotoLabel')}
                    style={{ borderRadius: 46, borderWidth: c.ringed ? 4 : 0, borderColor: colors.surface }}
                  >
                    <UserAvatar uri={profile?.avatar_url ? imageUrl(profile.avatar_url, { width: 240 }) : null} name={profile?.full_name} size={84} accessibilityLabel={t('profile.yourPhoto')} />
                  </Pressable>
                  <Text variant="h2" style={{ marginTop: spacing.sm, textAlign: 'center', color: c.primary }}>
                    {profile?.full_name?.trim() || t('profile.defaultUserName')}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4, alignItems: 'center' }}>
                    {/* Blue = personal verification (profiles.verified_at). The gold badge belongs to a staff-verified business and sits in the business details. */}
                    {profile?.verified_at ? (
                      <View accessibilityLabel={t('profile.verifiedBadge')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
                        <Text variant="caption" style={{ color: c.secondary }}>
                          {t('profile.verifiedBadge')}
                        </Text>
                      </View>
                    ) : null}
                    {memberSince ? (
                      <Text variant="caption" style={{ color: c.secondary }}>
                        {t('profile.memberSince', { date: memberSince })}
                      </Text>
                    ) : null}
                  </View>
                  {profile?.bio?.trim() ? (
                    <Text variant="body" numberOfLines={3} style={{ marginTop: spacing.sm, textAlign: 'center', paddingHorizontal: spacing.md, color: c.secondary }}>
                      {profile.bio.trim()}
                    </Text>
                  ) : null}
                  <Button label={t('profile.editProfile')} variant="outline" size="sm" onPress={() => router.push('/settings/edit-profile' as any)} style={{ marginTop: spacing.sm }} />
                </View>
              )}
            </ProfileHeaderCover>
            {showModeSwitch(profile) ? (
              <ActiveIdentitySwitch />
            ) : (
              <Pressable
                onPress={() => router.push('/settings/business-profile' as any)}
                accessibilityRole="button"
                accessibilityLabel={t('business.createDashboard.title')}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, padding: spacing.md, borderRadius: 16, borderWidth: 1, borderColor: colors.primary + '55', backgroundColor: colors.surface }}
              >
                <Ionicons name="storefront-outline" size={24} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text variant="tiny" color="muted">{t('business.createDashboard.label')}</Text>
                  <Text variant="bodyMedium">{t('business.createDashboard.title')}</Text>
                  <Text variant="caption" color="secondary">{t('business.createDashboard.sub')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Pressable>
            )}
            {mode === 'business' ? (
              <BusinessProfileCard
                profile={profile!}
                verified={ownStorefront?.verified === true}
                isSelf
                onVisitStorefront={ownStorefront?.id ? () => router.push(`/storefront/${ownStorefront.id}` as any) : undefined}
                onEdit={() => router.push('/settings/business-profile' as any)}
              />
            ) : null}

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
              <GoogleSignInButton
                label={t('components.authPrompt.continueWithGoogle', { provider: 'Google' })}
                onPress={handleGuestGoogleSignIn}
                loading={signingIn && signingProvider === 'google'}
                disabled={signingIn}
              />
              <AppleSignInButton
                onPress={handleGuestAppleSignIn}
                loading={signingIn && signingProvider === 'apple'}
                disabled={signingIn}
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

      {session && profile?.avatar_url && (
        <AvatarViewerModal
          visible={viewerVisible}
          uri={profile?.avatar_url ? imageUrl(profile.avatar_url, { width: 800 }) : ''}
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
