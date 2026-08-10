import { useState } from 'react';
import { View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'so', label: 'Somali' },
  { code: 'am', label: 'አማርኛ' },
];

function LanguageCard({ code, label, selected, onPress, index }: { code: string; label: string; selected: boolean; onPress: () => void; index: number }) {
  const { colors, spacing, radius } = useTheme();
  const checkScale = useSharedValue(selected ? 1 : 0);

  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
    opacity: checkScale.value,
  }));

  const handlePress = () => {
    checkScale.value = withSpring(1, { damping: 12, stiffness: 200 });
    onPress();
  };

  return (
    <Animated.View entering={FadeInDown.delay(index * 80).duration(400)}>
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: spacing.lg,
          paddingHorizontal: spacing.lg,
          borderRadius: radius.lg,
          borderWidth: 1.5,
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: selected ? colors.primary + '0D' : colors.surface,
          minHeight: 64,
        }}
      >
        <Text variant="h3" color={selected ? 'brand' : 'primary'}>
          {label}
        </Text>
        <Animated.View style={checkStyle}>
          <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

export default function Language() {
  const { spacing } = useTheme();
  const router = useRouter();
  const [selected, setSelected] = useState('en');

  const handleContinue = () => {
    router.push('/(onboarding)/select-interests');
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <View style={{ paddingTop: spacing.xxl, flex: 1 }}>
        <Animated.View entering={FadeInDown.duration(400)}>
          <Text variant="h1">Choose your language</Text>
          <Text variant="body" color="secondary" style={{ marginTop: spacing.xxs, marginBottom: spacing.xl }}>
            You can change this later in Settings.
          </Text>
        </Animated.View>

        <View style={{ gap: spacing.sm }}>
          {LANGUAGES.map((lang, index) => (
            <LanguageCard key={lang.code} code={lang.code} label={lang.label} selected={selected === lang.code} onPress={() => setSelected(lang.code)} index={index} />
          ))}
        </View>

        <View style={{ flex: 1 }} />
        <Button label="Continue" onPress={handleContinue} fullWidth size="lg" />
      </View>
    </Screen>
  );
}
