import { useEffect, useState } from 'react';
import { View, Pressable, FlatList, Alert, Share } from 'react-native';
import { File } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';
import { useAuthStore } from '@/store/auth';
import { useMyListingsStore, listingToRow } from '@/store/myListings';
import { notifyListingsChanged } from '@/lib/feedEvents';
import { supabase } from '@/lib/supabase';
import { profileToSeller } from '@/lib/sellerStats';
import { activeMode } from '@/lib/profileIdentity';
import { useLocationsStore } from '@/store/locations';
import { parseCsv, csvRowsToObjects } from '@/lib/csv';
import { parseBulkRow, buildListingFromBulkRow, bulkUploadTemplate, BulkRow } from '@/lib/bulkUpload';
import { conditionApplies } from '@/data/sellRules';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { fetchScanPolicy } from '@/lib/imageScan';
import { chooseBulkPath } from '@/lib/bulkImageQueue';
import { activeBulkBatch, enqueueBulk, BulkEnqueueError } from '@/lib/bulkQueueClient';
import { BulkQueuePanel } from '@/components/BulkQueuePanel';

type Phase = 'pick' | 'preview' | 'uploading' | 'queued' | 'summary';
type UploadResult = { row: BulkRow; success: boolean; error?: string };

export default function BulkUpload() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  useEffect(() => {
    useLocationsStore.getState().load();
  }, []);
  const { t } = useTranslation();
  const authed = useRequireAuthScreen();
  const profile = useAuthStore((s) => s.profile);
  const session = useAuthStore((s) => s.session);

  const [phase, setPhase] = useState<Phase>('pick');
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [picking, setPicking] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<UploadResult[]>([]);
  // A queued import (photos scanned + watermarked server-side). Used only while the server enforces photo checks.
  const [batchId, setBatchId] = useState<string | null>(null);

  // Resume the progress screen if a bulk import is still open (the queue keeps working while the app is closed).
  useEffect(() => {
    let alive = true;
    void activeBulkBatch().then((id) => {
      if (alive && id) {
        setBatchId(id);
        setPhase('queued');
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const reset = () => {
    setBatchId(null);
    setPhase('pick');
    setFileName(null);
    setRows([]);
    setResults([]);
    setProgress({ done: 0, total: 0 });
  };

  const downloadTemplate = async () => {
    try {
      await Share.share({ title: 'bulk-upload-template.csv', message: bulkUploadTemplate() });
    } catch {
      // User dismissed the share sheet — nothing to do.
    }
  };

  const pickFile = async () => {
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel', 'text/plain'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const text = await new File(asset.uri).text();
      const objects = csvRowsToObjects(parseCsv(text));
      if (objects.length === 0) {
        Alert.alert(t('business.bulkUpload.emptyFileTitle'), t('business.bulkUpload.emptyFileMessage'));
        return;
      }
      setFileName(asset.name);
      setRows(objects.map(parseBulkRow));
      setPhase('preview');
    } catch {
      Alert.alert(t('business.bulkUpload.readErrorTitle'), t('business.bulkUpload.readErrorMessage'));
    } finally {
      setPicking(false);
    }
  };

  const validRows = rows.filter((r) => r.errors.length === 0);
  const invalidCount = rows.length - validRows.length;

  const startUpload = async () => {
    if (!session || !profile || validRows.length === 0) return;

    // The SERVER decides (migration 0050/0051): while photo checks are enforced, photos must be fetched, checked and
    // watermarked by the queue — the old direct insert of whatever URLs a CSV contains would be refused (and was never safe).
    if (chooseBulkPath(await fetchScanPolicy()) === 'queue') {
      setPhase('uploading');
      setProgress({ done: 0, total: validRows.length });
      try {
        const queued = await enqueueBulk(
          validRows.map((r) => ({
            payload: { title: r.title, description: r.description, price: r.price, category: r.categoryId, categoryName: r.categoryName, condition: r.condition, city: r.city, sellerPresentation: activeMode(profile) },
            photoUrls: r.images,
          })),
        );
        setBatchId(queued.batchId);
        setPhase('queued');
      } catch (e) {
        const kind = e instanceof BulkEnqueueError ? e.kind : 'failed';
        Alert.alert(t('business.bulkUpload.queue.errorTitle'), t(`business.bulkUpload.queue.errors.${kind}`));
        setPhase('preview');
      }
      return;
    }

    setPhase('uploading');
    setProgress({ done: 0, total: validRows.length });
    // Bulk upload is a business tool: listings carry the profile the owner has active when the batch starts, stored per listing.
    const seller = profileToSeller(profile, { listingsCount: 0, soldCount: 0, followers: 0, rating: 0, reviewCount: 0 }, activeMode(profile));
    const outcomes: UploadResult[] = [];

    for (const row of validRows) {
      const listing = buildListingFromBulkRow(row, seller);
      const { error } = await supabase.from('listings').insert(listingToRow(listing, session.user.id));
      outcomes.push({ row, success: !error, error: error?.message });
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    setResults(outcomes);
    await useMyListingsStore.getState().load();
    // New public listings: the paged feeds refetch their first page (nothing downloads the whole catalogue).
    notifyListingsChanged({ type: 'changed' });
    setPhase('summary');
  };

  const succeededCount = results.filter((r) => r.success).length;
  const failedResults = results.filter((r) => !r.success);

  if (!authed) return <Screen />;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {t('business.bulkUpload.title')}
        </Text>
      </View>

      {phase === 'pick' && (
        <>
          <Text variant="body" color="secondary" style={{ marginBottom: spacing.md }}>
            {t('business.bulkUpload.description')}
          </Text>

          <Pressable
            onPress={pickFile}
            disabled={picking}
            accessibilityRole="button"
            accessibilityLabel={t('business.bulkUpload.selectCsvFileA11y')}
            style={{
              borderWidth: 1.5,
              borderStyle: 'dashed',
              borderColor: colors.border,
              borderRadius: radius.md,
              padding: spacing.xl,
              alignItems: 'center',
              opacity: picking ? 0.6 : 1,
            }}
          >
            <Ionicons name="document-attach-outline" size={28} color={colors.textMuted} />
            <Text variant="bodyMedium" style={{ marginTop: spacing.xs }}>
              {picking ? t('business.bulkUpload.openingFilePicker') : t('business.bulkUpload.tapToSelect')}
            </Text>
            <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
              {t('business.bulkUpload.downloadTemplateHint')}
            </Text>
          </Pressable>

          <Card elevated={false} style={{ marginTop: spacing.md }}>
            <Text variant="caption" color="secondary">
              {t('business.bulkUpload.expectedColumns', { columns: 'title, description, price, category, condition, city, image_urls' })}
            </Text>
          </Card>

          <View style={{ flex: 1 }} />
          <Button label={t('business.bulkUpload.downloadTemplate')} variant="outline" onPress={downloadTemplate} fullWidth />
        </>
      )}

      {phase === 'preview' && (
        <>
          <Text variant="body" color="secondary" style={{ marginBottom: spacing.xs }}>
            {fileName}
          </Text>
          <Text variant="bodyMedium" style={{ marginBottom: spacing.md }}>
            {invalidCount > 0
              ? t('business.bulkUpload.rowsReadyWithErrors', { valid: validRows.length, total: rows.length, invalid: invalidCount })
              : t('business.bulkUpload.rowsReady', { valid: validRows.length, total: rows.length })}
          </Text>

          <FlatList
            data={rows}
            keyExtractor={(_, i) => String(i)}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={{ height: spacing.xs }} />}
            renderItem={({ item, index }) => (
              <Card elevated={false} style={{ borderWidth: 1, borderColor: item.errors.length ? colors.error : colors.success }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons
                    name={item.errors.length ? 'close-circle' : 'checkmark-circle'}
                    size={18}
                    color={item.errors.length ? colors.error : colors.success}
                  />
                  <Text variant="bodyMedium" numberOfLines={1} style={{ marginLeft: spacing.xs, flex: 1 }}>
                    {index + 1}. {item.title || t('business.bulkUpload.untitled')}
                  </Text>
                </View>
                {item.errors.length === 0 ? (
                  <Text variant="caption" color="secondary" style={{ marginTop: 2 }}>
                    {[item.categoryName, conditionApplies(item.categoryId) ? item.condition : null, item.city].filter(Boolean).join(' · ')}
                  </Text>
                ) : (
                  item.errors.map((e, i) => (
                    <Text key={i} variant="caption" color="error" style={{ marginTop: 2 }}>
                      {e}
                    </Text>
                  ))
                )}
              </Card>
            )}
          />

          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
            <Button label={t('business.bulkUpload.chooseDifferentFile')} variant="ghost" onPress={reset} style={{ flex: 1 }} />
            <Button
              label={t('business.bulkUpload.uploadCount', { count: validRows.length })}
              onPress={startUpload}
              disabled={validRows.length === 0}
              style={{ flex: 1 }}
            />
          </View>
        </>
      )}

      {phase === 'uploading' && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="h2">
            {progress.done} / {progress.total}
          </Text>
          <Text variant="body" color="secondary" style={{ marginTop: spacing.xs }}>
            {t('business.bulkUpload.uploadingListings')}
          </Text>
          <View style={{ width: '100%', height: 8, borderRadius: 4, backgroundColor: colors.border, marginTop: spacing.md, overflow: 'hidden' }}>
            <View
              style={{
                width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
                height: '100%',
                backgroundColor: colors.primary,
              }}
            />
          </View>
        </View>
      )}

      {phase === 'queued' && batchId && profile && session && (
        <BulkQueuePanel
          batchId={batchId}
          userId={session.user.id}
          seller={profileToSeller(profile, { listingsCount: 0, soldCount: 0, followers: 0, rating: 0, reviewCount: 0 }, activeMode(profile))}
          onPublishedSome={() => {
            void useMyListingsStore.getState().load();
            notifyListingsChanged({ type: 'changed' });
          }}
          onClose={() => router.back()}
        />
      )}

      {phase === 'summary' && (
        <>
          <View style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
            <Ionicons
              name={failedResults.length === 0 ? 'checkmark-circle' : 'alert-circle'}
              size={48}
              color={failedResults.length === 0 ? colors.success : colors.warning}
            />
            <Text variant="h2" style={{ marginTop: spacing.sm }}>
              {t('business.bulkUpload.published', { count: succeededCount })}
            </Text>
            {(failedResults.length > 0 || invalidCount > 0) && (
              <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xxs }}>
                {failedResults.length > 0 ? `${t('business.bulkUpload.failedToUpload', { count: failedResults.length })} ` : ''}
                {invalidCount > 0 ? t('business.bulkUpload.skippedInvalid', { count: invalidCount }) : ''}
              </Text>
            )}
          </View>

          {failedResults.length > 0 && (
            <FlatList
              data={failedResults}
              keyExtractor={(_, i) => String(i)}
              showsVerticalScrollIndicator={false}
              ItemSeparatorComponent={() => <View style={{ height: spacing.xs }} />}
              renderItem={({ item }) => (
                <Card elevated={false} style={{ borderWidth: 1, borderColor: colors.error }}>
                  <Text variant="bodyMedium" numberOfLines={1}>
                    {item.row.title || '(untitled)'}
                  </Text>
                  <Text variant="caption" color="error" style={{ marginTop: 2 }}>
                    {item.error ?? t('business.bulkUpload.unknownError')}
                  </Text>
                </Card>
              )}
            />
          )}

          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
            <Button label={t('business.bulkUpload.uploadAnotherFile')} variant="outline" onPress={reset} style={{ flex: 1 }} />
            <Button label={t('common.done')} onPress={() => router.back()} style={{ flex: 1 }} />
          </View>
        </>
      )}
    </Screen>
  );
}
