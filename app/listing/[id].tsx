import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openExternal } from '@/lib/openLink';
import { View, Pressable, Dimensions, Share, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
// react-native-gesture-handler's FlatList AND ScrollView (not core RN's) —
// mixing a core-RN ScrollView with a horizontal pagingEnabled FlatList puts
// them in two different gesture-arbitration systems, which is what caused
// vertical scrolling to randomly stop working near the hero carousel.
// Keeping both on RNGH resolves it (same fix applied to app/post/preview.tsx
// and the technique the fullscreen gallery viewer already relies on).
import { FlatList, ScrollView } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import { WatermarkOverlay } from '@/components/WatermarkOverlay';
import { isWatermarkedDerivative } from '@/lib/imageSafety';
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
import { cancelDetailPrefetch, prefetchGalleryPhotos, prefetchHeroPhotos, prefetchStripImages } from '@/lib/imagePrefetch';
import { useImageFallback } from '@/hooks/useImageFallback';
import { stripScrollOffset } from '@/lib/stripScroll';
import { imageDiag, imageDiagTap, imageTimingDone, imageTimingStart } from '@/lib/imageTiming';
import { rememberImageSize } from '@/lib/viewerImage';
import { useMyListingsStore } from '@/store/myListings';
import { useListing } from '@/hooks/useListings';
import { useResource } from '@/hooks/useResource';
import { fetchComparableListings } from '@/lib/listingsApi';
import { useFavoritesStore } from '@/store/favorites';
import { useRecentlyViewedStore } from '@/store/recentlyViewed';
import { useAuthStore } from '@/store/auth';
import { requireAuth } from '@/store/authPrompt';
import { categoryLabel, subcategoryLabel } from '@/data/categoryNames';
import { closeKind, conditionApplies, isRentalListing } from '@/data/sellRules';
import { priceUnitText, listingPriceText } from '@/lib/sellText';
import { isContactPriceListing } from '@/data/serviceConfig';
import { serviceDetail } from '@/data/serviceDetail';
import { listingDetail } from '@/data/listingDetail';
import { ListingDetails } from '@/components/ListingDetails';
import { ServiceDetails, ServiceIdentity } from '@/components/ServiceDetails';
import { getMarketPriceStats } from '@/data/similarListings';
import { listingPostedLabel } from '@/data/time';
import { isRealListingId } from '@/data/validation';
import { useContactPhone } from '@/lib/contactPhone';
import { isBlockedEitherWaySync } from '@/lib/blocking';
import { UserSafetySheet } from '@/components/UserSafetySheet';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatBirr } from '@/lib/currency';
import { activeDiscount, discountEndsText, formatDiscountInstant } from '@/lib/discount';
import { DiscountModal } from '@/components/DiscountModal';
import { useSellerDiscount } from '@/hooks/useSellerDiscount';
import { showSnackbar } from '@/lib/snackbar';

// A render error in this route shows a friendly retry screen instead of closing the app.
export { ErrorFallback as ErrorBoundary } from '@/components/ErrorFallback';

const { width } = Dimensions.get('window');

// One photo of the hero carousel. Memoised so a swipe (which changes `activeImage` on the screen above) does not re-render the
// photos themselves: only the dots and the thumbnail highlight depend on the active index.
const HeroSlide = memo(function HeroSlide({ uri, index, count, title, hash, bg, onOpen, onLoaded }: { uri: string; index: number; count: number; title: string; hash: string | undefined; bg: string; onOpen: (index: number) => void; onLoaded: () => void }) {
  const { t } = useTranslation();
  const hero = useImageFallback(imageUrl(uri, { size: 'card' }));
  const cardUri = hero.uri;
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The mark is sized by the slide's box, not by the photo, but it is revealed only once the photo has loaded, and the photo
  // swaps in without a fade, so picture and mark arrive in the same frame and read as one image (never a mark over a blank box).
  // Photos that already carry the mark in their pixels (the scan Worker's output) are not marked twice.
  const [loaded, setLoaded] = useState(false);
  const needsMark = !isWatermarkedDerivative(uri);
  const placeholder = useMemo(() => imagePlaceholder(hash, uri), [hash, uri]);
  return (
    <Pressable onPress={() => onOpen(index)} accessibilityRole="button" accessibilityLabel={t('listing.viewGallery')}>
      <Image
        key={attempt}
        source={{ uri: cardUri }}
        placeholder={placeholder}
        accessibilityLabel={t('listing.photoAlt', { number: index + 1, total: count, title })}
        style={{ width, height: width, backgroundColor: bg }}
        contentFit="cover"
        cachePolicy="memory-disk"
        recyclingKey={cardUri}
        transition={0}
        onLoadStart={index === 0 ? () => imageTimingStart('listing detail first photo') : undefined}
        onLoad={(e) => {
          setLoaded(true);
          if (index === 0) imageTimingDone('listing detail first photo');
          // The viewer's watermark needs the photo's size; this load already knows it, so the viewer need not wait for its own.
          rememberImageSize(uri, e?.source?.width, e?.source?.height);
          hero.onLoad();
          setFailed(false);
          onLoaded();
        }}
        onError={() => {
          // A failed resized variant is retried once as the original; only then does the slide show its failed state (with Retry).
          if (hero.onError()) return;
          setLoaded(false);
          setFailed(true);
          // The thumbnail strip must not wait for a hero that is not coming.
          onLoaded();
        }}
      />
      {needsMark && loaded && !failed && <WatermarkOverlay width={width} height={width} naturalWidth={width} naturalHeight={width} />}
      {failed && (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: width, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Ionicons name="image-outline" size={36} color="rgba(255,255,255,0.8)" />
          <Pressable
            onPress={() => { setFailed(false); setAttempt((n) => n + 1); }}
            accessibilityRole="button"
            accessibilityLabel={t('common.retry')}
            hitSlop={8}
            style={{ minHeight: 44, minWidth: 120, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 20 }}
          >
            <Text variant="caption" style={{ color: '#fff' }}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      )}
    </Pressable>
  );
});

