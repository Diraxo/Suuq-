import { useState } from 'react';
import { View, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';

type Tier = { key: string; label: string; description: string; pendingMessage: string };

const TIERS: Tier[] = [
  { key: 'phone', label: 'Phone number', description: 'Confirm your number with a one-time code', pendingMessage: "We'll text you a one-time code once phone verification is available." },
  { key: 'id', label: 'ID verification', description: 'Optional — unlocks a higher trust badge', pendingMessage: 'ID upload and review will be available once verification is fully wired up.' },
  { key: 'business', label: 'Business verification', description: 'For dealers and shops selling regularly', pendingMessage: 'Business document review will be available once verification is fully wired up.' },
];

export default function Verification() {
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const authed = useRequireAuthScreen();
  const [done, setDone] = useState<Set<string>>(new Set(['google']));

  if (!authed) return <Screen />;

  const requestVerify = (tier: Tier) => {
    Alert.alert(tier.label, tier.pendingMessage, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Mark as submitted', onPress: () => setDone((prev) => new Set(prev).add(tier.key)) },
    ]);
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          Verification
        </Text>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name="checkmark-circle" size={22} color={colors.success} />
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <Text variant="bodyMedium">Google account</Text>
            <Text variant="caption" color="secondary">
              Verified automatically when you signed up
            </Text>
          </View>
        </Card>
        {TIERS.map((t) => {
          const isDone = done.has(t.key);
          return (
            <Card key={t.key} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name={isDone ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={isDone ? colors.success : colors.textMuted} />
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
                <Text variant="bodyMedium">{t.label}</Text>
                <Text variant="caption" color="secondary">
                  {isDone ? 'Submitted — pending review' : t.description}
                </Text>
              </View>
              {!isDone && <Button label="Verify" size="sm" variant="outline" onPress={() => requestVerify(t)} />}
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}
