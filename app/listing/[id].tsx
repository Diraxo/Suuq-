import { useEffect, useRef, useState } from 'react';
import { openExternal } from '@/lib/openLink';
import { View, Pressable, Dimensions, Share, Alert } from 'react-native';
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
import { idParam } from '@/lib/routeParams';
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
import { hashAt, imagePlaceholder } from '@/lib/imagePlaceholder';
import { prefetchCardImages } from '@/lib/imagePrefetch';
import { imageTimingDone, imageTimingStart } from '@/lib/imageTiming';
import { useMyListingsStore } from '@/store/myListings';
import { useListing } from '@/hooks/useListings';
import { useResource } from '@/hooks/useResource';
import { fetchComparableListings } from '@/lib/listingsApi';
import { useFavoritesStore } from '@/store/favorites';
import { useRecentlyViewedStore } from '@/store/recentlyViewed';
import { useAuthStore } from '@/store/auth';
import { requireAuth } from '@/store/authPrompt';
import { getCategoryFields } from '@/data/categoryFields';
import { categoryLabel, subcategoryLabel } from '@/data/categoryNames';
import { closeKind, conditionApplies, isRentalListing } from '@/data/sellRules';
import { fieldLabelText, optionText } from '@/lib/sellText';
import { getMarketPriceStats } from '@/data/similarListings';
import { listingPostedLabel } from '@/data/time';
import { isRealListingId } from '@/data/validation';
import { useContactPhone } from '@/lib/contactPhone';
import { isBlockedEitherWaySync } from '@/lib/blocking';
import { UserSafetySheet } from '@/components/UserSafetySheet';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatBirr } from '@/lib/currency';
import { showSnackbar } from '@/lib/snackbar';

// A render error in this route shows a friendly retry screen instead of closing the app.
export { ErrorFallback as ErrorBoundary } from '@/components/ErrorFallback';

const { width } = Dimensions.get('window');
const SPEC_PREVIEW_COUNT = 8;

