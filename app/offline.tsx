import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';

export default function Offline() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const router = useRouter();

  return (
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl }}>
        <Ionicons name="cloud-offline-outline" size={56} color={colors.textMuted} />
        <Text variant="h2" align="center" style={{ marginTop: spacing.md }}>
          {t('offline.title')}
        </Text>
        <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xxs, marginBottom: spacing.lg }}>
          {t('offline.message')}
        </Text>
        <Button label={t('common.retry')} onPress={() => router.replace('/(tabs)/home')} />
      </View>
    </Screen>
  );
}