// One thumbnail of the strip. Memoised: a swipe changes `selected` for two thumbnails only, the others are not re-rendered.
const THUMB_SIZE = 56;
const THUMB_GAP = 8;
const StripThumb = memo(function StripThumb({ uri, index, count, hash, selected, primary, radiusSm, enabled, onSelect }: { uri: string; index: number; count: number; hash: string | undefined; selected: boolean; primary: string; radiusSm: number; enabled: boolean; onSelect: (index: number) => void }) {
  const { t } = useTranslation();
  const thumb = useImageFallback(imageUrl(uri, { size: 'strip' }));
  const stripUri = thumb.uri;
  const placeholder = useMemo(() => imagePlaceholder(hash, uri), [hash, uri]);
  return (
    <Pressable onPress={() => onSelect(index)} accessibilityRole="button" accessibilityLabel={t('listing.jumpToPhoto', { number: index + 1 })}>
      <Image
        // Until the hero photo has painted, a thumbnail shows only its placeholder: its download must not compete with the hero's.
        source={enabled ? { uri: stripUri } : undefined}
        placeholder={placeholder}
        onLoad={thumb.onLoad}
        onError={() => { thumb.onError(); }}
        accessibilityLabel={t('listing.thumbnailAlt', { number: index + 1, total: count })}
        style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: radiusSm, borderWidth: 2, borderColor: selected ? primary : 'transparent', backgroundColor: 'rgba(128,128,128,0.15)' }}
        contentFit="cover"
        cachePolicy="memory-disk"
        recyclingKey={stripUri}
        transition={150}
      />
    </Pressable>
  );
});

