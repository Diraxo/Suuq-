import { View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeContext';

const OPTIONS: { value: 'light' | 'dark' | 'system'; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'light', label: 'Light', icon: 'sunny-outline' },
  { value: 'dark', label: 'Dark', icon: 'moon-outline' },
  { value: 'system', label: 'Match system', icon: 'phone-portrait-outline' },
];

export default function Appearance() {
  const { colors, spacing, radius, mode, setMode } = useTheme();
  const router = useRouter();

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          Appearance
        </Text>
      </View>

      <View style={{ gap: spacing.xs }}>
        {OPTIONS.map((opt) => {
          const active = mode === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => setMode(opt.value)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                padding: spacing.md,
                borderRadius: radius.md,
                borderWidth: 1.5,
                borderColor: active ? colors.primary : colors.border,
                backgroundColor: active ? colors.primary + '0D' : colors.surface,
              }}
            >
              <Ionicons name={opt.icon} size={20} color={active ? colors.primary : colors.textSecondary} />
              <Text variant="body" color={active ? 'brand' : 'primary'} style={{ marginLeft: spacing.sm, flex: 1 }}>
                {opt.label}
              </Text>
              {active && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}
