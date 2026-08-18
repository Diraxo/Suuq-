import React from 'react';
import { Pressable, View, Animated } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';
import { Badge } from './Badge';
import { Listing } from '@/types';
import { useFavoritesStore } from '@/store/favorites';
import { requireAuth } from '@/store/authPrompt';
import { listingPostedLabel } from '@/data/time';
import { imageUrl } from '@/lib/r2';
import { formatBirr } from '@/lib/currency';

type Props = {
  listing: Listing;
  width?: number;
};

// Module-level (not per-card state): rapidly tapping two *different* cards
// fires two separate component instances' onPress handlers, so a lock on
// one card's own state can't see the other card's tap. This is shared by
// every ListingCard on screen, so whichever card is tapped first wins and
// every other tap — on that card or any other — is ignored until the
// listing detail screen actually mounts (see releaseListingNavLock, called
// from app/listing/[id].tsx) or the navigation attempt itself throws.
let listingNavLocked = false;

export function releaseListingNavLock() {
  listingNavLocked = false;
}

function ListingCardComponent({ listing, width }: Props) {
  const { t } = useTranslation();
  const { colors, radius, spacing, shadow } = useTheme();
  const router = useRouter();
  const favorited = useFavoritesStore((s) => s.isFavorited(listing.id));
  const toggleFavoriteStore = useFavoritesStore((s) => s.toggle);
  const scale = React.useRef(new Animated.Value(1)).current;
  const [imageFailed, setImageFailed] = React.useState(false);

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
      onPress={() => {
        if (listingNavLocked) return;
        listingNavLocked = true;
        try {
          router.push(`/listing/${listing.id}`);
        } catch (e) {
          listingNavLocked = false;
          throw e;
        }
      }}
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
          source={{ uri: imageUrl(listing.images[0], { width: 480 }) }}
          accessibilityLabel={t('components.listingCard.photoOf', { title: listing.title })}
          style={width ? { width: '100%', height: width, backgroundColor: colors.skeleton } : { width: '100%', aspectRatio: 4 / 5, backgroundColor: colors.skeleton }}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={listing.id}
          transition={200}
          onError={(e) => {
            if (__DEV__) console.error('[ListingCard] failed to load cover image', listing.images[0], e.error);
            setImageFailed(true);
          }}
        />
        {imageFailed && (
          <View
            style={[
              { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
              width ? { width: '100%', height: width } : { width: '100%', aspectRatio: 4 / 5 },
            ]}
            pointerEvents="none"
          >
            <Ionicons name="image-outline" size={28} color={colors.textMuted} />
          </View>
        )}
        {listing.status === 'reserved' && (
          <View style={{ position: 'absolute', top: spacing.xs, left: spacing.xs }}>
            <Badge label={t('components.listingCard.reserved')} tone="warning" />
          </View>
        )}
        {listing.status === 'sold' && (
          <View style={{ position: 'absolute', top: spacing.xs, left: spacing.xs }}>
            <Badge label={t('components.listingCard.sold')} tone="solid" />
          </View>
        )}
        {listing.status === 'expired' && (
          <View style={{ position: 'absolute', top: spacing.xs, left: spacing.xs }}>
            <Badge label={t('components.listingCard.expired')} tone="neutral" />
          </View>
        )}
        <Pressable
          onPress={toggleFavorite}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={favorited ? t('components.listingCard.removeFromFavorites') : t('components.listingCard.addToFavorites')}
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
            {t('components.listingCard.citySummary', { city: listing.city, posted: listingPostedLabel(listing) })}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export const ListingCard = React.memo(ListingCardComponent);
