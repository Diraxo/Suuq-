'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Ban, CheckCircle2, Loader2 } from 'lucide-react';
import type { ChatMessage, ReactionType } from '@/hooks/useConversationChannel';
import { MessageBubble } from './MessageBubble';

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dateSeparatorLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (dayKey(iso) === dayKey(now.toISOString())) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

/** A private "You blocked / unblocked X" line (from block_events) shown inline in the thread, like WhatsApp. */
export type BlockEvent = { id: string; kind: 'blocked' | 'unblocked'; createdAt: string };

type Props = {
  messages: ChatMessage[]; // newest-first, as returned by useConversationChannel
  meId: string;
  peerLastReadAt: string | null;
  initialUnreadCount: number;
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onReply: (message: ChatMessage) => void;
  onReact: (messageId: string, reaction: ReactionType) => void;
  onRetry: (id: string) => void;
  onDismissFailed: (id: string) => void;
  blockEvents?: BlockEvent[];
  /** Name used in the "You blocked {name}" lines. */
  peerName?: string;
};

export function MessageList({
  messages,
  meId,
  peerLastReadAt,
  initialUnreadCount,
  hasMore,
  loadingOlder,
  onLoadOlder,
  onEdit,
  onDelete,
  onReply,
  onReact,
  onRetry,
  onDismissFailed,
  blockEvents,
  peerName = '',
}: Props) {
  const chronological = useMemo(() => [...messages].reverse(), [messages]);
  // Block events merged into the timeline. While older pages are unloaded, only events newer than the oldest loaded message
  // are shown, so a "You blocked X" line never floats above history that isn't there yet.
  const timeline = useMemo(() => {
    type Entry = { at: number; createdAt: string; key: string; message?: ChatMessage; event?: BlockEvent };
    const oldest = chronological.length > 0 ? new Date(chronological[0].createdAt).getTime() : 0;
    const events = (blockEvents ?? []).filter((e) => !hasMore || new Date(e.createdAt).getTime() >= oldest);
    return [
      ...chronological.map((m): Entry => ({ at: new Date(m.createdAt).getTime(), createdAt: m.createdAt, key: m.id, message: m })),
      ...events.map((e): Entry => ({ at: new Date(e.createdAt).getTime(), createdAt: e.createdAt, key: `event-${e.id}`, event: e })),
    ].sort((a, b) => a.at - b.at || (a.event ? 1 : 0) - (b.event ? 1 : 0));
  }, [chronological, blockEvents, hasMore]);
  const messageById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const dividerId = useMemo(() => {
    if (initialUnreadCount <= 0 || messages.length === 0) return null;
    const idx = Math.min(initialUnreadCount, messages.length) - 1;
    return messages[idx]?.id ?? null;
  }, [messages, initialUnreadCount]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastNewestIdRef = useRef<string | null>(null);
  const isFirstRenderRef = useRef(true);

  useEffect(() => {
    const newest = messages[0]?.id ?? null;
    if (newest === lastNewestIdRef.current) return;
    lastNewestIdRef.current = newest;

    const container = containerRef.current;
    const nearBottom = !container || container.scrollHeight - container.scrollTop - container.clientHeight < 200;
    if (isFirstRenderRef.current || nearBottom) {
      bottomRef.current?.scrollIntoView({ block: 'end', behavior: isFirstRenderRef.current ? 'auto' : 'smooth' });
    }
    isFirstRenderRef.current = false;
  }, [messages]);

  return (
    <div ref={containerRef} className="flex-1 space-y-1 overflow-y-auto px-4 py-4">
      {hasMore && (
        <div className="flex justify-center pb-2">
          <button
            onClick={onLoadOlder}
            disabled={loadingOlder}
            className="flex items-center gap-1.5 rounded-pill border border-border px-3 py-1.5 text-xs text-textSecondary hover:bg-inputBackground disabled:opacity-60"
          >
            {loadingOlder && <Loader2 size={12} className="animate-spin" />}
            {loadingOlder ? 'Loading…' : 'Load older messages'}
          </button>
        </div>
      )}

      {timeline.map((entry, i) => {
        const older = timeline[i - 1];
        const showDateSeparator = !older || dayKey(older.createdAt) !== dayKey(entry.createdAt);
        if (!entry.message) {
          const event = entry.event!;
          return (
            <div key={entry.key}>
              {showDateSeparator && (
                <div className="my-3 flex justify-center">
                  <span className="rounded-pill bg-inputBackground px-2.5 py-1 text-[11px] text-textMuted">{dateSeparatorLabel(entry.createdAt)}</span>
                </div>
              )}
              <div className="my-2 flex justify-center">
                <span role="status" className="inline-flex max-w-[90%] items-center gap-1.5 rounded-pill bg-inputBackground px-3 py-1.5 text-xs text-textMuted">
                  {event.kind === 'blocked' ? <Ban size={13} /> : <CheckCircle2 size={13} />}
                  {event.kind === 'blocked' ? `You blocked ${peerName}` : `You unblocked ${peerName}`}
                </span>
              </div>
            </div>
          );
        }
        const message = entry.message;
        const seen = message.senderId === meId && !!peerLastReadAt && new Date(message.createdAt) <= new Date(peerLastReadAt);
        const replyMessage = message.replyToId ? (messageById.get(message.replyToId) ?? null) : null;
        const replyPreview = message.replyToId
          ? { text: replyMessage?.text ?? null, legacyPhoto: replyMessage?.legacyPhoto ?? false, senderIsMine: replyMessage?.senderId === meId }
          : null;

        return (
          <div key={message.id}>
            {showDateSeparator && (
              <div className="my-3 flex justify-center">
                <span className="rounded-pill bg-inputBackground px-2.5 py-1 text-[11px] text-textMuted">{dateSeparatorLabel(message.createdAt)}</span>
              </div>
            )}
            {message.id === dividerId && (
              <div className="my-3 flex items-center gap-2">
                <div className="h-px flex-1 bg-accent/30" />
                <span className="text-[11px] font-medium text-accent">{initialUnreadCount} unread</span>
                <div className="h-px flex-1 bg-accent/30" />
              </div>
            )}
            <MessageBubble
              message={message}
              isMine={message.senderId === meId}
              meId={meId}
              seen={seen}
              replyPreview={replyPreview}
              onEdit={onEdit}
              onDelete={onDelete}
              onReply={onReply}
              onReact={onReact}
              onRetry={onRetry}
              onDismissFailed={onDismissFailed}
            />
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
