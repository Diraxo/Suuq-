import { useState } from 'react';
import { View, Pressable, TextInput, Modal, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';
import { phoneCountries, getPhoneCountry, PhoneCountryCode } from '@/data/phoneCountries';

type Props = {
  label?: string;
  country: PhoneCountryCode;
  local: string;
  onChangeCountry: (code: PhoneCountryCode) => void;
  onChangeLocal: (local: string) => void;
  error?: string;
  onFocus?: () => void;
};

// Country selector + dial-code prefix + numeric-only local number, with the
// validation checkmark at the end of the field (not the start) — replaces
// the old single free-text phone Input.
export function PhoneNumberInput({ label = 'Phone number', country, local, onChangeCountry, onChangeLocal, error, onFocus }: Props) {
  const { colors, spacing, radius, type } = useTheme();
  const [focused, setFocused] = useState(false);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const active = getPhoneCountry(country);
  const isValid = !!local && !error;

  return (
    <View style={{ width: '100%' }}>
      {label && (
        <Text variant="caption" color="secondary" style={{ marginBottom: spacing.xs, fontWeight: '700' }}>
          {isValid ? '✓ ' : ''}
          {label}
        </Text>
      )}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.inputBackground,
          borderRadius: radius.sm,
          borderWidth: 1.5,
          borderColor: error ? colors.error : focused ? colors.primary : 'transparent',
          paddingHorizontal: spacing.sm,
          minHeight: 50,
        }}
      >
        <Pressable
          onPress={() => setCountryPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Country: ${active.name}. Tap to change.`}
          style={{ flexDirection: 'row', alignItems: 'center', paddingRight: spacing.xs, borderRightWidth: 1, borderRightColor: colors.border, marginRight: spacing.xs }}
        >
          <Text variant="body">{active.flag}</Text>
          <Text variant="body" color="secondary" style={{ marginLeft: 4, marginRight: 2 }}>
            {active.dial}
          </Text>
          <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
        </Pressable>
        <TextInput
          value={local}
          onChangeText={(v) => onChangeLocal(v.replace(/[^0-9]/g, ''))}
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onBlur={() => setFocused(false)}
          placeholder={active.placeholder}
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          maxLength={active.localLength[1]}
          style={{ flex: 1, color: colors.textPrimary, fontSize: type.body.size }}
        />
        {isValid && <Ionicons name="checkmark-circle" size={20} color={colors.success} />}
      </View>
      {error && (
        <Text variant="caption" color="error" style={{ marginTop: spacing.xxs }}>
          {error}
        </Text>
      )}

      <Modal visible={countryPickerOpen} animationType="fade" transparent onRequestClose={() => setCountryPickerOpen(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.lg }}
          onPress={() => setCountryPickerOpen(false)}
          accessibilityLabel="Close"
          accessibilityRole="button"
        >
          <Pressable style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.md }} onPress={(e) => e.stopPropagation()}>
            <Text variant="h3" style={{ marginBottom: spacing.sm }}>
              Select country
            </Text>
            <FlatList
              data={phoneCountries}
              keyExtractor={(c) => c.code}
              renderItem={({ item }) => {
                const isSelected = item.code === country;
                return (
                  <Pressable
                    onPress={() => {
                      onChangeCountry(item.code);
                      setCountryPickerOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={item.name}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: spacing.sm,
                      borderRadius: radius.md,
                      backgroundColor: isSelected ? colors.primary + '0D' : 'transparent',
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                      <Text variant="body">{item.flag}</Text>
                      <Text variant="bodyMedium">{item.name}</Text>
                      <Text variant="caption" color="secondary">
                        {item.dial}
                      </Text>
                    </View>
                    {isSelected && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
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
