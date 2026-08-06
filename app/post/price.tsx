import { useEffect, useState } from 'react';
import { View, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { StepHeader } from '@/components/StepHeader';
import { Text } from '@/components/Text';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ChoiceChips } from '@/components/ChoiceChips';
import { useTheme } from '@/theme/ThemeContext';
import { usePostDraft } from '@/store/postDraft';
import { cityCurrency } from '@/data/categories';
import { validatePrice } from '@/data/validation';
import { usePostExitGuard } from '@/hooks/usePostExitGuard';

// Mock smart-pricing ranges — will call the AI pricing service once the backend exists.
// Keyed by currency so the suggestion always matches the listing's own currency.
const SUGGESTED_RANGE: Record<string, string> = {
  USD: '420–480',
  ETB: '23,000–26,000',
};

const NEGOTIABLE_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unsure', label: 'Not sure' },
] as const;

export default function Price() {
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const { price, currency, negotiable, city, setField } = usePostDraft();
  const [submitted, setSubmitted] = useState(false);
  const confirmLeave = usePostExitGuard('price');

  // Currency is derived from the city chosen in the previous step — never a manual choice.
  useEffect(() => {
    const derived = city ? cityCurrency[city] ?? 'ETB' : 'ETB';
    if (derived !== currency) setField('currency', derived);
  }, [city]);

  const formattedPrice = price ? Number(price).toLocaleString('en-US') : '';
  const suggestedRange = SUGGESTED_RANGE[currency] ?? SUGGESTED_RANGE.USD;
  const priceError = validatePrice(price);

  const handleContinue = () => {
    if (priceError) {
      setSubmitted(true);
      return;
    }
    router.push('/post/preview');
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <StepHeader step={5} totalSteps={6} title="Set your price" onClose={confirmLeave} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xl }}>
          <Input
            label="Price"
            boldLabel
            placeholder="0"
            value={formattedPrice}
            onChangeText={(v) => setField('price', v.replace(/[^0-9]/g, ''))}
            keyboardType="numeric"
            leftIcon={<Text variant="bodyMedium" color="secondary">Birr</Text>}
            error={submitted ? priceError : undefined}
          />

          <Card elevated={false} style={{ marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
            <Text variant="caption" color="secondary" style={{ marginLeft: spacing.xxs, flex: 1 }}>
              Similar listings nearby are priced {suggestedRange} Birr — a competitive price gets more replies.
            </Text>
          </Card>

          <View style={{ marginTop: spacing.md }}>
            <ChoiceChips
              label="Is the price negotiable?"
              options={NEGOTIABLE_OPTIONS.map((o) => o.label)}
              value={NEGOTIABLE_OPTIONS.find((o) => o.value === negotiable)?.label}
              onChange={(label) => setField('negotiable', NEGOTIABLE_OPTIONS.find((o) => o.label === label)!.value)}
            />
          </View>
        </ScrollView>

        <Button label="Continue" onPress={handleContinue} fullWidth size="lg" style={{ marginTop: spacing.sm }} />
      </KeyboardAvoidingView>
    </Screen>
  );
}
