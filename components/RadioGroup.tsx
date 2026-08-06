import { View, Pressable } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';

type RadioOption<T> = {
  value: T;
  label: string;
};

type Props<T> = {
  label?: string;
  options: RadioOption<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  error?: string;
  helperText?: string;
};

// ○-style radio rows for strictly binary/short exclusive choices (e.g. "Show
// phone number publicly?") — distinct from ChoiceChips, which is for longer
// enumerated option lists where a pill row reads better than stacked radios.
export function RadioGroup<T extends string | boolean>({ label, options, value, onChange, error, helperText }: Props<T>) {
  const { colors, spacing, radius } = useTheme();

  return (
    <View>
      {label && (
        <Text variant="caption" color="secondary" style={{ marginBottom: spacing.xs }}>
          {value !== undefined ? '✓ ' : ''}
          {label}
        </Text>
      )}
      <View style={{ gap: spacing.xs }}>
        {options.map((opt) => {
          const selected = value === opt.value;
          return (
            <Pressable
              key={String(opt.value)}
              onPress={() => onChange(opt.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: spacing.xs,
                paddingHorizontal: spacing.sm,
                borderRadius: radius.md,
                borderWidth: 1.5,
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: selected ? colors.primary + '0D' : colors.surface,
              }}
            >
              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  borderWidth: 1.5,
                  borderColor: selected ? colors.primary : colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: spacing.xs,
                }}
              >
                {selected && <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: colors.primary }} />}
              </View>
              <Text variant="body" color={selected ? 'brand' : 'primary'}>
                {opt.label}
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
      {!error && helperText && (
        <Text variant="tiny" color="muted" style={{ marginTop: spacing.xxs }}>
          {helperText}
        </Text>
      )}
    </View>
  );
}
