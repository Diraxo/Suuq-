import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import * as SystemUI from 'expo-system-ui';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lightColors, darkColors, ThemeColors } from './colors';
import { spacing, radius, shadow, type, motion } from './tokens';

type ThemeMode = 'light' | 'dark' | 'system';

const THEME_STORAGE_KEY = '@suuq/themeMode';

type ThemeContextValue = {
  colors: ThemeColors;
  isDark: boolean;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  spacing: typeof spacing;
  radius: typeof radius;
  shadow: typeof shadow;
  type: typeof type;
  motion: typeof motion;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') setModeState(stored);
    });
  }, []);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(THEME_STORAGE_KEY, next).catch(() => {});
  };

  const isDark = mode === 'system' ? systemScheme === 'dark' : mode === 'dark';
  const backgroundColor = isDark ? darkColors.background : lightColors.background;

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(backgroundColor).catch(() => {});
  }, [backgroundColor]);

  // Makes every other useColorScheme() consumer in the app agree with this
  // in-app toggle instead of independently following the device setting —
  // keeps native alerts/system UI in sync even when the app theme diverges
  // from the OS setting (e.g. app set to Dark while the OS is Light).
  useEffect(() => {
    Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
  }, [mode]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors: isDark ? darkColors : lightColors,
      isDark,
      mode,
      setMode,
      spacing,
      radius,
      shadow,
      type,
      motion,
    }),
    [isDark, mode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
