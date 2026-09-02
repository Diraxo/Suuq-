import type { Config } from 'tailwindcss';

// Mirrors theme/colors.ts and theme/tokens.ts from the SUUQIYE mobile app —
// same palette, spacing, radius and type scale, exposed as CSS variables so
// light/dark switches without a second Tailwind theme.
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'rgb(var(--color-background) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        surfaceElevated: 'rgb(var(--color-surface-elevated) / <alpha-value>)',
        border: 'rgb(var(--color-border) / <alpha-value>)',
        textPrimary: 'rgb(var(--color-text-primary) / <alpha-value>)',
        textSecondary: 'rgb(var(--color-text-secondary) / <alpha-value>)',
        textMuted: 'rgb(var(--color-text-muted) / <alpha-value>)',
        primary: 'rgb(var(--color-primary) / <alpha-value>)',
        primaryText: 'rgb(var(--color-primary-text) / <alpha-value>)',
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        accentText: 'rgb(var(--color-accent-text) / <alpha-value>)',
        success: 'rgb(var(--color-success) / <alpha-value>)',
        warning: 'rgb(var(--color-warning) / <alpha-value>)',
        error: 'rgb(var(--color-error) / <alpha-value>)',
        inputBackground: 'rgb(var(--color-input-background) / <alpha-value>)',
        skeleton: 'rgb(var(--color-skeleton) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        sm: '10px',
        md: '16px',
        lg: '20px',
        xl: '28px',
        pill: '999px',
      },
      spacing: {
        xxs: '4px',
        xs: '8px',
        sm: '12px',
        md: '16px',
        lg: '20px',
        xl: '24px',
        xxl: '32px',
        xxxl: '48px',
      },
      boxShadow: {
        sm: '0 2px 6px 0 rgb(15 23 42 / 0.06)',
        md: '0 6px 16px 0 rgb(15 23 42 / 0.08)',
      },
      maxWidth: {
        content: '1440px',
      },
    },
  },
  plugins: [],
};

export default config;
