import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Pressable, Alert, ScrollView, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { launchCameraAsync, launchImageLibraryAsync } from '@/lib/imagePickerSafe';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Screen } from '@/components/Screen';
import { StepHeader } from '@/components/StepHeader';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';
import { usePostDraft } from '@/store/postDraft';
import { usePostExitGuard } from '@/hooks/usePostExitGuard';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { persistDraftPhoto, deleteDraftPhoto } from '@/lib/postDraftPhotos';
import { checkImage, SCREENSHOT_WARNING } from '@/lib/imageModeration';
import { validateImageAsset } from '@/lib/imageValidation';
import { showSnackbar } from '@/lib/snackbar';
import { startPostFlow } from '@/store/publishSession';

const MAX_PHOTOS = 8;
const GRID_COLUMNS = 3;
const GRID_CARD_WIDTH = '31%';

// Compact marketplace-style grid (Jiji/FB Marketplace): each row holds
// GRID_COLUMNS cards, with a fixed gap only between cards (not after the
// last one in a row) so an incomplete final row stays left-aligned instead
// of stretching apart under `space-between`.
function gridCellLayout(index: number, marginBottom: number, gap: number): ViewStyle {
  return {
    width: GRID_CARD_WIDTH,
    aspectRatio: 1,
    marginBottom,
    marginRight: (index + 1) % GRID_COLUMNS === 0 ? 0 : gap,
  };
}

// An asset whose local copy (persistDraftPhoto) failed — kept around so the
// grid can offer Retry/Remove instead of silently dropping it.
type FailedItem = { key: string; asset: ImagePicker.ImagePickerAsset };

type Cell =
  | { kind: 'add' }
  | { kind: 'photo'; uri: string; photoIndex: number }
  | { kind: 'failed'; item: FailedItem }
  | { kind: 'empty'; key: string };

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const copy = [...arr];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

// The whole grid is GRID_COLUMNS-wide to look like a real marketplace photo
// picker (Jiji/FB Marketplace/Airbnb), not a single-column list. The
// underlying drag library (react-native-draggable-flatlist) has no grid
// support at all — its reorder math is strictly 1-dimensional — so reorder
// is implemented here directly with a Pan gesture that snaps the moved photo
// into the nearest grid cell based on the container's measured width.
function DraggablePhotoCell({
  uri,
  photoIndex,
  photosLength,
  gridWidth,
  cellLayout,
  onReorder,
  onRemove,
}: {
  uri: string;
  photoIndex: number;
  photosLength: number;
  gridWidth: number;
  cellLayout: ReturnType<typeof gridCellLayout>;
  onReorder: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}) {
  const { colors, radius, spacing, shadow } = useTheme();
  const { t } = useTranslation();
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const active = useSharedValue(0);

  const pan = Gesture.Pan()
    .activateAfterLongPress(200)
    .onStart(() => {
      active.value = 1;
    })
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY;
    })
    .onEnd((e) => {
      const step = gridWidth > 0 ? gridWidth / GRID_COLUMNS : 1;
      const deltaCol = Math.round(e.translationX / step);
      const deltaRow = Math.round(e.translationY / step);
      const target = Math.min(Math.max(photoIndex + deltaRow * GRID_COLUMNS + deltaCol, 0), photosLength - 1);
      translateX.value = withTiming(0, { duration: 150 });
      translateY.value = withTiming(0, { duration: 150 });
      active.value = 0;
      if (target !== photoIndex) runOnJS(onReorder)(photoIndex, target);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: active.value ? 1.05 : 1 }],
    zIndex: active.value ? 10 : 0,
    shadowOpacity: active.value ? 0.3 : shadow.sm.shadowOpacity,
    elevation: active.value ? 8 : 2,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        entering={FadeIn.duration(200)}
        exiting={FadeOut.duration(150)}
        layout={LinearTransition.duration(200)}
        style={[cellLayout, animatedStyle]}
      >
        <View
          style={[
            {
              flex: 1,
              borderRadius: radius.md,
              overflow: 'hidden',
              backgroundColor: colors.inputBackground,
              borderWidth: 1,
              borderColor: colors.border,
            },
            shadow.sm,
          ]}
        >
          <Image
            source={{ uri }}
            accessibilityLabel={t('post.index.photoAlt', { number: photoIndex + 1 })}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            recyclingKey={uri}
          />
          {photoIndex === 0 && (
            <View
              style={{
                position: 'absolute',
                top: 4,
                left: 4,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 2,
                backgroundColor: colors.primary,
                borderRadius: radius.pill,
                paddingHorizontal: 5,
                paddingVertical: 2,
              }}
            >
              <Ionicons name="star" size={8} color={colors.primaryText} />
              <Text style={{ color: colors.primaryText, fontSize: 8, lineHeight: 10 }}>{t('post.index.cover')}</Text>
            </View>
          )}
          <Pressable
            onPress={() => onRemove(photoIndex)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('post.index.removePhotoAlt', { number: photoIndex + 1 })}
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 18,
              height: 18,
              borderRadius: 9,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(15,23,42,0.65)',
            }}
          >
            <Ionicons name="close" size={11} color="#fff" />
          </Pressable>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

