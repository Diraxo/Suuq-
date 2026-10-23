import { useEffect, useState } from 'react';
import { Modal, View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useTheme } from '@/theme/ThemeContext';
import { formatBirr } from '@/lib/currency';

type Props = {
  visible: boolean;
  currentPrice: number;
  currency?: string;
  loading: boolean;
  onCancel: () => void;
  onConfirm: (newPrice: number) => void;
};

// Suggested starting value only — the seller must explicitly confirm (or
// change) it before anything is written. Never mutate price on a single tap.
const SUGGESTED_DROP_RATIO = 0.9;

export function PriceDropModal({ visible, currentPrice, currency, loading, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const { colors, spacing, radius, shadow } = useTheme();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (visible) {
      setValue(String(Math.max(1, Math.round(currentPrice * SUGGESTED_DROP_RATIO))));
      setError(undefined);
    }
  }, [visible, currentPrice]);

  const handleConfirm = () => {
    const newPrice = Number(value.replace(/[^0-9.]/g, ''));
    if (!value.trim() || Number.isNaN(newPrice) || newPrice <= 0) {
      setError(t('components.priceDropConfirm.invalidPrice'));
      return;
    }
    if (newPrice >= currentPrice) {
      setError(t('components.priceDropConfirm.mustBeLower'));
      return;
    }
    onConfirm(newPrice);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={loading ? undefined : onCancel}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay, padding: spacing.xl }}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={loading ? undefined : onCancel}
          accessibilityRole="button"
          accessibilityLabel={t('components.priceDropConfirm.dismiss')}
        />
        <View
          style={[
            {
              width: '100%',
              maxWidth: 340,
              backgroundColor: colors.surfaceElevated,
              borderRadius: radius.lg,
              padding: spacing.lg,
              alignItems: 'center',
            },
            shadow.md,
          ]}
        >
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: colors.background,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: spacing.md,
            }}
          >
            <Ionicons name="trending-down-outline" size={24} color={colors.primary} />
          </View>

          <Text variant="h3" align="center">
            {t('components.priceDropConfirm.title')}
          </Text>
          <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xxs }}>
            {t('components.priceDropConfirm.currentPrice', { price: formatBirr(currentPrice, currency) })}
          </Text>

          <View style={{ alignSelf: 'stretch', marginTop: spacing.md }}>
            <Input
              label={t('components.priceDropConfirm.newPriceLabel')}
              value={value}
              onChangeText={(text) => {
                setValue(text);
                if (error) setError(undefined);
              }}
              keyboardType="numeric"
              error={error}
              editable={!loading}
              accessibilityLabel={t('components.priceDropConfirm.newPriceLabel')}
            />
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, alignSelf: 'stretch' }}>
            <Button label={t('common.cancel')} variant="outline" onPress={onCancel} disabled={loading} style={{ flex: 1 }} />
            <Button label={t('components.priceDropConfirm.confirm')} variant="primary" onPress={handleConfirm} loading={loading} disabled={loading} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
