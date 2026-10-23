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
import { SellerRatingInline } from './SellerRatingInline';
import { Listing } from '@/types';
import { closeKind } from '@/data/sellRules';
import { useFavoritesStore } from '@/store/favorites';
import { requireAuth } from '@/store/authPrompt';
import { imageUrl } from '@/lib/r2';
import { hashAt, imagePlaceholder } from '@/lib/imagePlaceholder';
import { formatBirr } from '@/lib/currency';

type Props = {
  listing: Listing;
  style?: object;
};

// Same visual language as ListingCard (image handling, favorite behavior,
// price/status formatting) plus the seller identity + rating a shopper needs
// to actually judge a compared listing — ListingCard itself stays untouched
// since it's used all over the app in places that don't want a seller row.
function CompareListingCardComponent({ listing, style }: Props) {
  const { t } = useTranslation();
  const { colors, radius, spacing, shadow } = useTheme();
  const router = useRouter();
  const favorited = useFavoritesStore((s) => s.isFavorited(listing.id));
  const toggleFavoriteStore = useFavoritesStore((s) => s.toggle);
  const scale = React.useRef(new Animated.Value(1)).current;
  const [imageFailed, setImageFailed] = React.useState(false);
  const hasImage = !!listing.images?.[0];

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
      accessibilityRole="button"
      accessibilityLabel={listing.title}
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          overflow: 'hidden',
        },
        shadow.sm,
        style,
      ]}
    >
      <View>
        {hasImage && (
          <Image
            source={{ uri: imageUrl(listing.images[0], { size: 'thumb' }) }}
            placeholder={imagePlaceholder(hashAt(listing.imageHashes, listing.images.length, 0), listing.images[0])}
            accessibilityLabel={t('components.listingCard.photoOf', { title: listing.title })}
            style={{ width: '100%', aspectRatio: 4 / 5, backgroundColor: colors.skeleton }}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={listing.images[0]}
            transition={200}
            onError={(e) => {
              if (__DEV__) console.error('[CompareListingCard] failed to load cover image', listing.images[0], e.error);
              setImageFailed(true);
            }}
          />
        )}
        {(!hasImage || imageFailed) && (
          <View
            style={[
              hasImage ? { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } : undefined,
              { width: '100%', aspectRatio: 4 / 5, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.skeleton },
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
            <Badge label={t(`listing.close.${closeKind(listing)}.status`)} tone="solid" />
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
        <Text variant="bodyMedium" numberOfLines={2}>
          {listing.title}
        </Text>
        <Text variant="h3" color="brand" style={{ marginTop: 2 }}>
          {formatBirr(listing.price, listing.currency)}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
          <Ionicons name="location-outline" size={12} color={colors.textMuted} />
          <Text variant="tiny" color="muted" numberOfLines={1} style={{ marginLeft: 2, flexShrink: 1 }}>
            {listing.city}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Image
            source={{ uri: imageUrl(listing.seller.avatar, { width: 80 }) }}
            accessibilityLabel={t('listing.sellerPhotoAlt', { name: listing.seller.name })}
            style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: colors.skeleton }}
            cachePolicy="memory-disk"
            recyclingKey={listing.seller.avatar}
            transition={200}
          />
          <Text variant="tiny" color="secondary" numberOfLines={1} style={{ marginLeft: spacing.xxs, flexShrink: 1, maxWidth: '45%' }}>
            {listing.seller.name}
          </Text>
          <View style={{ marginLeft: 'auto' }}>
            <SellerRatingInline seller={listing.seller} size={11} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export const CompareListingCard = React.memo(CompareListingCardComponent);
