// Design tokens for the Fursad Google Play screenshot generator.
// Sourced directly from the production app's theme/colors.ts and theme/tokens.ts —
// do not invent new brand colors here, keep this file in sync with the app theme.

const palette = {
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

  slate50: '#F8FAFC',
  slate200: '#E2E8F0',
  slate900: '#0F172A',
  slate950: '#020617',

  white: '#FFFFFF',
  black: '#000000',
};

const canvas = { width: 1080, height: 1920 };

const font = {
  family: "'Inter', -apple-system, 'Segoe UI', sans-serif",
};

const phone = {
  width: 640,
  bezel: 18,
  outerRadius: 64,
  screenRadius: 48,
};

module.exports = { palette, canvas, font, phone };
