import { useState } from 'react';
import { View, Pressable, Switch, Platform } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';
import { WeekDay, DayHours } from '@/types';

const DAY_LABELS: Record<WeekDay, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};
const DAY_ORDER: WeekDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DEFAULT_DAY: DayHours = { closed: false, open: '09:00', close: '18:00' };

type Props = {
  value: Partial<Record<WeekDay, DayHours>>;
  onChange: (value: Partial<Record<WeekDay, DayHours>>) => void;
};

function timeToDate(time: string): Date {
  const [h, m] = time.split(':').map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

function dateToTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatTime(time: string): string {
  return timeToDate(time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Structured Monday-Sunday open/close editor for profiles.business_hours —
// replaces the old free-text "Mon-Sat 9am-7pm" note field. Stores
// { days: { mon: { closed, open, close }, ... } } into the same jsonb column.
export function BusinessHoursEditor({ value, onChange }: Props) {
  const { colors, spacing, radius } = useTheme();
  const [openPicker, setOpenPicker] = useState<{ day: WeekDay; field: 'open' | 'close' } | null>(null);

  const dayValue = (day: WeekDay): DayHours => value[day] ?? DEFAULT_DAY;

  const updateDay = (day: WeekDay, patch: Partial<DayHours>) => {
    onChange({ ...value, [day]: { ...dayValue(day), ...patch } });
  };

  const handleTimeChange = (event: DateTimePickerEvent, selected?: Date) => {
    const picker = openPicker;
    if (Platform.OS === 'android') setOpenPicker(null);
    if (event.type === 'dismissed' || !selected || !picker) return;
    updateDay(picker.day, { [picker.field]: dateToTime(selected) });
  };

  return (
    <View style={{ gap: spacing.sm }}>
      {DAY_ORDER.map((day) => {
        const hours = dayValue(day);
        return (
          <View key={day} style={{ backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text variant="bodyMedium">{DAY_LABELS[day]}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                <Text variant="caption" color="secondary">
                  Closed
                </Text>
                <Switch value={hours.closed} onValueChange={(closed) => updateDay(day, { closed })} trackColor={{ true: colors.primary }} />
              </View>
            </View>
            {!hours.closed && (
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
                <Pressable
                  onPress={() => setOpenPicker({ day, field: 'open' })}
                  accessibilityRole="button"
                  accessibilityLabel={`${DAY_LABELS[day]} opening time`}
                  style={{ flex: 1, backgroundColor: colors.inputBackground, borderRadius: radius.sm, padding: spacing.xs, alignItems: 'center' }}
                >
                  <Text variant="caption" color="muted">
                    Opens
                  </Text>
                  <Text variant="bodyMedium">{formatTime(hours.open)}</Text>
                </Pressable>
                <Pressable
                  onPress={() => setOpenPicker({ day, field: 'close' })}
                  accessibilityRole="button"
                  accessibilityLabel={`${DAY_LABELS[day]} closing time`}
                  style={{ flex: 1, backgroundColor: colors.inputBackground, borderRadius: radius.sm, padding: spacing.xs, alignItems: 'center' }}
                >
                  <Text variant="caption" color="muted">
                    Closes
                  </Text>
                  <Text variant="bodyMedium">{formatTime(hours.close)}</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}

      {openPicker && Platform.OS === 'android' && (
        <DateTimePicker value={timeToDate(dayValue(openPicker.day)[openPicker.field])} mode="time" display="default" onChange={handleTimeChange} />
      )}
      {openPicker && Platform.OS === 'ios' && (
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.sm, overflow: 'hidden' }}>
          <DateTimePicker value={timeToDate(dayValue(openPicker.day)[openPicker.field])} mode="time" display="spinner" onChange={handleTimeChange} />
          <Pressable onPress={() => setOpenPicker(null)} style={{ padding: spacing.sm, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text variant="bodyMedium" color="brand">
              Done
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
