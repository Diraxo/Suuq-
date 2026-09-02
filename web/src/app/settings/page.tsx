'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronLeft, User, Briefcase, Ban, MapPin, Trash2, Palette, Languages, Bell, SlidersHorizontal,
  ShieldAlert, HelpCircle, FileText, Lock, Users as UsersIcon, Info, ChevronRight,
} from '@/lib/icons';
import { requireAuth } from '@/store/authPrompt';
import { useAuthStore } from '@/store/auth';
import { deleteAccount } from '@/services/accountDeletion';

// Mirrors app/settings/index.tsx on mobile: Account / Preferences / Support
// sections, same items, same order, and same authRequired flags.
const ACCOUNT_ITEMS = [
  { icon: User, label: 'Edit Profile', href: '/settings', auth: true },
  { icon: Briefcase, label: 'Business Profile', href: '/settings', auth: true },
  { icon: Ban, label: 'Blocked Users', href: '/settings', auth: true },
  { icon: MapPin, label: 'Saved Addresses', href: '/settings', auth: true },
  { icon: Trash2, label: 'Delete Account', href: '/settings', auth: true, danger: true, action: 'delete-account' as const },
];
const PREFERENCES_ITEMS = [
  { icon: Palette, label: 'Appearance', href: '/settings/appearance', auth: false },
  { icon: Languages, label: 'Language', href: '/settings/language', auth: false },
  { icon: Bell, label: 'Notifications', href: '/notifications', auth: true },
  { icon: SlidersHorizontal, label: 'Push Notifications', href: '/settings', auth: false },
  { icon: ShieldAlert, label: 'Safety Center', href: '/settings/safety', auth: false },
];
const SUPPORT_ITEMS = [
  { icon: HelpCircle, label: 'Help Center', href: '/settings', auth: false },
  { icon: FileText, label: 'Terms of Service', href: '/settings/terms', auth: false },
  { icon: Lock, label: 'Privacy Policy', href: '/settings/privacy-policy', auth: false },
  { icon: UsersIcon, label: 'Community Guidelines', href: '/settings/community-guidelines', auth: false },
  { icon: Info, label: 'About', href: '/about', auth: false },
];

function Section({
  title,
  items,
  onAuthAction,
}: {
  title: string;
  items: typeof ACCOUNT_ITEMS | typeof PREFERENCES_ITEMS | typeof SUPPORT_ITEMS;
  onAuthAction?: (action: string | undefined) => void;
}) {
  return (
    <div className="mb-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-textMuted">{title}</p>
      <div className="divide-y divide-border">
        {items.map((item) => {
          const Icon = item.icon;
          const danger = 'danger' in item && item.danger;
          const action = 'action' in item ? item.action : undefined;
          const row = (
            <>
              <Icon size={20} className={danger ? 'text-error' : 'text-textSecondary'} />
              <span className={`flex-1 text-sm ${danger ? 'text-error' : 'text-textPrimary'}`}>{item.label}</span>
              <ChevronRight size={18} className="text-textMuted" />
            </>
          );
          return item.auth ? (
            <button
              key={item.label}
              onClick={() => requireAuth(() => onAuthAction?.(action), { next: '/settings' })}
              className="flex w-full items-center gap-3 py-3 text-left"
            >
              {row}
            </button>
          ) : (
            <Link key={item.label} href={item.href} className="flex items-center gap-3 py-3">
              {row}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const signOut = useAuthStore((s) => s.signOut);

  const handleAuthAction = async (action: string | undefined) => {
    if (action !== 'delete-account') return; // other auth-gated items have no dedicated screen yet
    const confirmed = window.confirm(
      'Delete your SUUQIYE account? This permanently removes your listings, messages, favorites, and profile. This cannot be undone.'
    );
    if (!confirmed) return;
    const { error } = await deleteAccount();
    if (error) {
      alert(`Couldn't delete account: ${error}`);
      return;
    }
    await signOut();
    router.push('/');
  };

  return (
    <div className="px-4 pb-10 pt-4 md:px-6 md:pt-8">
      <div className="mb-5 flex items-center gap-2">
        <button onClick={() => router.back()} aria-label="Back" className="rounded-full p-1 hover:bg-inputBackground">
          <ChevronLeft size={22} />
        </button>
        <h1 className="text-xl font-bold text-textPrimary">Settings</h1>
      </div>
      <div className="mx-auto max-w-2xl">
        <Section title="Account" items={ACCOUNT_ITEMS} onAuthAction={handleAuthAction} />
        <Section title="Preferences" items={PREFERENCES_ITEMS} />
        <Section title="Support" items={SUPPORT_ITEMS} />
      </div>
    </div>
  );
}
