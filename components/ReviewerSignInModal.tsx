import { useState } from 'react';
import { Modal, View, Pressable, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useTheme } from '@/theme/ThemeContext';
import { useAuthStore } from '@/store/auth';
import { announceSignInSuccess } from '@/lib/authFlow';

type Props = {
  visible: boolean;
  onClose: () => void;
};

// Hidden email/password sign-in used only by the app-store review teams, who
// cannot complete Google OAuth with a shared test account. Reached via a
// long-press on the guest Profile avatar — never linked from normal UI.
export function ReviewerSignInModal({ visible, onClose }: Props) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const signInWithPassword = useAuthStore((s) => s.signInWithPassword);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setEmail('');
    setPassword('');
    setSubmitting(false);
  };

  const dismiss = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!email.trim() || !password) {
      Alert.alert(t('components.reviewerSignIn.failedTitle'), t('components.reviewerSignIn.incomplete'));
      return;
    }
    setSubmitting(true);
    let error: string | undefined;
    try {
      ({ error } = await signInWithPassword(email, password));
    } catch {
      error = t('components.reviewerSignIn.incomplete');
    } finally {
      setSubmitting(false);
    }
    if (error) {
      Alert.alert(t('components.reviewerSignIn.failedTitle'), error);
      return;
    }
    reset();
    onClose();
    await announceSignInSuccess();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={dismiss}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay }}>
        <Pressable
          style={{ flex: 1 }}
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel={t('components.reviewerSignIn.dismiss')}
        />
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
            {t('components.reviewerSignIn.title')}
          </Text>
          <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xs }}>
            {t('components.reviewerSignIn.subtitle')}
          </Text>

          <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
            <Input
              label={t('components.reviewerSignIn.emailLabel')}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              editable={!submitting}
            />
            <Input
              label={t('components.reviewerSignIn.passwordLabel')}
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              textContentType="password"
              editable={!submitting}
              onSubmitEditing={handleSubmit}
              returnKeyType="go"
            />
            <Button
              label={t('components.reviewerSignIn.submit')}
              onPress={handleSubmit}
              loading={submitting}
              disabled={submitting}
              fullWidth
              size="lg"
            />
            <Button
              label={t('components.reviewerSignIn.dismiss')}
              variant="ghost"
              onPress={dismiss}
              disabled={submitting}
              fullWidth
              size="lg"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