export default function ListingDetail() {
  const { t, i18n } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = idParam(rawId);
  const removeListing = useMyListingsStore((s) => s.removeListing);
  const markSold = useMyListingsStore((s) => s.markSold);
  const updateListing = useMyListingsStore((s) => s.updateListing);
  const sellerDiscount = useSellerDiscount();
  // Fetched by id (a cached copy shows instantly and is re-checked once): the screen never depends on the whole catalogue.
  const { listing: foundListing, status: lookupStatus, retry } = useListing(id);
  // Real listings similar to this one, for the market-price estimate. A failure only hides the estimate.
  const comparableKey = foundListing ? `${foundListing.id}|${foundListing.category}|${foundListing.subcategory ?? ''}` : null;
  const comparables = useResource(comparableKey, () => fetchComparableListings({ category: foundListing!.category, subcategory: foundListing!.subcategory, excludeId: foundListing!.id }));
  const [activeImage, setActiveImage] = useState(0);
  const [marking, setMarking] = useState(false);
  const [confirming, setConfirming] = useState<'delete' | 'sold' | 'reopen' | null>(null);
  const heroListRef = useRef<FlatList<string>>(null);

  // Single source of truth for the selected photo — the hero FlatList, the
  // thumbnail highlight, and the dots all read/drive this one index.
  const selectImage = useCallback((i: number) => {
    setActiveImage(i);
    heroListRef.current?.scrollToOffset({ offset: i * width, animated: true });
  }, []);
  const openGallery = useCallback(
    (index: number) => {
      if (!foundListing) return;
      for (const label of ['mount', 'preview', 'full photo loaded', 'full photo displayed', 'watermark']) imageTimingStart(`viewer: tap to ${label}`);
      imageDiagTap();
      imageDiag('tap received', { index });
      prefetchGalleryPhotos(foundListing.images, index, { opened: true });
      router.push(`/listing/gallery/${foundListing.id}?index=${index}` as any);
    },
    [foundListing, router]
  );
  // The photo on screen and the next two are always downloaded (or on their way) before the buyer swipes to them.
  const heroImages = foundListing?.images;
  useEffect(() => {
    if (heroImages?.length) prefetchHeroPhotos(heroImages, activeImage);
  }, [heroImages, activeImage]);
  // Leaving the screen withdraws this listing's queued (not yet started) background downloads.
  useEffect(() => cancelDetailPrefetch, []);
  // Once the photo on screen has painted (so the full-size downloads never compete with it), prepare this listing's gallery at the
  // exact size the viewer requests: the open photo first, then its neighbours, then the rest.
  const [heroLoaded, setHeroLoaded] = useState(false);
  const onHeroLoaded = useCallback(() => setHeroLoaded(true), []);
  useEffect(() => {
    if (heroLoaded && heroImages?.length) prefetchGalleryPhotos(heroImages, activeImage);
  }, [heroLoaded, heroImages, activeImage]);
  // The thumbnail strip's small copies, queued behind the hero photos (low priority, bounded queue), once per listing.
  useEffect(() => {
    if (heroLoaded && heroImages && heroImages.length > 1) prefetchStripImages(heroImages);
  }, [heroLoaded, heroImages]);
  // The thumbnails start downloading once the hero has painted, or after a short wait if it has not (they must never stay empty).
  const [stripWaited, setStripWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setStripWaited(true), 1500);
    return () => clearTimeout(timer);
  }, []);
  const stripReady = heroLoaded || stripWaited;
  const stripRef = useRef<FlatList<string>>(null);
  const stripViewport = useRef(width);
  // Keep the selected thumbnail centred when the hero changes (swipe or tap). The offset is computed from the fixed cell size
  // (lib/stripScroll.ts) and applied with scrollToOffset: there is no index-not-measured failure to handle. No image is requested by this.
  useEffect(() => {
    if (!heroImages || heroImages.length < 2) return;
    const offset = stripScrollOffset({ index: activeImage, count: heroImages.length, viewport: stripViewport.current, cell: THUMB_SIZE, gap: THUMB_GAP, pad: spacing.sm });
    stripRef.current?.scrollToOffset({ offset, animated: true });
  }, [activeImage, heroImages, spacing.sm]);
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
  const discount = isUnavailable ? null : activeDiscount(listing);
  // The stored status is 'sold' for every closed listing; the words depend on what it was: sold, rented, filled or closed.
  const kind = closeKind(listing);
  const isRental = isRentalListing(listing.category, listing.subcategory, listing.attributes);

  // A service can be listed as "Contact for price" (stored as 0 with its mode) or charged per hour / job / ...
  const contactPrice = isContactPriceListing(listing);
  const priceUnit = contactPrice ? undefined : priceUnitText(t, listing.category, listing.attributes);
  // Services get their own grouped sections instead of one long list of raw fields.
  const service = serviceDetail(t, listing.category, listing.subcategory, listing.attributes);
  // Real listings only — the mock catalogue is permanent demo inventory, not
  // something a real buyer could price this listing against (see compare.tsx).
  const marketStats = comparables.data ? getMarketPriceStats(listing, comparables.data) : null;

  const shareListing = () => {
    Share.share({ message: t('listing.shareMessage', { title: listing.title, price: listingPriceText(t, listing, formatBirr), brand: 'SUUQIYE' }) }).catch(() => {});
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
      <DiscountModal
        visible={!!sellerDiscount.target}
        listing={sellerDiscount.target}
        loading={sellerDiscount.loading}
        error={sellerDiscount.error}
        onCancel={sellerDiscount.close}
        onStart={sellerDiscount.start}
        onEnd={sellerDiscount.end}
      />
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
            // Card-size photos are cheap: keep two on each side mounted so a swipe never waits for a photo to mount.
            initialNumToRender={3}
            windowSize={5}
            maxToRenderPerBatch={3}
            onMomentumScrollEnd={(e) => setActiveImage(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item, index }) => (
              <HeroSlide uri={item} index={index} count={listing.images.length} title={listing.title} hash={hashAt(listing.imageHashes, listing.images.length, index)} bg={colors.skeleton} onOpen={openGallery} onLoaded={onHeroLoaded} />
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
          {discount && (
            <View style={{ position: 'absolute', left: spacing.md, bottom: spacing.md }} pointerEvents="none">
              <Badge label={t('components.listingCard.discountOff', { percent: discount.percent })} tone="sale" />
            </View>
          )}
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
          <FlatList
            ref={stripRef}
            data={listing.images}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(uri, i) => uri + i}
            contentContainerStyle={{ gap: THUMB_GAP, padding: spacing.sm }}
            // Fixed-size cells: scrollToIndex is exact, and a listing has at most 8 photos so all of them render up front (no blank slots).
            getItemLayout={(_, i) => ({ length: THUMB_SIZE + THUMB_GAP, offset: spacing.sm + (THUMB_SIZE + THUMB_GAP) * i, index: i })}
            initialNumToRender={listing.images.length}
            windowSize={3}
            onLayout={(e) => { stripViewport.current = e.nativeEvent.layout.width; }}
            extraData={stripReady}
            renderItem={({ item: uri, index: i }) => (
              <StripThumb uri={uri} index={i} count={listing.images.length} hash={hashAt(listing.imageHashes, listing.images.length, i)} selected={i === activeImage} primary={colors.primary} radiusSm={radius.sm} enabled={stripReady} onSelect={selectImage} />
            )}
          />
        )}

        <View style={{ padding: spacing.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1, marginRight: spacing.sm }}>
              <Text variant="h1" color="brand">
                {listingPriceText(t, listing, formatBirr)}
              </Text>
              {priceUnit ? (
                <Text variant="caption" color="secondary">
                  {priceUnit}
                </Text>
              ) : null}
              {discount && (
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: spacing.xs, marginTop: 2 }}>
                  <Text variant="body" color="muted" style={{ textDecorationLine: 'line-through' }}>
                    {formatBirr(discount.originalPrice, listing.currency)}
                  </Text>
                  <Badge label={t('components.listingCard.discountOff', { percent: discount.percent })} tone="sale" />
                  <Text variant="caption" color="success">
                    {t('listing.discountSave', { amount: formatBirr(discount.originalPrice - listing.price, listing.currency) })}
                  </Text>
                </View>
              )}
              {discount && (() => {
                const endsText = discountEndsText(discount, t);
                return (
                  <>
                    {endsText && (
                      <Text variant="caption" color="secondary" style={{ marginTop: 2 }}>
                        {endsText}
                      </Text>
                    )}
                    {discount.note ? (
                      <Text variant="caption" color="secondary" style={{ marginTop: 2 }}>
                        {discount.note}
                      </Text>
                    ) : null}
                  </>
                );
              })()}
            </View>
            {listing.negotiable && !isUnavailable && <Badge label={t('listing.negotiable')} tone="accent" />}
          </View>
          {service && <ServiceIdentity subcategory={listing.subcategory} providerKindLabel={service.providerKindLabel} />}
          <Text variant="h3" style={{ marginTop: spacing.xxs }}>
            {listing.title}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
            {conditionApplies(listing.category, listing.subcategory) && <Badge label={listing.condition} tone="neutral" />}
            <Badge label={listing.city} tone="neutral" icon="location-outline" />
            {listing.subcategory && !service && <Badge label={subcategoryLabel(t, listing.category, listing.subcategory)} tone="neutral" />}
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

          {service ? <ServiceDetails detail={service} extra={[]} /> : <ListingDetails detail={listingDetail(t, listing.category, listing.subcategory, listing.attributes)} />}

          {!!listing.features?.length && (
            <Card style={{ marginTop: spacing.md }} elevated={false}>
              <Text variant="bodyMedium" style={{ marginBottom: spacing.xs }}>
                {service ? t('listing.service.included', { defaultValue: 'What is included' }) : t('listing.features')}
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
                    • {note}
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
            gap: spacing.xs,
            padding: spacing.md,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.background,
          }}
        >
          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
            <Button
              label={t('common.edit')}
              size="sm"
              onPress={() => router.push(`/listing/edit/${listing.id}` as any)}
              style={{ flex: 1 }}
              icon={<Ionicons name="create-outline" size={16} color={colors.primaryText} />}
            />
            {listing.status === 'available' && !contactPrice ? (
              <Button
                label={discount ? t('discount.manage') : t('discount.action')}
                variant="outline"
                size="sm"
                onPress={() => sellerDiscount.open(listing)}
                style={{ flex: 1 }}
                icon={<Ionicons name={discount ? 'pricetag' : 'pricetag-outline'} size={16} color={colors.primary} />}
              />
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
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
              label={t('common.delete')}
              variant="danger"
              size="sm"
              onPress={confirmDelete}
              style={{ flex: 1 }}
              icon={<Ionicons name="trash-outline" size={16} color={colors.primaryText} />}
            />
          </View>
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
          {!contactPrice && (
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
          )}
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
