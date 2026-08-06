import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { StepHeader } from '@/components/StepHeader';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';
import { regions } from '@/data/categories';
import { usePostDraft } from '@/store/postDraft';
import { validateCity } from '@/data/validation';
import { usePostExitGuard } from '@/hooks/usePostExitGuard';

export default function LocationStep() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const { city, setField } = usePostDraft();
  const [submitted, setSubmitted] = useState(false);
  const confirmLeave = usePostExitGuard('location');

  const cityError = validateCity(city);

  const handleContinue = () => {
    if (cityError) {
      setSubmitted(true);
      return;
    }
    router.push('/post/price');
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <StepHeader step={4} totalSteps={6} title="Where is this item?" onClose={confirmLeave} />
      <Text variant="caption" color="secondary" style={{ marginBottom: spacing.sm }}>
        Only your city is shown publicly. Your exact location is shared only once a chat starts.
      </Text>

      <FlatList
        data={regions}
        keyExtractor={(r) => r}
        contentContainerStyle={{ gap: spacing.xs }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => setField('city', item)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              padding: spacing.sm,
              borderRadius: radius.md,
              backgroundColor: city === item ? colors.primary + '0D' : colors.surface,
            }}
          >
            <Ionicons name="location-outline" size={18} color={colors.textSecondary} />
            <Text variant="body" style={{ marginLeft: spacing.xs, flex: 1 }}>
              {item}
            </Text>
            {city === item && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
          </Pressable>
        )}
      />

      {submitted && cityError && (
        <Text variant="caption" color="error" style={{ marginTop: spacing.xs }}>
          {cityError}
        </Text>
      )}

      <View style={{ flex: 1 }} />
      <Button label="Continue" onPress={handleContinue} fullWidth size="lg" />
    </Screen>
  );
}
