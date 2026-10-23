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
import { closeKind, isRentalListing } from '@/data/sellRules';
import { useFavoritesStore } from '@/store/favorites';
import { registerKnownListingIds, useVisibilityStore } from '@/store/visibility';
import { requireAuth } from '@/store/authPrompt';
import { useAuthStore } from '@/store/auth';
import { listingPostedLabel } from '@/data/time';
import { imageUrl } from '@/lib/r2';
import { hashAt, imagePlaceholder } from '@/lib/imagePlaceholder';
import { prefetchCardImages } from '@/lib/imagePrefetch';
import { imageTimingDone, imageTimingStart } from '@/lib/imageTiming';
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
  // Nobody favorites their own listing, so the heart is not shown on it.
  const isOwn = useAuthStore((s) => s.session?.user.id === listing.seller.id);
  const scale = React.useRef(new Animated.Value(1)).current;
  const [imageFailed, setImageFailed] = React.useState(false);
  // Staff removed/deactivated this listing while it was on screen: drop it immediately (real-time + reconciled).
  const hiddenByServer = useVisibilityStore((s) => s.hidden.has(listing.id));
  React.useEffect(() => {
    registerKnownListingIds([listing.id]);
  }, [listing.id]);

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

  if (hiddenByServer) return null;

  return (
    <Pressable
      onPress={() => {
        if (listingNavLocked) return;
        listingNavLocked = true;
        // Start the detail screen's first photos downloading now, so they are usually ready when it opens.
        prefetchCardImages(listing.images.slice(0, 2));
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
          source={{ uri: imageUrl(listing.images[0], { size: 'thumb' }) }}
          placeholder={imagePlaceholder(hashAt(listing.imageHashes, listing.images.length, 0), listing.images[0])}
          accessibilityLabel={t('components.listingCard.photoOf', { title: listing.title })}
          style={width ? { width: '100%', height: width, backgroundColor: colors.skeleton } : { width: '100%', aspectRatio: 4 / 5, backgroundColor: colors.skeleton }}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={listing.images[0]}
          transition={200}
          onLoadStart={() => imageTimingStart('home first card')}
          onLoad={() => imageTimingDone('home first card')}
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
        {listing.status === 'available' && isRentalListing(listing.category, listing.subcategory, listing.attributes) && (
          <View style={{ position: 'absolute', top: spacing.xs, left: spacing.xs }}>
            <Badge label={t('listing.forRent')} tone="neutral" />
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
        {listing.status === 'available' && (listing.priceReduced || listing.boosted) && (
          <View style={{ position: 'absolute', top: spacing.xs, left: spacing.xs }}>
            <Badge label={listing.priceReduced ? t('components.listingCard.priceReduced') : t('components.listingCard.boosted')} tone={listing.priceReduced ? 'success' : 'accent'} />
          </View>
        )}
        {!isOwn && (
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
        )}
      </View>
      <View style={{ padding: spacing.sm }}>
        <Text variant="bodyMedium" numberOfLines={1}>
          {listing.title}
        </Text>
        <Text variant="h3" color="brand" style={{ marginTop: 2 }}>
          {formatBirr(listing.price, listing.currency)}
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
