import { useEffect, useRef, useState } from 'react';
import { View, Alert, ScrollView, KeyboardAvoidingView, Platform, LayoutChangeEvent, Keyboard } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { DeleteAccountConfirmModal } from '@/components/DeleteAccountConfirmModal';
import { useTheme } from '@/theme/ThemeContext';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { deleteAccount } from '@/lib/accountDeletion';

// Leaf keys under settings.deleteAccount.items — short UI labels, not legal body text.
const DELETED_ITEM_KEYS = [
  'profileAndBusiness',
  'listingsAndPhotos',
  'favoritesFollowers',
  'reviews',
  'savedSearchesAndAddresses',
  'notificationsAndTokens',
  'chatConversations',
] as const;

// Fixed confirmation keyword the user must type — an internal value compared
// in code (canDelete check below), so it is intentionally not translated.
const CONFIRM_TEXT = 'DELETE';

export default function DeleteAccount() {
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const authed = useRequireAuthScreen();
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  // y-offset of the confirm field, relative to the scroll content — filled
  // in by its onLayout so focusing it can scroll it above the keyboard.
  const fieldY = useRef<number | null>(null);
  const trackFieldLayout = (e: LayoutChangeEvent) => {
    fieldY.current = e.nativeEvent.layout.y;
  };

  // Keeps the confirm field visible above the keyboard. Scrolls immediately
  // on focus (covers the keyboard already being up) and again once it
  // finishes animating in (covers the first focus, before it has a height).
  const fieldFocused = useRef(false);
  const scrollToField = () => {
    if (fieldY.current === null) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, fieldY.current - 16), animated: true });
  };
  const handleFieldFocus = () => {
    fieldFocused.current = true;
    scrollToField();
  };
  const handleFieldBlur = () => {
    fieldFocused.current = false;
  };
  useEffect(() => {
    const event = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(event, () => {
      if (fieldFocused.current) scrollToField();
    });
    return () => sub.remove();
  }, []);

  if (!authed) return <Screen edges={['top', 'left', 'right', 'bottom']} />;

  const canDelete = confirmText.trim().toUpperCase() === CONFIRM_TEXT;

  const runDelete = async () => {
    setDeleting(true);
    const { error } = await deleteAccount();
    setDeleting(false);
    if (error) {
      setConfirmVisible(false);
      Alert.alert(t('settings.deleteAccount.deleteFailedTitle'), error);
      return;
    }
    router.replace('/(tabs)/home');
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {t('settings.deleteAccount.title')}
        </Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.md }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', marginBottom: spacing.lg }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.error + '1A', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="warning-outline" size={30} color={colors.error} />
            </View>
          </View>

          <Text variant="body" color="secondary" style={{ marginBottom: spacing.md }}>
            {t('settings.deleteAccount.warningText')}
          </Text>

          <View style={{ gap: spacing.xs, marginBottom: spacing.lg }}>
            {DELETED_ITEM_KEYS.map((key) => (
              <View key={key} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="close-circle" size={16} color={colors.error} />
                <Text variant="body" style={{ marginLeft: spacing.xs }}>
                  {t(`settings.deleteAccount.items.${key}`)}
                </Text>
              </View>
            ))}
          </View>

          <View onLayout={trackFieldLayout}>
            <Text variant="caption" color="muted" style={{ marginBottom: spacing.xs }}>
              {t('settings.deleteAccount.typeToConfirm', { word: CONFIRM_TEXT })}
            </Text>
            <Input
              value={confirmText}
              onChangeText={setConfirmText}
              placeholder={CONFIRM_TEXT}
              autoCapitalize="characters"
              autoCorrect={false}
              onFocus={handleFieldFocus}
              onBlur={handleFieldBlur}
            />
          </View>
        </ScrollView>

        <Button
          label={t('settings.deleteAccount.deleteButton')}
          variant="danger"
          onPress={() => setConfirmVisible(true)}
          disabled={!canDelete}
          loading={deleting}
          fullWidth
          size="lg"
          style={{ marginTop: spacing.sm }}
        />
      </KeyboardAvoidingView>

      <DeleteAccountConfirmModal
        visible={confirmVisible}
        loading={deleting}
        onCancel={() => setConfirmVisible(false)}
        onConfirm={runDelete}
      />
    </Screen>
  );
}
