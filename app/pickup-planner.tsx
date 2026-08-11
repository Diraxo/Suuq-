import { useState } from 'react';
import { View, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { useTheme } from '@/theme/ThemeContext';

export default function PickupPlanner() {
  const { t } = useTranslation();
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
          {t('pickupPlanner.title')}
        </Text>
      </View>

      <Card elevated={false} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md }}>
        <Ionicons name="shield-checkmark-outline" size={16} color={colors.success} />
        <Text variant="caption" color="secondary" style={{ marginLeft: spacing.xxs, flex: 1 }}>
          {t('pickupPlanner.disclaimer')}
        </Text>
      </Card>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top}>
        <ScrollView contentContainerStyle={{ gap: spacing.md, flexGrow: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Input label={t('pickupPlanner.locationLabel')} placeholder={t('pickupPlanner.locationPlaceholder')} value={location} onChangeText={setLocation} leftIcon={<Ionicons name="location-outline" size={16} color={colors.textMuted} />} />
          <Input label={t('pickupPlanner.timeLabel')} placeholder={t('pickupPlanner.timePlaceholder')} value={time} onChangeText={setTime} leftIcon={<Ionicons name="time-outline" size={16} color={colors.textMuted} />} />
          <Input label={t('pickupPlanner.notesLabel')} placeholder={t('pickupPlanner.notesPlaceholder')} value={notes} onChangeText={setNotes} multiline numberOfLines={3} style={{ height: 70, textAlignVertical: 'top' }} />
          <View style={{ flex: 1 }} />
        </ScrollView>
        <Button label={t('pickupPlanner.sendToSeller')} onPress={() => router.back()} disabled={!location || !time} fullWidth size="lg" style={{ marginTop: spacing.md, marginBottom: spacing.sm }} />
      </KeyboardAvoidingView>
    </Screen>
  );
}
