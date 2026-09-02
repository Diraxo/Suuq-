import { useEffect, useRef, useState } from 'react';
import { View, Pressable, Dimensions, Linking, Share, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
// react-native-gesture-handler's FlatList AND ScrollView (not core RN's) â€”
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
import { BackButton } from '@/components/BackButton';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { Skeleton } from '@/components/Skeleton';
import { EmptyState } from '@/components/EmptyState';
import { releaseListingNavLock } from '@/components/ListingCard';
import { useTheme } from '@/theme/ThemeContext';
import { supabase } from '@/lib/supabase';
import { imageUrl } from '@/lib/r2';
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
import { showSnackbar } from '@/lib/snackbar';

const { width } = Dimensions.get('window');
const SPEC_PREVIEW_COUNT = 8;

export default function ListingDetail() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const allListings = useListingsStore((s) => s.listings);
  const hasHydrated = useListingsStore((s) => s.hasHydrated);
  const removeListing = useMyListingsStore((s) => s.removeListing);
  const markSold = useMyListingsStore((s) => s.markSold);
  const foundListing = resolveListing(id, allListings);
  const [activeImage, setActiveImage] = useState(0);
  const [showAllSpecs, setShowAllSpecs] = useState(false);
  const [marking, setMarking] = useState(false);
  const heroListRef = useRef<FlatList<string>>(null);

  // Single source of truth for the selected photo â€” the hero FlatList, the
  // thumbnail highlight, and the dots all read/drive this one index.
  const selectImage = (i: number) => {
    setActiveImage(i);
    heroListRef.current?.scrollToOffset({ offset: i * width, animated: true });
  };
  const favorited = useFavoritesStore((s) => s.isFavorited(foundListing?.id ?? ''));
  const toggleFavorite = useFavoritesStore((s) => s.toggle);
  const addView = useRecentlyViewedStore((s) => s.addView);
  const session = useAuthStore((s) => s.session);
  const isOwner = !!session && !!foundListing && foundListing.seller.id === session.user.id;

  // A listing card's tap lock (components/ListingCard.tsx) stays held until
  // the navigation it started actually lands here — this is that "landed"
  // signal, freeing the lock so the next card tap can navigate. Runs
  // unconditionally on mount (not gated on foundListing) since the lock
  // should release as soon as this screen exists, regardless of whether the
  // listing data itself has resolved yet.
  useEffect(() => {
    releaseListingNavLock();
  }, []);

  useEffect(() => {
    if (!foundListing) return;
    addView(foundListing.id);
    // Only real (Supabase) listings have a row to increment, and we skip the
    // owner viewing their own listing so revisiting it doesn't inflate the stat.
    if (isRealListingId(foundListing.id) && !isOwner) {
      supabase.rpc('increment_listing_views', { p_listing_id: foundListing.id }).then(() => {});
    }
  }, [foundListing?.id, isOwner]);

  // A real (non-mock) id that hasn't shown up in the global store yet is a
  // loading state, not a missing listing â€” the store hasn't hydrated, or a
  // deep link landed before Home's initial load() resolved. Only treat it as
  // truly missing once hydration has actually finished and it's still absent.
  if (!foundListing && !hasHydrated) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <View style={{ marginTop: insets.top + spacing.xs, gap: spacing.md }}>
          <Skeleton height={width} radius={0} />
          <View style={{ paddingHorizontal: spacing.md, gap: spacing.sm }}>
            <Skeleton width="50%" height={28} />
            <Skeleton width="80%" height={20} />
            <Skeleton width="60%" height={16} />
          </View>
        </View>
      </Screen>
    );
  }
  if (!foundListing) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <View style={{ flexDirection: 'row', paddingTop: insets.top + spacing.xs, paddingHorizontal: spacing.md }}>
          <BackButton onPress={() => router.back()} />
        </View>
        <EmptyState
          icon="alert-circle-outline"
          title={t('listing.notFound.title')}
          message={t('listing.notFound.message')}
          actionLabel={t('listing.goBack')}
          onAction={() => router.back()}
        />
      </Screen>
    );
  }
  const listing = foundListing;
  const isUnavailable = listing.status === 'sold' || listing.status === 'expired';

  const attributeInfoFields = getCategoryFields(listing.category, listing.subcategory)
    .filter((f) => !!listing.attributes?.[f.key])
    .map((f) => ({ key: f.key, label: f.label, value: listing.attributes?.[f.key] ?? '' }));
  const generalInfoFields = [
    { key: '_condition', label: t('listing.condition'), value: listing.condition },
    { key: '_location', label: t('listing.location'), value: listing.city },
    { key: '_negotiable', label: t('listing.negotiable'), value: listing.negotiable ? t('common.yes') : t('common.no') },
    { key: '_posted', label: t('listing.postedFieldLabel'), value: listingPostedLabel(listing) },
  ];
  const allSpecFields = [...attributeInfoFields, ...generalInfoFields];
  const specFields = showAllSpecs ? allSpecFields : allSpecFields.slice(0, SPEC_PREVIEW_COUNT);
  // Real listings only â€” the mock catalogue is permanent demo inventory, not
  // something a real buyer could price this listing against (see compare.tsx).
  const marketStats = getMarketPriceStats(listing, allListings);

  const shareListing = () => {
    Share.share({ message: t('listing.shareMessage', { title: listing.title, price: formatBirr(listing.price), brand: 'SUUQIYE' }) }).catch(() => {});
  };

  const contactSeller = (go: () => void) => {
    if (isBlockedEitherWaySync(listing.seller.id)) {
      Alert.alert(t('listing.notAvailableTitle'), t('listing.cannotContactSeller'));
      return;
    }
    go();
  };

  const confirmDelete = () => {
    Alert.alert(t('listing.deleteConfirmTitle'), t('listing.deleteConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          const ok = await removeListing(listing.id);
          if (ok) {
            router.replace('/my-listings');
          } else {
            Alert.alert(t('listing.deleteErrorTitle'), t('listing.deleteErrorMessage'));
          }
        },
      },
    ]);
  };

  const confirmMarkSold = () => {
    if (marking) return;
    Alert.alert(t('listing.markSoldConfirmTitle'), t('listing.markSoldConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('listing.markAsSold'),
        onPress: async () => {
          if (marking) return;
          setMarking(true);
          try {
            const ok = await markSold(listing.id);
            if (ok) showSnackbar(t('listing.markSoldSuccess'), { tone: 'success' });
            else Alert.alert(t('listing.markSoldErrorTitle'), t('listing.markSoldErrorMessage'));
          } finally {
            setMarking(false);
          }
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
                accessibilityLabel={t('listing.viewGallery')}
              >
                <Image
                  source={{ uri: imageUrl(item, { width: 1200 }) }}
                  accessibilityLabel={t('listing.photoAlt', { number: index + 1, total: listing.images.length, title: listing.title })}
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
            <RoundButton icon="chevron-back" onPress={() => router.back()} label={t('listing.goBack')} />
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              <RoundButton icon="share-outline" onPress={shareListing} label={t('listing.shareListing')} />
              <RoundButton
                icon={favorited ? 'heart' : 'heart-outline'}
                iconColor={favorited ? colors.accent : '#fff'}
                onPress={() => requireAuth(() => toggleFavorite(listing.id))}
                label={favorited ? t('listing.removeFromFavorites') : t('listing.addToFavorites')}
              />
            </View>
          </View>
          {listing.status !== 'available' && (
            <View style={{ position: 'absolute', top: spacing.xl + spacing.lg, left: spacing.md, flexDirection: 'row', gap: spacing.xs }}>
              <Badge
                label={t(`listing.status.${listing.status === 'sold' ? 'sold' : listing.status === 'expired' ? 'expired' : 'reserved'}`)}
                tone={listing.status === 'sold' ? 'solid' : listing.status === 'reserved' ? 'warning' : 'neutral'}
              />
              {(listing.status === 'sold' || listing.status === 'expired') && <Badge label={t('listing.unavailable')} tone="neutral" />}
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
                accessibilityLabel={t('listing.jumpToPhoto', { number: i + 1 })}
              >
                <Image
                  source={{ uri }}
                  accessibilityLabel={t('listing.thumbnailAlt', { number: i + 1, total: listing.images.length })}
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: radius.sm,
                    borderWidth: 2,
                    borderColor: i === activeImage ? colors.primary : 'transparent',
                  }}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  recyclingKey={uri}
                  transition={150}
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
            {listing.negotiable && !isUnavailable && <Badge label={t('listing.negotiable')} tone="accent" />}
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
            {t('listing.postedLabel', { time: listingPostedLabel(listing) })}
          </Text>

          {listing.status !== 'sold' && (
            <Pressable
              onPress={() => router.push(`/compare?id=${listing.id}` as any)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('listing.compareSimilar')}
              style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, alignSelf: 'flex-start' }}
            >
              <Ionicons name="swap-horizontal-outline" size={16} color={colors.primary} />
              <Text variant="caption" color="brand" style={{ marginLeft: spacing.xxs }}>
                {t('listing.compareSimilar')}
              </Text>
            </Pressable>
          )}

          {marketStats && (
            <Card style={{ marginTop: spacing.md }} elevated={false}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="stats-chart-outline" size={16} color={colors.primary} />
                <Text variant="bodyMedium" style={{ marginLeft: spacing.xxs }}>
                  {t('listing.marketPrice')}
                </Text>
              </View>
              {marketStats.trusted ? (
                <>
                  <Text variant="caption" color="secondary" style={{ marginTop: spacing.xxs }}>
                    {t('listing.marketAverage', { average: formatBirr(marketStats.average!), count: marketStats.sampleSize })}
                  </Text>
                  {marketStats.savingsAmount !== undefined && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.xxs }}>
                      <Ionicons name="pricetag" size={14} color={colors.success} />
                      <Text variant="caption" color="success" style={{ marginLeft: spacing.xxs }}>
                        {t('listing.yourSaving', { amount: formatBirr(marketStats.savingsAmount), percent: marketStats.savingsPercent })}
                      </Text>
                    </View>
                  )}
                </>
              ) : (
                <Text variant="caption" color="secondary" style={{ marginTop: spacing.xxs }}>
                  {t('listing.notEnoughData', { count: marketStats.sampleSize })}
                </Text>
              )}
            </Card>
          )}

          {allSpecFields.length > 0 && (
            <Card style={{ marginTop: spacing.md }} elevated={false}>
              <Text variant="bodyMedium" style={{ marginBottom: spacing.xs }}>
                {t('listing.specifications')}
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
                  accessibilityLabel={showAllSpecs ? t('listing.showFewerDetails') : t('listing.showMoreDetails')}
                  style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs }}
                >
                  <Text variant="caption" color="brand">
                    {showAllSpecs ? t('listing.showLess') : t('listing.showMore', { count: allSpecFields.length - SPEC_PREVIEW_COUNT })}
                  </Text>
                  <Ionicons name={showAllSpecs ? 'chevron-up' : 'chevron-down'} size={14} color={colors.primary} style={{ marginLeft: 2 }} />
                </Pressable>
              )}
            </Card>
          )}

          {!!listing.features?.length && (
            <Card style={{ marginTop: spacing.md }} elevated={false}>
              <Text variant="bodyMedium" style={{ marginBottom: spacing.xs }}>
                {t('listing.features')}
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
                {t('listing.sellerNotes')}
              </Text>
              <View style={{ gap: spacing.xxs }}>
                {listing.sellerNotes.map((note, i) => (
                  <Text key={i} variant="caption" color="secondary">
                    â€¢ {note}
                  </Text>
                ))}
              </View>
            </Card>
          )}

          <Text variant="bodyMedium" style={{ marginTop: spacing.lg, marginBottom: spacing.xs }}>
            {t('listing.description')}
          </Text>
          <Text variant="body" color="secondary">
            {listing.description}
          </Text>

          <Pressable onPress={() => router.push(`/seller/${listing.seller.id}`)}>
            <Card style={{ marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center' }}>
              <Image
                source={{ uri: imageUrl(listing.seller.avatar, { width: 160 }) }}
                accessibilityLabel={t('listing.sellerPhotoAlt', { name: listing.seller.name })}
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
                  {t('listing.sellerRatingSummary', { rating: listing.seller.rating, count: listing.seller.reviewCount, responseTime: listing.seller.responseTime })}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Card>
          </Pressable>

          <Card style={{ marginTop: spacing.md }} elevated={false}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="shield-checkmark-outline" size={16} color={colors.success} />
              <Text variant="caption" color="secondary" style={{ marginLeft: spacing.xxs, flex: 1 }}>
                {t('listing.safetyTip')}
              </Text>
            </View>
          </Card>

          <Pressable
            onPress={() => requireAuth(() => router.push(`/report?type=listing&id=${listing.id}` as any))}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('listing.reportThisListing')}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.md, paddingVertical: spacing.xs }}
          >
            <Ionicons name="flag-outline" size={16} color={colors.textMuted} />
            <Text variant="caption" color="muted" style={{ marginLeft: spacing.xxs }}>
              {t('listing.reportThisListing')}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      {isOwner && listing.status !== 'sold' ? (
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
            label={t('listing.deleteListing')}
            variant="danger"
            size="sm"
            onPress={confirmDelete}
            style={{ flex: 1 }}
            icon={<Ionicons name="trash-outline" size={16} color={colors.primaryText} />}
          />
          <Button
            label={t('listing.markAsSold')}
            variant="outline"
            size="sm"
            onPress={confirmMarkSold}
            loading={marking}
            disabled={marking}
            style={{ flex: 1 }}
            icon={<Ionicons name="checkmark-circle-outline" size={16} color={colors.primary} />}
          />
          <Button
            label={t('listing.editListing')}
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
            {listing.status === 'expired' ? t('listing.expiredMessage') : t('listing.soldMessage')}
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
              label={t('seller.call')}
              variant="outline"
              size="sm"
              onPress={() => Linking.openURL(`tel:${listing.seller.phone}`)}
              style={{ flex: 1 }}
              icon={<Ionicons name="call-outline" size={16} color={colors.primary} />}
            />
          )}
          <Button
            label={t('chat.chat')}
            size="sm"
            onPress={() =>
              requireAuth(() =>
                contactSeller(() =>
                  isRealListingId(listing.id) ? router.push(`/chat/${listing.id}` as any) : Alert.alert(t('listing.demoListingTitle'), t('listing.demoListingChatMessage'))
                )
              )
            }
            style={{ flex: 1 }}
            icon={<Ionicons name="chatbubble-outline" size={16} color={colors.primaryText} />}
          />
          <Button
            label={t('listing.makeOffer')}
            variant="secondary"
            size="sm"
            onPress={() =>
              requireAuth(() =>
                contactSeller(() =>
                  isRealListingId(listing.id)
                    ? router.push(`/offers?listingId=${listing.id}&currency=${listing.currency}` as any)
                    : Alert.alert(t('listing.demoListingTitle'), t('listing.demoListingOfferMessage'))
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
