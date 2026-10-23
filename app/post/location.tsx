import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { StepHeader } from '@/components/StepHeader';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';
import { LocationList } from '@/components/LocationList';
import { usePostDraft } from '@/store/postDraft';
import { validateCity } from '@/data/validation';
import { usePostExitGuard } from '@/hooks/usePostExitGuard';
import { localizeSellError } from '@/lib/sellText';

export default function LocationStep() {
  const { spacing } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { city, setField } = usePostDraft();
  const [submitted, setSubmitted] = useState(false);
  const [pendingName, setPendingName] = useState<string | undefined>();
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
      <StepHeader step={4} totalSteps={6} title={t('post.location.title')} onClose={confirmLeave} />
      <Text variant="caption" color="secondary" style={{ marginBottom: spacing.sm }}>
        {t('post.location.subtitle')}
      </Text>

      <View style={{ flex: 1 }}>
      <LocationList
        selected={city}
        onSelect={(loc) => {
          setField('city', loc.name);
          setPendingName(loc.pending ? loc.name : undefined);
          setField('region', loc.regionLabel);
          setField('currencyOptions', loc.currencies);
          setField('currency', loc.defaultCurrency);
        }}
      />
      </View>

      {city && city === pendingName && (
        <Text variant="caption" color="secondary" style={{ marginTop: spacing.xs }}>
          {t('components.locationList.pendingNote')}
        </Text>
      )}

      {submitted && cityError && (
        <Text variant="caption" color="error" style={{ marginTop: spacing.xs }}>
          {localizeSellError(t, cityError)}
        </Text>
      )}

      <Button label={t('common.continue')} onPress={handleContinue} fullWidth size="lg" />
    </Screen>
  );
}
