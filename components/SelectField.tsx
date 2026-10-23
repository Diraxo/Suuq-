import { useState } from 'react';
import { View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';
import { KeyboardSheet } from './KeyboardSheet';

type Option = { value: string; label: string };

type Props = {
  label?: string;
  placeholder: string;
  options: Option[];
  value?: string;
  onChange: (value: string) => void;
};

// A dropdown for a short fixed list (gender, ...): looks like the city picker, opens a bottom sheet with the choices.
export function SelectField({ label, placeholder, options, value, onChange }: Props) {
  const { colors, spacing, radius } = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <View style={{ width: '100%' }}>
      {label ? (
        <Text variant="caption" color="secondary" style={{ marginBottom: spacing.xs }}>
          {label}
        </Text>
      ) : null}
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label ?? placeholder}: ${selected?.label ?? placeholder}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: colors.inputBackground,
          borderRadius: radius.sm,
          paddingHorizontal: spacing.sm,
          minHeight: 50,
        }}
      >
        <Text variant="body" color={selected ? 'primary' : 'muted'}>
          {selected?.label ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>

      <KeyboardSheet visible={open} onClose={() => setOpen(false)}>
        <Text variant="h3" style={{ marginBottom: spacing.sm }}>
          {label ?? placeholder}
        </Text>
        {options.map((o) => (
          <Pressable
            key={o.value}
            onPress={() => {
              onChange(o.value);
              setOpen(false);
            }}
            accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm }}
          >
            <Text variant="body">{o.label}</Text>
            {o.value === value ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
          </Pressable>
        ))}
      </KeyboardSheet>
    </View>
  );
}
