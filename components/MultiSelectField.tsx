import { useState } from 'react';
import { View, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';
import { Button } from './Button';
import { KeyboardSheet } from './KeyboardSheet';

type Option = { value: string; label: string };

type Props = {
  label?: string;
  placeholder: string;
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  /** Most options that can be ticked; the rest are disabled until one is unticked. */
  max?: number;
  maxHint?: string;
};

// A dropdown that lets several options be ticked (business categories): looks like SelectField, opens a bottom sheet with checkmarks and a Done button.
export function MultiSelectField({ label, placeholder, options, value, onChange, max, maxHint }: Props) {
  const { colors, spacing, radius } = useTheme();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selectedLabels = value.map((v) => options.find((o) => o.value === v)?.label).filter(Boolean) as string[];
  const full = max !== undefined && value.length >= max;

  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

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
        accessibilityLabel={`${label ?? placeholder}: ${selectedLabels.join(', ') || placeholder}`}
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
        <Text variant="body" color={selectedLabels.length ? 'primary' : 'muted'} style={{ flex: 1 }} numberOfLines={2}>
          {selectedLabels.join(', ') || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>

      <KeyboardSheet visible={open} onClose={() => setOpen(false)}>
        <Text variant="h3" style={{ marginBottom: spacing.xs }}>
          {label ?? placeholder}
        </Text>
        {maxHint ? (
          <Text variant="tiny" color="muted" style={{ marginBottom: spacing.xs }}>
            {maxHint}
          </Text>
        ) : null}
        <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
          {options.map((o) => {
            const checked = value.includes(o.value);
            const disabled = !checked && full;
            return (
              <Pressable
                key={o.value}
                onPress={() => toggle(o.value)}
                disabled={disabled}
                accessibilityRole="checkbox"
                accessibilityState={{ checked, disabled }}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm, opacity: disabled ? 0.4 : 1 }}
              >
                <Text variant="body">{o.label}</Text>
                <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? colors.primary : colors.textMuted} />
              </Pressable>
            );
          })}
        </ScrollView>
        <Button label={t('common.done')} onPress={() => setOpen(false)} fullWidth style={{ marginTop: spacing.sm }} />
      </KeyboardSheet>
    </View>
  );
}
