import { useState } from 'react';
import { View, ScrollView, FlatList, Pressable, Alert, KeyboardAvoidingView, Platform, Modal } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { launchImageLibraryAsync } from '@/lib/imagePickerSafe';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { CategoryIcon } from '@/components/CategoryIcon';
import { CityPicker } from '@/components/CityPicker';
import { DynamicField } from '@/components/DynamicField';
import { useTheme } from '@/theme/ThemeContext';
import { mockListings } from '@/data/mockListings';
import { categories, currencies, cityRegion } from '@/data/categories';
import { getCategoryFields } from '@/data/categoryFields';
import { getCategoryFeatures } from '@/data/categoryFeatures';
import { validateTitle, validateDescription, validatePrice, validateRequiredAttributes } from '@/data/validation';
import { useMyListingsStore } from '@/store/myListings';
import { useListingsStore, resolveListing } from '@/store/listings';
import { useAuthStore } from '@/store/auth';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { uploadListingImagesStrict } from '@/lib/storage';
import { deleteR2Assets, imageUrl } from '@/lib/r2';
import { validateImageAsset } from '@/lib/imageValidation';
import { showSnackbar } from '@/lib/snackbar';
import { Listing } from '@/types';

const STATUSES = ['available', 'reserved', 'sold', 'expired'] as const;
const CONDITIONS = ['new', 'like-new', 'used', 'for-parts'] as const;
const CONDITION_KEY: Record<(typeof CONDITIONS)[number], string> = { new: 'new', 'like-new': 'likeNew', used: 'used', 'for-parts': 'needsRepair' };
const MAX_PHOTOS = 8;
const PHOTO_GRID_COLUMNS = 3;

const isLocalUri = (uri: string) => !/^https?:\/\//i.test(uri);

// Plain flexWrap grid (no drag library) — react-native-draggable-flatlist's
// reorder math is strictly 1-dimensional (see app/post/index.tsx's own
// DraggablePhotoCell comment), so applying it to a 3-column numColumns grid
// here made cells overlap/hide each other during and after a reorder.
// Reordering is instead handled by the explicit move-earlier/move-later
// buttons below, which don't depend on any grid-aware drag math.
function photoCellStyle(index: number, gap: number): { width: `${number}%`; aspectRatio: number; marginBottom: number; marginRight: number } {
  return {
    width: '31%',
    aspectRatio: 1,
    marginBottom: gap,
    marginRight: (index + 1) % PHOTO_GRID_COLUMNS === 0 ? 0 : gap,
  };
}

