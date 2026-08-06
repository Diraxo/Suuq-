import { useState } from 'react';
import { Modal, View, Pressable, Alert, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';
import { useAuthStore } from '@/store/auth';
import { useAuthPromptStore } from '@/store/authPrompt';
import { performGoogleSignIn } from '@/lib/authFlow';

export function AuthPromptModal() {
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const visible = useAuthPromptStore((s) => s.visible);
  const hide = useAuthPromptStore((s) => s.hide);
  const onSuccess = useAuthPromptStore((s) => s.onSuccess);
  const onCancel = useAuthPromptStore((s) => s.onCancel);
  const [signingIn, setSigningIn] = useState(false);

  const dismiss = () => {
    const cancel = onCancel;
    hide();
    cancel?.();
  };

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    const { error } = await performGoogleSignIn();
    setSigningIn(false);
    if (error) {
      Alert.alert('Sign-in failed', error);
      return;
    }
    if (!useAuthStore.getState().session) {
      // User cancelled the Google sign-in sheet — stay on the prompt.
      return;
    }
    const run = onSuccess;
    hide();
    run?.();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={dismiss}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay }}>
        <Pressable style={{ flex: 1 }} onPress={dismiss} accessibilityRole="button" accessibilityLabel="Dismiss" />
        <View
          style={{
            backgroundColor: colors.surfaceElevated,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            padding: spacing.lg,
            paddingBottom: spacing.xl + insets.bottom,
          }}
        >
          <Text variant="h2" align="center">
            Sign in to continue
          </Text>
          <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xs }}>
            Sign in to sell items, chat with sellers, save favorites, follow sellers, and manage your account.
          </Text>

          <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
            <Button
              label="Continue with Google"
              onPress={handleGoogleSignIn}
              loading={signingIn}
              disabled={signingIn}
              fullWidth
              size="lg"
              icon={<Image source={require('@/assets/images/google-logo.png')} style={{ width: 18, height: 18 }} />}
            />
            <Button label="Not now" variant="ghost" onPress={dismiss} fullWidth size="lg" />
          </View>
        </View>
      </View>
    </Modal>
  );
}
