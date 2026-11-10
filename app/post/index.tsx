import { useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Pressable, ScrollView, ViewStyle, Alert, Platform } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { requestLibraryPermission } from '@/lib/libraryPermission';
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
import { PhotoSourceSheet } from '@/components/PhotoSourceSheet';
import { useTheme } from '@/theme/ThemeContext';
import { usePostDraft, draftPhotoItems, type DraftPhoto } from '@/store/postDraft';
import { MAX_PHOTOS, addPhotos, removePhotoById, movePhoto, replacePhotoById, isCover, remainingSlots, showAddTile, dragTargetIndex } from '@/data/photoList';
import { usePostExitGuard } from '@/hooks/usePostExitGuard';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { persistDraftPhoto, deleteDraftPhoto } from '@/lib/postDraftPhotos';
import { checkImage, SCREENSHOT_WARNING } from '@/lib/imageModeration';
import { validateImageAsset } from '@/lib/imageValidation';
import { showSnackbar } from '@/lib/snackbar';
import { prewarmCompression } from '@/lib/storage';
import { startPostFlow } from '@/store/publishSession';

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

// Cell order is exactly the visual order: photos (list order), then photos
// still needing a retry, then the Add tile LAST. A photo's grid index is
// therefore its list index, which the drag maths below relies on.
type Cell =
  | { kind: 'photo'; photo: DraftPhoto; photoIndex: number }
  | { kind: 'failed'; item: FailedItem }
  | { kind: 'add' };

