import { useState } from 'react';
import { View, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';
import { useAuthStore } from '@/store/auth';
import { performGoogleSignIn } from '@/lib/authFlow';

export default function Welcome() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const [signingIn, setSigningIn] = useState(false);

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    const { error } = await performGoogleSignIn();
    setSigningIn(false);
    if (error) {
      Alert.alert('Sign-in failed', error);
      return;
    }
    if (!useAuthStore.getState().session) {
      // User cancelled the Google sign-in sheet — stay on this screen.
      return;
    }
    router.push('/(onboarding)/select-region');
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <View style={{ flex: 1, justifyContent: 'space-between', paddingVertical: spacing.xl }}>
        <View style={{ alignItems: 'center', marginTop: spacing.xxxl }}>
          <View
            style={{
              width: 96,
              height: 96,
              borderRadius: radius.xl,
              backgroundColor: colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: spacing.lg,
            }}
          >
            <Text variant="display" color="inverse">
              S+
            </Text>
          </View>
          <Text variant="h1" align="center">
            Buy and sell, the trusted way
          </Text>
          <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.xs, paddingHorizontal: spacing.lg }}>
            One place for Somalia, Somaliland, Puntland, and the Somali Region — built for how you already do business.
          </Text>
        </View>

        <View style={{ gap: spacing.sm }}>
          <Button
            label="Continue with Google"
            onPress={handleGoogleSignIn}
            loading={signingIn}
            disabled={signingIn}
            fullWidth
            size="lg"
            icon={<Ionicons name="logo-google" size={18} color={colors.primaryText} />}
          />
          <Text variant="tiny" color="muted" align="center">
            By continuing you agree to Suuq+&apos;s Terms and Privacy Policy.
          </Text>
        </View>
      </View>
    </Screen>
  );
}
