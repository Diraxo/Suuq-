'use client';

import { use, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, notFound } from 'next/navigation';
import { AlertCircle, Ban, ChevronLeft, Phone, Tag as TagIcon, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useBlockedUsersStore } from '@/store/blockedUsers';
import { Conversation } from '@/lib/types';
import { getConversation } from '@/services/chat';
import { formatBirr } from '@/lib/currency';
import { formatRelativeTime } from '@/lib/time';
import { useAuthStore } from '@/store/auth';
import { requireAuth } from '@/store/authPrompt';
import { useConversationChannel, ChatMessage } from '@/hooks/useConversationChannel';
import { UserSafetyMenu } from '@/components/UserSafetyMenu';
import { MessageList, type BlockEvent } from '@/components/chat/MessageList';
import { MessageComposer, ComposerEditTarget } from '@/components/chat/MessageComposer';

const QUICK_REPLIES = ['Is this still available?', "What's your best price?", 'Can I see it today?'];

// Mirrors app/chat/[id].tsx on mobile: listing context bar under the header,
// realtime message list (hooks/useConversationChannel.ts port), composer at
// the bottom. Every write (send/edit/delete/read-receipt) goes through the
// same Supabase tables/RPCs the mobile app uses — no second backend.
export default function ChatDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const meId = session?.user.id;
  const [conversation, setConversation] = useState<Conversation | null | undefined>(undefined);
  const [editing, setEditing] = useState<ComposerEditTarget>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

  // WhatsApp model: when I have blocked them I keep the whole conversation (history + a "You blocked X" line) but can't
  // send until I unblock. When THEY blocked me nothing changes on my screen — my messages simply never get a second tick.
  const withUserId = conversation?.withUser.id ?? null;
  const blockedByMe = useBlockedUsersStore((s) => !!withUserId && s.blocked.some((b) => b.id === withUserId));
  const blockVersion = useBlockedUsersStore((s) => s.version);
  const [blockEvents, setBlockEvents] = useState<BlockEvent[]>([]);

  useEffect(() => {
    if (!session) requireAuth(() => {}, { next: `/chat/${id}` });
  }, [session, id]);

  useEffect(() => {
    if (!meId) return;
    let cancelled = false;
    getConversation(id, meId).then((c) => {
      if (!cancelled) setConversation(c ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [id, meId]);

  // Private "You blocked / unblocked X" log (only its author can read it). Refetched after every block/unblock completes.
  useEffect(() => {
    if (!withUserId || !meId) return;
    let cancelled = false;
    supabase
      .from('block_events')
      .select('id, kind, created_at')
      .eq('other_id', withUserId)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (cancelled) return;
        setBlockEvents(((data ?? []) as { id: string; kind: 'blocked' | 'unblocked'; created_at: string }[]).map((e) => ({ id: e.id, kind: e.kind, createdAt: e.created_at })));
      });
    return () => {
      cancelled = true;
    };
  }, [withUserId, meId, blockVersion]);

  const chat = useConversationChannel(conversation ? conversation.id : null, meId ?? null, withUserId, blockedByMe);
  const typingUser = !blockedByMe && chat.typingUser;
  const peerOnline = !blockedByMe && chat.presence.online;

  if (!session) return <div className="min-h-[50vh]" />;
  if (conversation === null) notFound();
  if (conversation === undefined || !meId) return <div className="min-h-[50vh]" />;

  const subtitle = typingUser
    ? 'Typing…'
    : peerOnline
      ? 'Online'
      : !blockedByMe && conversation.withUser.lastSeenAt
        ? `Last seen ${formatRelativeTime(new Date(conversation.withUser.lastSeenAt).getTime())}`
        : conversation.listing.title;

  const handleSend = async (input: { text?: string; replyToId?: string | null }) => {
    setError(null);
    await chat.sendMessage(input);
  };

  const handleSubmitEdit = async (msgId: string, text: string) => {
    const { error: err } = await chat.editMessage(msgId, text);
    if (err) setError(err);
    setEditing(null);
  };

  const handleDelete = async (message: ChatMessage) => {
    if (!window.confirm('Delete this message?')) return;
    const { error: err } = await chat.deleteMessage(message.id);
    if (err) setError(err);
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col md:h-[calc(100vh-4rem-1px)]">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button onClick={() => router.push('/chat')} aria-label="Back to chats" className="rounded-full p-1 hover:bg-inputBackground">
          <ChevronLeft size={20} />
        </button>
        <Link href={`/seller/${conversation.withUser.id}`} aria-label={`View ${conversation.withUser.name}'s profile`} className="flex min-w-0 flex-1 items-center gap-3">
          <div className="relative">
            <Image src={conversation.withUser.avatar} alt={conversation.withUser.name} width={36} height={36} className="rounded-full object-cover" />
            {peerOnline && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-success" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-textPrimary">{conversation.withUser.name}</p>
            <p className={`truncate text-xs ${typingUser ? 'text-primary' : peerOnline ? 'text-success' : 'text-textMuted'}`}>{subtitle}</p>
          </div>
        </Link>
        {conversation.withUser.phone && !blockedByMe && (
          <a href={`tel:${conversation.withUser.phone}`} aria-label={`Call ${conversation.withUser.name}`} className="rounded-full p-2 text-primary hover:bg-inputBackground">
            <Phone size={18} />
          </a>
        )}
        <UserSafetyMenu
          userId={conversation.withUser.id}
          userName={conversation.withUser.name}
          listingId={conversation.listingUnavailable ? null : conversation.listing.id}
          conversationId={conversation.id}
          source="chat"
        />
      </div>

      {conversation.listingUnavailable ? (
        <div className="flex items-center gap-2 border-b border-border bg-inputBackground px-4 py-2">
          <p className="truncate text-xs text-textMuted">{conversation.listing.title}</p>
        </div>
      ) : (
        <>
          <Link href={`/listing/${conversation.listing.id}`} className="flex items-center gap-2 border-b border-border bg-inputBackground px-4 py-2">
            {conversation.listing.images[0] && (
              <Image src={conversation.listing.images[0]} alt="" width={32} height={32} className="rounded object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-textPrimary">{conversation.listing.title}</p>
              <p className="text-xs font-semibold text-primary">{formatBirr(conversation.listing.price, conversation.listing.currency)}</p>
            </div>
          </Link>

          {!blockedByMe && (
          <div className="flex gap-2 px-4 pt-2">
            <Link
              href={`/offers?listingId=${conversation.listing.id}&currency=${conversation.listing.currency}`}
              className="flex items-center gap-1 rounded-pill border border-primary px-2.5 py-1 text-xs font-medium text-primary"
            >
              <TagIcon size={12} />
              Make offer
            </Link>
          </div>
          )}
        </>
      )}

      {error && (
        <div className="mx-4 mt-2 flex items-start gap-2 rounded-md bg-error/10 px-3 py-2 text-xs text-error">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <p className="flex-1">{error}</p>
          <button onClick={() => setError(null)} aria-label="Dismiss error">
            <X size={14} />
          </button>
        </div>
      )}

      {chat.initializing ? (
        <div className="flex-1 px-4 py-4 text-center text-sm text-textSecondary">Loading conversation…</div>
      ) : (
        <MessageList
          messages={chat.messages}
          meId={meId}
          peerLastReadAt={chat.peerLastReadAt}
          blockEvents={blockEvents}
          peerName={conversation.withUser.name}
          initialUnreadCount={chat.initialUnreadCount}
          hasMore={chat.hasMore}
          loadingOlder={chat.loadingOlder}
          onLoadOlder={chat.loadOlder}
          onEdit={(m) => {
            setReplyTo(null);
            setEditing({ id: m.id, text: m.text ?? '' });
          }}
          onDelete={handleDelete}
          onReply={(m) => {
            setEditing(null);
            setReplyTo(m);
          }}
          onReact={chat.toggleReaction}
          onRetry={chat.retrySend}
          onDismissFailed={chat.dismissFailed}
        />
      )}

      {!blockedByMe && !chat.initializing && chat.messages.length === 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {QUICK_REPLIES.map((q) => (
            <button key={q} onClick={() => handleSend({ text: q })} className="rounded-pill border border-border px-2.5 py-1.5 text-xs text-textSecondary hover:bg-inputBackground">
              {q}
            </button>
          ))}
        </div>
      )}

      {blockedByMe ? (
        <div role="region" aria-label="Blocked contact" className="space-y-2 border-t border-border bg-surface px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-textPrimary">
            <Ban size={16} className="text-textMuted" /> You blocked {conversation.withUser.name}
          </p>
          <p className="text-xs text-textMuted">You won&apos;t send or receive messages from them. Unblock to chat again.</p>
          <button
            onClick={() => void useBlockedUsersStore.getState().unblock(conversation.withUser.id)}
            className="rounded-pill border border-primary px-4 py-1.5 text-sm font-medium text-primary hover:bg-primary/5"
          >
            Unblock
          </button>
        </div>
      ) : (
      <MessageComposer
        onSend={handleSend}
        onTyping={chat.sendTyping}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
        onSubmitEdit={handleSubmitEdit}
      />
      )}
    </div>
  );
}
