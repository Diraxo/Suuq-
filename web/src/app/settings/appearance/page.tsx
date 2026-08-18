'use client';

import { useRouter } from 'next/navigation';
import { IoSunnyOutline, IoMoonOutline, IoPhonePortraitOutline, IoCheckmarkCircle } from 'react-icons/io5';
import { ChevronLeft } from '@/lib/icons';
import { useThemeStore, ThemeMode } from '@/store/theme';

const OPTIONS: { mode: ThemeMode; label: string; icon: typeof IoSunnyOutline }[] = [
  { mode: 'light', label: 'Light', icon: IoSunnyOutline },
  { mode: 'dark', label: 'Dark', icon: IoMoonOutline },
  { mode: 'system', label: 'Match system', icon: IoPhonePortraitOutline },
];

// Mirrors app/settings/appearance.tsx on mobile: same three options, same
// selected-row treatment (primary border + ~5% primary tint background,
// trailing checkmark), same instant-apply (no confirm step). The compact
// light/dark-only ThemeToggle on the Profile page is a separate control that
// mirrors the mobile app's split between a quick pill and this full screen.
export default function AppearancePage() {
  const router = useRouter();
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);

  return (
    <div className="px-4 pb-10 pt-4 md:px-6 md:pt-8">
      <div className="mb-5 flex items-center gap-2">
        <button onClick={() => router.back()} aria-label="Back" className="rounded-full p-1 hover:bg-inputBackground">
          <ChevronLeft size={22} />
        </button>
        <h1 className="text-xl font-bold text-textPrimary">Appearance</h1>
      </div>
      <div className="mx-auto max-w-md space-y-3">
        {OPTIONS.map(({ mode: optionMode, label, icon: Icon }) => {
          const selected = mode === optionMode;
          return (
            <button
              key={optionMode}
              onClick={() => setMode(optionMode)}
              aria-pressed={selected}
              className={`flex w-full items-center gap-3 rounded-md border-[1.5px] px-4 py-4 text-left ${
                selected ? 'border-primary bg-primary/5' : 'border-border bg-surface'
              }`}
            >
              <Icon size={20} className={selected ? 'text-primary' : 'text-textSecondary'} />
              <span className={`flex-1 text-[15px] ${selected ? 'font-medium text-primary' : 'text-textPrimary'}`}>{label}</span>
              {selected && <IoCheckmarkCircle size={20} className="text-primary" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
