import { useEffect, useMemo, useState } from 'react';
import { Modal, View, Pressable, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useTheme } from '@/theme/ThemeContext';
import { formatBirr } from '@/lib/currency';
import type { Listing } from '@/types';
import {
  DISCOUNT_DAYS,
  DISCOUNT_MAX_DAYS,
  DISCOUNT_NOTE_MAX_LENGTH,
  activeDiscount,
  discountEndsAtFor,
  discountEndsText,
  formatDiscountInstant,
  parseCustomDays,
  percentFromPrice,
  priceFromPercent,
  validateDiscountInput,
  type DiscountDuration,
} from '@/lib/discount';

type Props = {
  visible: boolean;
  /** The listing being discounted. While it already has a running discount the modal shows that discount and "End discount". */
  listing: Listing | null;
  loading: boolean;
  /** Already translated explanation of why the last attempt failed (from the database or the pre-check). */
  error?: string;
  onCancel: () => void;
  /** `replace` is true when the seller edits a running discount. */
  onStart: (newPrice: number, days: DiscountDuration, note: string, replace?: boolean) => void;
  onEnd: () => void;
};

// Only used for the greyed example in the empty boxes; the boxes themselves start empty.
const EXAMPLE_PERCENT = 10;
const DAY_MS = 86_400_000;

const digits = (s: string) => s.replace(/[^0-9]/g, '');

// A percent such as 12.5 reads "12.5", 10 reads "10".
const percentText = (p: number) => String(Math.round(p * 10) / 10);

