import { View, Pressable } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';

type Props = {
  label?: string;
  required?: boolean;
  options: string[];
  /** Shown on the chip instead of the option itself (translations) — the value passed to onChange is always the raw option. */
  optionLabel?: (option: string) => string;
  value?: string;
  onChange: (value: string) => void;
  error?: string;
};

// The single "row of pills" single-select control, reused everywhere a
// category field or top-level choice (condition, negotiable, ...) offers a
// fixed list of options — replaces the same block that used to be hand-rolled
// inline in details.tsx, price.tsx, and category attribute rendering.
export function ChoiceChips({ label, required, options, optionLabel, value, onChange, error }: Props) {
  const { colors, spacing, radius } = useTheme();
  const filled = !!value;

  return (
    <View>
      {label && (
        <Text variant="caption" color="secondary" style={{ marginBottom: spacing.xs, fontWeight: '700' }}>
          {filled ? '✓ ' : ''}
          {required ? `${label} *` : label}
        </Text>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {options.map((opt) => {
          const selected = value === opt;
          return (
            <Pressable
              key={opt}
              onPress={() => onChange(opt)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
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
                {optionLabel ? optionLabel(opt) : opt}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error && (
        <Text variant="caption" color="error" style={{ marginTop: spacing.xxs }}>
          {error}
        </Text>
      )}
    </View>
  );
}
