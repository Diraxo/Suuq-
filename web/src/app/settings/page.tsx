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
import { useT } from '@/lib/i18n';

// Mirrors app/settings/index.tsx on mobile: Account / Preferences / Support
// sections, same items, same order, and same authRequired flags.
const ACCOUNT_ITEMS = [
  { icon: User, label: 'Edit Profile', href: '/settings/edit-profile', auth: true },
  { icon: Briefcase, label: 'Business Profile', href: '/settings/business-profile', auth: true },
  { icon: Ban, label: 'Blocked Users', href: '/settings/blocked-users', auth: true },
  { icon: MapPin, label: 'Saved Addresses', href: '/settings/saved-addresses', auth: true },
  { icon: Trash2, label: 'Delete Account', href: '/settings', auth: true, danger: true, action: 'delete-account' as const },
];
const PREFERENCES_ITEMS = [
  { icon: Palette, label: 'Appearance', href: '/settings/appearance', auth: false },
  { icon: Languages, label: 'Language', href: '/settings/language', auth: false },
  { icon: Bell, label: 'Notifications', href: '/notifications', auth: true },
  { icon: SlidersHorizontal, label: 'Push Notifications', href: '/settings/push-notifications', auth: true },
  { icon: ShieldAlert, label: 'Safety Center', href: '/settings/safety', auth: false },
];
const SUPPORT_ITEMS = [
  { icon: HelpCircle, label: 'Help Center', href: '/help', auth: false },
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
  onAuthAction?: (action: string | undefined, href: string) => void;
}) {
  const t = useT();
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
              <span className={`flex-1 text-sm ${danger ? 'text-error' : 'text-textPrimary'}`}>{t.text(item.label)}</span>
              <ChevronRight size={18} className="text-textMuted" />
            </>
          );
          return item.auth ? (
            <button
              key={item.label}
              onClick={() => requireAuth(() => onAuthAction?.(action, item.href), { next: item.href })}
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
  const t = useT();
  const router = useRouter();
  const signOut = useAuthStore((s) => s.signOut);

  const handleAuthAction = async (action: string | undefined, href: string) => {
    if (action !== 'delete-account') {
      router.push(href);
      return;
    }
    const confirmed = window.confirm(
      t('web.t.deleteYourSuuqiyeAccountThis')
    );
    if (!confirmed) return;
    const { error } = await deleteAccount();
    if (error) {
      alert(t('web.m.deleteAccountFailed', { error }));
      return;
    }
    await signOut();
    router.push('/');
  };

  return (
    <div className="px-4 pb-10 pt-4 md:px-6 md:pt-8">
      <div className="mb-5 flex items-center gap-2">
        <button onClick={() => router.back()} aria-label={t('common.back')} className="rounded-full p-1 hover:bg-inputBackground">
          <ChevronLeft size={22} />
        </button>
        <h1 className="text-xl font-bold text-textPrimary">{t('settings.title')}</h1>
      </div>
      <div className="mx-auto max-w-2xl">
        <Section title={t('settings.account')} items={ACCOUNT_ITEMS} onAuthAction={handleAuthAction} />
        <Section title={t('settings.index.preferences')} items={PREFERENCES_ITEMS} />
        <Section title={t('settings.index.support')} items={SUPPORT_ITEMS} />
      </div>
    </div>
  );
}
