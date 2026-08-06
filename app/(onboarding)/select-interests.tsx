import { useState } from 'react';
import { View, FlatList, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';
import { categories } from '@/data/categories';
import { ONBOARDED_KEY } from '@/data/onboarding';

export default function SelectInterests() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const finishOnboarding = () => {
    AsyncStorage.setItem(ONBOARDED_KEY, 'true').catch(() => {});
    router.replace('/(tabs)/home');
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <View style={{ paddingTop: spacing.lg, flex: 1 }}>
        <Text variant="h1">What are you into?</Text>
        <Text variant="body" color="secondary" style={{ marginTop: spacing.xxs, marginBottom: spacing.lg }}>
          Pick a few — your home feed will lead with these.
        </Text>

        <FlatList
          data={categories}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={{ gap: spacing.sm }}
          contentContainerStyle={{ gap: spacing.sm }}
          renderItem={({ item }) => {
            const isSelected = selected.includes(item.id);
            return (
              <Pressable
                onPress={() => toggle(item.id)}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: spacing.sm,
                  borderRadius: radius.md,
                  borderWidth: 1.5,
                  borderColor: isSelected ? colors.primary : colors.border,
                  backgroundColor: isSelected ? colors.primary + '0D' : colors.surface,
                }}
              >
                <CategoryIcon icon={item.icon} size={20} color={isSelected ? colors.primary : colors.textSecondary} />
                <Text variant="body" color={isSelected ? 'brand' : 'primary'} style={{ marginLeft: spacing.xs }}>
                  {item.name}
                </Text>
              </Pressable>
            );
          }}
        />

        <Button
          label={selected.length ? `Continue (${selected.length} selected)` : 'Skip for now'}
          onPress={finishOnboarding}
          fullWidth
          size="lg"
          style={{ marginTop: spacing.md }}
        />
      </View>
    </Screen>
  );
}
