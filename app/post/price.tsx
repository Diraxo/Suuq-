import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useListingsStore } from '@/store/listings';
import { cityCurrency } from '@/data/categories';
import { validatePrice } from '@/data/validation';
import { formatAmount } from '@/lib/currency';
import { usePostExitGuard } from '@/hooks/usePostExitGuard';

const NEGOTIABLE_OPTIONS = [
  { value: 'yes', labelKey: 'common.yes' },
  { value: 'no', labelKey: 'common.no' },
  { value: 'unsure', labelKey: 'post.price.notSure' },
] as const;

export default function Price() {
  const { colors, spacing } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { price, currency, negotiable, city, category, subcategory, setField } = usePostDraft();
  const [submitted, setSubmitted] = useState(false);
  const confirmLeave = usePostExitGuard('price');
  const listings = useListingsStore((s) => s.listings);
  const hasHydrated = useListingsStore((s) => s.hasHydrated);
  const loadListings = useListingsStore((s) => s.load);

  useEffect(() => {
    if (!hasHydrated) loadListings();
  }, [hasHydrated, loadListings]);

  // Currency is derived from the city chosen in the previous step — never a manual choice.
  useEffect(() => {
    const derived = city ? cityCurrency[city] ?? 'ETB' : 'ETB';
    if (derived !== currency) setField('currency', derived);
  }, [city]);

  const formattedPrice = price ? Number(price).toLocaleString('en-US') : '';

  // A listing only counts as a genuine comparable when it shares this draft's
  // exact category + subcategory (not just a similar price or title) and the
  // same currency, so the raw numbers stay meaningful — mixing USD and ETB
  // rows into one "range" would be nonsense even though both render as
  // "Birr". Real (Supabase) listings only, same convention as the listing
  // detail page's market estimate and the Compare screen (see
  // data/similarListings.ts) — the mock catalogue is permanent demo
  // inventory, not something a real seller could price against.
  const comparableListings = useMemo(
    () =>
      listings.filter(
        (l) => l.status === 'available' && l.category === category && l.subcategory === subcategory && l.currency === currency
      ),
    [listings, category, subcategory, currency]
  );

  const suggestedRange = useMemo(() => {
    if (comparableListings.length === 0) return null;
    const prices = comparableListings.map((l) => l.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return min === max ? formatAmount(min) : `${formatAmount(min)}–${formatAmount(max)}`;
  }, [comparableListings]);

  const priceError = validatePrice(price);
  const negotiableOptions = NEGOTIABLE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }));

  const handleContinue = () => {
    if (priceError) {
      setSubmitted(true);
      return;
    }
    router.push('/post/preview');
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <StepHeader step={5} totalSteps={6} title={t('post.price.title')} onClose={confirmLeave} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xl }}>
          <Input
            label={t('post.price.priceLabel')}
            boldLabel
            placeholder="0"
            value={formattedPrice}
            onChangeText={(v) => setField('price', v.replace(/[^0-9]/g, ''))}
            keyboardType="numeric"
            leftIcon={<Text variant="bodyMedium" color="secondary">Birr</Text>}
            error={submitted ? priceError : undefined}
          />

          {suggestedRange && (
            <Card elevated={false} style={{ marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
              <Text variant="caption" color="secondary" style={{ marginLeft: spacing.xxs, flex: 1 }}>
                {t('post.price.suggestionHint', { range: suggestedRange })}
              </Text>
            </Card>
          )}

          <View style={{ marginTop: spacing.md }}>
            <ChoiceChips
              label={t('post.price.negotiableLabel')}
              options={negotiableOptions.map((o) => o.label)}
              value={negotiableOptions.find((o) => o.value === negotiable)?.label}
              onChange={(label) => setField('negotiable', negotiableOptions.find((o) => o.label === label)!.value)}
            />
          </View>
        </ScrollView>

        <Button label={t('common.continue')} onPress={handleContinue} fullWidth size="lg" style={{ marginTop: spacing.sm }} />
      </KeyboardAvoidingView>
    </Screen>
  );
}
