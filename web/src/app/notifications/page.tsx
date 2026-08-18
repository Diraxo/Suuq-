'use client';

import { useEffect, useState } from 'react';
import { Bell, Heart, Users, MessageCircle, Tag, TrendingDown, X } from '@/lib/icons';
import { EmptyState } from '@/components/EmptyState';
import { Notif, NotifType } from '@/lib/types';
import { listNotifications, markAllRead, markRead, dismissNotification, subscribeToNotifications } from '@/services/notifications';
import { useAuthStore } from '@/store/auth';
import { requireAuth } from '@/store/authPrompt';

const TYPE_ICON: Record<NotifType, typeof Bell> = {
  favorite: Heart,
  follow: Users,
  message: MessageCircle,
  offer: Tag,
  listing: TrendingDown,
  system: Bell,
};

// Mirrors app/notifications.tsx on mobile: unread rows tinted, mark-all-read,
// per-item dismiss, same notification types the mobile app surfaces.
// Phase 2: real Supabase `notifications` table + realtime updates.
export default function NotificationsPage() {
  const session = useAuthStore((s) => s.session);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) requireAuth(() => {}, { next: '/notifications' });
  }, [session]);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;
    const refresh = () => listNotifications(userId).then((rows) => { setNotifs(rows); setLoading(false); });
    refresh();
    return subscribeToNotifications(userId, refresh);
  }, [session?.user.id]);

  if (!session) return <div className="min-h-[50vh]" />;

  const hasUnread = notifs.some((n) => n.unread);

  const markAll = () => {
    setNotifs((n) => n.map((x) => ({ ...x, unread: false })));
    markAllRead(session.user.id);
  };

  const dismiss = (id: string) => {
    setNotifs((list) => list.filter((x) => x.id !== id));
    dismissNotification(session.user.id, id);
  };

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-textPrimary">Notifications</h1>
        {hasUnread && (
          <button onClick={markAll} className="text-sm font-medium text-primary">
            Mark all read
          </button>
        )}
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-textSecondary">Loading…</p>
      ) : notifs.length === 0 ? (
        <EmptyState icon={Bell} title="You're all caught up" message="New activity on your listings and chats will show up here." />
      ) : (
        <div className="space-y-1">
          {notifs.map((n) => {
            const Icon = TYPE_ICON[n.type];
            return (
              <div
                key={n.id}
                onClick={() => n.unread && markRead(session.user.id, n.id)}
                className={`flex items-start gap-3 rounded-md p-3 ${n.unread ? 'bg-primary/5' : ''}`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface shadow-sm">
                  <Icon size={16} className="text-primary" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-textPrimary">{n.title}</p>
                  <p className="text-sm text-textSecondary">{n.body}</p>
                  <p className="mt-0.5 text-xs text-textMuted">{n.time}</p>
                </div>
                {n.unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    dismiss(n.id);
                  }}
                  aria-label="Dismiss notification"
                  className="ml-1 rounded-full p-1 text-textMuted hover:bg-inputBackground"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
