'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Logo } from './Logo';
import { Search, Bell, MessageSquare, PlusCircle, ChevronDown } from '@/lib/icons';
import { categories } from '@/lib/categories';
import { CategoryIcon } from '@/lib/icons';
import { useAuthStore, useCurrentUser } from '@/store/auth';
import { requireAuth } from '@/store/authPrompt';
import { getUnreadCount, subscribeToNotifications } from '@/services/notifications';
import { listConversations, subscribeToInbox } from '@/services/chat';

// Desktop: full top nav (logo, search, categories, sell, messages,
// notifications, profile) per Phase 1 spec §28. Mobile: condensed bar —
// logo + search + notifications; Home/Sell/Chats/Profile live in the bottom
// tab bar (MobileTabBar) matching the mobile app's tab layout.
export function Header() {
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const user = useCurrentUser();
  const [query, setQuery] = useState('');
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [unreadChats, setUnreadChats] = useState(0);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) {
      setUnreadNotifs(0);
      setUnreadChats(0);
      return;
    }
    const refresh = () => {
      getUnreadCount(userId).then(setUnreadNotifs);
      listConversations(userId).then((cs) => setUnreadChats(cs.reduce((sum, c) => sum + c.unread, 0)));
    };
    refresh();
    const unsubNotifs = subscribeToNotifications(userId, refresh);
    const unsubChats = subscribeToInbox(userId, refresh);
    return () => {
      unsubNotifs();
      unsubChats();
    };
  }, [session?.user.id]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(query ? `/search?q=${encodeURIComponent(query)}` : '/search');
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-content items-center gap-4 px-4 md:px-6">
        <Logo />

        {/* Categories dropdown — desktop only */}
        <div className="relative hidden md:block">
          <button
            onClick={() => setCategoriesOpen((v) => !v)}
            onBlur={() => setTimeout(() => setCategoriesOpen(false), 150)}
            className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-textSecondary hover:bg-inputBackground"
          >
            Categories
            <ChevronDown size={14} />
          </button>
          {categoriesOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 grid w-[560px] grid-cols-2 gap-1 rounded-lg border border-border bg-surface p-3 shadow-md">
              {categories.map((cat) => (
                <Link
                  key={cat.id}
                  href={`/category/${cat.id}`}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-textSecondary hover:bg-inputBackground hover:text-textPrimary"
                >
                  <CategoryIcon icon={cat.icon} size={16} className="text-primary" />
                  {cat.name}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Search — desktop persistent bar, mobile icon-only */}
        <form onSubmit={submitSearch} className="hidden flex-1 md:flex">
          <div className="flex w-full max-w-md items-center gap-2 rounded-pill bg-inputBackground px-4 py-2">
            <Search size={16} className="text-textMuted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search phones, cars, furniture..."
              className="w-full bg-transparent text-sm text-textPrimary placeholder:text-textMuted focus:outline-none"
            />
          </div>
        </form>

        <div className="flex flex-1 items-center justify-end gap-1 md:flex-none md:gap-2">
          <Link href="/search" aria-label="Search" className="rounded-full p-2 hover:bg-inputBackground md:hidden">
            <Search size={20} className="text-textPrimary" />
          </Link>

          <button
            onClick={() => requireAuth(() => router.push('/sell'), { next: '/sell' })}
            className="hidden items-center gap-1.5 rounded-pill bg-primary px-4 py-2 text-sm font-semibold text-primaryText hover:opacity-90 md:flex"
          >
            <PlusCircle size={16} />
            Sell
          </button>

          <button
            onClick={() => requireAuth(() => router.push('/chat'), { next: '/chat' })}
            aria-label="Messages"
            className="relative hidden rounded-full p-2 hover:bg-inputBackground md:inline-flex"
          >
            <MessageSquare size={20} className="text-textPrimary" />
            {unreadChats > 0 && (
              <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">
                {unreadChats}
              </span>
            )}
          </button>

          <button
            onClick={() => requireAuth(() => router.push('/notifications'), { next: '/notifications' })}
            aria-label="Notifications"
            className="relative rounded-full p-2 hover:bg-inputBackground"
          >
            <Bell size={20} className="text-textPrimary" />
            {unreadNotifs > 0 && (
              <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">
                {unreadNotifs}
              </span>
            )}
          </button>

          <Link href="/profile" aria-label="Profile" className="ml-1 rounded-full">
            {user ? (
              <Image src={user.avatar} alt={user.name} width={34} height={34} className="rounded-full object-cover" />
            ) : (
              <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-inputBackground text-textSecondary">
                <UserGlyph />
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}

function UserGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}
