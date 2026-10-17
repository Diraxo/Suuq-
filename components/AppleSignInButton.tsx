import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';

type Props = {
  onPress: () => void;
  disabled?: boolean;
  height?: number;
};

// Native "Continue with Apple" button (Apple's own control, so logo, wording
// localisation and HIG proportions are guaranteed). Renders nothing on
// Android/web and on iOS devices where Sign in with Apple is unavailable.
export function AppleSignInButton({ onPress, disabled, height = 58 }: Props) {
  const { isDark } = useTheme();
  const [available, setAvailable] = useState(false);

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
    <View style={{ opacity: disabled ? 0.5 : 1 }} pointerEvents={disabled ? 'none' : 'auto'}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={isDark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={height / 2}
        style={{ width: '100%', height }}
        onPress={onPress}
      />
    </View>
  );
}
