import { useState } from 'react';
import { View, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';

type Tier = { key: string; labelKey: string; descriptionKey: string; pendingMessageKey: string };

const TIERS: Tier[] = [
  { key: 'phone', labelKey: 'verification.tiers.phone.label', descriptionKey: 'verification.tiers.phone.description', pendingMessageKey: 'verification.tiers.phone.pendingMessage' },
  { key: 'id', labelKey: 'verification.tiers.id.label', descriptionKey: 'verification.tiers.id.description', pendingMessageKey: 'verification.tiers.id.pendingMessage' },
  { key: 'business', labelKey: 'verification.tiers.business.label', descriptionKey: 'verification.tiers.business.description', pendingMessageKey: 'verification.tiers.business.pendingMessage' },
];

export default function Verification() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const authed = useRequireAuthScreen();
  const [done, setDone] = useState<Set<string>>(new Set(['google']));

  if (!authed) return <Screen />;

  const requestVerify = (tier: Tier) => {
    Alert.alert(t(tier.labelKey), t(tier.pendingMessageKey), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('verification.markAsSubmitted'), onPress: () => setDone((prev) => new Set(prev).add(tier.key)) },
    ]);
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {t('verification.title')}
        </Text>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name="checkmark-circle" size={22} color={colors.success} />
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <Text variant="bodyMedium">{t('verification.googleAccount', { provider: 'Google' })}</Text>
            <Text variant="caption" color="secondary">
              {t('verification.verifiedAutomatically')}
            </Text>
          </View>
        </Card>
        {TIERS.map((tier) => {
          const isDone = done.has(tier.key);
          return (
            <Card key={tier.key} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name={isDone ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={isDone ? colors.success : colors.textMuted} />
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
                <Text variant="bodyMedium">{t(tier.labelKey)}</Text>
                <Text variant="caption" color="secondary">
                  {isDone ? t('verification.submittedPendingReview') : t(tier.descriptionKey)}
                </Text>
              </View>
              {!isDone && <Button label={t('verification.verify')} size="sm" variant="outline" onPress={() => requestVerify(tier)} />}
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}
