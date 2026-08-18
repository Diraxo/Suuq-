'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  List, BarChart3, Heart, History, TrendingDown, Bookmark, Tag, Star, Users,
  ShieldCheck, Building2, Bell, Settings, HelpCircle, Info, LogOut, User as UserIcon,
} from '@/lib/icons';
import { Button } from '@/components/Button';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAuthStore, useCurrentUser } from '@/store/auth';
import { requireAuth } from '@/store/authPrompt';
import { useSellerStatsStore } from '@/store/sellerStats';

const MENU = [
  { icon: List, label: 'My Listings', href: '/my-listings', auth: true },
  { icon: BarChart3, label: 'Seller Dashboard', href: '/profile', auth: true },
  { icon: Heart, label: 'Favorites & Collections', href: '/favorites', auth: true },
  { icon: History, label: 'Recently Viewed', href: '/profile', auth: false },
  { icon: TrendingDown, label: 'Price Drops', href: '/profile', auth: true },
  { icon: Bookmark, label: 'Saved Searches', href: '/profile', auth: true },
  { icon: Tag, label: 'Offers', href: '/offers', auth: true },
  { icon: Star, label: 'Reviews', href: '/profile', auth: true },
  { icon: Users, label: 'Followers & Following', href: '/profile', auth: true },
  { icon: ShieldCheck, label: 'Verification', href: '/profile', auth: true },
  { icon: Building2, label: 'Business Dashboard', href: '/profile', auth: true },
  { icon: Bell, label: 'Notifications', href: '/notifications', auth: true },
  { icon: Settings, label: 'Settings', href: '/settings', auth: false },
  { icon: HelpCircle, label: 'Help & Support', href: '/settings', auth: false },
  { icon: Info, label: 'About Fursad', href: '/about', auth: false },
] as const;

// Mirrors app/(tabs)/profile.tsx on mobile: guest state (avatar placeholder +
// Continue with Google) vs signed-in state (avatar, stats row, menu list).
// Screens not yet built (Seller/Business Dashboard, Price Drops, Saved
// Searches, Followers, Verification) route back here for now — see
// PHASE3_REPORT.md. My Listings (+ listing edit/insights/price-drop) and
// Offers are real screens now.
export default function ProfilePage() {
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
  const [signInError, setSignInError] = useState<string | null>(null);

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
            <Image src={user.avatar} alt={user.name} width={84} height={84} className="rounded-full object-cover" />
            <h1 className="mt-3 text-xl font-bold text-textPrimary">{user.name}</h1>
            <span className="mt-1 rounded-pill bg-success/15 px-2.5 py-1 text-xs font-medium text-success">New Seller</span>
            <Button variant="outline" size="sm" className="mt-3">
              Edit Profile
            </Button>

            <div className="mt-6 grid w-full grid-cols-4 rounded-lg bg-surface py-4 shadow-sm">
              {(
                [
                  ['Listings', stats.listingsCount, '/my-listings'],
                  ['Sold', stats.soldCount, '/my-listings?tab=sold'],
                  ['Followers', stats.followers, null],
                  ['Rating', stats.reviewCount > 0 ? stats.rating.toFixed(1) : '0.0', null],
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
            <h1 className="mt-3 text-xl font-bold text-textPrimary">Guest User</h1>
            <p className="mt-1 max-w-xs text-center text-sm text-textSecondary">
              Sign in to access your listings, favorites, reviews and seller dashboard.
            </p>
            {signInError && (
              <p className="mt-3 w-full max-w-xs rounded-md bg-error/10 px-3 py-2 text-center text-sm text-error">{signInError}</p>
            )}
            <Button
              className="mt-4 w-full max-w-xs"
              loading={signingIn}
              onClick={handleSignIn}
              icon={<Image src="/google-logo.png" alt="" width={18} height={18} />}
            >
              Continue with Google
            </Button>
          </div>
        )}

        <div className="mt-8 divide-y divide-border">
          {MENU.map((item) => {
            const Icon = item.icon;
            const content = (
              <>
                <Icon size={20} className="text-textSecondary" />
                <span className="flex-1 text-sm text-textPrimary">{item.label}</span>
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
              <span className="flex-1 text-sm text-error">Sign out</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