// The whole grid is GRID_COLUMNS-wide to look like a real marketplace photo
// picker (Jiji/FB Marketplace/Airbnb), not a single-column list. The
// underlying drag library (react-native-draggable-flatlist) has no grid
// support at all — its reorder math is strictly 1-dimensional — so reorder
// is implemented here directly with a Pan gesture that snaps the moved photo
// into the nearest grid cell.
//
// On release the photo glides to the centre of the cell it was dropped on and
// only THEN is the list reordered; the drag offset is cleared in a layout
// effect keyed on the photo's new index, so the photo is never left floating
// over, or stacked under, its neighbours. The dragged cell stays on top
// (zIndex) until that hand-off. Long-press activation keeps taps on the remove
// button and plain scrolling working. Screen readers get "move earlier /
// later" actions instead of drag.
function DraggablePhotoCell({
  photo,
  photoIndex,
  photosLength,
  stepX,
  stepY,
  cellLayout,
  onReorder,
  onRemove,
}: {
  photo: DraftPhoto;
  photoIndex: number;
  photosLength: number;
  stepX: number;
  stepY: number;
  cellLayout: ReturnType<typeof gridCellLayout>;
  onReorder: (from: number, to: number) => void;
  onRemove: (id: string) => void;
}) {
  const { colors, radius, shadow } = useTheme();
  const { t } = useTranslation();
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const active = useSharedValue(0);

  // The photo now lives in a different grid cell (or was just mounted): drop any leftover drag offset.
  useLayoutEffect(() => {
    translateX.value = 0;
    translateY.value = 0;
    active.value = 0;
  }, [photoIndex]);

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
      const deltaCol = stepX > 0 ? Math.round(e.translationX / stepX) : 0;
      const deltaRow = stepY > 0 ? Math.round(e.translationY / stepY) : 0;
      const target = dragTargetIndex(photoIndex, deltaCol, deltaRow, GRID_COLUMNS, photosLength);
      // Offset of the target cell from this one (clamping can make it differ from the raw finger offset).
      const colShift = (target % GRID_COLUMNS) - (photoIndex % GRID_COLUMNS);
      const rowShift = Math.floor(target / GRID_COLUMNS) - Math.floor(photoIndex / GRID_COLUMNS);
      translateY.value = withTiming(rowShift * stepY, { duration: 120 });
      translateX.value = withTiming(colShift * stepX, { duration: 120 }, (finished) => {
        if (finished && target !== photoIndex) {
          runOnJS(onReorder)(photoIndex, target);
        } else {
          translateX.value = 0;
          translateY.value = 0;
          active.value = 0;
        }
      });
    })
    .onFinalize((_e, success) => {
      // Cancelled/interrupted gesture: never leave the cell displaced or on top.
      if (!success) {
        translateX.value = 0;
        translateY.value = 0;
        active.value = 0;
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: active.value ? 1.05 : 1 }],
    zIndex: active.value ? 10 : 0,
    shadowOpacity: active.value ? 0.3 : shadow.sm.shadowOpacity,
    elevation: active.value ? 8 : 2,
  }));

  const number = photoIndex + 1;
  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        entering={FadeIn.duration(200)}
        exiting={FadeOut.duration(150)}
        style={[cellLayout, animatedStyle]}
        accessible
        accessibilityLabel={t('post.index.photoAlt', { number })}
        accessibilityActions={[
          ...(photoIndex > 0 ? [{ name: 'earlier', label: t('listing.edit.movePhotoEarlier', { number }) }] : []),
          ...(photoIndex < photosLength - 1 ? [{ name: 'later', label: t('listing.edit.movePhotoLater', { number }) }] : []),
        ]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'earlier') onReorder(photoIndex, photoIndex - 1);
          if (e.nativeEvent.actionName === 'later') onReorder(photoIndex, photoIndex + 1);
        }}
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
            source={{ uri: photo.uri }}
            accessibilityLabel={t('post.index.photoAlt', { number })}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            recyclingKey={photo.id}
          />
          {isCover(photoIndex) && (
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
          {!isCover(photoIndex) && (
            <Pressable
              onPress={() => onReorder(photoIndex, 0)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t('post.index.makeCoverAlt', { number })}
              style={{
                position: 'absolute',
                bottom: 4,
                left: 4,
                width: 22,
                height: 22,
                borderRadius: 11,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(15,23,42,0.65)',
              }}
            >
              <Ionicons name="star-outline" size={13} color="#fff" />
            </Pressable>
          )}
          <Pressable
            onPress={() => onRemove(photo.id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('post.index.removePhotoAlt', { number })}
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
  const [sourceOpen, setSourceOpen] = useState(false);
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

  // The one ordered photo list. Everything below (cover, add tile, slots left)
  // is derived from it; photos still waiting on a retry also occupy a slot.
  const photoItems = draftPhotoItems(photos, photoIds);
  const occupiedSlots = photoItems.length + failedItems.length;
  const addVisible = showAddTile(occupiedSlots);
  const remaining = remainingSlots(occupiedSlots);

  // Every change reads the LATEST list from the store (a render-time snapshot
  // goes stale across the awaits below) and writes photos + photoIds in one update.
  const currentItems = (): DraftPhoto[] => {
    const s = usePostDraft.getState();
    return draftPhotoItems(s.photos, s.photoIds);
  };
  const commit = (next: DraftPhoto[]) => usePostDraft.getState().setPhotoItems(next);

  // Screenshot/low-quality warnings are never a block — flagged photos stay
  // in the grid, and the seller decides whether to remove them.
  const presentFlaggedWarning = (flaggedUris: string[]) => {
    if (flaggedUris.length === 0) return;
    Alert.alert(SCREENSHOT_WARNING.split('\n\n')[0], SCREENSHOT_WARNING.split('\n\n')[1], [
      {
        text: t('post.index.removeIt'),
        style: 'destructive',
        onPress: () => {
          flaggedUris.forEach(deleteDraftPhoto);
          commit(currentItems().filter((p) => !flaggedUris.includes(p.uri)));
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
  // it's ready (same id, so the cell is not remounted); a failure pulls that
  // photo back out and drops it into failedItems as a Retry/Remove cell instead.
  const addAssets = async (assets: ImagePicker.ImagePickerAsset[]) => {
    if (assets.length === 0) return;

    const existing = currentItems();
    const candidates: { asset: ImagePicker.ImagePickerAsset; id: string }[] = [];
    let skippedDuplicate = false;
    let invalidMessage: string | undefined;

    for (const asset of assets) {
      const id = asset.assetId ?? asset.uri;
      const isDuplicate =
        existing.some((p) => p.id === id) ||
        candidates.some((c) => c.id === id) ||
        failedItems.some((f) => (f.asset.assetId ?? f.asset.uri) === id);
      if (isDuplicate) {
        skippedDuplicate = true;
        continue;
      }
      const validation = validateImageAsset(asset);
      if (!validation.ok) {
        invalidMessage = validation.message;
        continue;
      }
      candidates.push({ asset, id });
    }

    if (skippedDuplicate) showSnackbar(t('post.index.alreadyAdded'));
    // Image validation failures always surface through the snackbar (never
    // silently — the seller sees exactly why a photo didn't get added).
    if (invalidMessage) showSnackbar(invalidMessage);

    if (candidates.length === 0) return;

    // The five-photo cap is enforced here for the camera and the gallery alike (photos waiting on a retry hold a slot).
    const { list, added, rejected } = addPhotos(
      existing,
      candidates.map((c) => ({ id: c.id, uri: c.asset.uri })),
      MAX_PHOTOS - failedItems.length
    );
    if (rejected.length > 0) showSnackbar(t('post.webSell.tooManyPhotos', { max: MAX_PHOTOS, count: rejected.length }));
    if (added.length === 0) return;
    commit(list);

    const accepted = candidates.filter((c) => added.some((a) => a.id === c.id));

    setImporting(true);
    try {
      const flaggedUris: string[] = [];

      await Promise.allSettled(
        accepted.map(async ({ asset, id }, i) => {
          try {
            // Copy into the app's own permanent storage — the picker's URIs
            // live in an OS cache that isn't guaranteed to survive an app
            // relaunch, but the draft (including these paths) is persisted
            // across app kills.
            const persistedUri = await persistDraftPhoto(asset.uri);
            const items = currentItems();
            if (!items.some((p) => p.id === id)) {
              deleteDraftPhoto(persistedUri);
              return; // removed from the grid while this was persisting
            }
            commit(replacePhotoById(items, id, { id, uri: persistedUri }));
            prewarmCompression(persistedUri);
            if (checkImage(asset).suspicious) flaggedUris.push(persistedUri);
          } catch {
            commit(removePhotoById(currentItems(), id));
            setFailedItems((prev) => [...prev, { key: `${id}-${Date.now()}-${i}`, asset }]);
            showSnackbar(t('post.index.couldNotAddPhoto'));
          }
        })
      );

      presentFlaggedWarning(flaggedUris);
    } finally {
      setImporting(false);
    }
  };

  // Android can destroy the app's Activity while the camera is open; the photo
  // the seller just confirmed is then delivered here instead of to takePhoto().
  useEffect(() => {
    if (Platform.OS !== 'android' || !hasHydrated) return;
    ImagePicker.getPendingResultAsync()
      .then((pending) => {
        if (pending && 'assets' in pending && !pending.canceled && pending.assets?.length) return addAssets(pending.assets);
      })
      .catch(() => {});
  }, [hasHydrated]);

  const retryFailedItem = async (key: string) => {
    const failed = failedItems.find((f) => f.key === key);
    if (!failed) return;

    setImporting(true);
    try {
      const uri = await persistDraftPhoto(failed.asset.uri);
      const id = failed.asset.assetId ?? failed.asset.uri;
      // This item's own slot is freed as it moves into the list.
      const { list, added } = addPhotos(currentItems(), [{ id, uri }], MAX_PHOTOS - (failedItems.length - 1));
      if (added.length === 0) {
        deleteDraftPhoto(uri);
        showSnackbar(t('post.index.alreadyAdded'));
        return;
      }
      commit(list);
      prewarmCompression(uri);
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
    try {
      const permission = await requestLibraryPermission();
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
    } catch {
      showSnackbar(t('post.index.couldNotAddPhoto'));
    }
  };

  const takePhoto = async () => {
    try {
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

      // Cancelling the camera adds nothing; a confirmed photo goes through the same path as the gallery.
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      await addAssets(result.assets);
    } catch {
      // Never swallow a failed capture: tell the seller instead of silently closing.
      showSnackbar(t('post.index.couldNotAddPhoto'));
    }
  };

  const openAddPhotosMenu = () => {
    if (importing || remaining <= 0) return;
    setSourceOpen(true);
  };

  const removePhoto = (id: string) => {
    const target = currentItems().find((p) => p.id === id);
    if (target) deleteDraftPhoto(target.uri);
    commit(removePhotoById(currentItems(), id));
  };

  const reorderPhotos = (from: number, to: number) => {
    commit(movePhoto(currentItems(), from, to));
  };

  if (!authed) return <Screen edges={['top', 'left', 'right', 'bottom']} />;

  // Real photos, then retry cells, then Add last — no empty placeholder slots.
  const cells: Cell[] = [
    ...photoItems.map((photo, photoIndex) => ({ kind: 'photo', photo, photoIndex }) as Cell),
    ...failedItems.map((item) => ({ kind: 'failed', item }) as Cell),
    ...(addVisible ? [{ kind: 'add' } as Cell] : []),
  ];
  // Distance between neighbouring cell origins, from the measured grid width.
  const cellWidth = gridWidth * 0.31;
  const stepX = cellWidth + spacing.xs;
  const stepY = cellWidth + spacing.sm;

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

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.md }}>
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

            const { photo, photoIndex } = cell;
            return (
              <DraggablePhotoCell
                key={photo.id}
                photo={photo}
                photoIndex={photoIndex}
                photosLength={photoItems.length}
                stepX={stepX}
                stepY={stepY}
                cellLayout={gridCellLayout(index, spacing.sm, spacing.xs)}
                onReorder={reorderPhotos}
                onRemove={removePhoto}
              />
            );
          })}
        </View>

        {photoItems.length > 1 && (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.sm }}>
            <Ionicons name="swap-horizontal" size={16} color={colors.primary} style={{ marginRight: spacing.xs, marginTop: 1 }} />
            <Text variant="caption" color="secondary" style={{ flex: 1 }}>
              {t('post.index.photoDragHint')}
            </Text>
          </View>
        )}

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
        disabled={photoItems.length === 0}
        fullWidth
        size="lg"
      />
      <PhotoSourceSheet
        visible={sourceOpen}
        title={t('post.index.addPhotos')}
        galleryLabel={t('post.index.chooseFromGallery')}
        cameraLabel={t('post.index.takePhoto')}
        cancelLabel={t('common.cancel')}
        onGallery={() => { setSourceOpen(false); pickFromLibrary(); }}
        onCamera={() => { setSourceOpen(false); takePhoto(); }}
        onCancel={() => setSourceOpen(false)}
      />
    </Screen>
  );
}
