import { useState } from 'react';
import { View, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { useTheme } from '@/theme/ThemeContext';

export default function PickupPlanner() {
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [location, setLocation] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          Plan Pickup
        </Text>
      </View>

      <Card elevated={false} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md }}>
        <Ionicons name="shield-checkmark-outline" size={16} color={colors.success} />
        <Text variant="caption" color="secondary" style={{ marginLeft: spacing.xxs, flex: 1 }}>
          This just plans the meeting — no payment happens here. Pay in person after inspecting the item.
        </Text>
      </Card>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top}>
        <ScrollView contentContainerStyle={{ gap: spacing.md, flexGrow: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Input label="Meeting location" placeholder="e.g. Hargeisa central market" value={location} onChangeText={setLocation} leftIcon={<Ionicons name="location-outline" size={16} color={colors.textMuted} />} />
          <Input label="Meeting time" placeholder="e.g. Today, 5:00 PM" value={time} onChangeText={setTime} leftIcon={<Ionicons name="time-outline" size={16} color={colors.textMuted} />} />
          <Input label="Notes (optional)" placeholder="e.g. I'll be wearing a blue jacket" value={notes} onChangeText={setNotes} multiline numberOfLines={3} style={{ height: 70, textAlignVertical: 'top' }} />
          <View style={{ flex: 1 }} />
        </ScrollView>
        <Button label="Send to seller" onPress={() => router.back()} disabled={!location || !time} fullWidth size="lg" style={{ marginTop: spacing.md, marginBottom: spacing.sm }} />
      </KeyboardAvoidingView>
    </Screen>
  );
}
