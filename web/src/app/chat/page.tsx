'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { MessageSquare } from '@/lib/icons';
import { EmptyState } from '@/components/EmptyState';
import { Conversation } from '@/lib/types';
import { listConversations, subscribeToInbox } from '@/services/chat';
import { useAuthStore } from '@/store/auth';
import { requireAuth } from '@/store/authPrompt';

// Mirrors app/(tabs)/chats.tsx on mobile: avatar + listing thumbnail badge,
// name, relative time, last message preview, unread count. Phase 2: real
// Supabase conversations + Realtime (store/chatConversations.ts on mobile).
export default function ChatListPage() {
  const session = useAuthStore((s) => s.session);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) requireAuth(() => {}, { next: '/chat' });
  }, [session]);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;
    const refresh = () => listConversations(userId).then((rows) => { setConversations(rows); setLoading(false); });
    refresh();
    return subscribeToInbox(userId, refresh);
  }, [session?.user.id]);

  if (!session) return <div className="min-h-[50vh]" />;

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <h1 className="mb-4 text-2xl font-bold text-textPrimary">Chats</h1>
      {loading ? (
        <p className="py-10 text-center text-sm text-textSecondary">Loading conversations…</p>
      ) : conversations.length === 0 ? (
        <EmptyState icon={MessageSquare} title="No conversations yet" message="Message a seller from any listing to start chatting." />
      ) : (
        <div className="divide-y divide-border">
          {conversations.map((c) => (
            <Link key={c.id} href={`/chat/${c.id}`} className="flex items-center gap-3 py-3">
              <div className="relative">
                <Image src={c.withUser.avatar} alt={c.withUser.name} width={52} height={52} className="rounded-full object-cover" />
                {c.listing.images[0] && (
                  <Image
                    src={c.listing.images[0]}
                    alt=""
                    width={22}
                    height={22}
                    className="absolute -bottom-0.5 -right-0.5 rounded border-2 border-background object-cover"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex justify-between">
                  <span className="font-medium text-textPrimary">{c.withUser.name}</span>
                  <span className="shrink-0 text-xs text-textMuted">{c.lastMessageAt}</span>
                </div>
                <p className="truncate text-sm text-textSecondary">{c.lastMessage}</p>
                <p className="truncate text-xs text-textMuted">Re: {c.listing.title}</p>
              </div>
              {c.unread > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-pill bg-accent px-1.5 text-[11px] font-bold text-white">{c.unread}</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
