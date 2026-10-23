'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  List, BarChart3, Heart, History, TrendingDown, Bookmark, Tag, Star, Users,
  ShieldCheck, Building2, Bell, Settings, HelpCircle, Info, LogOut, User as UserIcon, X,
} from '@/lib/icons';
import { Button } from '@/components/Button';
import { UserAvatar } from '@/components/UserAvatar';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAuthStore, useCurrentUser } from '@/store/auth';
import { requireAuth } from '@/store/authPrompt';
import { useSellerStatsStore } from '@/store/sellerStats';
import { ActiveIdentitySwitch } from '@/components/ActiveIdentitySwitch';
import { BusinessProfileCard } from '@/components/BusinessProfileCard';
import { ProfileHeaderCover } from '@/components/ProfileHeaderCover';
import { showModeSwitch } from '@/lib/profileIdentity';
import { useActiveMode } from '@/hooks/useActiveMode';
import { usePublicStorefront } from '@/hooks/usePublicStorefront';
import { useT, localeTag } from '@/lib/i18n';

const MENU = [
  { icon: List, label: 'My Listings', href: '/my-listings', auth: true },
  { icon: BarChart3, label: 'Seller Dashboard', href: '/seller-dashboard', auth: true },
  { icon: Heart, label: 'Favorites & Collections', href: '/favorites', auth: true },
  { icon: History, label: 'Recently Viewed', href: '/recently-viewed', auth: false },
  { icon: TrendingDown, label: 'Price Drops', href: '/price-drops', auth: true },
  { icon: Bookmark, label: 'Saved Searches', href: '/saved-searches', auth: true },
  { icon: Tag, label: 'Offers', href: '/offers', auth: true },
  { icon: Star, label: 'Reviews', href: '/reviews', auth: true },
  { icon: Users, label: 'Followers & Following', href: '/followers', auth: true },
  { icon: ShieldCheck, label: 'Verification', href: '/verification', auth: true },
  { icon: Building2, label: 'Business Dashboard', href: '/business/dashboard', auth: true },
  { icon: Bell, label: 'Notifications', href: '/notifications', auth: true },
  { icon: Settings, label: 'Settings', href: '/settings', auth: false },
  { icon: HelpCircle, label: 'Help & Support', href: '/help', auth: false },
  { icon: ShieldCheck, label: 'Notices & Support', href: '/support', auth: true },
  { icon: Info, label: 'About SUUQIYE', href: '/about', auth: false },
] as const;

