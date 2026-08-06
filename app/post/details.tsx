import { useEffect, useRef, useState } from 'react';
import { View, Pressable, ScrollView, KeyboardAvoidingView, Platform, LayoutChangeEvent, Keyboard } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { StepHeader } from '@/components/StepHeader';
import { Text } from '@/components/Text';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { ChoiceChips } from '@/components/ChoiceChips';
import { DynamicField } from '@/components/DynamicField';
import { PhoneNumberInput } from '@/components/PhoneNumberInput';
import { useTheme } from '@/theme/ThemeContext';
import { usePostDraft } from '@/store/postDraft';
import { useAuthStore } from '@/store/auth';
import { getCategoryFields, getTitlePlaceholder } from '@/data/categoryFields';
import { getCategoryFeatures } from '@/data/categoryFeatures';
import { validateTitle, validateDescription, validatePhoneLocal, validateRequiredAttributes } from '@/data/validation';
import { usePostExitGuard } from '@/hooks/usePostExitGuard';

const CONDITIONS = [
  { value: 'new', label: 'New' },
  { value: 'like-new', label: 'Like New' },
  { value: 'used', label: 'Used' },
  { value: 'for-parts', label: 'Needs Repair' },
] as const;

export default function Details() {
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const {
    title,
    description,
    condition,
    phoneCountry,
    phoneLocal,
    category,
    subcategory,
    attributes,
    features,
    sellerNotes,
    setField,
    setAttribute,
    toggleFeature,
  } = usePostDraft();
  const savedPhone = useAuthStore((s) => s.profile?.phone);
  const [submitted, setSubmitted] = useState(false);
  const confirmLeave = usePostExitGuard('details');
  const scrollRef = useRef<ScrollView>(null);
  // y-offset of each validated field, relative to the scroll content — filled
  // in by each field's onLayout so an invalid Continue press can jump
  // straight to the first field that actually needs attention.
  const fieldY = useRef<Record<string, number>>({});
  const trackLayout = (key: string) => (e: LayoutChangeEvent) => {
    fieldY.current[key] = e.nativeEvent.layout.y;
  };

  // Keeps whichever field is currently focused visible above the keyboard.
  // Scrolls immediately on focus (covers tapping a new field while the
  // keyboard is already up) and again once the keyboard finishes animating
  // in (covers the first field focused, before the keyboard has a height).
  const focusedField = useRef<string | null>(null);
  const scrollToField = (key: string) => {
    const y = fieldY.current[key];
    if (y === undefined) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
  };
  const handleFieldFocus = (key: string) => () => {
    focusedField.current = key;
    scrollToField(key);
  };
  useEffect(() => {
    const event = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(event, () => {
      if (focusedField.current) scrollToField(focusedField.current);
    });
    return () => sub.remove();
  }, []);

  const extraFields = getCategoryFields(category, subcategory);
  const featureOptions = getCategoryFeatures(category, subcategory);
  const titlePlaceholder = getTitlePlaceholder(category, subcategory);
  // Once a phone is saved on the profile it's never collected again — see
  // app/post/preview.tsx, which writes a first-time phone to profiles.phone
  // on publish. Only validate the field while it's actually being shown.
  const needsPhone = !savedPhone;

  const titleError = validateTitle(title);
  const descriptionError = validateDescription(description);
  const phoneError = needsPhone ? validatePhoneLocal(phoneCountry, phoneLocal) : undefined;
  const attributeErrors = validateRequiredAttributes(extraFields, attributes);
  const conditionError = condition ? undefined : 'Select a condition.';

  const isValid = !titleError && !descriptionError && !phoneError && !conditionError && Object.keys(attributeErrors).length === 0;

  const handleContinue = () => {
    if (!isValid) {
      setSubmitted(true);
      // Jump straight to whichever field is actually invalid — with a
      // description, N category fields, and a phone block on this step, the
      // first error is very often below the fold.
      const ordered: [string, string | undefined][] = [
        ['title', titleError],
        ['description', descriptionError],
        ['condition', conditionError],
        ...extraFields.map((f): [string, string | undefined] => [f.key, attributeErrors[f.key]]),
        ['phone', phoneError],
      ];
      const firstInvalid = ordered.find(([, error]) => !!error)?.[0];
      if (firstInvalid && fieldY.current[firstInvalid] !== undefined) {
        scrollRef.current?.scrollTo({ y: Math.max(0, fieldY.current[firstInvalid] - 16), animated: true });
      }
      return;
    }
    router.push('/post/location');
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <StepHeader step={3} totalSteps={6} title="Describe your item" onClose={confirmLeave} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xl }}>
          <View style={{ gap: spacing.md }}>
            <View onLayout={trackLayout('title')}>
              <Input
                label={`${title ? '✓ ' : ''}Title`}
                boldLabel
                placeholder={titlePlaceholder}
                value={title}
                onChangeText={(v) => setField('title', v)}
                onFocus={handleFieldFocus('title')}
                error={submitted ? titleError : undefined}
              />
            </View>
            <View onLayout={trackLayout('description')}>
              <Input
                label={`${description ? '✓ ' : ''}Description`}
                boldLabel
                placeholder="Condition, reason for selling, anything a buyer should know..."
                value={description}
                onChangeText={(v) => setField('description', v)}
                onFocus={handleFieldFocus('description')}
                multiline
                numberOfLines={5}
                style={{ height: 110, textAlignVertical: 'top', paddingTop: spacing.xs }}
                error={submitted ? descriptionError : undefined}
              />
            </View>

            <View onLayout={trackLayout('condition')}>
              <ChoiceChips
                label="Condition"
                options={CONDITIONS.map((c) => c.label)}
                value={CONDITIONS.find((c) => c.value === condition)?.label}
                onChange={(label) => setField('condition', CONDITIONS.find((c) => c.label === label)!.value)}
                error={submitted ? conditionError : undefined}
              />
            </View>

            {extraFields.length > 0 && (
              <View style={{ gap: spacing.md }}>
                {extraFields.map((field) => (
                  <View key={field.key} onLayout={trackLayout(field.key)}>
                    <DynamicField
                      field={field}
                      value={attributes[field.key] ?? ''}
                      onChange={(v) => setAttribute(field.key, v)}
                      onFocus={handleFieldFocus(field.key)}
                      error={submitted ? attributeErrors[field.key] : undefined}
                    />
                  </View>
                ))}
              </View>
            )}

            {featureOptions.length > 0 && (
              <View>
                <Text variant="caption" color="secondary" style={{ marginBottom: spacing.xs, fontWeight: '700' }}>
                  Features (optional)
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                  {featureOptions.map((f) => {
                    const selected = features.includes(f);
                    return (
                      <Pressable
                        key={f}
                        onPress={() => toggleFeature(f)}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}
                      >
                        <FeatureChip label={f} selected={selected} />
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}

            <View onLayout={trackLayout('sellerNotes')}>
              <Input
                label="Seller notes (optional)"
                boldLabel
                placeholder={'One highlight per line, e.g.\nBattery health 90%\nOriginal charger included'}
                value={sellerNotes}
                onChangeText={(v) => setField('sellerNotes', v)}
                onFocus={handleFieldFocus('sellerNotes')}
                multiline
                numberOfLines={4}
                style={{ height: 90, textAlignVertical: 'top', paddingTop: spacing.xs }}
              />
            </View>

            <View onLayout={trackLayout('phone')}>
              {needsPhone ? (
                <PhoneNumberInput
                  country={phoneCountry}
                  local={phoneLocal}
                  onChangeCountry={(c) => setField('phoneCountry', c)}
                  onChangeLocal={(v) => setField('phoneLocal', v)}
                  onFocus={handleFieldFocus('phone')}
                  error={phoneLocal ? phoneError : undefined}
                />
              ) : (
                <View>
                  <Text variant="caption" color="secondary" style={{ marginBottom: spacing.xs, fontWeight: '700' }}>
                    Contact number
                  </Text>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: colors.inputBackground,
                      borderRadius: 10,
                      paddingHorizontal: spacing.sm,
                      minHeight: 50,
                    }}
                  >
                    <Text variant="body">{savedPhone}</Text>
                    <Pressable onPress={() => router.push('/settings/edit-profile' as any)} accessibilityRole="button" accessibilityLabel="Change your phone number">
                      <Text variant="caption" color="brand">
                        Change
                      </Text>
                    </Pressable>
                  </View>
                  <Text variant="tiny" color="muted" style={{ marginTop: spacing.xxs }}>
                    Buyers can call you using the number saved on your profile.
                  </Text>
                </View>
              )}
            </View>
          </View>
        </ScrollView>

        <Button label="Continue" onPress={handleContinue} fullWidth size="lg" style={{ marginTop: spacing.sm }} />
      </KeyboardAvoidingView>
    </Screen>
  );
}

// Small local helper so the feature checklist keeps its own checkmark-prefixed
// pill look without re-deriving colors/spacing at every call site.
function FeatureChip({ label, selected }: { label: string; selected: boolean }) {
  const { colors, spacing, radius } = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: spacing.sm,
        paddingVertical: 8,
        borderRadius: radius.pill,
        borderWidth: 1.5,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.primary + '0D' : colors.surface,
      }}
    >
      <Text variant="caption" color={selected ? 'brand' : 'secondary'}>
        {selected ? '✓ ' : ''}
        {label}
      </Text>
    </View>
  );
}
