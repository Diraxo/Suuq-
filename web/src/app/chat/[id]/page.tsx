'use client';

import { use, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, notFound } from 'next/navigation';
import { AlertCircle, Ban, ChevronLeft, Phone, Tag as TagIcon, X } from 'lucide-react';
import { Conversation } from '@/lib/types';
import { getConversation } from '@/services/chat';
import { formatBirr } from '@/lib/currency';
import { formatRelativeTime } from '@/lib/time';
import { useAuthStore } from '@/store/auth';
import { requireAuth } from '@/store/authPrompt';
import { useConversationChannel, ChatMessage } from '@/hooks/useConversationChannel';
import { useBlockedEitherWayIds } from '@/lib/blocking';
import { MessageList } from '@/components/chat/MessageList';
import { MessageComposer, ComposerEditTarget } from '@/components/chat/MessageComposer';
import { MessageImageViewer } from '@/components/chat/MessageImageViewer';

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
  const [viewerImages, setViewerImages] = useState<{ images: string[]; index: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const blockedIds = useBlockedEitherWayIds();
  const isBlocked = !!conversation && blockedIds.has(conversation.withUser.id);

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

  const chat = useConversationChannel(conversation && !isBlocked ? conversation.id : null, meId ?? null, conversation ? conversation.withUser.id : null);

  if (!session) return <div className="min-h-[50vh]" />;
  if (conversation === null) notFound();
  if (conversation === undefined || !meId) return <div className="min-h-[50vh]" />;

  const subtitle = chat.typingUser
    ? 'Typing…'
    : chat.presence.online
      ? 'Online'
      : conversation.withUser.lastSeenAt
        ? `Last seen ${formatRelativeTime(new Date(conversation.withUser.lastSeenAt).getTime())}`
        : conversation.listing.title;

  const handleSend = async (input: { text?: string; images?: string[]; imageKeys?: string[]; replyToId?: string | null }) => {
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

  if (isBlocked) {
    return (
      <div className="flex h-[calc(100vh-4rem)] flex-col">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <button onClick={() => router.back()} aria-label="Back to chats" className="rounded-full p-1 hover:bg-inputBackground">
            <ChevronLeft size={20} />
          </button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <Ban size={32} className="text-textMuted" />
          <p className="font-medium text-textPrimary">This conversation isn&apos;t available</p>
          <p className="text-sm text-textSecondary">You can&apos;t message this user right now.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col md:h-[calc(100vh-4rem-1px)]">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button onClick={() => router.push('/chat')} aria-label="Back to chats" className="rounded-full p-1 hover:bg-inputBackground">
          <ChevronLeft size={20} />
        </button>
        <div className="relative">
          <Image src={conversation.withUser.avatar} alt={conversation.withUser.name} width={36} height={36} className="rounded-full object-cover" />
          {chat.presence.online && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-success" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-textPrimary">{conversation.withUser.name}</p>
          <p className={`truncate text-xs ${chat.typingUser ? 'text-primary' : chat.presence.online ? 'text-success' : 'text-textMuted'}`}>{subtitle}</p>
        </div>
        {conversation.withUser.phone && (
          <a href={`tel:${conversation.withUser.phone}`} aria-label={`Call ${conversation.withUser.name}`} className="rounded-full p-2 text-primary hover:bg-inputBackground">
            <Phone size={18} />
          </a>
        )}
      </div>

      <Link href={`/listing/${conversation.listing.id}`} className="flex items-center gap-2 border-b border-border bg-inputBackground px-4 py-2">
        {conversation.listing.images[0] && (
          <Image src={conversation.listing.images[0]} alt="" width={32} height={32} className="rounded object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-textPrimary">{conversation.listing.title}</p>
          <p className="text-xs font-semibold text-primary">{formatBirr(conversation.listing.price)}</p>
        </div>
      </Link>

      <div className="flex gap-2 px-4 pt-2">
        <Link
          href={`/offers?listingId=${conversation.listing.id}&currency=${conversation.listing.currency}`}
          className="flex items-center gap-1 rounded-pill border border-primary px-2.5 py-1 text-xs font-medium text-primary"
        >
          <TagIcon size={12} />
          Make offer
        </Link>
      </div>

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
          onImagePress={(images, index) => setViewerImages({ images, index })}
          onRetry={chat.retrySend}
          onDismissFailed={chat.dismissFailed}
        />
      )}

      {!chat.initializing && chat.messages.length === 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {QUICK_REPLIES.map((q) => (
            <button key={q} onClick={() => handleSend({ text: q })} className="rounded-pill border border-border px-2.5 py-1.5 text-xs text-textSecondary hover:bg-inputBackground">
              {q}
            </button>
          ))}
        </div>
      )}

      <MessageComposer
        onSend={handleSend}
        onTyping={chat.sendTyping}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
        onSubmitEdit={handleSubmitEdit}
        uploadFolder={`chat/${conversation.id}/${meId}`}
      />

      {viewerImages && <MessageImageViewer images={viewerImages.images} initialIndex={viewerImages.index} onClose={() => setViewerImages(null)} />}
    </div>
  );
}
