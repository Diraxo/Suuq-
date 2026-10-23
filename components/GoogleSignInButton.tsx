import { ActivityIndicator, Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';
import { SIGN_IN_BUTTON_HEIGHT } from './AppleSignInButton';

type Props = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  height?: number;
};

const ICON_BOX = 26;

// Official multicolour Google "G", drawn inline so it paints in the same frame
// as the button (no image decode, no network, no layout shift).
function GoogleLogo({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </Svg>
  );
}

// Same footprint as AppleSignInButton: full width, same height, fully rounded.
export function GoogleSignInButton({ label, onPress, loading, disabled, height = SIGN_IN_BUTTON_HEIGHT }: Props) {
  const { colors, isDark } = useTheme();
  const blocked = disabled || loading;

  // Google's guidance: white button on light, dark button on dark.
  const background = isDark ? '#131314' : '#FFFFFF';
  const foreground = isDark ? '#E3E3E3' : '#1F1F1F';
  const border = isDark ? '#8E918F' : '#747775';

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!blocked }}
      style={({ pressed }) => ({
        width: '100%',
        height,
        borderRadius: height / 2,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: background,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
        opacity: disabled && !loading ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <>
          <View style={{ width: ICON_BOX, height: ICON_BOX, alignItems: 'center', justifyContent: 'center' }}>
            <GoogleLogo size={22} />
          </View>
          <Text
            variant="bodyMedium"
            style={{ marginLeft: 10, color: foreground, fontWeight: '600', fontSize: Math.round(height * 0.37), lineHeight: Math.round(height * 0.46) }}
            numberOfLines={1}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}