export default function ListingDetail() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = idParam(rawId);
  const removeListing = useMyListingsStore((s) => s.removeListing);
  const markSold = useMyListingsStore((s) => s.markSold);
  const updateListing = useMyListingsStore((s) => s.updateListing);
  // Fetched by id (a cached copy shows instantly and is re-checked once): the screen never depends on the whole catalogue.
  const { listing: foundListing, status: lookupStatus, retry } = useListing(id);
  // Real listings similar to this one, for the market-price estimate. A failure only hides the estimate.
  const comparableKey = foundListing ? `${foundListing.id}|${foundListing.category}|${foundListing.subcategory ?? ''}` : null;
  const comparables = useResource(comparableKey, () => fetchComparableListings({ category: foundListing!.category, subcategory: foundListing!.subcategory, excludeId: foundListing!.id }));
  const [activeImage, setActiveImage] = useState(0);
  const [showAllSpecs, setShowAllSpecs] = useState(false);
  const [marking, setMarking] = useState(false);
  const [confirming, setConfirming] = useState<'delete' | 'sold' | 'reopen' | null>(null);
  const heroListRef = useRef<FlatList<string>>(null);

  // Single source of truth for the selected photo â€” the hero FlatList, the
  // thumbnail highlight, and the dots all read/drive this one index.
  const selectImage = (i: number) => {
    setActiveImage(i);
    heroListRef.current?.scrollToOffset({ offset: i * width, animated: true });
  };
  // The photo on screen and the next two are always downloaded (or on their way) before the buyer swipes to them.
  const heroImages = foundListing?.images;
  useEffect(() => {
    if (heroImages?.length) prefetchCardImages(heroImages.slice(activeImage, activeImage + 3));
  }, [heroImages, activeImage]);
  const favorited = useFavoritesStore((s) => s.isFavorited(foundListing?.id ?? ''));
  const toggleFavorite = useFavoritesStore((s) => s.toggle);
  const addView = useRecentlyViewedStore((s) => s.addView);
  const session = useAuthStore((s) => s.session);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const isOwner = !!session && !!foundListing && foundListing.seller.id === session.user.id;
  // The seller's phone is private (0072): the database hands it to a signed-in viewer only where the owner shares it for this listing.
  const callPhone = useContactPhone(foundListing?.seller.id, foundListing ? { kind: 'listing', listingId: foundListing.id } : null, !!session && !!foundListing && !isOwner && isRealListingId(foundListing.id));

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

  // A real id that is still being fetched (first open, or a deep link) is a loading state, not a missing listing.
  // "Not found" is shown only when the server says the listing is not visible (removed, deactivated, blocked, or it
  // never existed); a failed request is its own state with a retry.
  if (!foundListing && lookupStatus === 'loading') {
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
  if (!foundListing && lookupStatus === 'error') {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <View style={{ flexDirection: 'row', paddingTop: insets.top + spacing.xs, paddingHorizontal: spacing.md }}>
          <BackButton onPress={() => router.back()} />
        </View>
        <EmptyState icon="cloud-offline-outline" title={t('listing.loadError.title')} message={t('listing.loadError.message')} actionLabel={t('listing.loadError.retry')} onAction={retry} />
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
  // The stored status is 'sold' for every closed listing; the words depend on what it was: sold, rented, filled or closed.
  const kind = closeKind(listing);
  const isRental = isRentalListing(listing.category, listing.subcategory, listing.attributes);

  const attributeInfoFields = getCategoryFields(listing.category, listing.subcategory)
    .filter((f) => !!listing.attributes?.[f.key])
    .map((f) => {
      const raw = listing.attributes?.[f.key] ?? '';
      return { key: f.key, label: fieldLabelText(t, f), value: f.type === 'select' ? optionText(t, raw) : raw };
    });
  const showCondition = conditionApplies(listing.category, listing.subcategory);
  const generalInfoFields = [
    ...(showCondition ? [{ key: '_condition', label: t('listing.condition'), value: listing.condition }] : []),
    { key: '_location', label: t('listing.location'), value: listing.city },
    { key: '_negotiable', label: t('listing.negotiable'), value: listing.negotiable ? t('common.yes') : t('common.no') },
    { key: '_posted', label: t('listing.postedFieldLabel'), value: listingPostedLabel(listing) },
  ];
  const allSpecFields = [...attributeInfoFields, ...generalInfoFields];
  const specFields = showAllSpecs ? allSpecFields : allSpecFields.slice(0, SPEC_PREVIEW_COUNT);
  // Real listings only â€” the mock catalogue is permanent demo inventory, not
  // something a real buyer could price this listing against (see compare.tsx).
  const marketStats = comparables.data ? getMarketPriceStats(listing, comparables.data) : null;

  const shareListing = () => {
    Share.share({ message: t('listing.shareMessage', { title: listing.title, price: formatBirr(listing.price, listing.currency), brand: 'SUUQIYE' }) }).catch(() => {});
  };

  const contactSeller = (go: () => void) => {
    if (isBlockedEitherWaySync(listing.seller.id)) {
      Alert.alert(t('listing.notAvailableTitle'), t('listing.cannotContactSeller'));
      return;
    }
    go();
  };

  const confirmDelete = () => setConfirming('delete');
  const confirmMarkSold = () => {
    if (!marking) setConfirming('sold');
  };
  const confirmReopen = () => {
    if (!marking) setConfirming('reopen');
  };

  const runConfirmed = async () => {
    const action = confirming;
    setConfirming(null);
    if (action === 'delete') {
      const ok = await removeListing(listing.id);
      if (ok) router.replace('/my-listings');
      else Alert.alert(t('listing.deleteErrorTitle'), t('listing.deleteErrorMessage'));
    } else if (action === 'reopen') {
      if (marking) return;
      setMarking(true);
      try {
        const ok = await updateListing(listing.id, { status: 'available' });
        if (ok) showSnackbar(t('listing.reopen.success'), { tone: 'success' });
        else Alert.alert(t('listing.reopen.errorTitle'), t('listing.markSoldErrorMessage'));
      } finally {
        setMarking(false);
      }
    } else if (action === 'sold') {
      if (marking) return;
      setMarking(true);
      try {
        const ok = await markSold(listing.id);
        if (ok) showSnackbar(t(`listing.close.${kind}.success`), { tone: 'success' });
        else Alert.alert(t(`listing.close.${kind}.errorTitle`), t('listing.markSoldErrorMessage'));
      } finally {
        setMarking(false);
      }
    }
  };

  return (
    <Screen edges={['left', 'right', 'bottom']} noPadding>
      <ConfirmDialog
        visible={confirming !== null}
        icon={confirming === 'delete' ? 'trash-outline' : 'checkmark-circle-outline'}
        destructive={confirming === 'delete'}
        title={confirming === 'delete' ? t('listing.deleteConfirmTitle') : confirming === 'reopen' ? t('listing.reopen.confirmTitle') : t(`listing.close.${kind}.confirmTitle`)}
        message={confirming === 'delete' ? t('listing.deleteConfirmMessage') : confirming === 'reopen' ? t('listing.reopen.confirmMessage') : t(`listing.close.${kind}.confirmMessage`)}
        confirmLabel={confirming === 'delete' ? t('common.delete') : confirming === 'reopen' ? t('listing.reopen.confirmYes') : t(`listing.close.${kind}.confirmYes`)}
        onCancel={() => setConfirming(null)}
        onConfirm={runConfirmed}
      />
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
            initialNumToRender={2}
            windowSize={3}
            maxToRenderPerBatch={2}
            onMomentumScrollEnd={(e) => setActiveImage(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item, index }) => (
              <Pressable
                onPress={() => router.push(`/listing/gallery/${listing.id}?index=${index}` as any)}
                accessibilityRole="button"
                accessibilityLabel={t('listing.viewGallery')}
              >
                <Image
                  source={{ uri: imageUrl(item, { size: 'card' }) }}
                  placeholder={imagePlaceholder(hashAt(listing.imageHashes, listing.images.length, index), item)}
                  accessibilityLabel={t('listing.photoAlt', { number: index + 1, total: listing.images.length, title: listing.title })}
                  style={{ width, height: width, backgroundColor: colors.skeleton }}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  recyclingKey={imageUrl(item, { size: 'card' })}
                  transition={200}
                  onLoadStart={index === 0 ? () => imageTimingStart('listing detail first photo') : undefined}
                  onLoad={index === 0 ? () => imageTimingDone('listing detail first photo') : undefined}
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
              {!isOwner && (
                <RoundButton
                  icon={favorited ? 'heart' : 'heart-outline'}
                  iconColor={favorited ? colors.accent : '#fff'}
                  onPress={() => requireAuth(() => toggleFavorite(listing.id))}
                  label={favorited ? t('listing.removeFromFavorites') : t('listing.addToFavorites')}
                />
              )}
            </View>
          </View>
          {listing.status === 'sold' && (
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' }}>
              <View style={{ backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8 }}>
                <Text style={{ color: '#fff', fontSize: 24, fontWeight: '700', letterSpacing: 3, textTransform: 'uppercase' }}>{t(`listing.close.${kind}.status`)}</Text>
              </View>
            </View>
          )}
          {listing.status === 'available' && isRental && (
            <View style={{ position: 'absolute', top: spacing.xl + spacing.lg, left: spacing.md }}>
              <Badge label={t('listing.forRent')} tone="solid" />
            </View>
          )}
          {listing.status !== 'available' && (
            <View style={{ position: 'absolute', top: spacing.xl + spacing.lg, left: spacing.md, flexDirection: 'row', gap: spacing.xs }}>
              <Badge
                label={listing.status === 'sold' ? t(`listing.close.${kind}.status`) : t(`listing.status.${listing.status === 'expired' ? 'expired' : 'reserved'}`)}
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
                  source={{ uri: imageUrl(uri, { size: 'thumb' }) }}
                  placeholder={imagePlaceholder(hashAt(listing.imageHashes, listing.images.length, i), uri)}
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
                  recyclingKey={imageUrl(uri, { size: 'thumb' })}
                  transition={150}
                />
              </Pressable>
            ))}
          </ScrollView>
        )}

        <View style={{ padding: spacing.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Text variant="h1" color="brand">
              {formatBirr(listing.price, listing.currency)}
            </Text>
            {listing.negotiable && !isUnavailable && <Badge label={t('listing.negotiable')} tone="accent" />}
          </View>
          <Text variant="h3" style={{ marginTop: spacing.xxs }}>
            {listing.title}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
            {conditionApplies(listing.category, listing.subcategory) && <Badge label={listing.condition} tone="neutral" />}
            <Badge label={listing.city} tone="neutral" icon="location-outline" />
            {listing.subcategory && <Badge label={subcategoryLabel(t, listing.category, listing.subcategory)} tone="neutral" />}
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
                    {t('listing.marketAverage', { average: formatBirr(marketStats.average!, listing.currency), count: marketStats.sampleSize })}
                  </Text>
                  {marketStats.savingsAmount !== undefined && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.xxs }}>
                      <Ionicons name="pricetag" size={14} color={colors.success} />
                      <Text variant="caption" color="success" style={{ marginLeft: spacing.xxs }}>
                        {t('listing.yourSaving', { amount: formatBirr(marketStats.savingsAmount, listing.currency), percent: marketStats.savingsPercent })}
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

          {!isOwner && (
          <Card style={{ marginTop: spacing.lg, padding: 0 }}>
            <Pressable
              onPress={() => router.push(`/seller/${listing.seller.id}` as any)}
              accessibilityRole="button"
              accessibilityLabel={t('safety.viewProfileOf', { name: listing.seller.name })}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', padding: spacing.md, opacity: pressed ? 0.7 : 1 })}
            >
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
                  {t('listing.sellerRatingSummary', { rating: listing.seller.rating.toFixed(1), count: listing.seller.reviewCount, responseTime: listing.seller.responseTime })}
                </Text>
                <Text variant="tiny" color="brand" style={{ marginTop: 2 }}>
                  {t('safety.viewProfile')}
                </Text>
              </View>
              {isOwner && <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
            </Pressable>
            {!isOwner && (
              <Pressable
                onPress={() => requireAuth(() => setSafetyOpen(true))}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('safety.menuLabel')}
                style={{ position: 'absolute', top: 0, right: 0, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
              </Pressable>
            )}
          </Card>
          )}
          {!isOwner && (
            <UserSafetySheet
              visible={safetyOpen}
              onClose={() => setSafetyOpen(false)}
              userId={listing.seller.id}
              userName={listing.seller.name}
              listingId={listing.id}
              source="listing"
            />
          )}

          {!isOwner && (
            <Card style={{ marginTop: spacing.md }} elevated={false}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="shield-checkmark-outline" size={16} color={colors.success} />
                <Text variant="caption" color="secondary" style={{ marginLeft: spacing.xxs, flex: 1 }}>
                  {t('listing.safetyTip')}
                </Text>
              </View>
            </Card>
          )}

          {!isOwner && (
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
          )}
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
            label={t('common.delete')}
            variant="danger"
            size="sm"
            onPress={confirmDelete}
            style={{ flex: 1 }}
            icon={<Ionicons name="trash-outline" size={16} color={colors.primaryText} />}
          />
          <Button
            label={t(`listing.close.${kind}.short`)}
            variant="outline"
            size="sm"
            onPress={confirmMarkSold}
            loading={marking}
            disabled={marking}
            style={{ flex: 1 }}
            icon={<Ionicons name="checkmark-circle-outline" size={16} color={colors.primary} />}
          />
          <Button
            label={t('common.edit')}
            size="sm"
            onPress={() => router.push(`/listing/edit/${listing.id}` as any)}
            style={{ flex: 1 }}
            icon={<Ionicons name="create-outline" size={16} color={colors.primaryText} />}
          />
        </View>
      ) : isOwner && listing.status === 'sold' ? (
        <View
          style={{
            gap: spacing.xs,
            padding: spacing.md,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.background,
          }}
        >
          <Text variant="bodyMedium" color="muted" style={{ textAlign: 'center' }}>
            {t(`listing.close.${kind}.message`)}
          </Text>
          <Button
            label={t('listing.reopen.button')}
            size="sm"
            onPress={confirmReopen}
            loading={marking}
            disabled={marking}
            icon={<Ionicons name="refresh-outline" size={16} color={colors.primaryText} />}
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
            {listing.status === 'expired' ? t('listing.expiredMessage') : t(`listing.close.${kind}.message`)}
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
          {callPhone && (
            <Button
              label={t('seller.call')}
              variant="outline"
              size="sm"
              onPress={() => openExternal(`tel:${callPhone}`)}
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
