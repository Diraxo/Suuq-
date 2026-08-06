import { useState } from 'react';
import { View, Pressable, FlatList, Alert, Share } from 'react-native';
import { File } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';
import { useAuthStore } from '@/store/auth';
import { useMyListingsStore, listingToRow } from '@/store/myListings';
import { useListingsStore } from '@/store/listings';
import { supabase } from '@/lib/supabase';
import { profileToSeller } from '@/lib/sellerStats';
import { parseCsv, csvRowsToObjects } from '@/lib/csv';
import { parseBulkRow, buildListingFromBulkRow, bulkUploadTemplate, BulkRow } from '@/lib/bulkUpload';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';

type Phase = 'pick' | 'preview' | 'uploading' | 'summary';
type UploadResult = { row: BulkRow; success: boolean; error?: string };

export default function BulkUpload() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const authed = useRequireAuthScreen();
  const profile = useAuthStore((s) => s.profile);
  const session = useAuthStore((s) => s.session);

  const [phase, setPhase] = useState<Phase>('pick');
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [picking, setPicking] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<UploadResult[]>([]);

  const reset = () => {
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
        Alert.alert('Empty file', 'That CSV has no data rows to import.');
        return;
      }
      setFileName(asset.name);
      setRows(objects.map(parseBulkRow));
      setPhase('preview');
    } catch {
      Alert.alert('Could not read file', 'Make sure it is a valid CSV and try again.');
    } finally {
      setPicking(false);
    }
  };

  const validRows = rows.filter((r) => r.errors.length === 0);
  const invalidCount = rows.length - validRows.length;

  const startUpload = async () => {
    if (!session || !profile || validRows.length === 0) return;
    setPhase('uploading');
    setProgress({ done: 0, total: validRows.length });
    const seller = profileToSeller(profile, { listingsCount: 0, soldCount: 0, followers: 0, rating: 0, reviewCount: 0 });
    const outcomes: UploadResult[] = [];

    for (const row of validRows) {
      const listing = buildListingFromBulkRow(row, seller);
      const { error } = await supabase.from('listings').insert(listingToRow(listing, session.user.id));
      outcomes.push({ row, success: !error, error: error?.message });
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    setResults(outcomes);
    await Promise.all([useMyListingsStore.getState().load(), useListingsStore.getState().load()]);
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
          Bulk Upload
        </Text>
      </View>

      {phase === 'pick' && (
        <>
          <Text variant="body" color="secondary" style={{ marginBottom: spacing.md }}>
            Upload a CSV with multiple listings at once — useful for dealers with large inventory.
          </Text>

          <Pressable
            onPress={pickFile}
            disabled={picking}
            accessibilityRole="button"
            accessibilityLabel="Select a CSV file"
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
              {picking ? 'Opening file picker…' : 'Tap to select a CSV file'}
            </Text>
            <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
              Download the template to see the expected format
            </Text>
          </Pressable>

          <Card elevated={false} style={{ marginTop: spacing.md }}>
            <Text variant="caption" color="secondary">
              Expected columns: title, description, price, category, condition, city, image_urls (separate multiple image URLs with &quot;|&quot;)
            </Text>
          </Card>

          <View style={{ flex: 1 }} />
          <Button label="Download template" variant="outline" onPress={downloadTemplate} fullWidth />
        </>
      )}

      {phase === 'preview' && (
        <>
          <Text variant="body" color="secondary" style={{ marginBottom: spacing.xs }}>
            {fileName}
          </Text>
          <Text variant="bodyMedium" style={{ marginBottom: spacing.md }}>
            {validRows.length} of {rows.length} rows are ready to import
            {invalidCount > 0 ? ` — ${invalidCount} need fixing` : ''}.
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
                    {index + 1}. {item.title || '(untitled)'}
                  </Text>
                </View>
                {item.errors.length === 0 ? (
                  <Text variant="caption" color="secondary" style={{ marginTop: 2 }}>
                    {item.categoryName} · {item.condition} · {item.city}
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
            <Button label="Choose a different file" variant="ghost" onPress={reset} style={{ flex: 1 }} />
            <Button
              label={`Upload ${validRows.length}`}
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
            Uploading listings…
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

      {phase === 'summary' && (
        <>
          <View style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
            <Ionicons
              name={failedResults.length === 0 ? 'checkmark-circle' : 'alert-circle'}
              size={48}
              color={failedResults.length === 0 ? colors.success : colors.warning}
            />
            <Text variant="h2" style={{ marginTop: spacing.sm }}>
              {succeededCount} listing{succeededCount === 1 ? '' : 's'} published
            </Text>
            {(failedResults.length > 0 || invalidCount > 0) && (
              <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xxs }}>
                {failedResults.length > 0 ? `${failedResults.length} failed to upload. ` : ''}
                {invalidCount > 0 ? `${invalidCount} skipped for invalid data.` : ''}
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
                    {item.error ?? 'Unknown error'}
                  </Text>
                </Card>
              )}
            />
          )}

          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
            <Button label="Upload another file" variant="outline" onPress={reset} style={{ flex: 1 }} />
            <Button label="Done" onPress={() => router.back()} style={{ flex: 1 }} />
          </View>
        </>
      )}
    </Screen>
  );
}
