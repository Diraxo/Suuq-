import { useState } from 'react';
import { View, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { deleteAccount } from '@/lib/accountDeletion';

const DELETED_ITEMS = [
  'Your profile and business profile',
  'All your listings and photos',
  'Favorites, followers, and following',
  'Reviews you left or received',
  'Saved searches and saved addresses',
  'Notifications and device tokens',
  'Chat conversations',
];

const CONFIRM_TEXT = 'DELETE';

export default function DeleteAccount() {
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const authed = useRequireAuthScreen();
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  if (!authed) return <Screen edges={['top', 'left', 'right', 'bottom']} />;

  const canDelete = confirmText.trim().toUpperCase() === CONFIRM_TEXT;

  const runDelete = async () => {
    setDeleting(true);
    const { error } = await deleteAccount();
    setDeleting(false);
    if (error) {
      Alert.alert('Could not delete account', error);
      return;
    }
    router.replace('/(onboarding)/welcome');
  };

  const confirmAndDelete = () => {
    Alert.alert('Are you sure?', 'This will permanently delete your account and everything listed above. This action cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete my account', style: 'destructive', onPress: runDelete },
    ]);
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          Delete Account
        </Text>
      </View>

      <View style={{ flex: 1 }}>
        <View style={{ alignItems: 'center', marginBottom: spacing.lg }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.error + '1A', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="warning-outline" size={30} color={colors.error} />
          </View>
        </View>

        <Text variant="body" color="secondary" style={{ marginBottom: spacing.md }}>
          Deleting your account is permanent and cannot be undone. This will remove:
        </Text>

        <View style={{ gap: spacing.xs, marginBottom: spacing.lg }}>
          {DELETED_ITEMS.map((item) => (
            <View key={item} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="close-circle" size={16} color={colors.error} />
              <Text variant="body" style={{ marginLeft: spacing.xs }}>
                {item}
              </Text>
            </View>
          ))}
        </View>

        <Text variant="caption" color="muted" style={{ marginBottom: spacing.xs }}>
          Type {CONFIRM_TEXT} to confirm
        </Text>
        <Input
          value={confirmText}
          onChangeText={setConfirmText}
          placeholder={CONFIRM_TEXT}
          autoCapitalize="characters"
          autoCorrect={false}
        />
      </View>

      <Button
        label="Delete my account"
        variant="danger"
        onPress={confirmAndDelete}
        disabled={!canDelete}
        loading={deleting}
        fullWidth
        size="lg"
        style={{ marginTop: spacing.lg }}
      />
    </Screen>
  );
}
