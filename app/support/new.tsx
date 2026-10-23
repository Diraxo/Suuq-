import { useState } from 'react';
import { View, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { idParam } from '@/lib/routeParams';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { openAppeal, openCase } from '@/lib/supportApi';
import { useModerationStore } from '@/store/moderation';

export default function NewSupportCase() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const router = useRouter();
  const authed = useRequireAuthScreen();
  const params = useLocalSearchParams<{ appeal?: string; listingId?: string; noticeId?: string }>();
  const appeal = params.appeal === 'listing' || params.appeal === 'suspension' || params.appeal === 'ban' ? params.appeal : null;
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!authed) return <Screen />;

  const max = appeal ? 2000 : 4000;
  const valid = body.trim().length >= (appeal ? 10 : 1) && body.length <= max && (appeal !== null || subject.trim().length >= 3);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const result = appeal
      ? await openAppeal({ kind: appeal, listingId: appeal === 'listing' ? idParam(params.listingId) || null : null, statement: body.trim() })
      : await openCase({ subject: subject.trim(), body: body.trim(), listingId: idParam(params.listingId) || null, noticeId: idParam(params.noticeId) || null });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    await useModerationStore.getState().load();
    router.replace(appeal ? ('/support' as never) : (`/support/${result.value}` as never));
  };

  const title = appeal === 'listing' ? t('support.new.appealListing') : appeal === 'suspension' ? t('support.new.appealSuspension') : appeal === 'ban' ? t('support.new.appealBan') : t('support.new.contactTitle');

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
          <BackButton onPress={() => router.back()} />
          <Text variant="h2" style={{ marginLeft: spacing.sm, flex: 1 }}>
            {title}
          </Text>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.xxl }}>
          <Text variant="caption" color="secondary">
            {appeal ? t('support.new.appealIntro') : t('support.new.contactIntro')}
          </Text>
          {!appeal && <Input label={t('support.new.subject')} value={subject} onChangeText={setSubject} maxLength={120} />}
          <Input
            label={appeal ? t('support.new.yourAppeal') : t('support.new.message')}
            value={body}
            onChangeText={setBody}
            multiline
            numberOfLines={6}
            maxLength={max}
            textAlignVertical="top"
            style={{ minHeight: 140 }}
          />
          <Text variant="tiny" color="muted">
            {body.length}/{max}
            {appeal ? ` · ${t('support.new.minChars')}` : ''}
          </Text>
          {error && (
            <Text variant="caption" color="error" accessibilityRole="alert">
              {error}
            </Text>
          )}
          <Button label={appeal ? t('support.new.submitAppeal') : t('support.new.send')} onPress={submit} loading={busy} disabled={!valid} fullWidth />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
