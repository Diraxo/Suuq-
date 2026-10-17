'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Home, Search, PlusCircle, MessageSquare, User } from '@/lib/icons';
import { requireAuth } from '@/store/authPrompt';
import { homeRefresh } from '@/store/homeRefresh';

// Mirrors app/(tabs)/_layout.tsx on mobile: Home / Search / Sell / Chats /
// Profile, Sell and Chats gated behind sign-in. Hidden on md+ where the
// desktop Header carries this navigation instead.
const TABS = [
  { href: '/', label: 'Home', icon: Home, auth: false },
  { href: '/search', label: 'Search', icon: Search, auth: false },
  { href: '/sell', label: 'Sell', icon: PlusCircle, auth: true },
  { href: '/chat', label: 'Chats', icon: MessageSquare, auth: true },
  { href: '/profile', label: 'Profile', icon: User, auth: false },
] as const;

export function MobileTabBar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="flex h-16 items-center justify-around">
        {TABS.map((tab) => {
          const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          const go = () => {
            // Already on Home and tapping Home again: back to the default Home
            // view (filters cleared, scrolled to top) and refetch, in place
            // instead of a no-op push. Arriving from another tab never resets.
            if (tab.href === '/' && active) {
              homeRefresh.onHomeTabPress(true);
              return;
            }
            router.push(tab.href);
          };
          return (
            <button
              key={tab.href}
              onClick={() => (tab.auth ? requireAuth(go, { next: tab.href }) : go())}
              className="flex flex-1 flex-col items-center gap-1 py-1"
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={22} className={active ? 'text-primary' : 'text-textMuted'} fill={tab.href === '/sell' && active ? 'currentColor' : 'none'} />
              <span className={`text-[11px] ${active ? 'font-semibold text-primary' : 'text-textMuted'}`}>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
