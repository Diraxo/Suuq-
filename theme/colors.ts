// Suuq+ design tokens — colors
// Brand: indigo primary, coral accent, on a clean trustworthy base.

export const palette = {
  indigo50: '#EEF0FF',
  indigo100: '#E0E4FF',
  indigo400: '#7C82F0',
  indigo500: '#4F46E5', // primary
  indigo600: '#4338CA',
  indigo700: '#3730A3',

  coral300: '#FF9B9B',
  coral400: '#FF8585',
  coral500: '#FF6B6B', // accent
  coral600: '#E85555',

  emerald500: '#10B981', // success
  amber500: '#F59E0B', // warning
  red500: '#EF4444', // error

  slate50: '#F8FAFC',
  slate100: '#F1F5F9',
  slate200: '#E2E8F0',
  slate300: '#CBD5E1',
  slate400: '#94A3B8',
  slate500: '#64748B',
  slate600: '#475569',
  slate700: '#334155',
  slate800: '#1E293B',
  slate900: '#0F172A',
  slate950: '#020617',

  white: '#FFFFFF',
  black: '#000000',
};

export type ThemeColors = {
  background: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  primaryText: string;
  accent: string;
  accentText: string;
  success: string;
  warning: string;
  error: string;
  overlay: string;
  tabBarBackground: string;
  inputBackground: string;
  skeleton: string;
};

export const lightColors: ThemeColors = {
  background: palette.slate50,
  surface: palette.white,
  surfaceElevated: palette.white,
  border: palette.slate200,
  textPrimary: palette.slate900,
  textSecondary: palette.slate600,
  textMuted: palette.slate500,
  primary: palette.indigo500,
  primaryText: palette.white,
  accent: palette.coral500,
  accentText: palette.slate900,
  success: palette.emerald500,
  warning: palette.amber500,
  error: palette.red500,
  overlay: 'rgba(15, 23, 42, 0.5)',
  tabBarBackground: palette.white,
  inputBackground: palette.slate100,
  skeleton: palette.slate200,
};

export const darkColors: ThemeColors = {
  background: palette.slate950,
  surface: palette.slate900,
  surfaceElevated: palette.slate800,
  border: palette.slate700,
  textPrimary: palette.slate50,
  textSecondary: palette.slate300,
  textMuted: palette.slate400,
  primary: palette.indigo400,
  primaryText: palette.slate950,
  accent: palette.coral400,
  accentText: palette.slate950,
  success: palette.emerald500,
  warning: palette.amber500,
  error: palette.red500,
  overlay: 'rgba(2, 6, 23, 0.65)',
  tabBarBackground: palette.slate900,
  inputBackground: palette.slate800,
  skeleton: palette.slate700,
};
