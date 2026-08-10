import { useState } from 'react';
import { View, Pressable, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Stat } from '@/components/Stat';
import { Button } from '@/components/Button';
import { AvatarViewerModal } from '@/components/AvatarViewerModal';
import { SignOutConfirmModal } from '@/components/SignOutConfirmModal';
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

const MENU: { icon: keyof typeof Ionicons.glyphMap; label: string; href: string; authRequired?: boolean }[] = [
  { icon: 'list-outline', label: 'My Listings', href: '/my-listings', authRequired: true },
  { icon: 'bar-chart-outline', label: 'Seller Dashboard', href: '/seller-dashboard', authRequired: true },
  { icon: 'heart-outline', label: 'Favorites & Collections', href: '/favorites', authRequired: true },
  { icon: 'time-outline', label: 'Recently Viewed', href: '/recently-viewed' },
  { icon: 'trending-down-outline', label: 'Price Drops', href: '/price-drops', authRequired: true },
  { icon: 'bookmark-outline', label: 'Saved Searches', href: '/saved-searches', authRequired: true },
  { icon: 'pricetag-outline', label: 'Offers', href: '/offers', authRequired: true },
  { icon: 'star-outline', label: 'Reviews', href: '/reviews', authRequired: true },
  { icon: 'people-outline', label: 'Followers & Following', href: '/followers', authRequired: true },
  { icon: 'shield-checkmark-outline', label: 'Verification', href: '/verification', authRequired: true },
  { icon: 'business-outline', label: 'Business Dashboard', href: '/business/dashboard', authRequired: true },
  { icon: 'notifications-outline', label: 'Notifications', href: '/notifications', authRequired: true },
  { icon: 'settings-outline', label: 'Settings', href: '/settings' },
  { icon: 'help-circle-outline', label: 'Help & Support', href: '/help' },
  { icon: 'information-circle-outline', label: 'About Suuq+', href: '/about' },
];

export default function Profile() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const session = useAuthStore((s) => s.session);
  const signOut = useAuthStore((s) => s.signOut);
  const [signingIn, setSigningIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutModalVisible, setSignOutModalVisible] = useState(false);

  // Derived straight from the already-reactive stores (each keeps itself in
  // sync via realtime + optimistic local writes) instead of a one-shot fetch,
  // so Listings/Sold/Followers/Rating update instantly after any action that
  // changes them â€” no refresh or app restart needed.
  const myListings = useMyListingsStore((s) => s.listings);
  const followers = useFollowStore((s) => s.followers);
  const reviews = useReviewsStore((s) => s.reviews);
  const { openAvatarMenu, uploading: uploadingAvatar, viewerVisible, closeViewer } = useAvatarActions();
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
      showSnackbar("Couldn't sign you out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  };

  const handleMenuPress = (item: (typeof MENU)[number]) => {
    const go = () => router.push(item.href as any);
    if (item.authRequired) requireAuth(go);
    else go();
  };

  const handleGuestGoogleSignIn = async () => {
    setSigningIn(true);
    let error: string | undefined;
    try {
      ({ error } = await performGoogleSignIn());
    } catch {
      error = 'Sign-in was not completed.';
    } finally {
      setSigningIn(false);
    }
    if (error) {
      Alert.alert('Sign-in failed', error);
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
              <Pressable onPress={openAvatarMenu} accessibilityRole="button" accessibilityLabel="Profile photo options" style={{ position: 'relative' }}>
                <Image
                  source={{ uri: profile?.avatar_url ? imageUrl(profile.avatar_url, { width: 240 }) : `https://picsum.photos/seed/${profile?.id ?? 'me'}/200/200` }}
                  accessibilityLabel="Your profile photo"
                  style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: colors.skeleton }}
                  cachePolicy="memory-disk"
                  transition={200}
                />
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
                {profile?.full_name ?? 'Suuq+ user'}
              </Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4 }}>
                <Badge label="New Seller" tone="success" />
              </View>
              <Button
                label="Edit Profile"
                variant="outline"
                size="sm"
                onPress={() => router.push('/settings/edit-profile' as any)}
                style={{ marginTop: spacing.sm }}
              />
            </View>

            <Card style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: spacing.lg }}>
              <Pressable onPress={() => router.push('/my-listings')} accessibilityRole="button" accessibilityLabel="View your listings">
                <Stat label="Listings" value={stats.listingsCount} />
              </Pressable>
              <Pressable onPress={() => router.push('/my-listings?tab=sold' as any)} accessibilityRole="button" accessibilityLabel="View sold listings">
                <Stat label="Sold" value={stats.soldCount} />
              </Pressable>
              <Pressable onPress={() => router.push('/followers')} accessibilityRole="button" accessibilityLabel="View followers">
                <Stat label="Followers" value={stats.followers} />
              </Pressable>
              <Pressable onPress={() => router.push('/reviews')} accessibilityRole="button" accessibilityLabel="View reviews">
                <Stat label="Rating" value={stats.rating.toFixed(1)} />
              </Pressable>
            </Card>
          </>
        ) : (
          <View style={{ alignItems: 'center', marginTop: spacing.lg }}>
            <View
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
            </View>
            <Text variant="h2" style={{ marginTop: spacing.sm }}>
              Guest User
            </Text>
            <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xxs, paddingHorizontal: spacing.lg }}>
              Sign in to access your listings, favorites, reviews and seller dashboard.
            </Text>
            <View style={{ gap: spacing.sm, marginTop: spacing.md, alignSelf: 'stretch' }}>
              <Button
                label="Continue with Google"
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
              key={item.label}
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
                {item.label}
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
                Sign out
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
    </Screen>
  );
}
