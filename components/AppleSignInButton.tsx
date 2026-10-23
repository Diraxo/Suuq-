import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';

type Props = {
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  height?: number;
};

// Shared height for the Google and Apple sign-in buttons.
export const SIGN_IN_BUTTON_HEIGHT = 54;

// Native "Continue with Apple" button (Apple's own control, so logo, wording
// localisation and HIG proportions are guaranteed). Renders nothing on
// Android/web and on iOS devices where Sign in with Apple is unavailable.
export function AppleSignInButton({ onPress, disabled, loading, height = SIGN_IN_BUTTON_HEIGHT }: Props) {
  const { isDark } = useTheme();
  // Optimistic on iOS so the button doesn't pop in (and shift the layout) after
  // the async check; the check below still hides it where unsupported.
  const [available, setAvailable] = useState(() => {
    if (Platform.OS !== 'ios') return false;
    try {
      require('expo-apple-authentication');
      return true;
    } catch {
      return false; // native module missing in this binary
    }
  });

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    // A binary built before expo-apple-authentication was added throws on
    // require (native module missing) — treat that as "unavailable", not a crash.
    try {
      const AppleAuthentication = require('expo-apple-authentication') as typeof import('expo-apple-authentication');
      AppleAuthentication.isAvailableAsync().then(setAvailable).catch(() => setAvailable(false));
    } catch {
      // stays unavailable (initial state)
    }
  }, []);

  if (Platform.OS !== 'ios' || !available) return null;
  const AppleAuthentication = require('expo-apple-authentication') as typeof import('expo-apple-authentication');

  return (
    <View style={{ opacity: disabled && !loading ? 0.5 : 1 }} pointerEvents={disabled ? 'none' : 'auto'}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={isDark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={height / 2}
        style={{ width: '100%', height }}
        onPress={onPress}
      />
      {loading ? (
        // The native control can't show a spinner, so cover it with one.
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: height / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: isDark ? '#FFFFFF' : '#000000',
          }}
        >
          <ActivityIndicator color={isDark ? '#000000' : '#FFFFFF'} />
        </View>
      ) : null}
    </View>
  );
}
