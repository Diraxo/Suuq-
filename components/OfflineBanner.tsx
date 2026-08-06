import React, { useEffect, useState } from 'react';
import { View, Animated, AccessibilityInfo } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Network from 'expo-network';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';

// Mount once near the root (e.g. in the tabs layout) to surface connectivity loss globally.
export function OfflineBanner() {
  const { colors, spacing } = useTheme();
  const [isOffline, setIsOffline] = useState(false);
  const translateY = React.useRef(new Animated.Value(-40)).current;

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
    Animated.timing(translateY, { toValue: isOffline ? 0 : -40, duration: 250, useNativeDriver: true }).start();
    if (isOffline) AccessibilityInfo.announceForAccessibility('No internet connection. Showing cached listings.');
  }, [isOffline]);

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={{
        transform: [{ translateY }],
        backgroundColor: colors.error,
        paddingVertical: spacing.xxs,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
      <Text variant="tiny" color="inverse">
        No internet connection — showing cached listings
      </Text>
    </Animated.View>
  );
}
