import React from 'react';
import { Pressable, View, Animated } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';
import { Badge } from './Badge';
import { Listing } from '@/types';
import { useFavoritesStore } from '@/store/favorites';
import { requireAuth } from '@/store/authPrompt';
import { listingPostedLabel } from '@/data/time';
import { cldUrl } from '@/lib/cloudinary';
import { formatBirr } from '@/lib/currency';

type Props = {
  listing: Listing;
  width?: number;
};

function ListingCardComponent({ listing, width }: Props) {
  const { colors, radius, spacing, shadow } = useTheme();
  const router = useRouter();
  const favorited = useFavoritesStore((s) => s.isFavorited(listing.id));
  const toggleFavoriteStore = useFavoritesStore((s) => s.toggle);
  const scale = React.useRef(new Animated.Value(1)).current;

  const toggleFavorite = () => {
    requireAuth(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      toggleFavoriteStore(listing.id);
      Animated.sequence([
        Animated.spring(scale, { toValue: 1.3, useNativeDriver: true, speed: 40 }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20 }),
      ]).start();
    });
  };

  return (
    <Pressable
      onPress={() => router.push(`/listing/${listing.id}`)}
      style={[
        {
          width,
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          overflow: 'hidden',
          marginBottom: spacing.md,
        },
        shadow.sm,
      ]}
    >
      <View>
        <Image
          source={{ uri: cldUrl(listing.images[0], { width: 480 }) }}
          accessibilityLabel={`Photo of ${listing.title}`}
          style={width ? { width: '100%', height: width, backgroundColor: colors.skeleton } : { width: '100%', aspectRatio: 4 / 5, backgroundColor: colors.skeleton }}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={listing.id}
          transition={200}
        />
        {listing.status === 'reserved' && (
          <View style={{ position: 'absolute', top: spacing.xs, left: spacing.xs }}>
            <Badge label="Reserved" tone="warning" />
          </View>
        )}
        {listing.status === 'sold' && (
          <View style={{ position: 'absolute', top: spacing.xs, left: spacing.xs }}>
            <Badge label="Sold" tone="solid" />
          </View>
        )}
        {listing.status === 'expired' && (
          <View style={{ position: 'absolute', top: spacing.xs, left: spacing.xs }}>
            <Badge label="Expired" tone="neutral" />
          </View>
        )}
        <Pressable
          onPress={toggleFavorite}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={favorited ? 'Remove from favorites' : 'Add to favorites'}
          style={{
            position: 'absolute',
            top: spacing.xs,
            right: spacing.xs,
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: 'rgba(15,23,42,0.45)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Animated.View style={{ transform: [{ scale }] }}>
            <Ionicons name={favorited ? 'heart' : 'heart-outline'} size={16} color={favorited ? colors.accent : '#fff'} />
          </Animated.View>
        </Pressable>
      </View>
      <View style={{ padding: spacing.sm }}>
        <Text variant="bodyMedium" numberOfLines={1}>
          {listing.title}
        </Text>
        <Text variant="h3" color="brand" style={{ marginTop: 2 }}>
          {formatBirr(listing.price)}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
          <Ionicons name="location-outline" size={12} color={colors.textMuted} />
          <Text variant="tiny" color="muted" style={{ marginLeft: 2 }}>
            {listing.city} · {listingPostedLabel(listing)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export const ListingCard = React.memo(ListingCardComponent);
