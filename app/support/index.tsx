import { useEffect } from 'react';
import { View, ScrollView, Pressable, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { useModerationStore } from '@/store/moderation';
import { appealKindFor } from '@/lib/moderationClient';
import { formatRelativeTime } from '@/data/time';

export default function SupportCenter() {
  const { t, i18n } = useTranslation();
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const authed = useRequireAuthScreen();
  const { notices, cases, account, hasLoaded, error, load, markRead } = useModerationStore();

  useEffect(() => {
    if (authed) void load();
  }, [authed]);

  if (!authed) return <Screen />;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm, flex: 1 }}>
          {t('support.title')}
        </Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={false} onRefresh={() => load()} tintColor={colors.primary} />} contentContainerStyle={{ paddingBottom: spacing.xxl, gap: spacing.sm }}>
        <Button label={t('support.contact')} onPress={() => router.push('/support/new' as never)} fullWidth />

        {account.status !== 'active' && (
          <Card style={{ borderWidth: 1, borderColor: colors.warning }}>
            <Text variant="bodyMedium">
              {account.status === 'banned' ? t('support.account.banned') : account.until ? t('support.account.suspendedUntil', { date: new Date(account.until).toLocaleString(i18n.language) }) : t('support.account.suspended')}
            </Text>
            <Text variant="caption" color="secondary" style={{ marginTop: 4 }}>
              {t('support.account.hint')}
            </Text>
            <Pressable onPress={() => router.push(`/support/new?appeal=${account.status === 'banned' ? 'ban' : 'suspension'}` as never)} accessibilityRole="button" style={{ marginTop: spacing.xs }}>
              <Text variant="caption" color="brand">
                {t('support.appealThisDecision')}
              </Text>
            </Pressable>
          </Card>
        )}

        {error && (
          <Pressable onPress={() => load()} accessibilityRole="button">
            <Text variant="caption" color="error">
              {t('support.loadFailed')} {t('support.retry')}
            </Text>
          </Pressable>
        )}

        <Text variant="bodyMedium" color="secondary" style={{ marginTop: spacing.sm }}>
          {t('support.noticesHeading')}
        </Text>
        {hasLoaded && notices.length === 0 ? (
          <Text variant="caption" color="secondary">
            {t('support.noNotices')}
          </Text>
        ) : (
          notices.map((n) => {
            const appealKind = n.appealable ? appealKindFor(n.kind) : null;
            return (
              <Card key={n.id} style={n.readAt ? undefined : { borderWidth: 1, borderColor: colors.primary }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                  <Text variant="bodyMedium" style={{ flex: 1 }}>
                    {n.title}
                  </Text>
                  {!n.readAt && <Badge label={t('support.newBadge')} tone="accent" />}
                </View>
                <Text variant="caption" color="secondary" style={{ marginTop: 4 }}>
                  {n.body}
                </Text>
                <Text variant="tiny" color="muted" style={{ marginTop: 6 }}>
                  {t('support.thread.team')} · {formatRelativeTime(new Date(n.createdAt).getTime())}
                </Text>
                <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs }}>
                  {appealKind && (
                    <Pressable
                      onPress={() => router.push(`/support/new?appeal=${appealKind}${n.listingId ? `&listingId=${n.listingId}` : ''}&noticeId=${n.id}` as never)}
                      accessibilityRole="button"
                    >
                      <Text variant="caption" color="brand">
                        {t('support.appeal')}
                      </Text>
                    </Pressable>
                  )}
                  {!n.readAt && (
                    <Pressable onPress={() => markRead(n.id)} accessibilityRole="button">
                      <Text variant="caption" color="secondary">
                        {t('support.markRead')}
                      </Text>
                    </Pressable>
                  )}
                </View>
              </Card>
            );
          })
        )}

        <Text variant="bodyMedium" color="secondary" style={{ marginTop: spacing.sm }}>
          {t('support.conversationsHeading')}
        </Text>
        {hasLoaded && cases.length === 0 ? (
          <Text variant="caption" color="secondary">
            {t('support.noConversationsHint')}
          </Text>
        ) : (
          cases.map((c) => (
            <Pressable key={c.id} onPress={() => router.push(`/support/${c.id}` as never)} accessibilityRole="button">
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                  <Text variant="bodyMedium" style={{ flex: 1 }} numberOfLines={1}>
                    {c.subject}
                  </Text>
                  <Badge label={t(`support.status.${c.status}`)} tone={c.status === 'awaiting_user' ? 'accent' : c.status === 'awaiting_staff' ? 'warning' : 'neutral'} />
                </View>
                <Text variant="tiny" color="muted" style={{ marginTop: 4 }}>
                  {formatRelativeTime(new Date(c.lastMessageAt).getTime())}
                </Text>
              </Card>
            </Pressable>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
