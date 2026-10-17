import { Modal, View, ScrollView, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';
import { issueRows, type ScanResult } from '@/lib/imageScanState';
import type { ImageScanFailure } from '@/lib/imageScan';

export type ImageScanSheetState =
  | { kind: 'hidden' }
  | { kind: 'checking' }
  | { kind: 'error'; failure: ImageScanFailure }
  | { kind: 'result'; result: ScanResult };

type Props = {
  state: ImageScanSheetState;
  /** Local picked-photo uris, in order — used to show which photos an issue is about. */
  photoUris: string[];
  categoryLabel: string;
  onReplace: () => void;
  onRetry: () => void;
  onPublishForReview: () => void;
  onClose: () => void;
  /** False outside enforce mode when a photo is held privately: the seller must replace it (see reviewPublishAllowed). Default true. */
  allowReviewPublish?: boolean;
};

// The checking state is deliberately INDETERMINATE: the stages listed are what is being checked, not a
// progress claim. Nothing is ticked off until the server has actually answered.
const STAGES = ['stagePhotos', 'stageDuplicates', 'stageSafety', 'stageCategory'] as const;

export function ImageScanSheet({ state, photoUris, categoryLabel, onReplace, onRetry, onPublishForReview, onClose, allowReviewPublish = true }: Props) {
  const { t } = useTranslation();
  const { colors, spacing, radius, shadow } = useTheme();
  if (state.kind === 'hidden') return null;
  const busy = state.kind === 'checking';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={busy ? undefined : onClose}>
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.overlay, padding: spacing.lg }}>
        <View style={[{ backgroundColor: colors.surfaceElevated, borderRadius: radius.lg, padding: spacing.lg, maxHeight: '86%' }, shadow.md]}>
          {state.kind === 'checking' && (
            <View accessible accessibilityLiveRegion="polite" accessibilityLabel={t('imageScan.checking.a11y')} style={{ alignItems: 'center' }}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text variant="h3" align="center" style={{ marginTop: spacing.md }}>{t('imageScan.checking.title')}</Text>
              <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xxs }}>{t('imageScan.checking.subtitle')}</Text>
              <View style={{ alignSelf: 'stretch', marginTop: spacing.md, gap: spacing.xs }}>
                {STAGES.map((s) => (
                  <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                    <Ionicons name="ellipse-outline" size={14} color={colors.textSecondary} />
                    <Text variant="caption" color="secondary">{t(`imageScan.checking.${s}`)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {state.kind === 'error' && (
            <View>
              <Ionicons name="cloud-offline-outline" size={32} color={colors.textSecondary} style={{ alignSelf: 'center' }} />
              <Text variant="h3" align="center" style={{ marginTop: spacing.sm }}>{t('imageScan.issue.check_failed.title')}</Text>
              <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xxs }}>{t(`imageScan.errors.${state.failure}`)}</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                <Button label={t('imageScan.result.close')} variant="outline" onPress={onClose} style={{ flex: 1 }} />
                {state.failure === 'unreadable' ? (
                  <Button label={t('imageScan.result.replace')} onPress={onReplace} style={{ flex: 1 }} />
                ) : (
                  <Button label={t('imageScan.result.tryAgain')} onPress={onRetry} style={{ flex: 1 }} />
                )}
              </View>
            </View>
          )}

          {state.kind === 'result' && <Result state={state} photoUris={photoUris} categoryLabel={categoryLabel} onReplace={onReplace} onRetry={onRetry} onPublishForReview={onPublishForReview} onClose={onClose} allowReviewPublish={allowReviewPublish} />}
        </View>
      </View>
    </Modal>
  );
}

function Result({ state, photoUris, categoryLabel, onReplace, onRetry, onPublishForReview, onClose, allowReviewPublish = true }: Props & { state: { kind: 'result'; result: ScanResult } }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const { result } = state;
  const rows = issueRows(result);
  const needsFix = result.outcome === 'needs_changes';

  return (
    <>
      <Text variant="h3" align="center">{needsFix ? t('imageScan.result.fixTitle') : t('imageScan.result.reviewTitle')}</Text>
      <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xxs }}>
        {needsFix ? t('imageScan.result.fixIntro') : t('imageScan.result.reviewIntro')}
      </Text>

      <ScrollView style={{ marginTop: spacing.md }} contentContainerStyle={{ gap: spacing.sm }}>
        {rows.map((row) => (
          <View key={row.code} style={{ backgroundColor: colors.background, borderRadius: radius.md, padding: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <Ionicons name={row.severity === 'fix' ? 'alert-circle' : 'time-outline'} size={18} color={row.severity === 'fix' ? colors.error : colors.textSecondary} />
              <Text variant="bodyMedium" style={{ flex: 1 }}>{t(row.titleKey)}</Text>
            </View>
            <Text variant="body" color="secondary" style={{ marginTop: spacing.xxs }}>{t(row.messageKey, { category: categoryLabel })}</Text>
            {/* thumbnails of the affected photos only */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
              {row.photos.map((n) => (
                <View key={n} accessible accessibilityLabel={t('imageScan.result.photoN', { n })} style={{ alignItems: 'center' }}>
                  <Image source={{ uri: photoUris[n - 1] }} style={{ width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.skeleton }} contentFit="cover" />
                  <Text variant="caption" color="secondary">{n}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
        {needsFix || !allowReviewPublish ? (
          <>
            {!needsFix && result.canRetry && <Button label={t('imageScan.result.tryAgain')} variant="outline" onPress={onRetry} fullWidth />}
            <Button label={t('imageScan.result.replace')} onPress={onReplace} fullWidth />
          </>
        ) : (
          <>
            {result.canRetry && <Button label={t('imageScan.result.tryAgain')} onPress={onRetry} fullWidth />}
            <Button label={t('imageScan.result.publishForReview')} variant={result.canRetry ? 'outline' : 'primary'} onPress={onPublishForReview} fullWidth />
            <Button label={t('imageScan.result.replace')} variant="ghost" onPress={onReplace} fullWidth />
          </>
        )}
        <Button label={t('imageScan.result.close')} variant="ghost" onPress={onClose} fullWidth />
      </View>
    </>
  );
}
