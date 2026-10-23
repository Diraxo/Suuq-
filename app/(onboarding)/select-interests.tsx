import { useState } from 'react';
import { View, FlatList, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { categoryLabel, subcategoryLabel } from '@/data/categoryNames';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';
import { categories } from '@/data/categories';
import { ONBOARDED_KEY } from '@/data/onboarding';

function InterestCard({
  icon,
  name,
  selected,
  onPress,
  index,
}: {
  icon: string;
  name: string;
  selected: boolean;
  onPress: () => void;
  index: number;
}) {
  const { colors, spacing, radius } = useTheme();
  const scale = useSharedValue(1);

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePress = () => {
    scale.value = withSpring(1.04, { damping: 10, stiffness: 300 }, () => {
      scale.value = withSpring(1, { damping: 10, stiffness: 300 });
    });
    onPress();
  };

  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 40).duration(350)} style={{ flex: 1 }}>
      <Animated.View style={cardStyle}>
        <Pressable
          onPress={handlePress}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            padding: spacing.sm,
            borderRadius: radius.md,
            borderWidth: 1.5,
            borderColor: selected ? colors.primary : colors.border,
            backgroundColor: selected ? colors.primary + '0D' : colors.surface,
          }}
        >
          <CategoryIcon icon={icon as any} size={20} color={selected ? colors.primary : colors.textSecondary} />
          <Text variant="body" color={selected ? 'brand' : 'primary'} style={{ marginLeft: spacing.xs }}>
            {name}
          </Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

export default function SelectInterests() {
  const { spacing } = useTheme();
  const { t } = useTranslation();
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
        <Animated.View entering={FadeInDown.duration(400)}>
          <Text variant="h1">{t('onboarding.selectInterestsTitle')}</Text>
          <Text variant="body" color="secondary" style={{ marginTop: spacing.xxs, marginBottom: spacing.lg }}>
            {t('onboarding.selectInterestsSubtitle')}
          </Text>
        </Animated.View>

        <FlatList
          data={categories}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={{ gap: spacing.sm }}
          contentContainerStyle={{ gap: spacing.sm }}
          renderItem={({ item, index }) => (
            <InterestCard icon={item.icon} name={categoryLabel(t, item.id, item.name)} selected={selected.includes(item.id)} onPress={() => toggle(item.id)} index={index} />
          )}
        />

        <Button
          label={selected.length ? t('onboarding.continueWithCount', { count: selected.length }) : t('onboarding.skipForNow')}
          onPress={finishOnboarding}
          fullWidth
          size="lg"
          style={{ marginTop: spacing.md }}
        />
      </View>
    </Screen>
  );
}
