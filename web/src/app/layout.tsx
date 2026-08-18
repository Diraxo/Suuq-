import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Header } from '@/components/Header';
import { MobileTabBar } from '@/components/MobileTabBar';
import { Footer } from '@/components/Footer';
import { SignInModal } from '@/components/SignInModal';
import { ThemeApplier } from '@/components/ThemeApplier';
import { AuthInit } from '@/components/AuthInit';
import { PendingActionRunner } from '@/components/PendingActionRunner';
import { LanguageSync } from '@/components/LanguageSync';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Fursad — Marketplace',
  description: 'Browse listings, message sellers, and post your own — the Fursad marketplace, now on the web.',
  icons: { icon: '/favicon.png' },
};

// Runs synchronously, before the browser paints anything else in <body>,
// so the persisted (or system) theme's `dark` class is already on <html>
// by the time the first pixel is drawn — eliminates the light-mode flash
// on refresh that ThemeApplier's useEffect (which only runs after mount)
// can't prevent on its own. Reads the same zustand-persist localStorage key
// as src/store/theme.ts and the same system-preference check as
// ThemeApplier, so the two never disagree.
const THEME_INIT_SCRIPT = `(function(){try{var raw=localStorage.getItem('fursad-web-theme');var mode='system';if(raw){var parsed=JSON.parse(raw);mode=(parsed&&parsed.state&&parsed.state.mode)||'system';}var isDark=mode==='dark'||(mode==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(isDark)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-textPrimary" suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <ThemeApplier />
        <AuthInit />
        <PendingActionRunner />
        <LanguageSync />
        <Header />
        <main className="mx-auto min-h-[60vh] max-w-content pb-20 md:pb-0">{children}</main>
        <Footer />
        <MobileTabBar />
        <SignInModal />
      </body>
    </html>
  );
}
