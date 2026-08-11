import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';

type Props = {
  label?: string;
  /** YYYY-MM-DD, matching profiles.birthday (a `date` column). */
  value?: string;
  onChange: (value: string) => void;
  error?: string;
};

function toDate(value?: string): Date {
  if (value) {
    const d = new Date(`${value}T00:00:00`);
    if (!isNaN(d.getTime())) return d;
  }
  const fallback = new Date();
  fallback.setFullYear(fallback.getFullYear() - 18);
  return fallback;
}

function formatValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDisplay(value: string | undefined, placeholder: string): string {
  if (!value) return placeholder;
  return toDate(value).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

// Native date picker — Android opens the OS spinner/calendar dialog, iOS
// shows an inline spinner with a Done button. Replaces manual YYYY-MM-DD
// text entry; still round-trips the same string shape to the DB.
export function BirthdayPicker({ label, value, onChange, error }: Props) {
  const { t } = useTranslation();
  const resolvedLabel = label ?? t('components.birthdayPicker.label');
  const { colors, radius, spacing, type } = useTheme();
  const [open, setOpen] = useState(false);

  const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setOpen(false);
    if (event.type === 'dismissed' || !selected) return;
    onChange(formatValue(selected));
  };

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
        accessibilityLabel={`${resolvedLabel}: ${formatDisplay(value, t('components.birthdayPicker.placeholder'))}`}
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
        <Text variant="body" color={value ? 'primary' : 'muted'} style={{ fontSize: type.body.size }}>
          {formatDisplay(value, t('components.birthdayPicker.placeholder'))}
        </Text>
        <Ionicons name="calendar-outline" size={18} color={colors.textMuted} />
      </Pressable>
      {error && (
        <Text variant="caption" color="error" style={{ marginTop: spacing.xxs }}>
          {error}
        </Text>
      )}
      {open && Platform.OS === 'android' && (
        <DateTimePicker value={toDate(value)} mode="date" display="default" maximumDate={new Date()} onChange={handleChange} />
      )}
      {open && Platform.OS === 'ios' && (
        <View style={{ marginTop: spacing.xs, backgroundColor: colors.surface, borderRadius: radius.sm, overflow: 'hidden' }}>
          <DateTimePicker value={toDate(value)} mode="date" display="spinner" maximumDate={new Date()} onChange={handleChange} />
          <Pressable onPress={() => setOpen(false)} style={{ padding: spacing.sm, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text variant="bodyMedium" color="brand">
              {t('common.done')}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
