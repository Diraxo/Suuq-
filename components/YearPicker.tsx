import { useRef, useState } from 'react';
import { View, Pressable, FlatList, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';

type Props = {
  label?: string;
  required?: boolean;
  value: string | undefined;
  onChange: (year: string) => void;
  error?: string;
};

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 45 }, (_, i) => String(CURRENT_YEAR - i));
const ROW_HEIGHT = 50;

// Scrollable year picker defaulting to the current year — used for any
// category field that asks "what year" (vehicle model year, year built, ...)
// instead of free-typed text.
export function YearPicker({ label, required, value, onChange, error }: Props) {
  const { t } = useTranslation();
  const resolvedLabel = label ?? t('components.yearPicker.label');
  const { colors, spacing, radius } = useTheme();
  const [open, setOpen] = useState(false);
  const listRef = useRef<FlatList<string>>(null);

  const openPicker = () => {
    setOpen(true);
    const target = value ?? String(CURRENT_YEAR);
    const index = YEARS.indexOf(target);
    requestAnimationFrame(() => {
      if (index >= 0) listRef.current?.scrollToOffset({ offset: index * ROW_HEIGHT, animated: false });
    });
  };

  return (
    <View style={{ width: '100%' }}>
      {resolvedLabel && (
        <Text variant="caption" color="secondary" style={{ marginBottom: spacing.xs }}>
          {value ? '✓ ' : ''}
          {required ? `${resolvedLabel} *` : resolvedLabel}
        </Text>
      )}
      <Pressable
        onPress={openPicker}
        accessibilityRole="button"
        accessibilityLabel={t('components.yearPicker.a11yLabel', { label: resolvedLabel, value: value || t('components.cityPicker.notSet') })}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: colors.inputBackground,
          borderRadius: radius.sm,
          borderWidth: 1.5,
          borderColor: error ? colors.error : 'transparent',
          paddingHorizontal: spacing.sm,
          minHeight: 50,
        }}
      >
        <Text variant="body" color={value ? 'primary' : 'muted'}>
          {value || t('components.yearPicker.example', { year: CURRENT_YEAR })}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>
      {error && (
        <Text variant="caption" color="error" style={{ marginTop: spacing.xxs }}>
          {error}
        </Text>
      )}

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }} onPress={() => setOpen(false)} accessibilityLabel={t('common.close')} accessibilityRole="button">
          <Pressable
            style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '60%', padding: spacing.md }}
            onPress={(e) => e.stopPropagation()}
          >
            <Text variant="h3" style={{ marginBottom: spacing.sm }}>
              {t('components.yearPicker.selectYear')}
            </Text>
            <FlatList
              ref={listRef}
              data={YEARS}
              keyExtractor={(y) => y}
              getItemLayout={(_, i) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * i, index: i })}
              contentContainerStyle={{ paddingBottom: spacing.md }}
              renderItem={({ item }) => {
                const isSelected = value === item;
                return (
                  <Pressable
                    onPress={() => {
                      onChange(item);
                      setOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={item}
                    style={{
                      height: ROW_HEIGHT,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingHorizontal: spacing.md,
                    }}
                  >
                    <Text variant="bodyMedium" color={isSelected ? 'brand' : 'primary'}>
                      {item}
                    </Text>
                    {isSelected && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