export default function EditListing() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const authed = useRequireAuthScreen();
  const { id } = useLocalSearchParams<{ id: string }>();
  const allListings = useListingsStore((s) => s.listings);
  const updateListing = useMyListingsStore((s) => s.updateListing);
  const removeListing = useMyListingsStore((s) => s.removeListing);
  const dropPrice = useMyListingsStore((s) => s.dropPrice);
  const original = resolveListing(id, allListings) ?? mockListings[0];

  const [images, setImages] = useState<string[]>(original.images);
  const [title, setTitle] = useState(original.title);
  const [price, setPrice] = useState(String(original.price));
  const [currency, setCurrency] = useState(original.currency);
  const [description, setDescription] = useState(original.description);
  const [status, setStatus] = useState(original.status);
  const [condition, setCondition] = useState(original.condition);
  const [category, setCategory] = useState(original.category);
  const [subcategory, setSubcategory] = useState(original.subcategory);
  const [negotiable, setNegotiable] = useState(original.negotiable);
  const [city, setCity] = useState(original.city);
  const [attributes, setAttributes] = useState<Record<string, string>>(original.attributes ?? {});
  const [features, setFeatures] = useState<string[]>(original.features ?? []);
  const [sellerNotes, setSellerNotes] = useState((original.sellerNotes ?? []).join('\n'));
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ completed: number; total: number } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryModalParent, setCategoryModalParent] = useState<string | null>(null);

  const activeCategory = categories.find((c) => c.id === category);
  const extraFields = getCategoryFields(category, subcategory);
  const featureOptions = getCategoryFeatures(category, subcategory);
  const priceError = submitted ? validatePrice(price) : undefined;
  const titleError = submitted ? validateTitle(title) : undefined;
  const descriptionError = submitted ? validateDescription(description) : undefined;
  const attributeErrors = validateRequiredAttributes(extraFields, attributes);

  const setAttribute = (key: string, value: string) => setAttributes((prev) => ({ ...prev, [key]: value }));
  const toggleFeature = (f: string) => setFeatures((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));

  const pickPhoto = async (replaceIndex?: number) => {
    if (replaceIndex === undefined && images.length >= MAX_PHOTOS) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('post.index.galleryPermissionTitle'), t('post.index.galleryPermissionMessage'));
      return;
    }
    if (replaceIndex !== undefined) {
      const result = await launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (result.canceled || result.assets.length === 0) return;
      const validation = validateImageAsset(result.assets[0]);
      if (!validation.ok) {
        showSnackbar(validation.message);
        return;
      }
      setImages((prev) => prev.map((uri, i) => (i === replaceIndex ? result.assets[0].uri : uri)));
      return;
    }
    const remaining = MAX_PHOTOS - images.length;
    const result = await launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;
    const validAssets: typeof result.assets = [];
    let invalidMessage: string | undefined;
    for (const asset of result.assets) {
      const validation = validateImageAsset(asset);
      if (validation.ok) validAssets.push(asset);
      else invalidMessage = validation.message;
    }
    if (invalidMessage) showSnackbar(invalidMessage);
    if (validAssets.length > 0) setImages((prev) => [...prev, ...validAssets.map((a) => a.uri)].slice(0, MAX_PHOTOS));
  };

  const removePhoto = (i: number) => setImages((prev) => prev.filter((_, idx) => idx !== i));

  const reorderPhotos = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= images.length || to >= images.length) return;
    setImages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const movePhoto = (i: number, direction: -1 | 1) => reorderPhotos(i, i + direction);

  const selectCategory = (catId: string) => {
    const chosen = categories.find((c) => c.id === catId);
    if (chosen?.subcategories?.length) {
      setCategoryModalParent(catId);
      return;
    }
    setCategory(catId);
    setSubcategory(undefined);
    setCategoryModalOpen(false);
    setCategoryModalParent(null);
  };

  const selectSubcategory = (catId: string, sub: string) => {
    setCategory(catId);
    setSubcategory(sub);
    setCategoryModalOpen(false);
    setCategoryModalParent(null);
  };

  const save = async () => {
    setSubmitted(true);
    if (
      validateTitle(title) ||
      validateDescription(description) ||
      validatePrice(price) ||
      !city ||
      images.length === 0 ||
      Object.keys(attributeErrors).length > 0
    ) {
      Alert.alert(t('post.preview.missingDetailsTitle'), t('listing.edit.missingFieldsMessage'));
      return;
    }

    const session = useAuthStore.getState().session;
    if (!session) {
      Alert.alert(t('post.preview.signInRequiredTitle'), t('post.preview.signInRequiredMessage'));
      return;
    }

    setSaving(true);
    try {
      // Upload every new/replaced photo first — if any single one fails, bail
      // out before touching the listing row so the edit never lands half-done.
      const localUris = images.filter(isLocalUri);
      const uploadedByLocalUri = new Map<string, { url: string; publicId: string }>();
      if (localUris.length > 0) {
        setUploadProgress({ completed: 0, total: localUris.length });
        const uploaded = await uploadListingImagesStrict(session.user.id, localUris, setUploadProgress);
        localUris.forEach((uri, i) => uploadedByLocalUri.set(uri, uploaded[i]));
      }
      // Keyed by URL (not position), so reordering/inserting/removing photos
      // in the `images` array can't misalign a kept photo's known public_id.
      // Pre-migration rows may have no stored id here (an old Cloudinary
      // photo) — left as '' rather than derived, since there's no Cloudinary
      // credential left to resolve/delete it with.
      const originalPublicIdByUrl = new Map<string, string>(
        original.images.map((url, i) => [url, original.imagePublicIds?.[i] || ''] as const).filter(([, id]) => !!id)
      );
      const finalImages = images.map((uri) => uploadedByLocalUri.get(uri)?.url ?? uri);
      const finalPublicIds = images.map((uri) => uploadedByLocalUri.get(uri)?.publicId ?? originalPublicIdByUrl.get(uri) ?? '');

      const priceNum = Number(price);
      const sellerNotesList = sellerNotes
        .split('\n')
        .map((n) => n.trim())
        .filter(Boolean);
      const patch: Partial<Listing> = {
        title: title.trim(),
        description,
        category,
        subcategory,
        condition,
        currency,
        negotiable,
        city,
        region: cityRegion[city] ?? '',
        status,
        images: finalImages,
        imagePublicIds: finalPublicIds,
        attributes,
        features,
        sellerNotes: sellerNotesList,
      };

      // Route price decreases through dropPrice (as before) so they show up on
      // the Price Drops screen — it already writes the new price itself, so
      // price is left out of the field patch to avoid a redundant write.
      if (priceNum < original.price) {
        if (!(await dropPrice(original.id, priceNum))) throw new Error('dropPrice failed');
        if (!(await updateListing(original.id, patch))) throw new Error('updateListing failed');
      } else {
        if (!(await updateListing(original.id, { ...patch, price: priceNum }))) throw new Error('updateListing failed');
      }

      // Only clean up R2 once the row itself is safely updated, so a failed
      // save never orphans images the listing still points at.
      const removedUrls = original.images.filter((u) => !finalImages.includes(u));
      const removedPublicIds = removedUrls.map((u) => originalPublicIdByUrl.get(u)).filter((p): p is string => !!p);
      if (removedPublicIds.length > 0) {
        const { failed } = await deleteR2Assets(removedPublicIds);
        if (failed.length && __DEV__) console.warn(`[R2] Listing edit: failed to clean up ${failed.length}/${removedPublicIds.length} removed image(s):`, failed);
      }

      router.back();
    } catch {
      Alert.alert(t('listing.edit.saveFailedTitle'), t('listing.edit.saveFailedMessage'));
    } finally {
      setSaving(false);
      setUploadProgress(null);
    }
  };

  const confirmDelete = () => {
    Alert.alert(t('listing.deleteConfirmTitle'), t('listing.deleteConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          const ok = await removeListing(original.id);
          if (ok) {
            router.replace('/my-listings');
          } else {
            Alert.alert(t('listing.deleteErrorTitle'), t('listing.deleteErrorMessage'));
          }
        },
      },
    ]);
  };

  if (!authed) return <Screen />;

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} noPadding>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md, paddingHorizontal: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {t('listing.edit.title')}
        </Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: spacing.xl }}>
          <View style={{ gap: spacing.md }}>
            <View>
              <Text variant="caption" color="secondary" style={{ marginBottom: spacing.xs }}>
                {t('listing.edit.photos')}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {images.map((item, index) => (
                  <View key={item + index} style={photoCellStyle(index, spacing.xs)}>
                    <Image
                      source={{ uri: imageUrl(item, { width: 400 }) }}
                      accessibilityLabel={t('post.index.photoAlt', { number: index + 1 })}
                      style={{ width: '100%', height: '100%', borderRadius: radius.sm, backgroundColor: colors.skeleton }}
                      contentFit="cover"
                      recyclingKey={item}
                      transition={200}
                    />
                    {index === 0 && (
                      <View style={{ position: 'absolute', bottom: 4, left: 4, backgroundColor: 'rgba(15,23,42,0.6)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 }}>
                        <Text variant="tiny" style={{ color: '#fff' }}>
                          {t('post.index.cover')}
                        </Text>
                      </View>
                    )}
                    <Pressable
                      onPress={() => pickPhoto(index)}
                      accessibilityRole="button"
                      accessibilityLabel={t('listing.edit.replacePhoto', { number: index + 1 })}
                      style={{ position: 'absolute', top: 4, left: 4, backgroundColor: 'rgba(15,23,42,0.6)', borderRadius: 10, padding: 2 }}
                    >
                      <Ionicons name="swap-horizontal" size={12} color="#fff" />
                    </Pressable>
                    <Pressable
                      onPress={() => removePhoto(index)}
                      accessibilityRole="button"
                      accessibilityLabel={t('post.index.removePhotoAlt', { number: index + 1 })}
                      style={{ position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(15,23,42,0.6)', borderRadius: 10, padding: 2 }}
                    >
                      <Ionicons name="close" size={12} color="#fff" />
                    </Pressable>
                    <View style={{ position: 'absolute', bottom: 4, right: 4, flexDirection: 'row', gap: 3 }}>
                      {index > 0 && (
                        <Pressable
                          onPress={() => movePhoto(index, -1)}
                          accessibilityRole="button"
                          accessibilityLabel={t('listing.edit.movePhotoEarlier', { number: index + 1 })}
                          style={{ backgroundColor: 'rgba(15,23,42,0.6)', borderRadius: 10, padding: 2 }}
                        >
                          <Ionicons name="chevron-back" size={12} color="#fff" />
                        </Pressable>
                      )}
                      {index < images.length - 1 && (
                        <Pressable
                          onPress={() => movePhoto(index, 1)}
                          accessibilityRole="button"
                          accessibilityLabel={t('listing.edit.movePhotoLater', { number: index + 1 })}
                          style={{ backgroundColor: 'rgba(15,23,42,0.6)', borderRadius: 10, padding: 2 }}
                        >
                          <Ionicons name="chevron-forward" size={12} color="#fff" />
                        </Pressable>
                      )}
                    </View>
                  </View>
                ))}
                {images.length < MAX_PHOTOS && (
                  <Pressable
                    onPress={() => pickPhoto()}
                    accessibilityRole="button"
                    accessibilityLabel={t('post.index.addPhotos')}
                    style={[
                      photoCellStyle(images.length, spacing.xs),
                      {
                        borderRadius: radius.sm,
                        borderWidth: 1.5,
                        borderStyle: 'dashed',
                        borderColor: colors.border,
                        alignItems: 'center',
                        justifyContent: 'center',
                      },
                    ]}
                  >
                    <Ionicons name="camera-outline" size={22} color={colors.textMuted} />
                  </Pressable>
                )}
              </View>
              {submitted && images.length === 0 && (
                <Text variant="caption" color="error" style={{ marginTop: spacing.xxs }}>
                  {t('listing.edit.addAtLeastOnePhoto')}
                </Text>
              )}
            </View>

            <View>
              <Text variant="caption" color="secondary" style={{ marginBottom: spacing.xs }}>
                {t('listing.edit.status')}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {STATUSES.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => setStatus(s)}
                    style={{
                      paddingHorizontal: spacing.sm,
                      paddingVertical: 8,
                      borderRadius: radius.pill,
                      borderWidth: 1.5,
                      borderColor: status === s ? colors.primary : colors.border,
                      backgroundColor: status === s ? colors.primary + '0D' : colors.surface,
                    }}
                  >
                    <Text variant="caption" color={status === s ? 'brand' : 'secondary'}>
                      {t(`listing.edit.statusValue.${s}`)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <Input label={t('post.details.titleLabel')} value={title} onChangeText={setTitle} error={titleError} />

            <View>
              <Text variant="caption" color="secondary" style={{ marginBottom: spacing.xs }}>
                {t('post.category.title')}
              </Text>
              <Pressable
                onPress={() => setCategoryModalOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={t('listing.edit.changeCategory')}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: colors.inputBackground,
                  borderRadius: radius.sm,
                  paddingHorizontal: spacing.sm,
                  minHeight: 50,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                  {activeCategory && <CategoryIcon icon={activeCategory.icon} size={18} color={colors.primary} />}
                  <Text variant="body">{subcategory ? `${activeCategory?.name} · ${subcategory}` : activeCategory?.name ?? t('listing.edit.selectCategory')}</Text>
                </View>
                <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
              </Pressable>
            </View>

            <Input
              label={t('post.price.priceLabel')}
              value={price}
              onChangeText={(v) => setPrice(v.replace(/[^0-9]/g, ''))}
              keyboardType="numeric"
              leftIcon={<Text color="secondary">{currency}</Text>}
              error={priceError}
            />

            <View>
              <Text variant="caption" color="secondary" style={{ marginBottom: spacing.xs }}>
                {t('listing.edit.currency')}
              </Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                {currencies.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => setCurrency(c)}
                    style={{
                      paddingHorizontal: spacing.sm,
                      paddingVertical: 8,
                      borderRadius: radius.pill,
                      borderWidth: 1.5,
                      borderColor: currency === c ? colors.primary : colors.border,
                      backgroundColor: currency === c ? colors.primary + '0D' : colors.surface,
                    }}
                  >
                    <Text variant="caption" color={currency === c ? 'brand' : 'secondary'}>
                      {c}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View>
              <Text variant="caption" color="secondary" style={{ marginBottom: spacing.xs }}>
                {t('listing.edit.priceNegotiable')}
              </Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                {([true, false] as const).map((val) => (
                  <Pressable
                    key={String(val)}
                    onPress={() => setNegotiable(val)}
                    style={{
                      paddingHorizontal: spacing.sm,
                      paddingVertical: 8,
                      borderRadius: radius.pill,
                      borderWidth: 1.5,
                      borderColor: negotiable === val ? colors.primary : colors.border,
                      backgroundColor: negotiable === val ? colors.primary + '0D' : colors.surface,
                    }}
                  >
                    <Text variant="caption" color={negotiable === val ? 'brand' : 'secondary'}>
                      {val ? t('listing.negotiable') : t('listing.edit.fixedPrice')}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <Input label={t('post.details.descriptionLabel')} value={description} onChangeText={setDescription} multiline numberOfLines={5} style={{ height: 110 }} error={descriptionError} />

            <View>
              <Text variant="caption" color="secondary" style={{ marginBottom: spacing.xs }}>
                {t('post.details.conditionLabel')}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {CONDITIONS.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => setCondition(c)}
                    style={{
                      paddingHorizontal: spacing.sm,
                      paddingVertical: 8,
                      borderRadius: radius.pill,
                      borderWidth: 1.5,
                      borderColor: condition === c ? colors.primary : colors.border,
                      backgroundColor: condition === c ? colors.primary + '0D' : colors.surface,
                    }}
                  >
                    <Text variant="caption" color={condition === c ? 'brand' : 'secondary'}>
                      {t(`post.details.condition.${CONDITION_KEY[c]}`)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {extraFields.length > 0 && (
              <View style={{ gap: spacing.md }}>
                {extraFields.map((field) => (
                  <DynamicField
                    key={field.key}
                    field={field}
                    value={attributes[field.key] ?? ''}
                    onChange={(v) => setAttribute(field.key, v)}
                    error={submitted ? attributeErrors[field.key] : undefined}
                  />
                ))}
              </View>
            )}

            {featureOptions.length > 0 && (
              <View>
                <Text variant="caption" color="secondary" style={{ marginBottom: spacing.xs }}>
                  {t('post.details.featuresOptional')}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                  {featureOptions.map((f) => {
                    const selected = features.includes(f);
                    return (
                      <Pressable
                        key={f}
                        onPress={() => toggleFeature(f)}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        style={{
                          paddingHorizontal: spacing.sm,
                          paddingVertical: 8,
                          borderRadius: radius.pill,
                          borderWidth: 1.5,
                          borderColor: selected ? colors.primary : colors.border,
                          backgroundColor: selected ? colors.primary + '0D' : colors.surface,
                        }}
                      >
                        <Text variant="caption" color={selected ? 'brand' : 'secondary'}>
                          {selected ? '✓ ' : ''}
                          {f}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}

            <Input
              label={t('post.details.sellerNotesLabel')}
              placeholder={t('post.details.sellerNotesPlaceholder')}
              value={sellerNotes}
              onChangeText={setSellerNotes}
              multiline
              numberOfLines={4}
              style={{ height: 90, textAlignVertical: 'top', paddingTop: spacing.xs }}
            />

            <CityPicker value={city} onChange={setCity} />

            <View>
              <Text variant="caption" color="secondary" style={{ marginBottom: spacing.xs }}>
                {t('post.details.contactNumberLabel')}
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: colors.inputBackground,
                  borderRadius: radius.sm,
                  paddingHorizontal: spacing.sm,
                  minHeight: 50,
                }}
              >
                <Text variant="body">{original.seller.phone || t('listing.edit.notSet')}</Text>
                <Pressable onPress={() => router.push('/settings/edit-profile' as any)} accessibilityRole="button" accessibilityLabel={t('post.details.changePhoneLabel')}>
                  <Text variant="caption" color="brand">
                    {t('post.details.change')}
                  </Text>
                </Pressable>
              </View>
              <Text variant="tiny" color="muted" style={{ marginTop: spacing.xxs }}>
                {t('listing.edit.phoneHint')}
              </Text>
            </View>
          </View>
        </ScrollView>

        <View style={{ paddingHorizontal: spacing.md }}>
          {uploadProgress && (
            <Text variant="caption" color="secondary" align="center" style={{ marginTop: spacing.sm }}>
              {t('post.preview.uploadingPhotos', { completed: uploadProgress.completed, total: uploadProgress.total })}
            </Text>
          )}
          <Button label={t('common.saveChanges')} onPress={save} loading={saving} disabled={saving} fullWidth size="lg" style={{ marginTop: spacing.sm }} />
          <Button label={t('listing.edit.deleteListing')} variant="danger" onPress={confirmDelete} disabled={saving} fullWidth size="lg" style={{ marginTop: spacing.xs }} />
        </View>
      </KeyboardAvoidingView>

      <Modal visible={categoryModalOpen} animationType="slide" transparent onRequestClose={() => setCategoryModalOpen(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }}
          onPress={() => {
            setCategoryModalOpen(false);
            setCategoryModalParent(null);
          }}
          accessibilityLabel={t('common.close')}
          accessibilityRole="button"
        >
          <Pressable
            style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '75%', padding: spacing.md }}
            onPress={(e) => e.stopPropagation()}
          >
            {categoryModalParent ? (
              <>
                <Pressable onPress={() => setCategoryModalParent(null)} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
                  <Ionicons name="chevron-back" size={16} color={colors.primary} />
                  <Text variant="caption" color="brand" style={{ marginLeft: 2 }}>
                    {t('post.category.allCategories')}
                  </Text>
                </Pressable>
                <FlatList
                  data={categories.find((c) => c.id === categoryModalParent)?.subcategories ?? []}
                  keyExtractor={(s) => s.name}
                  contentContainerStyle={{ gap: spacing.xs, paddingBottom: spacing.md }}
                  renderItem={({ item }) => (
                    <Pressable
                      onPress={() => selectSubcategory(categoryModalParent, item.name)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        padding: spacing.sm,
                        borderRadius: radius.md,
                        backgroundColor: subcategory === item.name && category === categoryModalParent ? colors.primary + '0D' : colors.surface,
                      }}
                    >
                      <CategoryIcon icon={item.icon} size={20} color={colors.primary} />
                      <Text variant="body" style={{ marginLeft: spacing.sm, flex: 1 }}>
                        {item.name}
                      </Text>
                      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                    </Pressable>
                  )}
                />
              </>
            ) : (
              <>
                <Text variant="h3" style={{ marginBottom: spacing.sm }}>
                  {t('listing.edit.selectCategory')}
                </Text>
                <FlatList
                  data={categories}
                  keyExtractor={(c) => c.id}
                  contentContainerStyle={{ gap: spacing.xs, paddingBottom: spacing.md }}
                  renderItem={({ item }) => (
                    <Pressable
                      onPress={() => selectCategory(item.id)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        padding: spacing.sm,
                        borderRadius: radius.md,
                        backgroundColor: category === item.id ? colors.primary + '0D' : colors.surface,
                      }}
                    >
                      <CategoryIcon icon={item.icon} size={20} color={colors.primary} />
                      <Text variant="body" style={{ marginLeft: spacing.sm, flex: 1 }}>
                        {item.name}
                      </Text>
                      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                    </Pressable>
                  )}
                />
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
