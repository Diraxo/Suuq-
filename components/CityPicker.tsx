import { useState } from 'react';
import { View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';
import { LocationList, PickedLocation } from './LocationList';
import { KeyboardSheet } from './KeyboardSheet';

type Props = {
  label?: string;
  value: string | undefined;
  onChange: (city: string, location?: PickedLocation) => void;
  error?: string;
};

// The one city picker, reused wherever a city is chosen (Edit Listing, Edit
// Profile). Options come from the admin-managed locations directory; a missing
// city can be requested from inside the sheet (see LocationList).
export function CityPicker({ label, value, onChange, error }: Props) {
  const { t } = useTranslation();
  const resolvedLabel = label ?? t('components.cityPicker.label');
  const { colors, spacing, radius } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <View style={{ width: '100%' }}>
      {resolvedLabel && (
        <Text variant="caption" color="secondary" style={{ marginBottom: spacing.xs }}>
          {resolvedLabel}
        </Text>
      )}
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t('components.cityPicker.a11yLabel', { label: resolvedLabel, value: value || t('components.cityPicker.notSet') })}
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
          {value || t('components.cityPicker.selectCity')}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>
      {error && (
        <Text variant="caption" color="error" style={{ marginTop: spacing.xxs }}>
          {error}
        </Text>
      )}

      <KeyboardSheet visible={open} onClose={() => setOpen(false)}>
        <Text variant="h3" style={{ marginBottom: spacing.sm }}>
          {t('components.cityPicker.selectCity')}
        </Text>
        <LocationList
          selected={value}
          onSelect={(loc) => {
            onChange(loc.name, loc);
            setOpen(false);
          }}
        />
      </KeyboardSheet>
    </View>
  );
}
