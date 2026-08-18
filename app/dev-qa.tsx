import { useEffect, useRef, useState } from 'react';
import { View, Pressable, Animated, AccessibilityInfo, Platform, useWindowDimensions, PixelRatio, I18nManager, ScrollView } from 'react-native';
import { useRouter, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Skeleton } from '@/components/Skeleton';
import { DevSection } from '@/components/dev/DevSection';
import { DevChip } from '@/components/dev/DevChip';
import { useTheme } from '@/theme/ThemeContext';
import { useNotifStore } from '@/store/notifications';
import { useFollowStore } from '@/store/follow';
import { useOfferStore } from '@/store/offers';
import { usePostDraft } from '@/store/postDraft';
import { useDevMockStore, MockNetworkState } from '@/store/devMock';
import { useFavoritesStore } from '@/store/favorites';
import { useCollectionsStore } from '@/store/collections';
import { useSavedSearchStore } from '@/store/savedSearches';
import { useMyListingsStore } from '@/store/myListings';
import { mockSellers } from '@/data/mockListings';

type Row = { label: string; href: string };

const SECTIONS: { title: string; data: Row[] }[] = [
  {
    title: 'Onboarding',
    data: [
      { label: 'Language', href: '/(onboarding)/language' },
      { label: 'Select interests', href: '/(onboarding)/select-interests' },
    ],
  },
  {
    title: 'Main tabs',
    data: [
      { label: 'Home', href: '/(tabs)/home' },
      { label: 'Search', href: '/(tabs)/search' },
      { label: 'Chats', href: '/(tabs)/chats' },
      { label: 'Profile', href: '/(tabs)/profile' },
    ],
  },
  {
    title: 'Listings',
    data: [
      { label: 'Listing detail', href: '/listing/demo' },
      { label: 'Listing gallery', href: '/listing/gallery/demo' },
      { label: 'Edit listing', href: '/listing/edit/demo' },
      { label: 'Listing insights', href: '/listing/insights/demo' },
      { label: 'Compare listings', href: '/compare' },
      { label: 'Recently viewed', href: '/recently-viewed' },
      { label: 'Price drops', href: '/price-drops' },
    ],
  },
  {
    title: 'Posting flow',
    data: [
      { label: '1. Add photos', href: '/post' },
      { label: '2. Category', href: '/post/category' },
      { label: '3. Details', href: '/post/details' },
      { label: '4. Location', href: '/post/location' },
      { label: '5. Price', href: '/post/price' },
      { label: '6. Preview', href: '/post/preview' },
      { label: 'Success', href: '/post/success' },
    ],
  },
  {
    title: 'People & trust',
    data: [
      { label: 'Seller profile', href: `/seller/${mockSellers[0].id}` },
      { label: 'Dealer profile', href: `/dealer/${mockSellers[2].id}` },
      { label: 'Followers / following', href: '/followers' },
      { label: 'Reviews', href: '/reviews' },
      { label: 'Verification', href: '/verification' },
      { label: 'Report', href: '/report?type=listing&id=demo' },
    ],
  },
  {
    title: 'Communication',
    data: [
      { label: 'Chat thread', href: '/chat/demo' },
      { label: 'Offers', href: '/offers?listingId=demo' },
      { label: 'Pickup planner', href: '/pickup-planner' },
      { label: 'Notifications', href: '/notifications' },
    ],
  },
  {
    title: 'Seller tools',
    data: [
      { label: 'My listings', href: '/my-listings' },
      { label: 'Seller dashboard', href: '/seller-dashboard' },
      { label: 'Business dashboard', href: '/business/dashboard' },
      { label: 'Business analytics', href: '/business/analytics' },
      { label: 'Bulk upload', href: '/business/bulk-upload' },
    ],
  },
  {
    title: 'Discovery',
    data: [
      { label: 'City page', href: '/city/Hargeisa' },
      { label: 'Category detail', href: `/category/vehicles` },
      { label: 'Favorites', href: '/favorites' },
      { label: 'Saved searches', href: '/saved-searches' },
    ],
  },
  {
    title: 'Settings & info',
    data: [
      { label: 'Settings', href: '/settings' },
      { label: 'Appearance (dark/light)', href: '/settings/appearance' },
      { label: 'Language', href: '/settings/language' },
      { label: 'Safety center', href: '/settings/safety' },
      { label: 'Help & support', href: '/help' },
      { label: 'About', href: '/about' },
    ],
  },
  {
    title: 'States',
    data: [{ label: 'Offline screen', href: '/offline' }],
  },
];