export default function AddPhotos() {
  const { colors, spacing, radius, shadow } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const authed = useRequireAuthScreen();
  const { photos, photoIds, setField } = usePostDraft();
  const hasHydrated = usePostDraft((s) => s.hasHydrated);
  const [importing, setImporting] = useState(false);
  const [failedItems, setFailedItems] = useState<FailedItem[]>([]);
  const [gridWidth, setGridWidth] = useState(0);
  // This screen owns its own currentStep bookkeeping (rather than the shared
  // hook's auto-set) because Sell must always open here — see the effect
  // below — regardless of which step the seller was last on.
  const confirmLeave = usePostExitGuard(null);

  // Tapping Sell always lands on Step 1, even when a draft has later-step
  // data: the draft (photos, category, description, etc.) stays intact and
  // pre-filled on every step, but the seller reviews it from the start
  // instead of being dropped back into whatever step they left off on.
  useEffect(() => {
    if (!hasHydrated) return;
    setField('currentStep', 'index');
    // This screen is the Sell wizard's single entry point, so every mount is
    // the seller (re)starting a posting flow — mark it as the active one so
    // an older in-flight publish (see store/publishSession.ts) knows not to
    // navigate here out from under whatever the seller is doing now.
    startPostFlow();
  }, [hasHydrated]);

  const occupiedSlots = photos.length + failedItems.length;
  const addVisible = occupiedSlots < MAX_PHOTOS;
  const remaining = MAX_PHOTOS - occupiedSlots;

  // Screenshot/low-quality warnings are never a block — flagged photos stay
  // in the grid, and the seller decides whether to remove them.
  const presentFlaggedWarning = (flaggedUris: string[]) => {
    if (flaggedUris.length === 0) return;
    Alert.alert(SCREENSHOT_WARNING.split('\n\n')[0], SCREENSHOT_WARNING.split('\n\n')[1], [
      {
        text: t('post.index.removeIt'),
        style: 'destructive',
        onPress: () => {
          // Read both parallel arrays once, before either setField call, so
          // filtering by index can't desync photos from photoIds.
          const state = usePostDraft.getState();
          const keepIndices = state.photos.reduce<number[]>((acc, uri, i) => {
            if (!flaggedUris.includes(uri)) acc.push(i);
            return acc;
          }, []);
          flaggedUris.forEach(deleteDraftPhoto);
          setField('photos', keepIndices.map((i) => state.photos[i]));
          setField('photoIds', keepIndices.map((i) => state.photoIds[i]));
        },
      },
      { text: t('post.index.keepAnyway'), style: 'cancel' },
    ]);
  };

  // Shared by both the camera and gallery pickers: dedupes against what's
  // already in the draft (or already queued as a failed retry), validates,
  // then shows every accepted asset immediately using the picker's own
  // local URI — no waiting on the permanent-storage copy, moderation check,
  // or anything else. Persisting into permanent storage happens in the
  // background per-asset (so one failure doesn't drop the rest of the
  // batch) and silently swaps the placeholder URI for the durable one once
  // it's ready; a failure pulls that photo back out and drops it into
  // failedItems as a Retry/Remove cell instead.
  const addAssets = async (assets: ImagePicker.ImagePickerAsset[]) => {
    if (assets.length === 0) return;

    const acceptedAssets: (typeof assets)[number][] = [];
    let skippedDuplicate = false;
    let invalidMessage: string | undefined;

    for (const asset of assets) {
      const key = asset.assetId ?? asset.uri;
      const isDuplicate =
        photoIds.includes(key) ||
        acceptedAssets.some((a) => (a.assetId ?? a.uri) === key) ||
        failedItems.some((f) => (f.asset.assetId ?? f.asset.uri) === key);
      if (isDuplicate) {
        skippedDuplicate = true;
        continue;
      }
      const validation = validateImageAsset(asset);
      if (!validation.ok) {
        invalidMessage = validation.message;
        continue;
      }
      acceptedAssets.push(asset);
    }

    if (skippedDuplicate) showSnackbar(t('post.index.alreadyAdded'));
    // Image validation failures always surface through the snackbar (never
    // silently — the seller sees exactly why a photo didn't get added).
    if (invalidMessage) showSnackbar(invalidMessage);

    if (acceptedAssets.length === 0) return;

    const pendingIds = acceptedAssets.map((a) => a.assetId ?? a.uri);
    const current = usePostDraft.getState();
    setField('photos', [...current.photos, ...acceptedAssets.map((a) => a.uri)].slice(0, MAX_PHOTOS));
    setField('photoIds', [...current.photoIds, ...pendingIds].slice(0, MAX_PHOTOS));

    setImporting(true);
    try {
      const flaggedUris: string[] = [];

      await Promise.allSettled(
        acceptedAssets.map(async (asset, i) => {
          const id = pendingIds[i];
          try {
            // Copy into the app's own permanent storage — the picker's URIs
            // live in an OS cache that isn't guaranteed to survive an app
            // relaunch, but the draft (including these paths) is persisted
            // across app kills.
            const persistedUri = await persistDraftPhoto(asset.uri);
            const state = usePostDraft.getState();
            const idx = state.photoIds.indexOf(id);
            if (idx === -1) return; // removed from the grid while this was persisting
            const nextPhotos = [...state.photos];
            nextPhotos[idx] = persistedUri;
            setField('photos', nextPhotos);
            if (checkImage(asset).suspicious) flaggedUris.push(persistedUri);
          } catch {
            const state = usePostDraft.getState();
            const idx = state.photoIds.indexOf(id);
            if (idx !== -1) {
              setField('photos', state.photos.filter((_, i2) => i2 !== idx));
              setField('photoIds', state.photoIds.filter((_, i2) => i2 !== idx));
            }
            setFailedItems((prev) => [...prev, { key: `${id}-${Date.now()}-${i}`, asset }]);
          }
        })
      );

      presentFlaggedWarning(flaggedUris);
    } finally {
      setImporting(false);
    }
  };

  const retryFailedItem = async (key: string) => {
    const failed = failedItems.find((f) => f.key === key);
    if (!failed) return;

    setImporting(true);
    try {
      const uri = await persistDraftPhoto(failed.asset.uri);
      const state = usePostDraft.getState();
      setField('photos', [...state.photos, uri].slice(0, MAX_PHOTOS));
      setField('photoIds', [...state.photoIds, failed.asset.assetId ?? failed.asset.uri].slice(0, MAX_PHOTOS));
      setFailedItems((prev) => prev.filter((f) => f.key !== key));
      if (checkImage(failed.asset).suspicious) presentFlaggedWarning([uri]);
    } catch {
      showSnackbar(t('post.index.couldNotAddPhoto'));
    } finally {
      setImporting(false);
    }
  };

  const removeFailedItem = (key: string) => setFailedItems((prev) => prev.filter((f) => f.key !== key));

  const pickFromLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('post.index.galleryPermissionTitle'), t('post.index.galleryPermissionMessage'));
      return;
    }

    const result = await launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      // No picker-side compression — that's what was stalling the picker for
      // 10-15s on multi-photo selections. Real compression already happens
      // in the background before upload (lib/imagePipeline.ts).
      quality: 1,
      exif: true,
    });

    if (result.canceled || result.assets.length === 0) return;
    await addAssets(result.assets);
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('post.index.cameraPermissionTitle'), t('post.index.cameraPermissionMessage'));
      return;
    }

    const result = await launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
      exif: true,
    });

    if (result.canceled || result.assets.length === 0) return;
    await addAssets(result.assets);
  };

  const openAddPhotosMenu = () => {
    if (importing || remaining <= 0) return;
    Alert.alert(t('post.index.addPhotos'), undefined, [
      { text: t('post.index.chooseFromGallery'), onPress: pickFromLibrary },
      { text: t('post.index.takePhoto'), onPress: takePhoto },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const removePhoto = (i: number) => {
    deleteDraftPhoto(photos[i]);
    setField('photos', photos.filter((_, idx) => idx !== i));
    setField('photoIds', photoIds.filter((_, idx) => idx !== i));
  };

  const reorderPhotos = (from: number, to: number) => {
    if (from === to || to < 0 || to >= photos.length) return;
    setField('photos', arrayMove(photos, from, to));
    setField('photoIds', arrayMove(photoIds, from, to));
  };

  if (!authed) return <Screen edges={['top', 'left', 'right', 'bottom']} />;

  // The add tile itself occupies one of the 8 grid boxes, so only pad with
  // empty placeholders for whatever's left — keeps the grid looking like a
  // full 8-box layout instead of shrinking to just the occupied cells.
  const emptySlotCount = Math.max(0, MAX_PHOTOS - occupiedSlots - (addVisible ? 1 : 0));

  const cells: Cell[] = [
    ...(addVisible ? [{ kind: 'add' } as Cell] : []),
    ...photos.map((uri, photoIndex) => ({ kind: 'photo', uri, photoIndex }) as Cell),
    ...failedItems.map((item) => ({ kind: 'failed', item }) as Cell),
    ...Array.from({ length: emptySlotCount }, (_, i) => ({ kind: 'empty', key: `empty-${i}` }) as Cell),
  ];

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <StepHeader
        step={1}
        totalSteps={6}
        title={t('post.index.addPhotos')}
        subtitle={t('post.index.subtitle')}
        onClose={confirmLeave}
      />
      <Text variant="tiny" color="muted" style={{ marginBottom: spacing.sm }}>
        {t('post.index.photoHint', { max: MAX_PHOTOS })}
      </Text>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.md }}>
        <View
          onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
          style={{ flexDirection: 'row', flexWrap: 'wrap' }}
        >
          {cells.map((cell, index) => {
            if (cell.kind === 'add') {
              return (
                <View key="add-slot" style={gridCellLayout(index, spacing.sm, spacing.xs)}>
                  <Pressable
                    onPress={openAddPhotosMenu}
                    disabled={importing}
                    accessibilityRole="button"
                    accessibilityLabel={t('post.index.addPhotoLabel')}
                    accessibilityHint={t('post.index.addPhotoHint')}
                    style={({ pressed }) => ({
                      flex: 1,
                      borderRadius: radius.md,
                      borderWidth: 1.5,
                      borderStyle: 'dashed',
                      borderColor: colors.primary,
                      backgroundColor: colors.inputBackground,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: pressed ? 0.7 : importing ? 0.5 : 1,
                      transform: [{ scale: pressed ? 0.96 : 1 }],
                    })}
                  >
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        backgroundColor: colors.surface,
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: spacing.xxs,
                      }}
                    >
                      <Ionicons name="add" size={22} color={colors.primary} />
                      <View
                        style={{
                          position: 'absolute',
                          bottom: -3,
                          right: -3,
                          width: 14,
                          height: 14,
                          borderRadius: 7,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: colors.primary,
                          borderWidth: 1.5,
                          borderColor: colors.inputBackground,
                        }}
                      >
                        <Ionicons name="camera" size={7} color={colors.primaryText} />
                      </View>
                    </View>
                    <Text variant="tiny" color="brand" style={{ fontWeight: '600' }}>
                      {t('post.index.addPhotos')}
                    </Text>
                  </Pressable>
                </View>
              );
            }

            if (cell.kind === 'empty') {
              return (
                <View
                  key={cell.key}
                  style={[
                    gridCellLayout(index, spacing.sm, spacing.xs),
                    {
                      borderRadius: radius.md,
                      borderWidth: 1.5,
                      borderStyle: 'dashed',
                      borderColor: colors.border,
                      opacity: 0.5,
                    },
                  ]}
                />
              );
            }

            if (cell.kind === 'failed') {
              const { item } = cell;
              return (
                <Animated.View
                  key={item.key}
                  entering={FadeIn.duration(200)}
                  exiting={FadeOut.duration(150)}
                  layout={LinearTransition.duration(200)}
                  style={gridCellLayout(index, spacing.sm, spacing.xs)}
                >
                  <View
                    style={[
                      {
                        flex: 1,
                        borderRadius: radius.md,
                        overflow: 'hidden',
                        backgroundColor: colors.inputBackground,
                        borderWidth: 1,
                        borderColor: colors.error,
                      },
                      shadow.sm,
                    ]}
                  >
                    <Image
                      source={{ uri: item.asset.uri }}
                      style={{ width: '100%', height: '100%', opacity: 0.4 }}
                      contentFit="cover"
                    />
                    <View
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: spacing.xs,
                      }}
                    >
                      <Ionicons name="alert-circle" size={20} color={colors.error} style={{ marginBottom: spacing.xxs }} />
                      <Pressable
                        onPress={() => retryFailedItem(item.key)}
                        disabled={importing}
                        accessibilityRole="button"
                        accessibilityLabel={t('post.index.retryUploadLabel')}
                        style={({ pressed }) => ({
                          backgroundColor: colors.primary,
                          borderRadius: radius.pill,
                          paddingHorizontal: spacing.sm,
                          paddingVertical: 4,
                          marginBottom: spacing.xxs,
                          opacity: pressed ? 0.8 : 1,
                        })}
                      >
                        <Text variant="tiny" style={{ color: colors.primaryText }}>
                          {t('common.retry')}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => removeFailedItem(item.key)}
                        accessibilityRole="button"
                        accessibilityLabel={t('common.remove')}
                      >
                        <Text variant="tiny" color="secondary">
                          {t('common.remove')}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                </Animated.View>
              );
            }

            const { uri, photoIndex } = cell;
            return (
              <DraggablePhotoCell
                key={uri}
                uri={uri}
                photoIndex={photoIndex}
                photosLength={photos.length}
                gridWidth={gridWidth}
                cellLayout={gridCellLayout(index, spacing.sm, spacing.xs)}
                onReorder={reorderPhotos}
                onRemove={removePhoto}
              />
            );
          })}
        </View>

        {importing && (
          <Text variant="tiny" color="muted" style={{ marginTop: spacing.sm }}>
            {t('post.index.addingPhotos')}
          </Text>
        )}

        <View
          style={{
            marginTop: spacing.lg,
            borderRadius: radius.lg,
            backgroundColor: colors.surface,
            padding: spacing.md,
          }}
        >
          <Text variant="bodyMedium" style={{ marginBottom: spacing.sm }}>
            {t('post.index.tipsTitle')}
          </Text>
          {[
            t('post.index.tips.naturalLighting'),
            t('post.index.tips.frontAndBack'),
            t('post.index.tips.closeUps'),
            t('post.index.tips.avoidBlurry'),
          ].map((tip) => (
            <View key={tip} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
              <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
              <Text variant="body" color="secondary" style={{ marginLeft: spacing.xs }}>
                {tip}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <Button
        label={t('common.continue')}
        onPress={() => router.push('/post/category')}
        disabled={photos.length === 0}
        fullWidth
        size="lg"
      />
    </Screen>
  );
}
