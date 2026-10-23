import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Animated, AccessibilityInfo, Share } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { idParam } from '@/lib/routeParams';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';
import { usePostDraft } from '@/store/postDraft';

export default function Success() {
  const { colors, spacing, radius } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { listingId: rawListingId } = useLocalSearchParams<{ listingId?: string }>();
  const listingId = idParam(rawListingId) || undefined;
  const reset = usePostDraft((s) => s.reset);
  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    AccessibilityInfo.announceForAccessibility(t('post.success.announcement'));
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
          {t('post.success.title')}
        </Text>
        <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xs, paddingHorizontal: spacing.lg }}>
          {t('post.success.subtitle')}
        </Text>

        <View style={{ width: '100%', gap: spacing.sm, marginTop: spacing.xl, paddingHorizontal: spacing.lg }}>
          <Button label={t('post.success.viewListing')} onPress={viewListing} fullWidth />
          <Button
            label={t('post.success.shareListing')}
            variant="outline"
            onPress={() => Share.share({ message: t('post.success.shareMessage') }).catch(() => {})}
            fullWidth
            icon={<Ionicons name="share-outline" size={16} color={colors.primary} />}
          />
          <Button label={t('post.success.postAnotherItem')} variant="ghost" onPress={() => { reset(); router.replace('/post'); }} fullWidth />
        </View>
      </View>
    </Screen>
  );
}
