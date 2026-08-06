import React from 'react';
import { ViewStyle, StatusBar, Keyboard, Pressable } from 'react-native';
import { SafeAreaView, Edge } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeContext';

type Props = {
  children?: React.ReactNode;
  edges?: Edge[];
  style?: ViewStyle;
  noPadding?: boolean;
};

// Every screen in the app should use this instead of a raw View, so safe areas
// and the correct status bar style are handled consistently on iOS and Android.
export function Screen({ children, edges = ['top', 'left', 'right'], style, noPadding }: Props) {
  const { colors, spacing, isDark } = useTheme();

  return (
    <SafeAreaView
      edges={edges}
      style={[
        {
          flex: 1,
          backgroundColor: colors.background,
          paddingHorizontal: noPadding ? 0 : spacing.md,
        },
        style,
      ]}
    >
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      {/* Tapping anywhere outside a focused input should dismiss the keyboard, app-wide. */}
      <Pressable onPress={() => Keyboard.dismiss()} style={{ flex: 1 }} accessible={false}>
        {children}
      </Pressable>
    </SafeAreaView>
  );
}
