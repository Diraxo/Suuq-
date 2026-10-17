import React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { Skeleton } from '@/components/Skeleton';
import { useTheme } from '@/theme/ThemeContext';

// The two pieces every paginated listing grid shares (Home, category, city): placeholder cards while the first page
// loads, and the strip under the last row.

export function FeedSkeleton({ numColumns }: { numColumns: number }) {
  const { t } = useTranslation();
  const { spacing, radius } = useTheme();
  return (
    <View style={{ paddingHorizontal: spacing.md, gap: spacing.sm }} accessibilityLabel={t('home.updating')}>
      {Array.from({ length: 2 }).map((_, row) => (
        <View key={row} style={{ flexDirection: 'row', gap: spacing.sm }}>
          {Array.from({ length: numColumns }).map((__, col) => (
            <View key={col} style={{ flex: 1, gap: spacing.xs }}>
              <Skeleton height={140} radius={radius.md} />
              <Skeleton height={14} />
              <Skeleton width="60%" height={14} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

type FooterProps = {
  /** Rows currently shown; the footer only exists under a non-empty list. */
  count: number;
  loadingMore: boolean;
  moreFailed: boolean;
  hasMore: boolean;
  /** The first page has loaded (so "no more" really is the end). */
  ready: boolean;
  onRetry: () => void;
};

/** More loading → a spinner; a failed page → a quiet retry (rows stay); the last page → a short end note. */
export function FeedFooter({ count, loadingMore, moreFailed, hasMore, ready, onRetry }: FooterProps) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  if (count === 0) return null;
  if (loadingMore) {
    return (
      <View style={{ paddingVertical: spacing.md }}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('home.loadingMore')} />
      </View>
    );
  }
  if (moreFailed) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.md }}>
        <Text variant="tiny" color="secondary">
          {t('home.loadMoreFailed')}
        </Text>
        <Pressable onPress={onRetry} hitSlop={10} accessibilityRole="button">
          <Text variant="tiny" color="brand">
            {t('home.tryAgain')}
          </Text>
        </Pressable>
      </View>
    );
  }
  if (!hasMore && ready) {
    return (
      <Text variant="tiny" color="secondary" align="center" style={{ paddingVertical: spacing.md }}>
        {t('home.endOfFeed')}
      </Text>
    );
  }
  return null;
}
