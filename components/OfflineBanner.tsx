import React, { useEffect, useState } from 'react';
import { Animated, AccessibilityInfo } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Network from 'expo-network';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';

// Mount once near the root (e.g. in the tabs layout) to surface connectivity loss globally.
// Rendered as a sibling above the tab navigator (outside any per-screen Screen
// component's own top inset), so it must add the status-bar/notch inset itself
// — otherwise it paints flush against the top edge, under the status bar.
//
// Only actually mounted (via `visible`) while offline or animating out: a
// translateY-only hide still reserves the banner's full layout box — including
// its insets.top padding — permanently, which stacked with every screen's own
// Screen/SafeAreaView top inset and pushed all tab content down by an extra
// insets.top at all times, even online. Unmounting when fully hidden removes
// that reserved space instead of just hiding it visually.
export function OfflineBanner() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const [isOffline, setIsOffline] = useState(false);
  const [visible, setVisible] = useState(false);
  // Hidden offset grows with the top inset (status bar/notch) so the banner's
  // extra top padding below is always fully off-screen when hidden, not just
  // clipped at the top.
  const hiddenOffset = -(40 + insets.top);
  const translateY = React.useRef(new Animated.Value(hiddenOffset)).current;

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const state = await Network.getNetworkStateAsync();
        if (mounted) setIsOffline(state.isConnected === false);
      } catch {
        // expo-network unavailable in this environment — assume online
      }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (isOffline) {
      setVisible(true);
      AccessibilityInfo.announceForAccessibility(t('offline.bannerAnnouncement'));
    }
    Animated.timing(translateY, { toValue: isOffline ? 0 : hiddenOffset, duration: 250, useNativeDriver: true }).start(({ finished }) => {
      if (finished && !isOffline) setVisible(false);
    });
  }, [isOffline]);

  if (!visible) return null;

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={{
        transform: [{ translateY }],
        backgroundColor: colors.error,
        paddingTop: insets.top + spacing.xxs,
        paddingBottom: spacing.xxs,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
      <Text variant="tiny" color="inverse">
        {t('offline.bannerMessage')}
      </Text>
    </Animated.View>
  );
}
