import { useEffect, useRef, useState } from 'react';
import { View, Pressable, Dimensions, Linking, Share, Alert } from 'react-native';
// react-native-gesture-handler's FlatList AND ScrollView (not core RN's) —
// mixing a core-RN ScrollView with a horizontal pagingEnabled FlatList puts
// them in two different gesture-arbitration systems, which is what caused
// vertical scrolling to randomly stop working near the hero carousel.
// Keeping both on RNGH resolves it (same fix applied to app/post/preview.tsx
// and the technique the fullscreen gallery viewer already relies on).
import { FlatList, ScrollView } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { useTheme } from '@/theme/ThemeContext';
import { supabase } from '@/lib/supabase';
import { cldUrl } from '@/lib/cloudinary';
import { mockListings } from '@/data/mockListings';
import { useMyListingsStore } from '@/store/myListings';
import { useListingsStore, resolveListing } from '@/store/listings';
import { useFavoritesStore } from '@/store/favorites';
import { useRecentlyViewedStore } from '@/store/recentlyViewed';
import { useAuthStore } from '@/store/auth';
import { requireAuth } from '@/store/authPrompt';
import { getCategoryFields } from '@/data/categoryFields';
import { getMarketPriceStats } from '@/data/similarListings';
import { listingPostedLabel } from '@/data/time';
import { isRealListingId } from '@/data/validation';
import { isBlockedEitherWaySync } from '@/lib/blocking';
import { formatBirr } from '@/lib/currency';

const { width } = Dimensions.get('window');
const SPEC_PREVIEW_COUNT = 8;

