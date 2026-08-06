import { useEffect, useRef } from 'react';
import { View, Animated, AccessibilityInfo, Share } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';
import { usePostDraft } from '@/store/postDraft';

export default function Success() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const { listingId } = useLocalSearchParams<{ listingId?: string }>();
  const reset = usePostDraft((s) => s.reset);
  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    AccessibilityInfo.announceForAccessibility('Your listing is live');
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 5 }).start();
    // Publishing must fully clear the draft here, not only when "View listing" /
    // "Post another item" is tapped — otherwise leaving this screen any other way
    // (back, a tab) reopens Sell with the just-published photos/fields still set.
    reset();
  }, []);

  const viewListing = () => {
    reset();
    if (listingId) {
      router.replace(`/listing/${listingId}` as any);
    } else {
      router.replace('/(tabs)/home');
    }
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View
          style={{
            width: 96,
            height: 96,
            borderRadius: 48,
            backgroundColor: colors.success + '1A',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: spacing.lg,
            transform: [{ scale }],
          }}
        >
          <Ionicons name="checkmark" size={48} color={colors.success} />
        </Animated.View>
        <Text variant="h1" align="center">
          Your listing is live!
        </Text>
        <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xs, paddingHorizontal: spacing.lg }}>
          Buyers nearby can find it right now. We&apos;ll notify you the moment someone messages.
        </Text>

        <View style={{ width: '100%', gap: spacing.sm, marginTop: spacing.xl, paddingHorizontal: spacing.lg }}>
          <Button label="View listing" onPress={viewListing} fullWidth />
          <Button
            label="Share listing"
            variant="outline"
            onPress={() => Share.share({ message: 'Check out my new listing on Suuq+!' }).catch(() => {})}
            fullWidth
            icon={<Ionicons name="share-outline" size={16} color={colors.primary} />}
          />
          <Button label="Post another item" variant="ghost" onPress={() => { reset(); router.replace('/post'); }} fullWidth />
        </View>
      </View>
    </Screen>
  );
}