const ALL_HREFS = SECTIONS.flatMap((s) => s.data.map((d) => d.href));

const NETWORK_STATES: { key: MockNetworkState; label: string }[] = [
  { key: 'normal', label: 'Normal' },
  { key: 'loading', label: 'Loading' },
  { key: 'slow', label: 'Slow network' },
  { key: 'error', label: 'Error' },
  { key: 'offline', label: 'Offline' },
  { key: 'empty', label: 'Empty' },
];

export default function DevQA() {
  const theme = useTheme();
  const { colors, spacing, radius, mode, setMode } = theme;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const notifRestore = useNotifStore((s) => s.restoreDefaults);
  const notifMarkAllRead = useNotifStore((s) => s.markAllRead);
  const followReset = useFollowStore((s) => s.reset);
  const offerReset = useOfferStore((s) => s.reset);
  const draftReset = usePostDraft((s) => s.reset);
  const favoritesReset = useFavoritesStore((s) => s.reset);
  const collectionsReset = useCollectionsStore((s) => s.reset);
  const savedSearchReset = useSavedSearchStore((s) => s.reset);
  const myListingsReset = useMyListingsStore((s) => s.reset);
  const networkState = useDevMockStore((s) => s.networkState);
  const setNetworkState = useDevMockStore((s) => s.setNetworkState);

  const [visited, setVisited] = useState<Set<string>>(new Set());
  const toggleVisited = (href: string) =>
    setVisited((prev) => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });

  const [showEmptyPreview, setShowEmptyPreview] = useState(false);
  const [showErrorPreview, setShowErrorPreview] = useState(false);
  const [showSkeletonPreview, setShowSkeletonPreview] = useState(false);
  const heartScale = useRef(new Animated.Value(1)).current;
  const successScale = useRef(new Animated.Value(0)).current;
  const [confettiKey, setConfettiKey] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);

  // Defense in depth: even a direct deep-link to /dev-qa bounces home in a production build.
  // This check runs after every hook above so hook call order never changes between renders.
  if (!__DEV__) {
    return <Redirect href="/(tabs)/home" />;
  }

  const playHeart = () => {
    heartScale.setValue(1);
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1.4, useNativeDriver: true, speed: 40 }),
      Animated.spring(heartScale, { toValue: 1, useNativeDriver: true, speed: 20 }),
    ]).start();
  };

  const playSuccess = () => {
    successScale.setValue(0);
    Animated.spring(successScale, { toValue: 1, useNativeDriver: true, friction: 5 }).start();
  };

  const playConfetti = () => {
    setConfettiKey((k) => k + 1);
    setShowConfetti(true);
    setTimeout(() => setShowConfetti(false), 1200);
  };

  const testAnnouncement = () => {
    AccessibilityInfo.announceForAccessibility('This is a test screen reader announcement from Dev QA.');
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.xs }}>
          <BackButton onPress={() => router.back()} />
          <Text variant="h2" style={{ marginLeft: spacing.sm, flex: 1 }}>
            Developer QA
          </Text>
          <Badge label="DEV ONLY" tone="warning" />
        </View>
        <Text variant="caption" color="muted" style={{ marginBottom: spacing.md }}>
          Not reachable in production builds. Visited: {visited.size}/{ALL_HREFS.length}
        </Text>

        {/* Theme shortcuts */}
        <DevSection title="Theme" defaultOpen>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <DevChip label="Light" active={mode === 'light'} onPress={() => setMode('light')} />
            <DevChip label="Dark" active={mode === 'dark'} onPress={() => setMode('dark')} />
            <DevChip label="System" active={mode === 'system'} onPress={() => setMode('system')} />
          </View>
        </DevSection>

        {/* Reset app state */}
        <DevSection title="Reset app state">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <DevChip label="Mark notifications read" onPress={notifMarkAllRead} />
            <DevChip label="Restore mock notifications" onPress={notifRestore} />
            <DevChip label="Reset follow states" onPress={followReset} />
            <DevChip label="Reset offer negotiation" onPress={offerReset} />
            <DevChip label="Clear post draft" onPress={draftReset} />
            <DevChip label="Reset favorites" onPress={favoritesReset} />
            <DevChip label="Reset collections" onPress={collectionsReset} />
            <DevChip label="Reset saved searches" onPress={savedSearchReset} />
            <DevChip label="Reset my listings" onPress={myListingsReset} />
          </View>
          <Text variant="tiny" color="muted" style={{ marginTop: spacing.xs }}>
            Recently viewed and onboarding-seen aren&apos;t backed by shared state yet — nothing to reset until those are
            wired to Supabase/local storage.
          </Text>
        </DevSection>

        {/* Mock network states */}
        <DevSection title="Mock network states (affects Home tab)">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {NETWORK_STATES.map((n) => (
              <DevChip key={n.key} label={n.label} active={networkState === n.key} onPress={() => setNetworkState(n.key)} />
            ))}
          </View>
          <Text variant="tiny" color="muted" style={{ marginTop: spacing.xs }}>
            Navigate to Home after selecting to see the effect. Other screens don&apos;t read this yet.
          </Text>
        </DevSection>

        {/* Animation testing */}
        <DevSection title="Animation testing">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm }}>
            <DevChip label="Heart pop" onPress={playHeart} />
            <DevChip label="Success checkmark" onPress={playSuccess} />
            <DevChip label="Confetti" onPress={playConfetti} />
            <DevChip label="Skeleton" active={showSkeletonPreview} onPress={() => setShowSkeletonPreview((s) => !s)} />
            <DevChip label="Empty state" active={showEmptyPreview} onPress={() => setShowEmptyPreview((s) => !s)} />
            <DevChip label="Error state" active={showErrorPreview} onPress={() => setShowErrorPreview((s) => !s)} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginBottom: spacing.sm }}>
            <Animated.View style={{ transform: [{ scale: heartScale }] }}>
              <Ionicons name="heart" size={28} color={colors.accent} />
            </Animated.View>
            <Animated.View style={{ transform: [{ scale: successScale }] }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.success + '1A', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="checkmark" size={22} color={colors.success} />
              </View>
            </Animated.View>
            {showConfetti && <ConfettiBurst key={confettiKey} />}
          </View>

          {showSkeletonPreview && (
            <View style={{ gap: spacing.xs, marginBottom: spacing.xs }}>
              <Skeleton height={14} />
              <Skeleton width="60%" height={14} />
              <Skeleton height={100} radius={radius.md} />
            </View>
          )}
          {showEmptyPreview && <EmptyState icon="search-outline" title="Preview: empty state" message="This is what an empty list looks like." />}
          {showErrorPreview && <ErrorState onRetry={() => setShowErrorPreview(false)} />}
        </DevSection>

        {/* Accessibility testing */}
        <DevSection title="Accessibility testing">
          <Text variant="body" style={{ fontSize: 15 * PixelRatio.getFontScale() }}>
            Sample text at your current system font scale ({PixelRatio.getFontScale().toFixed(2)}x)
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm }}>
            <DevChip label="Trigger screen-reader announcement" onPress={testAnnouncement} />
          </View>
          <Text variant="tiny" color="muted" style={{ marginTop: spacing.xs }}>
            RTL layout: {I18nManager.isRTL ? 'on' : 'off'}. Touch-target visualization isn&apos;t implemented — check
            manually with the OS accessibility inspector (iOS: Accessibility Inspector; Android: Layout Bounds).
          </Text>
        </DevSection>

        {/* Safe area preview */}
        <DevSection title="Safe area preview">
          <Card elevated={false}>
            <InfoRow label="Top inset" value={`${insets.top}pt`} />
            <InfoRow label="Bottom inset" value={`${insets.bottom}pt`} />
            <InfoRow label="Left inset" value={`${insets.left}pt`} />
            <InfoRow label="Right inset" value={`${insets.right}pt`} />
            <InfoRow label="Window size" value={`${Math.round(width)} × ${Math.round(height)}`} last />
          </Card>
        </DevSection>

        {/* Device info */}
        <DevSection title="Device info">
          <Card elevated={false}>
            <InfoRow label="Platform" value={`${Platform.OS} ${Platform.Version}`} />
            <InfoRow label="Expo SDK" value={String(Constants.expoConfig?.sdkVersion ?? 'unknown')} />
            <InfoRow label="App version" value={String(Constants.expoConfig?.version ?? 'unknown')} />
            <InfoRow label="Color scheme" value={theme.isDark ? 'dark' : 'light'} />
            <InfoRow label="Font scale" value={`${PixelRatio.getFontScale().toFixed(2)}x`} />
            <InfoRow label="Pixel ratio" value={String(PixelRatio.get())} />
            <InfoRow label="RTL" value={I18nManager.isRTL ? 'yes' : 'no'} last />
          </Card>
        </DevSection>

        {/* Navigation validation checklist + jump list */}
        <DevSection title={`Visit every screen (${visited.size}/${ALL_HREFS.length})`} defaultOpen>
          {SECTIONS.map((section) => (
            <View key={section.title}>
              <Text variant="caption" color="muted" style={{ marginTop: spacing.md, marginBottom: spacing.xxs, textTransform: 'uppercase' }}>
                {section.title}
              </Text>
              {section.data.map((item) => {
                const isVisited = visited.has(item.href);
                return (
                  <View
                    key={item.href}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border }}
                  >
                    <Pressable
                      onPress={() => toggleVisited(item.href)}
                      hitSlop={8}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isVisited }}
                      accessibilityLabel={`Mark ${item.label} as visited`}
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 5,
                        borderWidth: 1.5,
                        borderColor: isVisited ? colors.success : colors.border,
                        backgroundColor: isVisited ? colors.success : 'transparent',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: spacing.sm,
                      }}
                    >
                      {isVisited && <Ionicons name="checkmark" size={14} color="#fff" />}
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        toggleVisited(item.href);
                        router.push(item.href as any);
                      }}
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
                    >
                      <Text variant="body" style={{ flex: 1 }}>
                        {item.label}
                      </Text>
                      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ))}
        </DevSection>
      </ScrollView>
    </Screen>
  );
}

function InfoRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const { colors, spacing } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: spacing.xxs,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
      }}
    >
      <Text variant="caption" color="secondary">
        {label}
      </Text>
      <Text variant="caption">{value}</Text>
    </View>
  );
}

function ConfettiBurst() {
  const pieces = useRef(
    Array.from({ length: 14 }).map(() => ({
      anim: new Animated.Value(0),
      x: Math.random() * 80 - 40,
      color: ['#4F46E5', '#FF6B6B', '#10B981', '#F59E0B'][Math.floor(Math.random() * 4)],
      delay: Math.random() * 150,
    }))
  ).current;

  useEffect(() => {
    pieces.forEach((p) => {
      Animated.timing(p.anim, { toValue: 1, duration: 900, delay: p.delay, useNativeDriver: true }).start();
    });
  }, []);

  return (
    <View style={{ width: 40, height: 40 }}>
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: p.color,
            transform: [
              { translateX: p.x },
              {
                translateY: p.anim.interpolate({ inputRange: [0, 1], outputRange: [0, 80] }),
              },
            ],
            opacity: p.anim.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
          }}
        />
      ))}
    </View>
  );
}
