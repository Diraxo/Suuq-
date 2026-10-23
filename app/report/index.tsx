import { useState } from 'react';
import { View, Pressable, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { idParam, enumParam } from '@/lib/routeParams';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { useTheme } from '@/theme/ThemeContext';
import { useReportsStore } from '@/store/reports';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';

const LISTING_REASON_KEYS = ['scamOrFraud', 'prohibitedItem', 'duplicateListing', 'wrongCategory', 'offensiveContent'];
const USER_REASON_KEYS = ['scamOrFraud', 'harassment', 'fakeProfile', 'spamMessages', 'offensiveBehavior'];
// A user reported from inside a chat: the behaviour that happens in conversations (payment pressure, abuse, spam).
const CHAT_USER_REASON_KEYS = ['harassment', 'scamOrFraud', 'offPlatformPayment', 'spamMessages', 'inappropriateContent', 'fakeProfile'];
const REVIEW_REASON_KEYS = ['fakeReview', 'offensiveLanguage', 'harassment', 'irrelevantToItem'];

// Submitted to the backend as stable English text regardless of the
// reporter's UI language, so reports stay consistent for the review team —
// only the on-screen label (via t(`report.reasons.${key}`)) is localized.
const REASON_EN: Record<string, string> = {
  scamOrFraud: 'Scam or fraud',
  prohibitedItem: 'Prohibited item',
  duplicateListing: 'Duplicate listing',
  wrongCategory: 'Wrong category',
  offensiveContent: 'Offensive content',
  harassment: 'Harassment',
  fakeProfile: 'Fake profile',
  spamMessages: 'Spam messages',
  offensiveBehavior: 'Offensive behavior',
  offPlatformPayment: 'Pressure to pay outside the app',
  inappropriateContent: 'Inappropriate messages',
  fakeReview: 'Fake review',
  offensiveLanguage: 'Offensive language',
  irrelevantToItem: 'Irrelevant to item',
};

export default function Report() {
  const { t } = useTranslation();
  const { spacing, radius, colors } = useTheme();
  const router = useRouter();
  const authed = useRequireAuthScreen();
  const { type: rawType, id: rawId, source: rawSource, conversationId: rawConversationId } = useLocalSearchParams<{ type?: string; id?: string; source?: string; conversationId?: string }>();
  const type = enumParam(rawType, ['listing', 'user', 'review'] as const);
  const id = idParam(rawId) || undefined;
  const source = enumParam(rawSource, ['chat', 'profile', 'listing'] as const);
  const conversationId = idParam(rawConversationId) || undefined;
  const fromChat = source === 'chat';
  const targetKind: 'listing' | 'user' | 'review' = type === 'user' ? 'user' : type === 'review' ? 'review' : 'listing';
  const reasonKeys = targetKind === 'user' ? (fromChat ? CHAT_USER_REASON_KEYS : USER_REASON_KEYS) : targetKind === 'review' ? REVIEW_REASON_KEYS : LISTING_REASON_KEYS;
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');

  const reportKey = `${type ?? 'listing'}:${id ?? 'unknown'}`;
  const isReported = useReportsStore((s) => s.isReported(reportKey));
  const submitReportToServer = useReportsStore((s) => s.submit);

  const [submitting, setSubmitting] = useState(false);

  const submitReport = async () => {
    if (!reason) return;
    setSubmitting(true);
    // Context line for the review team (English, like the reason): where the report was filed from.
    const context = source ? `[From ${source}${conversationId ? ` · conversation ${conversationId}` : ''}]` : '';
    const fullDetails = [context, details.trim()].filter(Boolean).join(' ').slice(0, 1000);
    const { error } = await submitReportToServer(targetKind, id ?? 'unknown', REASON_EN[reason] ?? reason, fullDetails);
    setSubmitting(false);
    if (error) {
      Alert.alert(t('report.submitFailedTitle'), error);
      return;
    }
    Alert.alert(t('report.thankYouTitle'), t('report.receivedMessage'), [{ text: t('common.ok'), onPress: () => router.back() }]);
  };

  if (!authed) return <Screen edges={['top', 'left', 'right', 'bottom']} />;

  if (isReported) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
          <BackButton onPress={() => router.back()} />
          <Text variant="h2" style={{ marginLeft: spacing.sm }}>
            {t(`report.titles.${targetKind}`)}
          </Text>
        </View>
        <EmptyState
          icon="checkmark-done-circle-outline"
          title={t('report.alreadyReportedTitle')}
          message={t(`report.alreadyReportedMessage.${targetKind}`)}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {t(`report.titles.${targetKind}`)}
        </Text>
      </View>

      <Text variant="caption" color="secondary" style={{ marginBottom: spacing.sm }}>
        {t('report.confidentialNote')}
      </Text>
      {fromChat && (
        <Text variant="caption" color="secondary" style={{ marginBottom: spacing.sm }}>
          {t('report.fromChatNote')}
        </Text>
      )}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ gap: spacing.xs, marginBottom: spacing.md }}>
        {reasonKeys.map((key) => (
          <Pressable
            key={key}
            onPress={() => setReason(key)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              padding: spacing.sm,
              borderRadius: radius.md,
              borderWidth: 1.5,
              borderColor: reason === key ? colors.error : colors.border,
              backgroundColor: reason === key ? colors.error + '0D' : colors.surface,
            }}
          >
            <Text variant="body" style={{ flex: 1 }}>
              {t(`report.reasons.${key}`)}
            </Text>
            {reason === key && <Ionicons name="checkmark-circle" size={20} color={colors.error} />}
          </Pressable>
        ))}
      </View>

      <Input placeholder={t('report.detailsPlaceholder')} value={details} onChangeText={setDetails} multiline numberOfLines={4} style={{ height: 90, textAlignVertical: 'top' }} />

      <View style={{ flex: 1 }} />
      <Button label={t('report.submitReport')} variant="danger" onPress={submitReport} disabled={!reason || submitting} loading={submitting} fullWidth size="lg" />
      </KeyboardAvoidingView>
    </Screen>
  );
}
