import { useMemo } from 'react';
import { FlatList, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';
import type { ChatMessage } from '@/hooks/useConversationChannel';
import { MessageBubble } from './MessageBubble';
import { DateSeparator, dateSeparatorLabel } from './DateSeparator';
import { UnreadSeparator } from './UnreadSeparator';
import { SystemNotice } from './SystemNotice';

/** A private "You blocked / unblocked X" line (from block_events) shown inline in the thread, like WhatsApp. */
export type BlockEvent = { id: string; kind: 'blocked' | 'unblocked'; createdAt: string };

type ListItem =
  | { type: 'message'; key: string; message: ChatMessage }
  | { type: 'date'; key: string; label: string }
  | { type: 'unread'; key: string; count: number }
  | { type: 'event'; key: string; event: BlockEvent };

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// messages is newest-first (index 0 = newest), matching an inverted FlatList
// (index 0 renders at the bottom of the screen). A separator pushed
// immediately after message[i] in this array ends up rendering just above
// it on screen — exactly where a "start of a new day" / "unread" divider
// belongs relative to the messages beneath it.
function buildListItems(messages: ChatMessage[], unreadCount: number, events: BlockEvent[], hasMore: boolean, t: (key: string) => string): ListItem[] {
  const items: ListItem[] = [];
  // The boundary message (index unreadCount - 1) is normally within the
  // loaded window — the hook loads enough of the page to guarantee that. If
  // an extreme backlog still exceeds what was loaded, pin the divider to the
  // oldest loaded message instead of silently dropping it, so the true count
  // is still visible.
  const dividerIndex = unreadCount > 0 ? Math.min(unreadCount, messages.length) - 1 : -1;

  // Merge block events into the message timeline (both newest-first). While older pages are still unloaded, only show
  // events newer than the oldest loaded message so a "You blocked X" line never floats above history that isn't there yet.
  const oldestLoaded = messages.length > 0 ? new Date(messages[messages.length - 1].createdAt).getTime() : 0;
  const visibleEvents = events.filter((e) => !hasMore || new Date(e.createdAt).getTime() >= oldestLoaded);
  type Entry = { at: number; createdAt: string; msg?: ChatMessage; msgIndex?: number; event?: BlockEvent };
  const entries: Entry[] = [
    ...messages.map((m, i): Entry => ({ at: new Date(m.createdAt).getTime(), createdAt: m.createdAt, msg: m, msgIndex: i })),
    ...visibleEvents.map((e): Entry => ({ at: new Date(e.createdAt).getTime(), createdAt: e.createdAt, event: e })),
  ].sort((x, y) => y.at - x.at || (x.event ? 1 : 0) - (y.event ? 1 : 0));

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.msg) {
      items.push({ type: 'message', key: entry.msg.id, message: entry.msg });
      if (entry.msgIndex === dividerIndex) items.push({ type: 'unread', key: 'unread-separator', count: unreadCount });
    } else if (entry.event) {
      items.push({ type: 'event', key: `event-${entry.event.id}`, event: entry.event });
    }

    const older = entries[i + 1];
    if (!older || dayKey(older.createdAt) !== dayKey(entry.createdAt)) {
      items.push({ type: 'date', key: `date-${entry.msg?.id ?? entry.event?.id}`, label: dateSeparatorLabel(entry.at, t) });
    }
  }
  return items;
}

type Props = {
  messages: ChatMessage[];
  meId: string;
  peerLastReadAt: string | null;
  initialUnreadCount: number;
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onLongPressMessage: (message: ChatMessage) => void;
  onRetry: (id: string) => void;
  onDismissFailed: (id: string) => void;
  blockEvents?: BlockEvent[];
  /** Name used in the "You blocked {{name}}" lines. */
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
  onLongPressMessage,
  onRetry,
  onDismissFailed,
  blockEvents,
  peerName = '',
}: Props) {
  const { colors, spacing } = useTheme();
  const { t, i18n } = useTranslation();
  const messageById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const items = useMemo(() => buildListItems(messages, initialUnreadCount, blockEvents ?? [], hasMore, t), [messages, initialUnreadCount, blockEvents, hasMore, t, i18n.language]);

  return (
    <FlatList
      data={items}
      inverted
      keyExtractor={(item) => item.key}
      contentContainerStyle={{ paddingVertical: spacing.sm }}
      onEndReached={hasMore ? onLoadOlder : undefined}
      onEndReachedThreshold={0.4}
      ListFooterComponent={loadingOlder ? <ActivityIndicator style={{ marginVertical: spacing.sm }} color={colors.primary} /> : null}
      renderItem={({ item, index }) => {
        if (item.type === 'date') return <DateSeparator label={item.label} />;
        if (item.type === 'unread') return <UnreadSeparator count={item.count} />;
        if (item.type === 'event') {
          return <SystemNotice icon={item.event.kind === 'blocked' ? 'ban-outline' : 'checkmark-circle-outline'} text={t(item.event.kind === 'blocked' ? 'chat.youBlockedEvent' : 'chat.youUnblockedEvent', { name: peerName })} />;
        }

        const message = item.message;
        const isMine = message.senderId === meId;

        // Find neighbors among actual messages (skip separator entries) to
        // decide group boundaries — newer neighbor is at a smaller index,
        // older neighbor at a larger index, within this same items array.
        let newer: ChatMessage | null = null;
        for (let i = index - 1; i >= 0; i--) {
          const it = items[i];
          if (it.type === 'message') {
            newer = it.message;
            break;
          }
        }
        let older: ChatMessage | null = null;
        for (let i = index + 1; i < items.length; i++) {
          const it = items[i];
          if (it.type === 'message') {
            older = it.message;
            break;
          }
        }

        const showTail = !newer || newer.senderId !== message.senderId;
        const groupStart = !older || older.senderId !== message.senderId;
        const seen = isMine && !!peerLastReadAt && new Date(message.createdAt) <= new Date(peerLastReadAt);
        const replyMessage = message.replyToId ? (messageById.get(message.replyToId) ?? null) : null;
        const replyPreview = message.replyToId
          ? {
              text: replyMessage?.text ?? null,
              legacyPhoto: replyMessage?.legacyPhoto ?? false,
              senderIsMine: replyMessage?.senderId === meId,
            }
          : null;

        return (
          <MessageBubble
            message={message}
            isMine={isMine}
            groupStart={groupStart}
            showTail={showTail}
            seen={seen}
            replyPreview={replyPreview}
            onLongPress={onLongPressMessage}
            onRetry={onRetry}
            onDismissFailed={onDismissFailed}
          />
        );
      }}
    />
  );
}
