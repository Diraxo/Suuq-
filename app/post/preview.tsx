import { useRef, useState } from 'react';
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
import { formatBirr } from '@/lib/currency';
import { Listing } from '@/types';
import { usePostExitGuard } from '@/hooks/usePostExitGuard';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function Preview() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const draft = usePostDraft();
  const addListing = useMyListingsStore((s) => s.addListing);
  const [activeImage, setActiveImage] = useState(0);
  const [publishing, setPublishing] = useState(false);
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

  // Defense in depth: each step already gates its own Continue button, but a
  // seller can navigate back and edit an earlier step without re-triggering
  // that step's validation, so re-check everything before it becomes a listing.
  const publish = async () => {
    if (draft.photos.length === 0) {
      Alert.alert('Add at least one photo', 'Your listing needs at least one photo before it can be published.');
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
      Alert.alert('Some details are missing', 'Go back and finish the required fields before publishing.');
      router.push('/post/details');
      return;
    }
    if (validatePrice(draft.price)) {
      Alert.alert('Add a price', 'Enter a price greater than 0 before publishing.');
      router.push('/post/price');
      return;
    }

    const { session, profile } = useAuthStore.getState();
    if (!session || !profile) {
      Alert.alert('Sign-in required', 'Please sign in again before publishing.');
      return;
    }

    setPublishing(true);

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
        showSnackbar('Phone number saved to your profile.');
      }
    }
    console.log(`[publish] starting publish flow: ${draft.photos.length} photo(s)`);
    const { images: uploadedImages, error: uploadError } = await uploadListingImages(session.user.id, draft.photos);
    const images = uploadedImages.map((i) => i.url);
    const imagePublicIds = uploadedImages.map((i) => i.publicId);
    if (images.length === 0) {
      setPublishing(false);
      Alert.alert(
        'Upload failed',
        uploadError
          ? `Your photos could not be uploaded: ${uploadError}`
          : 'Your photos could not be uploaded. Check your connection and try again.'
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
    setPublishing(false);
    if (!created) {
      const lastError = useMyListingsStore.getState().lastError;
      Alert.alert(
        'Could not publish',
        lastError
          ? `Something went wrong saving your listing: ${lastError}`
          : 'Something went wrong saving your listing. Please try again.'
      );
      return;
    }
    // Collapse the whole posting flow's history before landing on success, so
    // Back from there exits the modal instead of stepping back through the six steps.
    router.dismissAll();
    router.replace({ pathname: '/post/success', params: { listingId: created.id } });
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <StepHeader step={6} totalSteps={6} title="Review your listing" onClose={confirmLeave} />

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
                  accessibilityLabel={`Listing preview photo ${index + 1} of ${draft.photos.length}`}
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
                      accessibilityLabel={`Jump to photo ${i + 1}`}
                    >
                      <Image
                        source={{ uri }}
                        accessibilityLabel={`Thumbnail ${i + 1} of ${draft.photos.length}`}
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
          {draft.title || 'Untitled listing'}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
          {draft.condition && <Badge label={draft.condition} tone="neutral" />}
          {draft.city && <Badge label={draft.city} tone="neutral" icon="location-outline" />}
          {draft.negotiable === 'yes' && <Badge label="Negotiable" tone="accent" />}
          {draft.negotiable === 'unsure' && <Badge label="Negotiable: not sure" tone="neutral" />}
        </View>
        <Text variant="body" color="secondary" style={{ marginTop: spacing.md }}>
          {draft.description || 'No description added.'}
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
              Features
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
              Seller Notes
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

      <Button
        label="Publish listing"
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
