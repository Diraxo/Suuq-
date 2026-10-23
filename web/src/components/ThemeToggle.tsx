'use client';

import { IoSunny, IoMoon } from 'react-icons/io5';
import { useThemeStore } from '@/store/theme';
import { useT } from '@/lib/i18n';

// Mirrors components/ThemeToggle.tsx on mobile: a compact two-segment pill,
// light/dark only (the three-way "system" choice lives on /settings/appearance,
// same split as the mobile app). Tapping either side sets an explicit mode —
// this control never itself selects "system". Segment size, pill radius and
// sliding-indicator behavior match the native control; the web equivalent of
// the RN Animated crossfade is a CSS color transition on the icon.
export function ThemeToggle({ className = '' }: { className?: string }) {
  const t = useT();
  const resolved = useThemeStore((s) => s.resolved);
  const setMode = useThemeStore((s) => s.setMode);
  const isDark = resolved === 'dark';

  return (
    <div
      className={`relative flex rounded-pill border border-border bg-inputBackground p-[3px] ${className}`}
      role="group"
      aria-label={t('web.m.theme')}
    >
      <span
        className="absolute left-[3px] top-[3px] h-7 w-8 rounded-pill bg-primary shadow-sm transition-transform duration-200 ease-out"
        style={{ transform: isDark ? 'translateX(32px)' : 'translateX(0)' }}
        aria-hidden="true"
      />
      <button
        type="button"
        onClick={() => setMode('light')}
        aria-label={t('components.themeToggle.switchToLight')}
        aria-pressed={!isDark}
        className="relative z-10 flex h-7 w-8 items-center justify-center"
      >
        <IoSunny size={15} className={`transition-colors duration-200 ${!isDark ? 'text-primaryText' : 'text-textSecondary'}`} />
      </button>
      <button
        type="button"
        onClick={() => setMode('dark')}
        aria-label={t('components.themeToggle.switchToDark')}
        aria-pressed={isDark}
        className="relative z-10 flex h-7 w-8 items-center justify-center"
      >
        <IoMoon size={14} className={`transition-colors duration-200 ${isDark ? 'text-primaryText' : 'text-textSecondary'}`} />
      </button>
    </div>
  );
}
