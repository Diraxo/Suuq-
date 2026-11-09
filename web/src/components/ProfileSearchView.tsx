'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  List, BarChart3, Heart, History, TrendingDown, Bookmark, Tag, Star, Users, ShieldCheck, Building2, Bell, Settings, HelpCircle, Info,
  User, Briefcase, Ban, MapPin, Trash2, Palette, Languages, SlidersHorizontal, ShieldAlert, FileText, Lock, Search, X, ChevronRight,
} from '@/lib/icons';
import { requireAuth } from '@/store/authPrompt';
import { useT } from '@/lib/i18n';
import { searchProfileEntries, type ProfileSearchEntry } from '@/lib/profileSearch';

type Section = 'Account' | 'Preferences' | 'Support';
type Item = { id: string; label: string; icon: typeof List; href: string; auth: boolean; section?: Section };

// Mirrors components/ProfileSearchView.tsx on mobile: Profile items, then every Settings page (listed once even where both link to it).
const ITEMS: Item[] = [
  { id: 'myListings', label: 'My Listings', icon: List, href: '/my-listings', auth: true },
  { id: 'sellerDashboard', label: 'Seller Dashboard', icon: BarChart3, href: '/seller-dashboard', auth: true },
  { id: 'favorites', label: 'Favorites & Collections', icon: Heart, href: '/favorites', auth: true },
  { id: 'recentlyViewed', label: 'Recently Viewed', icon: History, href: '/recently-viewed', auth: false },
  { id: 'priceDrops', label: 'Discounts', icon: TrendingDown, href: '/price-drops', auth: true },
  { id: 'savedSearches', label: 'Saved Searches', icon: Bookmark, href: '/saved-searches', auth: true },
  { id: 'offers', label: 'Offers', icon: Tag, href: '/offers', auth: true },
  { id: 'reviews', label: 'Reviews', icon: Star, href: '/reviews', auth: true },
  { id: 'followers', label: 'Followers & Following', icon: Users, href: '/followers', auth: true },
  { id: 'verification', label: 'Verification', icon: ShieldCheck, href: '/verification', auth: true },
  { id: 'businessDashboard', label: 'Business Dashboard', icon: Building2, href: '/business/dashboard', auth: true },
  { id: 'notifications', label: 'Notifications', icon: Bell, href: '/notifications', auth: true },
  { id: 'support', label: 'Notices & Support', icon: ShieldCheck, href: '/support', auth: true },
  { id: 'settings', label: 'Settings', icon: Settings, href: '/settings', auth: false },
  { id: 'help', label: 'Help & Support', icon: HelpCircle, href: '/help', auth: false },
  { id: 'about', label: 'About SUUQIYE', icon: Info, href: '/about', auth: false },
  { id: 'editProfile', label: 'Edit Profile', icon: User, href: '/settings/edit-profile', auth: true, section: 'Account' },
  { id: 'businessProfile', label: 'Business Profile', icon: Briefcase, href: '/settings/business-profile', auth: true, section: 'Account' },
  { id: 'blockedUsers', label: 'Blocked Users', icon: Ban, href: '/settings/blocked-users', auth: true, section: 'Account' },
  { id: 'savedAddresses', label: 'Saved Addresses', icon: MapPin, href: '/settings/saved-addresses', auth: true, section: 'Account' },
  { id: 'deleteAccount', label: 'Delete Account', icon: Trash2, href: '/settings', auth: true, section: 'Account' },
  { id: 'appearance', label: 'Appearance', icon: Palette, href: '/settings/appearance', auth: false, section: 'Preferences' },
  { id: 'language', label: 'Language', icon: Languages, href: '/settings/language', auth: false, section: 'Preferences' },
  { id: 'pushNotifications', label: 'Push Notifications', icon: SlidersHorizontal, href: '/settings/push-notifications', auth: true, section: 'Preferences' },
  { id: 'safety', label: 'Safety Center', icon: ShieldAlert, href: '/settings/safety', auth: false, section: 'Preferences' },
  { id: 'terms', label: 'Terms of Service', icon: FileText, href: '/settings/terms', auth: false, section: 'Support' },
  { id: 'privacyPolicy', label: 'Privacy Policy', icon: Lock, href: '/settings/privacy-policy', auth: false, section: 'Support' },
  { id: 'communityGuidelines', label: 'Community Guidelines', icon: Users, href: '/settings/community-guidelines', auth: false, section: 'Support' },
];

type Entry = ProfileSearchEntry & { icon: typeof List };

// Survives the Profile page unmounting when a result opens, so Back returns to the same search (the app keeps this by staying mounted).
let lastQuery: string | null = null;
export const hasOpenProfileSearch = () => lastQuery !== null;

/** Replaces the Profile body while open (the WhatsApp "You" search). Shows everything until the user types. */
export function ProfileSearchView({ onClose }: { onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [query, setQueryState] = useState(lastQuery ?? '');
  const setQuery = (q: string) => {
    lastQuery = q;
    setQueryState(q);
  };
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!query) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuilt when the language changes (t changes identity), so matching is always against the words on screen.
  const entries = useMemo<Entry[]>(
    () =>
      ITEMS.map((i) => ({
        id: i.id,
        label: t.text(i.label),
        path: i.section ? `${t.text('Settings')} → ${t.text(i.section)}` : '',
        href: i.href,
        authRequired: i.auth,
        icon: i.icon,
      })),
    [t],
  );
  const results = useMemo(() => searchProfileEntries(entries, query) as Entry[], [entries, query]);

  const open = (e: Entry) => {
    if (e.authRequired) requireAuth(() => router.push(e.href), { next: e.href });
    else router.push(e.href);
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="flex h-10 flex-1 items-center gap-2 rounded-pill border border-border bg-inputBackground px-3">
          <Search size={18} className="shrink-0 text-textMuted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('profile.search.placeholder')}
            aria-label={t('profile.search.open')}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-base text-textPrimary outline-none placeholder:text-textMuted"
          />
          {query && (
            <button type="button" onClick={() => { setQuery(''); inputRef.current?.focus(); }} aria-label={t('profile.search.clear')} className="text-textMuted">
              <X size={16} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            lastQuery = null;
            onClose();
          }}
          aria-label={t('profile.search.close')}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-inputBackground text-textPrimary"
        >
          <X size={20} />
        </button>
      </div>

      {results.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-16 text-center">
          <Search size={40} className="text-textMuted" />
          <p className="mt-3 text-sm font-medium text-textPrimary">{t('profile.search.noResultsTitle', { query: query.trim() })}</p>
          <p className="mt-1 text-xs text-textSecondary">{t('profile.search.noResultsHint')}</p>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {results.map((e) => {
            const Icon = e.icon;
            return (
              <li key={e.id}>
                <button type="button" onClick={() => open(e)} className="flex w-full items-center gap-3 py-3 text-left">
                  <Icon size={20} className="shrink-0 text-textSecondary" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-textPrimary">{e.label}</span>
                    {e.path && <span className="block text-xs text-textMuted">{e.path}</span>}
                  </span>
                  <ChevronRight size={18} className="shrink-0 text-textMuted" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