export function DiscountModal({ visible, listing, loading, error, onCancel, onStart, onEnd }: Props) {
  const { t, i18n } = useTranslation();
  const { colors, spacing, radius, shadow, isDark } = useTheme();
  const running = useMemo(() => (listing ? activeDiscount(listing) : null), [listing]);
  // Editing a running discount is measured against the ORIGINAL price (the shown price is already reduced).
  const original = running?.originalPrice ?? listing?.price ?? 0;
  const [editing, setEditing] = useState(false);
  const [percent, setPercent] = useState('');
  const [price, setPrice] = useState('');
  // A preset (3/7/14/30), 'custom' (the days box) or 'forever' (until the seller ends it).
  const [choice, setChoice] = useState<number | 'custom' | 'forever'>(7);
  const [customDays, setCustomDays] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [note, setNote] = useState('');
  const [localError, setLocalError] = useState<string | undefined>();

  useEffect(() => {
    if (!visible) return;
    setEditing(false);
    setPercent('');
    setPrice('');
    setChoice(7);
    setCustomDays('');
    setMenuOpen(false);
    setNote('');
    setLocalError(undefined);
  }, [visible, original]);

  const beginEdit = () => {
    if (!running || !listing) return;
    setPercent(String(running.percent));
    setPrice(String(listing.price));
    setChoice(running.permanent ? 'forever' : 'custom');
    setCustomDays(running.endsAt != null ? String(Math.min(DISCOUNT_MAX_DAYS, Math.max(1, Math.ceil((running.endsAt - Date.now()) / DAY_MS)))) : '');
    setNote(running.note ?? '');
    setMenuOpen(false);
    setLocalError(undefined);
    setEditing(true);
  };

  const onPercentChange = (text: string) => {
    const d = digits(text);
    setPercent(d);
    setLocalError(undefined);
    const p = Number(d);
    setPrice(d && p > 0 && p < 100 ? String(priceFromPercent(original, p)) : '');
  };
  const onPriceChange = (text: string) => {
    const d = digits(text);
    setPrice(d);
    setLocalError(undefined);
    const n = Number(d);
    setPercent(d && n > 0 ? percentText(percentFromPrice(original, n)) : '');
  };

  const newPrice = Number(price);
  const pct = percentFromPrice(original, newPrice);
  const examplePrice = String(priceFromPercent(original, EXAMPLE_PERCENT));
  const preview = price && newPrice > 0 && newPrice < original ? t('discount.preview', { percent: percentText(pct), amount: formatBirr(original - newPrice, listing?.currency) }) : undefined;

  // NaN (an empty or invalid custom box) is refused by validateDiscountInput as a duration error.
  const duration: DiscountDuration = choice === 'forever' ? 'forever' : choice === 'custom' ? (parseCustomDays(customDays) ?? Number.NaN) : choice;
  const endLine = duration === 'forever'
    ? t('discount.foreverNote')
    : Number.isFinite(duration)
      ? t('discount.willEnd', { date: formatDiscountInstant(discountEndsAtFor(duration), i18n.language) })
      : undefined;

  const handleStart = () => {
    const problem = validateDiscountInput({ original, price: newPrice, days: duration, note });
    if (problem) {
      setLocalError(t(`discount.errors.${!price ? 'enterDiscount' : problem === 'invalid' ? 'invalid' : problem}`, { max: DISCOUNT_NOTE_MAX_LENGTH }));
      return;
    }
    onStart(newPrice, duration, note.trim(), editing);
  };

  const endsText = running ? discountEndsText(running, t) : undefined;
  const shownError = localError ?? error;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={loading ? undefined : onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay, padding: spacing.xl }}>
          <Pressable style={StyleSheet.absoluteFill} onPress={loading ? undefined : onCancel} accessibilityRole="button" accessibilityLabel={t('common.close')} />
          <View
            style={[{ width: '100%', maxWidth: 360, maxHeight: '90%', backgroundColor: colors.surfaceElevated, borderRadius: radius.lg, padding: spacing.lg }, shadow.md]}
          >
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ alignItems: 'center' }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md }}>
                <Ionicons name="pricetag-outline" size={24} color={colors.primary} />
              </View>

              {running && listing && !editing ? (
                <>
                  <Text variant="h3" align="center">
                    {t('discount.runningTitle')}
                  </Text>
                  <Text variant="body" align="center" style={{ marginTop: spacing.sm }}>
                    {t('discount.runningSummary', {
                      percent: running.percent,
                      original: formatBirr(running.originalPrice, listing.currency),
                      price: formatBirr(listing.price, listing.currency),
                    })}
                  </Text>
                  {endsText && (
                    <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xxs }}>
                      {endsText}
                    </Text>
                  )}
                  {running.note ? (
                    <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xxs }}>
                      {running.note}
                    </Text>
                  ) : null}
                  {shownError ? (
                    <Text variant="caption" style={{ color: colors.error, marginTop: spacing.sm }} align="center">
                      {shownError}
                    </Text>
                  ) : null}
                  <Button label={t('discount.edit')} variant="primary" onPress={beginEdit} disabled={loading} style={{ alignSelf: 'stretch', marginTop: spacing.lg }} />
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignSelf: 'stretch' }}>
                    <Button label={t('common.close')} variant="outline" onPress={onCancel} disabled={loading} style={{ flex: 1 }} />
                    <Button label={t('discount.end')} variant="outline" onPress={onEnd} loading={loading} disabled={loading} style={{ flex: 1 }} />
                  </View>
                </>
              ) : (
                <>
                  <Text variant="h3" align="center">
                    {editing ? t('discount.editTitle') : t('discount.title')}
                  </Text>
                  <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xxs }}>
                    {t('discount.currentPrice', { price: formatBirr(original, listing?.currency) })}
                  </Text>

                  <View style={{ alignSelf: 'stretch', marginTop: spacing.md, gap: spacing.sm }}>
                    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                      <View style={{ flex: 1 }}>
                        <Input label={t('discount.percentLabel')} placeholder={t('discount.percentPlaceholder')} value={percent} onChangeText={onPercentChange} keyboardType="numeric" editable={!loading} accessibilityLabel={t('discount.percentLabel')} />
                      </View>
                      <View style={{ flex: 1.4 }}>
                        <Input label={t('discount.newPriceLabel')} placeholder={t('discount.newPricePlaceholder', { price: examplePrice })} value={price} onChangeText={onPriceChange} keyboardType="numeric" editable={!loading} accessibilityLabel={t('discount.newPriceLabel')} />
                      </View>
                    </View>
                    {preview ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: isDark ? '#34D3991A' : '#16A34A14', borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 8 }}>
                        <Text variant="caption" style={{ color: isDark ? '#34D399' : '#15803D', fontWeight: '700', flexShrink: 1 }}>
                          {preview}
                        </Text>
                      </View>
                    ) : null}

                    <Text variant="caption" color="secondary">
                      {t('discount.durationLabel')}
                    </Text>
                    {/* One way to set the length: pick from the list OR type a number of days. Picking clears the box; typing clears the pick. */}
                    <Pressable
                      onPress={() => setMenuOpen((o) => !o)}
                      disabled={loading}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: menuOpen }}
                      accessibilityLabel={t('discount.durationLabel')}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingHorizontal: spacing.md,
                        paddingVertical: 12,
                        borderRadius: radius.md,
                        borderWidth: 1.5,
                        borderColor: menuOpen ? colors.primary : colors.border,
                        backgroundColor: colors.surface,
                      }}
                    >
                      <Text variant="body" color={choice === 'custom' ? 'secondary' : 'primary'}>
                        {choice === 'custom' ? t('discount.chooseDuration') : choice === 'forever' ? t('discount.forever') : t('discount.days', { count: choice })}
                      </Text>
                      <Ionicons name={menuOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
                    </Pressable>
                    {menuOpen && (
                      <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' }}>
                        {[...DISCOUNT_DAYS, 'forever' as const].map((d) => {
                          const selected = choice === d;
                          return (
                            <Pressable
                              key={d}
                              onPress={() => { setChoice(d); setCustomDays(''); setMenuOpen(false); setLocalError(undefined); }}
                              accessibilityRole="button"
                              accessibilityState={{ selected }}
                              style={{ paddingHorizontal: spacing.md, paddingVertical: 12, backgroundColor: selected ? colors.primary + '0D' : 'transparent', flexDirection: 'row', justifyContent: 'space-between' }}
                            >
                              <Text variant="body" color={selected ? 'brand' : 'primary'}>
                                {d === 'forever' ? t('discount.forever') : t('discount.days', { count: d })}
                              </Text>
                              {selected && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                    <Input
                      label={t('discount.customDaysLabel')}
                      value={customDays}
                      onChangeText={(text) => {
                        const d = digits(text).slice(0, 3);
                        setCustomDays(d);
                        setMenuOpen(false);
                        // Typing replaces the list pick; emptying the box returns to the default pick.
                        setChoice(d ? 'custom' : 7);
                        setLocalError(undefined);
                      }}
                      keyboardType="number-pad"
                      placeholder={t('discount.customDaysPlaceholder', { max: DISCOUNT_MAX_DAYS })}
                      editable={!loading}
                      accessibilityLabel={t('discount.customDaysLabel')}
                    />
                    {endLine ? (
                      <Text variant="caption" color="secondary">
                        {endLine}
                      </Text>
                    ) : null}

                    <Input
                      label={t('discount.noteLabel')}
                      value={note}
                      onChangeText={(text) => {
                        setNote(text.replace(/[\r\n]+/g, ' '));
                        setLocalError(undefined);
                      }}
                      placeholder={t('discount.notePlaceholder')}
                      maxLength={DISCOUNT_NOTE_MAX_LENGTH}
                      counter={{ current: note.length, max: DISCOUNT_NOTE_MAX_LENGTH }}
                      editable={!loading}
                      accessibilityLabel={t('discount.noteLabel')}
                    />
                    {shownError ? (
                      <Text variant="caption" style={{ color: colors.error }}>
                        {shownError}
                      </Text>
                    ) : null}
                  </View>

                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, alignSelf: 'stretch' }}>
                    <Button label={t('common.cancel')} variant="outline" onPress={editing ? () => { setEditing(false); setLocalError(undefined); } : onCancel} disabled={loading} style={{ flex: 1 }} />
                    <Button label={editing ? t('discount.save') : t('discount.start')} variant="primary" onPress={handleStart} loading={loading} disabled={loading} style={{ flex: 1 }} />
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
