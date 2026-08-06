import { useState } from 'react';
import { View, FlatList, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { useTheme } from '@/theme/ThemeContext';
import { regions, featuredCities, cityRegion } from '@/data/categories';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

export default function SelectRegion() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleContinue = async () => {
    if (selected && session) {
      setSaving(true);
      await supabase
        .from('profiles')
        .update({ city: selected, region: cityRegion[selected] ?? null, updated_at: new Date().toISOString() })
        .eq('id', session.user.id);
      await refreshProfile();
      setSaving(false);
    }
    router.push('/(onboarding)/select-interests');
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <View style={{ paddingTop: spacing.lg, flex: 1 }}>
        <Text variant="h1">Where are you based?</Text>
        <Text variant="body" color="secondary" style={{ marginTop: spacing.xxs, marginBottom: spacing.lg }}>
          This helps us show listings near you first. You can change this anytime.
        </Text>

        <FlatList
          data={regions}
          keyExtractor={(item) => item}
          contentContainerStyle={{ gap: spacing.xs }}
          renderItem={({ item }) => {
            const isSelected = selected === item;
            const isFeatured = featuredCities.includes(item);
            return (
              <Pressable
                onPress={() => setSelected(item)}
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

        <Button label="Continue" onPress={handleContinue} loading={saving} disabled={!selected || saving} fullWidth size="lg" style={{ marginTop: spacing.md }} />
      </View>
    </Screen>
  );
}
