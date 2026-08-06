import { useState } from 'react';
import { View, Pressable, FlatList, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';
import { Badge } from './Badge';
import { regions, featuredCities } from '@/data/categories';

type Props = {
  label?: string;
  value: string | undefined;
  onChange: (city: string) => void;
  error?: string;
};

// The one supported-cities picker, reused everywhere a city is chosen
// (onboarding's select-region, Sell's location step, and Edit Listing) so the
// database only ever receives one of the fixed cities in data/categories.ts —
// never free-typed text.
export function CityPicker({ label = 'City', value, onChange, error }: Props) {
  const { colors, spacing, radius } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <View style={{ width: '100%' }}>
      {label && (
        <Text variant="caption" color="secondary" style={{ marginBottom: spacing.xs }}>
          {label}
        </Text>
      )}
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || 'not set'}. Tap to change.`}
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
          {value || 'Select a city'}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>
      {error && (
        <Text variant="caption" color="error" style={{ marginTop: spacing.xxs }}>
          {error}
        </Text>
      )}

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }} onPress={() => setOpen(false)} accessibilityLabel="Close" accessibilityRole="button">
          <Pressable
            style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '70%', padding: spacing.md }}
            onPress={(e) => e.stopPropagation()}
          >
            <Text variant="h3" style={{ marginBottom: spacing.sm }}>
              Select a city
            </Text>
            <FlatList
              data={regions}
              keyExtractor={(item) => item}
              contentContainerStyle={{ gap: spacing.xs, paddingBottom: spacing.md }}
              renderItem={({ item }) => {
                const isSelected = value === item;
                const isFeatured = featuredCities.includes(item);
                return (
                  <Pressable
                    onPress={() => {
                      onChange(item);
                      setOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={item}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: spacing.md,
                      borderRadius: radius.md,
                      borderWidth: 1.5,
                      borderColor: isSelected ? colors.primary : colors.border,
                      backgroundColor: isSelected ? colors.primary + '0D' : colors.surface,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                      <Text variant="bodyMedium">{item}</Text>
                      {isFeatured && <Badge label="Launch city" tone="brand" />}
                    </View>
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
