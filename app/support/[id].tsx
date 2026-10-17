import { useCallback, useEffect, useState } from 'react';
import { View, FlatList, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import { useTheme } from '@/theme/ThemeContext';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { CaseThread, fetchCaseThread, replyToCase, withdrawAppeal } from '@/lib/supportApi';
import { useModerationStore } from '@/store/moderation';
import { canReply } from '@/lib/moderationClient';
import { formatRelativeTime } from '@/data/time';

export default function SupportThread() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const authed = useRequireAuthScreen();
  const { id } = useLocalSearchParams<{ id: string }>();
  const nonce = useModerationStore((s) => s.messageNonce);
  const [thread, setThread] = useState<CaseThread | null | undefined>(undefined);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setThread(await fetchCaseThread(String(id)));
    } catch {
      setError(t('support.thread.loadFailed'));
    }
  }, [id, t]);

  // `nonce` changes when a support message arrives over Realtime, so replies from the team appear without a refresh.
  useEffect(() => {
    if (authed) void load();
  }, [authed, load, nonce]);

  if (!authed) return <Screen />;

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
      <BackButton onPress={() => router.back()} />
      <Text variant="h3" style={{ marginLeft: spacing.sm, flex: 1 }} numberOfLines={1}>
        {thread?.case.subject ?? t('support.title')}
      </Text>
    </View>
  );

  if (thread === undefined) {
    return (
      <Screen>
        {header}
        {error ? (
          <Text variant="caption" color="error">
            {error}
          </Text>
        ) : (
          <Skeleton height={80} radius={radius.md} />
        )}
      </Screen>
    );
  }
  if (thread === null) {
    return (
      <Screen>
        {header}
        <Text variant="body" color="secondary">
          {t('support.thread.notFound')}
        </Text>
      </Screen>
    );
  }

  const { case: c, messages, appeal } = thread;
  const open = canReply(c);

  const send = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    const r = await replyToCase(c.id, body.trim());
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setBody('');
    void load();
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        {header}
        {appeal && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm }}>
            <Text variant="caption" color="secondary">
              {t('support.thread.appealStatus', { status: appeal.status })}
            </Text>
            {appeal.status === 'pending' && (
              <Pressable
                accessibilityRole="button"
                onPress={async () => {
                  const r = await withdrawAppeal(appeal.id);
                  if (!r.ok) setError(r.error);
                  else {
                    void useModerationStore.getState().load();
                    void load();
                  }
                }}
              >
                <Text variant="caption" color="brand">
                  {t('support.thread.withdraw')}
                </Text>
              </Pressable>
            )}
          </View>
        )}
        <FlatList
          style={{ flex: 1 }}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}
          renderItem={({ item: m }) => {
            const mine = m.authorKind === 'user';
            const system = m.authorKind === 'system';
            return (
              <View
                style={{
                  alignSelf: system ? 'center' : mine ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  padding: spacing.sm,
                  borderRadius: radius.md,
                  backgroundColor: system ? 'transparent' : mine ? colors.primary : colors.surface,
                }}
              >
                {m.authorKind === 'staff' && (
                  <Text variant="tiny" color="brand" style={{ marginBottom: 2 }}>
                    {t('support.thread.team')}
                  </Text>
                )}
                <Text variant={system ? 'caption' : 'body'} color={system ? 'muted' : mine ? 'inverse' : 'primary'}>
                  {m.body}
                </Text>
                <Text variant="tiny" color={mine ? 'inverse' : 'muted'} style={{ marginTop: 2, opacity: 0.7 }}>
                  {formatRelativeTime(new Date(m.createdAt).getTime())}
                </Text>
              </View>
            );
          }}
        />
        {open ? (
          <View style={{ paddingTop: spacing.xs, gap: spacing.xs }}>
            {error && (
              <Text variant="caption" color="error" accessibilityRole="alert">
                {error}
              </Text>
            )}
            <Input value={body} onChangeText={setBody} placeholder={t('support.thread.reply')} multiline maxLength={4000} />
            <Button label={t('support.thread.send')} onPress={send} loading={busy} disabled={!body.trim()} fullWidth />
          </View>
        ) : (
          <View style={{ alignItems: 'center', paddingVertical: spacing.md }}>
            <Text variant="caption" color="secondary">
              {t('support.thread.closed')}
            </Text>
            <Pressable onPress={() => router.replace('/support/new' as never)} accessibilityRole="button">
              <Text variant="caption" color="brand">
                {t('support.thread.startNew')}
              </Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}