export default function ListingDetail() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const allListings = useListingsStore((s) => s.listings);
  const removeListing = useMyListingsStore((s) => s.removeListing);
  const listing = resolveListing(id, allListings) ?? mockListings[0];
  const [activeImage, setActiveImage] = useState(0);
  const [showAllSpecs, setShowAllSpecs] = useState(false);
  const heroListRef = useRef<FlatList<string>>(null);

  // Single source of truth for the selected photo — the hero FlatList, the
  // thumbnail highlight, and the dots all read/drive this one index.
  const selectImage = (i: number) => {
    setActiveImage(i);
    heroListRef.current?.scrollToOffset({ offset: i * width, animated: true });
  };
  const favorited = useFavoritesStore((s) => s.isFavorited(listing.id));
  const toggleFavorite = useFavoritesStore((s) => s.toggle);
  const addView = useRecentlyViewedStore((s) => s.addView);
  const isUnavailable = listing.status === 'sold' || listing.status === 'expired';
  const session = useAuthStore((s) => s.session);
  const isOwner = !!session && listing.seller.id === session.user.id;

  const attributeInfoFields = getCategoryFields(listing.category, listing.subcategory)
    .filter((f) => !!listing.attributes?.[f.key])
    .map((f) => ({ key: f.key, label: f.label, value: listing.attributes?.[f.key] ?? '' }));
  const generalInfoFields = [
    { key: '_condition', label: 'Condition', value: listing.condition },
    { key: '_location', label: 'Location', value: listing.city },
    { key: '_negotiable', label: 'Negotiable', value: listing.negotiable ? 'Yes' : 'No' },
    { key: '_posted', label: 'Posted', value: listingPostedLabel(listing) },
  ];
  const allSpecFields = [...attributeInfoFields, ...generalInfoFields];
  const specFields = showAllSpecs ? allSpecFields : allSpecFields.slice(0, SPEC_PREVIEW_COUNT);
  // Real listings only — the mock catalogue is permanent demo inventory, not
  // something a real buyer could price this listing against (see compare.tsx).
  const marketStats = getMarketPriceStats(listing, allListings);

  useEffect(() => {
    addView(listing.id);
    // Only real (Supabase) listings have a row to increment, and we skip the
    // owner viewing their own listing so revisiting it doesn't inflate the stat.
    if (isRealListingId(listing.id) && !isOwner) {
      supabase.rpc('increment_listing_views', { p_listing_id: listing.id }).then(() => {});
    }
  }, [listing.id]);

  const shareListing = () => {
    Share.share({ message: `${listing.title} — ${formatBirr(listing.price)} on Suuq+` }).catch(() => {});
  };

  const contactSeller = (go: () => void) => {
    if (isBlockedEitherWaySync(listing.seller.id)) {
      Alert.alert('Not available', "You can't contact this seller.");
      return;
    }
    go();
  };

  const confirmDelete = () => {
    Alert.alert('Delete this listing?', "This can’t be undone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          removeListing(listing.id);
          router.replace('/my-listings');
        },
      },
    ]);
  };

  return (
    <Screen edges={['left', 'right', 'bottom']} noPadding>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        directionalLockEnabled
        scrollEventThrottle={16}
      >
        <View style={{ marginTop: insets.top + spacing.xs }}>
          <FlatList
            ref={heroListRef}
            data={listing.images}
            keyExtractor={(uri, i) => uri + i}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onMomentumScrollEnd={(e) => setActiveImage(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item, index }) => (
              <Pressable
                onPress={() => router.push(`/listing/gallery/${listing.id}?index=${index}` as any)}
                accessibilityRole="button"
                accessibilityLabel="View full-screen gallery"
              >
                <Image
                  source={{ uri: cldUrl(item, { width: 1200 }) }}
                  accessibilityLabel={`Photo ${index + 1} of ${listing.images.length} for ${listing.title}`}
                  style={{ width, height: width, backgroundColor: colors.skeleton }}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  recyclingKey={item}
                  transition={200}
                />
              </Pressable>
            )}
          />
          <View
            style={{
              position: 'absolute',
              top: spacing.xs,
              left: spacing.md,
              right: spacing.md,
              flexDirection: 'row',
              justifyContent: 'space-between',
            }}
          >
            <RoundButton icon="chevron-back" onPress={() => router.back()} label="Go back" />
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              <RoundButton icon="share-outline" onPress={shareListing} label="Share listing" />
              <RoundButton
                icon={favorited ? 'heart' : 'heart-outline'}
                iconColor={favorited ? colors.accent : '#fff'}
                onPress={() => requireAuth(() => toggleFavorite(listing.id))}
                label={favorited ? 'Remove from favorites' : 'Add to favorites'}
              />
            </View>
          </View>
          {listing.status !== 'available' && (
            <View style={{ position: 'absolute', top: spacing.xl + spacing.lg, left: spacing.md, flexDirection: 'row', gap: spacing.xs }}>
              <Badge
                label={listing.status === 'sold' ? 'Sold' : listing.status === 'expired' ? 'Expired' : 'Reserved'}
                tone={listing.status === 'sold' ? 'solid' : listing.status === 'reserved' ? 'warning' : 'neutral'}
              />
              {(listing.status === 'sold' || listing.status === 'expired') && <Badge label="Unavailable" tone="neutral" />}
            </View>
          )}
          {listing.images.length > 1 && (
            <View style={{ position: 'absolute', bottom: spacing.sm, alignSelf: 'center', flexDirection: 'row', gap: 4 }}>
              {listing.images.map((_, i) => (
                <View
                  key={i}
                  style={{
                    width: i === activeImage ? 16 : 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: i === activeImage ? colors.primary : 'rgba(255,255,255,0.7)',
                  }}
                />
              ))}
            </View>
          )}
        </View>

        {listing.images.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.xs, padding: spacing.sm }}
          >
            {listing.images.map((uri, i) => (
              <Pressable
                key={uri + i}
                onPress={() => selectImage(i)}
                accessibilityRole="button"
                accessibilityLabel={`Jump to photo ${i + 1}`}
              >
                <Image
                  source={{ uri }}
                  accessibilityLabel={`Thumbnail ${i + 1} of ${listing.images.length}`}
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: radius.sm,
                    borderWidth: 2,
                    borderColor: i === activeImage ? colors.primary : 'transparent',
                  }}
                  cachePolicy="memory-disk"
                  recyclingKey={uri}
                />
              </Pressable>
            ))}
          </ScrollView>
        )}

        <View style={{ padding: spacing.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Text variant="h1" color="brand">
              {formatBirr(listing.price)}
            </Text>
            {listing.negotiable && !isUnavailable && <Badge label="Negotiable" tone="accent" />}
          </View>
          <Text variant="h3" style={{ marginTop: spacing.xxs }}>
            {listing.title}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
            <Badge label={listing.condition} tone="neutral" />
            <Badge label={listing.city} tone="neutral" icon="location-outline" />
            {listing.subcategory && <Badge label={listing.subcategory} tone="neutral" />}
          </View>
          <Text variant="caption" color="muted" style={{ marginTop: spacing.xs }}>
            Posted {listingPostedLabel(listing)}
          </Text>

          <Pressable
            onPress={() => router.push(`/compare?id=${listing.id}` as any)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Compare with similar listings"
            style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, alignSelf: 'flex-start' }}
          >
            <Ionicons name="swap-horizontal-outline" size={16} color={colors.primary} />
            <Text variant="caption" color="brand" style={{ marginLeft: spacing.xxs }}>
              Compare with similar listings
            </Text>
          </Pressable>

          {marketStats && (
            <Card style={{ marginTop: spacing.md }} elevated={false}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="stats-chart-outline" size={16} color={colors.primary} />
                <Text variant="bodyMedium" style={{ marginLeft: spacing.xxs }}>
                  Market price
                </Text>
              </View>
              {marketStats.trusted ? (
                <>
                  <Text variant="caption" color="secondary" style={{ marginTop: spacing.xxs }}>
                    Average: {formatBirr(marketStats.average!)} · based on {marketStats.sampleSize} similar listings
                  </Text>
                  {marketStats.savingsAmount !== undefined && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.xxs }}>
                      <Ionicons name="pricetag" size={14} color={colors.success} />
                      <Text variant="caption" color="success" style={{ marginLeft: spacing.xxs }}>
                        Your saving: {formatBirr(marketStats.savingsAmount)} ({marketStats.savingsPercent}% below average)
                      </Text>
                    </View>
                  )}
                </>
              ) : (
                <Text variant="caption" color="secondary" style={{ marginTop: spacing.xxs }}>
                  Based on {marketStats.sampleSize} similar {marketStats.sampleSize === 1 ? 'listing' : 'listings'} — not enough yet for a reliable market price.
                </Text>
              )}
            </Card>
          )}

          {allSpecFields.length > 0 && (
            <Card style={{ marginTop: spacing.md }} elevated={false}>
              <Text variant="bodyMedium" style={{ marginBottom: spacing.xs }}>
                Specifications
              </Text>
              <View style={{ gap: spacing.xs }}>
                {specFields.map((f) => (
                  <View key={f.key} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text variant="caption" color="secondary">
                      {f.label}
                    </Text>
                    <Text variant="caption" color="primary">
                      {f.value}
                    </Text>
                  </View>
                ))}
              </View>
              {allSpecFields.length > SPEC_PREVIEW_COUNT && (
                <Pressable
                  onPress={() => setShowAllSpecs((v) => !v)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={showAllSpecs ? 'Show fewer details' : 'Show more details'}
                  style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs }}
                >
                  <Text variant="caption" color="brand">
                    {showAllSpecs ? 'Show less' : `Show more (${allSpecFields.length - SPEC_PREVIEW_COUNT})`}
                  </Text>
                  <Ionicons name={showAllSpecs ? 'chevron-up' : 'chevron-down'} size={14} color={colors.primary} style={{ marginLeft: 2 }} />
                </Pressable>
              )}
            </Card>
          )}

          {!!listing.features?.length && (
            <Card style={{ marginTop: spacing.md }} elevated={false}>
              <Text variant="bodyMedium" style={{ marginBottom: spacing.xs }}>
                Features
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {listing.features.map((f) => (
                  <View key={f} style={{ flexDirection: 'row', alignItems: 'center', width: '50%', marginBottom: spacing.xs, paddingRight: spacing.xs }}>
                    <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                    <Text variant="caption" color="secondary" style={{ marginLeft: spacing.xxs, flexShrink: 1 }}>
                      {f}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>
          )}

          {!!listing.sellerNotes?.length && (
            <Card style={{ marginTop: spacing.md }} elevated={false}>
              <Text variant="bodyMedium" style={{ marginBottom: spacing.xs }}>
                Seller Notes
              </Text>
              <View style={{ gap: spacing.xxs }}>
                {listing.sellerNotes.map((note, i) => (
                  <Text key={i} variant="caption" color="secondary">
                    • {note}
                  </Text>
                ))}
              </View>
            </Card>
          )}

          <Text variant="bodyMedium" style={{ marginTop: spacing.lg, marginBottom: spacing.xs }}>
            Description
          </Text>
          <Text variant="body" color="secondary">
            {listing.description}
          </Text>

          <Pressable onPress={() => router.push(`/seller/${listing.seller.id}`)}>
            <Card style={{ marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center' }}>
              <Image
                source={{ uri: cldUrl(listing.seller.avatar, { width: 160 }) }}
                accessibilityLabel={`${listing.seller.name}'s profile photo`}
                style={{ width: 48, height: 48, borderRadius: 24 }}
                cachePolicy="memory-disk"
                transition={200}
              />
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text variant="bodyMedium">{listing.seller.name}</Text>
                  {listing.seller.verified && <Ionicons name="checkmark-circle" size={14} color={colors.primary} />}
                </View>
                <Text variant="caption" color="secondary">
                  ⭐ {listing.seller.rating} ({listing.seller.reviewCount}) · Replies {listing.seller.responseTime}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Card>
          </Pressable>

          <Card style={{ marginTop: spacing.md }} elevated={false}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="shield-checkmark-outline" size={16} color={colors.success} />
              <Text variant="caption" color="secondary" style={{ marginLeft: spacing.xxs, flex: 1 }}>
                Meet in a public place and inspect the item before paying. Never send money in advance.
              </Text>
            </View>
          </Card>

          <Pressable
            onPress={() => requireAuth(() => router.push(`/report?type=listing&id=${listing.id}` as any))}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Report this listing"
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.md, paddingVertical: spacing.xs }}
          >
            <Ionicons name="flag-outline" size={16} color={colors.textMuted} />
            <Text variant="caption" color="muted" style={{ marginLeft: spacing.xxs }}>
              Report this listing
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      {isOwner ? (
        <View
          style={{
            flexDirection: 'row',
            gap: spacing.xs,
            padding: spacing.md,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.background,
          }}
        >
          <Button
            label="Delete Listing"
            variant="danger"
            size="sm"
            onPress={confirmDelete}
            style={{ flex: 1 }}
            icon={<Ionicons name="trash-outline" size={16} color={colors.primaryText} />}
          />
          <Button
            label="Edit Listing"
            size="sm"
            onPress={() => router.push(`/listing/edit/${listing.id}` as any)}
            style={{ flex: 1 }}
            icon={<Ionicons name="create-outline" size={16} color={colors.primaryText} />}
          />
        </View>
      ) : isUnavailable ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.xs,
            padding: spacing.md,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.background,
          }}
        >
          <Ionicons name="lock-closed-outline" size={16} color={colors.textMuted} />
          <Text variant="bodyMedium" color="muted">
            {listing.status === 'expired' ? 'This listing has expired and is no longer available.' : 'This listing has been sold and is no longer available.'}
          </Text>
        </View>
      ) : (
        <View
          style={{
            flexDirection: 'row',
            gap: spacing.xs,
            padding: spacing.md,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.background,
          }}
        >
          {listing.seller.phone && (
            <Button
              label="Call"
              variant="outline"
              size="sm"
              onPress={() => Linking.openURL(`tel:${listing.seller.phone}`)}
              style={{ flex: 1 }}
              icon={<Ionicons name="call-outline" size={16} color={colors.primary} />}
            />
          )}
          <Button
            label="Chat"
            size="sm"
            onPress={() =>
              requireAuth(() =>
                contactSeller(() =>
                  isRealListingId(listing.id) ? router.push(`/chat/${listing.id}` as any) : Alert.alert('Demo listing', "This sample listing isn't a real seller, so chat isn't available.")
                )
              )
            }
            style={{ flex: 1 }}
            icon={<Ionicons name="chatbubble-outline" size={16} color={colors.primaryText} />}
          />
          <Button
            label="Make Offer"
            variant="secondary"
            size="sm"
            onPress={() =>
              requireAuth(() =>
                contactSeller(() =>
                  isRealListingId(listing.id)
                    ? router.push(`/offers?listingId=${listing.id}&currency=${listing.currency}` as any)
                    : Alert.alert('Demo listing', "This sample listing isn't a real seller, so offers aren't available.")
                )
              )
            }
            style={{ flex: 1 }}
            icon={<Ionicons name="pricetag-outline" size={16} color={colors.primaryText} />}
          />
        </View>
      )}
    </Screen>
  );
}

function RoundButton({
  icon,
  onPress,
  label,
  iconColor = '#fff',
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  label: string;
  iconColor?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(15,23,42,0.45)',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={icon} size={18} color={iconColor} />
    </Pressable>
  );
}
