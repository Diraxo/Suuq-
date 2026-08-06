import { useState } from 'react';
import { View, Pressable, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { useTheme } from '@/theme/ThemeContext';
import { useReportsStore } from '@/store/reports';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';

const LISTING_REASONS = ['Scam or fraud', 'Prohibited item', 'Duplicate listing', 'Wrong category', 'Offensive content'];
const USER_REASONS = ['Scam or fraud', 'Harassment', 'Fake profile', 'Spam messages', 'Offensive behavior'];
const REVIEW_REASONS = ['Fake review', 'Offensive language', 'Harassment', 'Irrelevant to item'];

const LABELS: Record<'listing' | 'user' | 'review', { title: string; noun: string }> = {
  listing: { title: 'Report listing', noun: 'listing' },
  user: { title: 'Report user', noun: 'user' },
  review: { title: 'Report review', noun: 'review' },
};

export default function Report() {
  const { spacing, radius, colors } = useTheme();
  const router = useRouter();
  const authed = useRequireAuthScreen();
  const { type, id } = useLocalSearchParams<{ type?: string; id?: string }>();
  const targetKind: 'listing' | 'user' | 'review' = type === 'user' ? 'user' : type === 'review' ? 'review' : 'listing';
  const reasons = targetKind === 'user' ? USER_REASONS : targetKind === 'review' ? REVIEW_REASONS : LISTING_REASONS;
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');

  const reportKey = `${type ?? 'listing'}:${id ?? 'unknown'}`;
  const isReported = useReportsStore((s) => s.isReported(reportKey));
  const submitReportToServer = useReportsStore((s) => s.submit);

  const [submitting, setSubmitting] = useState(false);

  const submitReport = async () => {
    if (!reason) return;
    setSubmitting(true);
    const { error } = await submitReportToServer(targetKind, id ?? 'unknown', reason, details);
    setSubmitting(false);
    if (error) {
      Alert.alert('Could not submit report', error);
      return;
    }
    Alert.alert('Thank you.', 'Your report has been received.', [{ text: 'OK', onPress: () => router.back() }]);
  };

  if (!authed) return <Screen edges={['top', 'left', 'right', 'bottom']} />;

  if (isReported) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
          <BackButton onPress={() => router.back()} />
          <Text variant="h2" style={{ marginLeft: spacing.sm }}>
            {LABELS[targetKind].title}
          </Text>
        </View>
        <EmptyState
          icon="checkmark-done-circle-outline"
          title="Already reported"
          message={`You've already submitted a report for this ${LABELS[targetKind].noun}. Our team is reviewing it.`}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {LABELS[targetKind].title}
        </Text>
      </View>

      <Text variant="caption" color="secondary" style={{ marginBottom: spacing.sm }}>
        Your report is confidential. Our team reviews every report.
      </Text>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ gap: spacing.xs, marginBottom: spacing.md }}>
        {reasons.map((r) => (
          <Pressable
            key={r}
            onPress={() => setReason(r)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              padding: spacing.sm,
              borderRadius: radius.md,
              borderWidth: 1.5,
              borderColor: reason === r ? colors.error : colors.border,
              backgroundColor: reason === r ? colors.error + '0D' : colors.surface,
            }}
          >
            <Text variant="body" style={{ flex: 1 }}>
              {r}
            </Text>
            {reason === r && <Ionicons name="checkmark-circle" size={20} color={colors.error} />}
          </Pressable>
        ))}
      </View>

      <Input placeholder="Add details (optional)" value={details} onChangeText={setDetails} multiline numberOfLines={4} style={{ height: 90, textAlignVertical: 'top' }} />

      <View style={{ flex: 1 }} />
      <Button label="Submit report" variant="danger" onPress={submitReport} disabled={!reason || submitting} loading={submitting} fullWidth size="lg" />
      </KeyboardAvoidingView>
    </Screen>
  );
}
