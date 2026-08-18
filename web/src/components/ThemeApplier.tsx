'use client';

import { useEffect } from 'react';
import { useThemeStore } from '@/store/theme';

// Applies the persisted light/dark/system choice by toggling `.dark` on
// <html>, mirroring theme/ThemeContext.tsx on mobile.
export function ThemeApplier() {
  const mode = useThemeStore((s) => s.mode);
  const setResolved = useThemeStore((s) => s.setResolved);

  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const isDark = mode === 'system' ? mq.matches : mode === 'dark';
      root.classList.toggle('dark', isDark);
      setResolved(isDark ? 'dark' : 'light');
    };

    apply();
    if (mode === 'system') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [mode, setResolved]);

  return null;
}
