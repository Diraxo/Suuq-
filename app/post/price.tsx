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
import { useResource } from '@/hooks/useResource';
import { fetchComparableListings } from '@/lib/listingsApi';
import { currenciesForPlace } from '@/store/locations';
import { validatePrice, validateCurrency, validateAttributes } from '@/data/sellRules';
import { getCategoryFields, visibleFields, priceStepFields } from '@/data/categoryFields';
import { DynamicField } from '@/components/DynamicField';
import { amountInputToDigits, formatAmountInput, hasComparablePrice, isContactPrice } from '@/data/serviceConfig';
import { priceUnitText } from '@/lib/sellText';
import { formatAmount, currencyLabel } from '@/lib/currency';
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
  const { price, currency, currencyOptions, negotiable, city, category, subcategory, attributes, setField, setAttribute } = usePostDraft();
  const [submitted, setSubmitted] = useState(false);
  const [priceTouched, setPriceTouched] = useState(false);
  const confirmLeave = usePostExitGuard('price');
  // One same-category/subcategory sample from the server for the suggestion below (the optional hint just stays hidden if it fails).
  const sample = useResource(category && subcategory ? `${category}|${subcategory}` : null, () => fetchComparableListings({ category: category!, subcategory }));

  // The currencies on offer come from the place chosen in the previous step
  // (set on the draft then; looked up again for drafts saved before that).
  // The seller picks one; the first is pre-selected when none is valid.
  const options = currencyOptions?.length ? currencyOptions : currenciesForPlace(city, currency).currencies;
  useEffect(() => {
    if (options.length && !options.includes(currency)) setField('currency', options[0]);
  }, [city]);

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
      (sample.data ?? []).filter(
        (l) => l.status === 'available' && l.category === category && l.subcategory === subcategory && l.currency === currency && hasComparablePrice(l)
      ),
    [sample.data, category, subcategory, currency]
  );

  const suggestedRange = useMemo(() => {
    if (comparableListings.length === 0) return null;
    const prices = comparableListings.map((l) => l.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return `${min === max ? formatAmount(min) : `${formatAmount(min)}–${formatAmount(max)}`} ${currencyLabel(currency)}`;
  }, [comparableListings, currency]);

  // A service says how it is charged (per hour, per job, ...) beside the amount; "Contact for price" has no amount at all.
  const allFields = getCategoryFields(category, subcategory);
  const pricingFields = visibleFields(priceStepFields(allFields), attributes);
  const pricingKeys = new Set(priceStepFields(allFields).map((f) => f.key));
  const pricingErrors = Object.fromEntries(Object.entries(validateAttributes(allFields, attributes, new Date(), true)).filter(([key]) => pricingKeys.has(key)));
  const contact = allFields.some((f) => f.key === 'priceMode') && isContactPrice(category, attributes);
  // Amounts of a service are shown with thousands separators as they are typed; what is kept (and published) is plain digits.
  const grouped = true;
  const unitText = priceUnitText(t, category, attributes);
  const priceError = contact ? undefined : validatePrice(price);
  const currencyError = contact ? undefined : validateCurrency(currency, options);
  const negotiableOptions = NEGOTIABLE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }));

  const handleContinue = () => {
    if (priceError || currencyError || Object.keys(pricingErrors).length > 0) {
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
          {options.length > 1 && (
            <View style={{ marginBottom: spacing.md }}>
              <ChoiceChips
                label={t('post.price.currencyLabel')}
                options={options.map(currencyLabel)}
                value={currencyLabel(currency)}
                onChange={(label) => setField('currency', options.find((c) => currencyLabel(c) === label) ?? options[0])}
              />
            </View>
          )}
          {pricingFields.length > 0 && (
            <View style={{ marginBottom: spacing.md, gap: spacing.md }}>
              {pricingFields.map((field) => (
                <DynamicField
                  key={field.key}
                  field={field}
                  value={attributes[field.key] ?? ''}
                  isNew
                  onChange={(v) => setAttribute(field.key, v)}
                  error={submitted ? pricingErrors[field.key] : undefined}
                />
              ))}
            </View>
          )}
          {contact ? (
            <Text variant="caption" color="secondary">
              {t('post.price.contactHint', { defaultValue: 'Buyers will see "Contact for price" and can message or call you to ask.' })}
            </Text>
          ) : (
          <Input
            label={t('post.price.priceLabel')}
            boldLabel
            placeholder="0"
            // The typed text is kept exactly as entered and validated as-is —
            // nothing is stripped or rewritten behind the seller's back. The
            // hint below echoes how the amount will be shown to buyers.
            value={grouped ? formatAmountInput(price) : price}
            onChangeText={(v) => setField('price', grouped ? amountInputToDigits(v) : v)}
            onBlur={() => setPriceTouched(true)}
            keyboardType="number-pad"
            rightIcon={<Text variant="bodyMedium" color="secondary">{currencyLabel(currency)}</Text>}
            error={submitted || priceTouched ? priceError ?? currencyError : undefined}
            hint={price && !priceError ? `${formatAmount(Number(price))} ${currencyLabel(currency)}${unitText ? ` · ${unitText}` : ''}` : grouped ? t('post.price.priceHintGrouped', { defaultValue: 'Whole numbers only. Commas are added for you.' }) : t('post.price.priceHint', { defaultValue: 'Whole numbers only — no commas, spaces or symbols.' })}
          />
          )}

          {suggestedRange && !contact && (
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