// Mirrors app/(tabs)/profile.tsx on mobile: guest state (avatar placeholder +
// Continue with Google) vs signed-in state (avatar, stats row, menu list).
export default function ProfilePage() {
  const t = useT();
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const user = useCurrentUser();
  const signingIn = useAuthStore((s) => s.signingIn);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const signOut = useAuthStore((s) => s.signOut);
  // Read from the app-wide prefetch store (store/sellerStats.ts) instead of
  // fetching locally on mount — that store starts loading the moment auth
  // resolves, anywhere in the app, so by the time a user navigates here the
  // numbers are usually already warm instead of flashing zero on every visit.
  const stats = useSellerStatsStore((s) => s.stats);
  const statsHydrated = useSellerStatsStore((s) => s.hasHydrated);
  const profile = useAuthStore((s) => s.profile);
  // Gold only for a storefront staff have verified; blue only for the personal identity.
  const ownStorefront = usePublicStorefront(session?.user.id);
  // Which profile the owner is working in. The person above never changes; only the section below it does.
  const { mode } = useActiveMode();
  const [signInError, setSignInError] = useState<string | null>(null);
  const [viewingPhoto, setViewingPhoto] = useState(false);
  const memberSince = profile?.created_at ? new Date(profile.created_at).toLocaleDateString(localeTag(), { month: 'long', year: 'numeric' }) : null;

  const handleSignIn = async () => {
    setSignInError(null);
    const { error } = await signInWithGoogle('/profile');
    if (error) setSignInError(error);
  };

  return (
    <div className="px-4 pt-6 md:px-6 md:pt-8">
      <div className="mx-auto max-w-2xl">
        <div className="flex justify-end">
          <ThemeToggle />
        </div>
        {user ? (
          <div className="flex flex-col items-center">
            {/* One account, one identity: the same avatar, name and bio in both modes. Business mode only puts the business banner behind
                them and adds the business details below; there is never a second name or photo. */}
            <ProfileHeaderCover mode={mode} bannerUrl={profile?.business_banner_url}>
              {(c) => (
                <>
                  <button
                    type="button"
                    onClick={() => (user.avatar ? setViewingPhoto(true) : router.push('/settings/edit-profile'))}
                    aria-label={t('profile.viewPhotoLabel')}
                    className={`rounded-full ${c.ring}`}
                  >
                    <UserAvatar url={user.avatar} name={user.name} size={84} />
                  </button>
                  <h1 className={`mt-3 text-center text-xl font-bold ${c.primary}`}>{user.name}</h1>
                  <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                    {profile?.verified_at && (
                      <span className={`inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-xs font-medium bg-primary/10 text-primary`} aria-label={t('web.t.verifiedAccount')}>
                        <ShieldCheck size={13} /> {t('profile.verifiedBadge')}
                      </span>
                    )}
                    {memberSince && <span className={`text-xs ${c.secondary}`}>{t('profile.memberSince', { date: memberSince })}</span>}
                  </div>
                  {profile?.bio?.trim() && <p className={`mt-3 line-clamp-3 max-w-md text-center text-sm ${c.secondary}`}>{profile.bio.trim()}</p>}
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => router.push('/settings/edit-profile')}>
                    {t('settings.editProfile.title')}
                  </Button>
                </>
              )}
            </ProfileHeaderCover>
            {showModeSwitch(profile) ? (
              <ActiveIdentitySwitch />
            ) : (
              <Link href="/settings/business-profile" className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-primary/30 bg-surface p-4 text-left shadow-sm hover:bg-primary/5">
                <Building2 size={24} className="shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-textMuted">{t('business.createDashboard.label')}</span>
                  <span className="block text-sm font-semibold text-textPrimary">{t('business.createDashboard.title')}</span>
                  <span className="block text-xs text-textSecondary">{t('business.createDashboard.sub')}</span>
                </span>
              </Link>
            )}
            {mode === 'business' && profile && (
              <BusinessProfileCard
                profile={profile}
                verified={ownStorefront?.verified === true}
                isSelf
                storefrontHref={ownStorefront?.id ? `/storefront/${ownStorefront.id}` : undefined}
              />
            )}

            <div className="mt-6 grid w-full grid-cols-4 rounded-lg bg-surface py-4 shadow-sm">
              {(
                [
                  [t('business.analytics.listings'), stats.listingsCount, '/my-listings'],
                  [t('myListings.stats.sold'), stats.soldCount, '/my-listings?tab=sold'],
                  [t('settings.notificationPreferences.categories.followers.label'), stats.followers, '/followers'],
                  [t('business.rating'), stats.reviewCount > 0 ? stats.rating.toFixed(1) : '0.0', '/reviews'],
                ] as const
              ).map(([label, value, href]) => {
                const display = statsHydrated ? (
                  <p className="text-lg font-bold text-textPrimary">{value}</p>
                ) : (
                  <p className="mx-auto h-5 w-6 animate-pulse rounded bg-inputBackground" aria-hidden />
                );
                return href ? (
                  <Link key={label} href={href} className="text-center">
                    {display}
                    <p className="text-xs text-textSecondary">{label}</p>
                  </Link>
                ) : (
                  <div key={label} className="text-center">
                    {display}
                    <p className="text-xs text-textSecondary">{label}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-inputBackground">
              <UserIcon size={32} className="text-textMuted" />
            </div>
            <h1 className="mt-3 text-xl font-bold text-textPrimary">{t('profile.guestUser')}</h1>
            <p className="mt-1 max-w-xs text-center text-sm text-textSecondary">
              {t('profile.guestPrompt')}
            </p>
            {signInError && (
              <p className="mt-3 w-full max-w-xs rounded-md bg-error/10 px-3 py-2 text-center text-sm text-error">{signInError}</p>
            )}
            <GoogleSignInButton
              label={t('web.t.continueWithGoogle')}
              className="mt-4 max-w-xs"
              loading={signingIn}
              onClick={handleSignIn}
            />
          </div>
        )}

        <div className="mt-8 divide-y divide-border">
          {MENU.map((item) => {
            const Icon = item.icon;
            const content = (
              <>
                <Icon size={20} className="text-textSecondary" />
                <span className="flex-1 text-sm text-textPrimary">{t.text(item.label)}</span>
              </>
            );
            return item.auth ? (
              <button
                key={item.label}
                onClick={() => requireAuth(() => router.push(item.href), { next: item.href })}
                className="flex w-full items-center gap-3 py-3 text-left"
              >
                {content}
              </button>
            ) : (
              <Link key={item.label} href={item.href} className="flex items-center gap-3 py-3">
                {content}
              </Link>
            );
          })}
          {user && (
            <button onClick={() => signOut()} className="flex w-full items-center gap-3 py-3 text-left">
              <LogOut size={20} className="text-error" />
              <span className="flex-1 text-sm text-error">{t('profile.signOut')}</span>
            </button>
          )}
        </div>
      </div>

      {viewingPhoto && user?.avatar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" role="dialog" aria-modal="true" aria-label={t('avatar.menuTitle')} onClick={() => setViewingPhoto(false)}>
          <button type="button" className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white" onClick={() => setViewingPhoto(false)} aria-label={t('chat.closePhoto')}>
            <X size={22} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={user.avatar} alt={user.name} className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
