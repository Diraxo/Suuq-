import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Pressable, Dimensions, Alert } from 'react-native';
// react-native-gesture-handler's FlatList AND ScrollView (not core RN's) for
// both the horizontal hero carousel and the outer vertical scroller — mixing
// a core-RN ScrollView with an RNGH FlatList puts them in two different
// gesture-arbitration systems, which is what caused vertical scrolling to
// randomly stop working near the carousel. Keeping both on RNGH resolves it
// (same technique the fullscreen gallery viewer's pinch/pan gestures rely on
// — app/listing/gallery/[id].tsx).
import { FlatList, ScrollView } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { StepHeader } from '@/components/StepHeader';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { useTheme } from '@/theme/ThemeContext';
import { usePostDraft } from '@/store/postDraft';
import { useMyListingsStore } from '@/store/myListings';
import { useAuthStore } from '@/store/auth';
import { profileToSeller } from '@/lib/sellerStats';
import { uploadListingImages } from '@/lib/storage';
import { cityRegion } from '@/data/categories';
import { getCategoryFields } from '@/data/categoryFields';
import { validateTitle, validateDescription, validatePhoneLocal, validatePrice, validateRequiredAttributes } from '@/data/validation';
import { formatFullPhone } from '@/data/phoneCountries';
import { supabase } from '@/lib/supabase';
import { showSnackbar } from '@/lib/snackbar';
import { getLastPath } from '@/lib/lastRoute';
import { formatBirr } from '@/lib/currency';
import { Listing } from '@/types';
import { usePostExitGuard } from '@/hooks/usePostExitGuard';
import { usePublishSession, publishOnce, setPublishProgress, getActivePostFlowId, isActivePostFlow } from '@/store/publishSession';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function Preview() {
  const { colors, spacing, radius } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const draft = usePostDraft();
  const addListing = useMyListingsStore((s) => s.addListing);
  const [activeImage, setActiveImage] = useState(0);
  // Read from the shared publish session, not local state: this screen can
  // unmount (Back) and remount (Continue again) mid-upload, and the
  // remounted instance needs to see the same in-flight submission rather
  // than defaulting back to "idle" and allowing a second Publish tap.
  const publishing = usePublishSession((s) => s.submitting);
  const uploadProgress = usePublishSession((s) => s.progress);
  const heroListRef = useRef<FlatList<string>>(null);
  const confirmLeave = usePostExitGuard('preview');

  const galleryWidth = SCREEN_WIDTH - spacing.md * 2;

  // Single source of truth for the selected photo — the hero FlatList, the
  // thumbnail highlight, and the dots all read/drive this one index so they
  // can never fall out of sync with each other.
  const selectImage = (i: number) => {
    setActiveImage(i);
    heroListRef.current?.scrollToOffset({ offset: i * galleryWidth, animated: true });
  };
  const fields = getCategoryFields(draft.category, draft.subcategory);
  const sellerNotesList = draft.sellerNotes
    .split('\n')
    .map((n) => n.trim())
    .filter(Boolean);

  // A failed upload/save surfaces via Alert.alert normally, but the publish
  // task can still be running after the seller has backed out of the Sell
  // modal entirely (see the getLastPath() check below) — popping a native
  // alert over whatever screen they've since navigated to would be the same
  // "surprise interruption" bug as the forced success-screen navigation,
  // just via a dialog instead of a route change. Fall back to the same
  // non-blocking snackbar used for that case.
  const notifyFailure = (title: string, message: string) => {
    if (getLastPath().startsWith('/post')) {
      Alert.alert(title, message);
    } else {
      showSnackbar(message);
    }
  };

  // Defense in depth: each step already gates its own Continue button, but a
  // seller can navigate back and edit an earlier step without re-triggering
  // that step's validation, so re-check everything before it becomes a listing.
  const publish = async () => {
    // A submission is already running — either from this tap or from a
    // previous mount of this screen (Back mid-upload, then Continue forward
    // again). Never start a second one; the in-flight one will finish and
    // navigate to Success on its own.
    if (usePublishSession.getState().submitting) return;

    if (draft.photos.length === 0) {
      Alert.alert(t('post.preview.needPhotoTitle'), t('post.preview.needPhotoMessage'));
      router.push('/post');
      return;
    }
    const attributeErrors = validateRequiredAttributes(fields, draft.attributes);
    const { profile: profileAtSubmit } = useAuthStore.getState();
    const needsPhone = !profileAtSubmit?.phone;
    if (
      validateTitle(draft.title) ||
      validateDescription(draft.description) ||
      !draft.condition ||
      (needsPhone && validatePhoneLocal(draft.phoneCountry, draft.phoneLocal)) ||
      Object.keys(attributeErrors).length > 0
    ) {
      Alert.alert(t('post.preview.missingDetailsTitle'), t('post.preview.missingDetailsMessage'));
      router.push('/post/details');
      return;
    }
    if (validatePrice(draft.price)) {
      Alert.alert(t('post.preview.addPriceTitle'), t('post.preview.addPriceMessage'));
      router.push('/post/price');
      return;
    }

    const { session, profile } = useAuthStore.getState();
    if (!session || !profile) {
      Alert.alert(t('post.preview.signInRequiredTitle'), t('post.preview.signInRequiredMessage'));
      return;
    }

    // Snapshot which Sell flow is active right now — the one this Preview
    // instance belongs to. If the seller leaves and reopens Sell (composing
    // a different draft, or just resuming this one) before this publish
    // finishes, app/post/index.tsx bumps the active flow and this snapshot
    // goes stale, which is exactly the signal used below to skip navigation.
    const flowId = getActivePostFlowId();

    // publishOnce sets the shared "submitting" flag synchronously and is a
    // no-op if something is already in flight, so this is safe even if two
    // taps land back-to-back before the button's `disabled` prop re-renders.
    publishOnce(async () => {
      // First listing ever posted without a saved phone: save it to the
      // profile once, here, so every future listing (and Edit Listing) reuses
      // it automatically — see app/post/details.tsx's needsPhone gate.
      let sellerProfile = profile;
      if (!profile.phone && draft.phoneLocal) {
        const { error: phoneError } = await supabase
          .from('profiles')
          .update({ phone: formatFullPhone(draft.phoneCountry, draft.phoneLocal), phone_country: draft.phoneCountry })
          .eq('id', session.user.id);
        if (!phoneError) {
          await useAuthStore.getState().refreshProfile();
          sellerProfile = useAuthStore.getState().profile ?? profile;
          showSnackbar(t('post.preview.phoneSaved'));
        }
      }
      if (__DEV__) console.log(`[publish] starting publish flow: ${draft.photos.length} photo(s)`);
      setPublishProgress({ completed: 0, total: draft.photos.length });
      const { images: uploadedImages, error: uploadError } = await uploadListingImages(session.user.id, draft.photos, setPublishProgress);
      const images = uploadedImages.map((i) => i.url);
      const imagePublicIds = uploadedImages.map((i) => i.publicId);
      if (images.length === 0) {
        notifyFailure(
          t('post.preview.uploadFailedTitle'),
          uploadError ? t('post.preview.uploadFailedWithReason', { reason: uploadError }) : t('post.preview.uploadFailedMessage')
        );
        return;
      }
      // Warm the disk/memory cache with the hosted URLs before navigating away, so
      // My Listings / the listing detail screen paint from cache instead of showing
      // blank placeholders while they re-download what was just uploaded.
      await Image.prefetch(images, { cachePolicy: 'memory-disk' }).catch(() => {});

      const me = profileToSeller(sellerProfile, { listingsCount: 0, soldCount: 0, followers: 0, rating: 0, reviewCount: 0 });
      const listing: Listing = {
        id: `draft-${Date.now()}`,
        title: draft.title || 'Untitled listing',
        price: Number(draft.price) || 0,
        currency: draft.currency,
        negotiable: draft.negotiable === 'yes',
        condition: draft.condition ?? 'used',
        category: draft.category ?? '',
        subcategory: draft.subcategory,
        city: draft.city ?? '',
        region: draft.city ? cityRegion[draft.city] ?? '' : '',
        images,
        imagePublicIds,
        description: draft.description,
        postedAt: 'just now',
        createdAt: Date.now(),
        status: 'available',
        seller: me,
        views: 0,
        favoritesCount: 0,
        attributes: draft.attributes,
        features: draft.features.length ? draft.features : undefined,
        sellerNotes: sellerNotesList.length ? sellerNotesList : undefined,
      };
      const created = await addListing(listing);
      if (!created) {
        notifyFailure(t('post.preview.publishFailedTitle'), t('post.preview.publishFailedMessage'));
        return;
      }
      // This upload/insert keeps running even if the seller backs out of the
      // Sell flow mid-publish (see publishOnce in store/publishSession.ts), so
      // by the time it finishes here they may already be off browsing the rest
      // of the app. Forcing them onto /post/success at that point would yank
      // them out of wherever they navigated to — only take over navigation if
      // they're still somewhere inside the Sell modal. getLastPath() is the
      // same app-wide "current route" tracker app/_layout.tsx already
      // maintains for the OAuth-redirect guard, so this reuses existing
      // infrastructure instead of adding new navigation-tracking state.
      //
      // Being under /post isn't enough on its own, though: the seller may
      // have left this draft and reopened Sell to compose a different one
      // (or just resume this one fresh) while this publish was still
      // uploading — see startPostFlow() in app/post/index.tsx. In that case
      // they're on /post, but not on the flow that started this publish, so
      // navigating to Success would hijack whatever they're doing now.
      if (!getLastPath().startsWith('/post') || !isActivePostFlow(flowId)) {
        showSnackbar(t('post.preview.publishedWhileAway'), { tone: 'success' });
        return;
      }
      // Collapse the whole posting flow's history before landing on success, so
      // Back from there exits the modal instead of stepping back through the six steps.
      router.dismissAll();
      router.replace({ pathname: '/post/success', params: { listingId: created.id } });
    });
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <StepHeader step={6} totalSteps={6} title={t('post.preview.title')} onClose={confirmLeave} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        directionalLockEnabled
        scrollEventThrottle={16}
      >
        {draft.photos.length > 0 && (
          <View>
            <FlatList
              ref={heroListRef}
              data={draft.photos}
              keyExtractor={(uri, i) => uri + i}
              horizontal
              pagingEnabled
              disableIntervalMomentum
              scrollEnabled={draft.photos.length > 1}
              showsHorizontalScrollIndicator={false}
              getItemLayout={(_, i) => ({ length: galleryWidth, offset: galleryWidth * i, index: i })}
              onMomentumScrollEnd={(e) => setActiveImage(Math.round(e.nativeEvent.contentOffset.x / galleryWidth))}
              renderItem={({ item, index }) => (
                <Image
                  source={{ uri: item }}
                  accessibilityLabel={t('post.preview.previewPhotoAlt', { number: index + 1, total: draft.photos.length })}
                  style={{ width: galleryWidth, height: galleryWidth, borderRadius: radius.md, backgroundColor: colors.skeleton }}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  recyclingKey={item}
                  transition={200}
                />
              )}
            />
            {draft.photos.length > 1 && (
              <>
                <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 4, marginTop: spacing.xs }}>
                  {draft.photos.map((_, i) => (
                    <View
                      key={i}
                      style={{
                        width: i === activeImage ? 16 : 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: i === activeImage ? colors.primary : colors.border,
                      }}
                    />
                  ))}
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, marginTop: spacing.sm }}>
                  {draft.photos.map((uri, i) => (
                    <Pressable
                      key={uri + i}
                      onPress={() => selectImage(i)}
                      accessibilityRole="button"
                      accessibilityLabel={t('post.preview.jumpToPhoto', { number: i + 1 })}
                    >
                      <Image
                        source={{ uri }}
                        accessibilityLabel={t('post.preview.thumbnailAlt', { number: i + 1, total: draft.photos.length })}
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
              </>
            )}
          </View>
        )}
        <Text variant="h2" style={{ marginTop: spacing.md }}>
          {formatBirr(Number(draft.price) || 0)}
        </Text>
        <Text variant="h3" style={{ marginTop: spacing.xxs }}>
          {draft.title || t('post.preview.untitledListing')}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
          {draft.condition && (
            <Badge
              label={t(`post.details.condition.${draft.condition === 'like-new' ? 'likeNew' : draft.condition === 'for-parts' ? 'needsRepair' : draft.condition}`)}
              tone="neutral"
            />
          )}
          {draft.city && <Badge label={draft.city} tone="neutral" icon="location-outline" />}
          {draft.negotiable === 'yes' && <Badge label={t('post.preview.negotiable')} tone="accent" />}
          {draft.negotiable === 'unsure' && <Badge label={t('post.preview.negotiableNotSure')} tone="neutral" />}
        </View>
        <Text variant="body" color="secondary" style={{ marginTop: spacing.md }}>
          {draft.description || t('post.preview.noDescription')}
        </Text>

        {fields.length > 0 && (
          <View style={{ marginTop: spacing.md, gap: spacing.xxs }}>
            {fields
              .filter((f) => !!draft.attributes[f.key])
              .map((f) => (
                <View key={f.key} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text variant="caption" color="secondary">
                    {f.label}
                  </Text>
                  <Text variant="caption">{draft.attributes[f.key]}</Text>
                </View>
              ))}
          </View>
        )}

        {draft.features.length > 0 && (
          <View style={{ marginTop: spacing.md }}>
            <Text variant="bodyMedium" style={{ marginBottom: spacing.xs }}>
              {t('post.preview.featuresTitle')}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {draft.features.map((f) => (
                <Badge key={f} label={f} tone="neutral" />
              ))}
            </View>
          </View>
        )}

        {sellerNotesList.length > 0 && (
          <View style={{ marginTop: spacing.md }}>
            <Text variant="bodyMedium" style={{ marginBottom: spacing.xs }}>
              {t('post.preview.sellerNotesTitle')}
            </Text>
            <View style={{ gap: spacing.xxs }}>
              {sellerNotesList.map((note, i) => (
                <Text key={i} variant="caption" color="secondary">
                  • {note}
                </Text>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {uploadProgress && (
        <Text variant="caption" color="secondary" align="center" style={{ marginBottom: spacing.xxs }}>
          {t('post.preview.uploadingPhotos', { completed: uploadProgress.completed, total: uploadProgress.total })}
        </Text>
      )}
      <Button
        label={t('post.preview.publishListing')}
        onPress={publish}
        loading={publishing}
        disabled={publishing}
        fullWidth
        size="lg"
        style={{ marginTop: spacing.sm }}
      />
    </Screen>
  );
}
