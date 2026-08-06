import { Platform } from 'react-native';

// Type scale — Inter on Android/web, SF Pro (system default) on iOS
export const fontFamily = Platform.select({
  ios: {
    regular: 'System',
    medium: 'System',
    semibold: 'System',
    bold: 'System',
  },
  default: {
    regular: 'Inter_400Regular',
    medium: 'Inter_500Medium',
    semibold: 'Inter_600SemiBold',
    bold: 'Inter_700Bold',
  },
})!;

export const type = {
  display: { size: 32, lineHeight: 38, weight: '700' as const },
  h1: { size: 26, lineHeight: 32, weight: '700' as const },
  h2: { size: 22, lineHeight: 28, weight: '600' as const },
  h3: { size: 18, lineHeight: 24, weight: '600' as const },
  bodyLg: { size: 16, lineHeight: 24, weight: '400' as const },
  body: { size: 15, lineHeight: 22, weight: '400' as const },
  bodyMedium: { size: 15, lineHeight: 22, weight: '500' as const },
  caption: { size: 13, lineHeight: 18, weight: '400' as const },
  tiny: { size: 11, lineHeight: 14, weight: '500' as const },
};

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = {
  sm: 10,
  md: 16,
  lg: 20,
  xl: 28,
  pill: 999,
};

export const shadow = {
  sm: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  md: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 5,
  },
};

// Animation durations & easing — used across the app for consistency
export const motion = {
  fast: 150,
  base: 250,
  slow: 400,
};
