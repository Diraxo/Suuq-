import { useMemo } from 'react';
import { FlatList, ActivityIndicator } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';
import type { ChatMessage } from '@/hooks/useConversationChannel';
import { MessageBubble } from './MessageBubble';
import { DateSeparator, dateSeparatorLabel } from './DateSeparator';
import { UnreadSeparator } from './UnreadSeparator';

type ListItem =
  | { type: 'message'; key: string; message: ChatMessage }
  | { type: 'date'; key: string; label: string }
  | { type: 'unread'; key: string; count: number };

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// messages is newest-first (index 0 = newest), matching an inverted FlatList
// (index 0 renders at the bottom of the screen). A separator pushed
// immediately after message[i] in this array ends up rendering just above
// it on screen — exactly where a "start of a new day" / "unread" divider
// belongs relative to the messages beneath it.
function buildListItems(messages: ChatMessage[], unreadCount: number): ListItem[] {
  const items: ListItem[] = [];
  // The boundary message (index unreadCount - 1) is normally within the
  // loaded window — the hook loads enough of the page to guarantee that. If
  // an extreme backlog still exceeds what was loaded, pin the divider to the
  // oldest loaded message instead of silently dropping it, so the true count
  // is still visible.
  const dividerIndex = unreadCount > 0 ? Math.min(unreadCount, messages.length) - 1 : -1;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    items.push({ type: 'message', key: msg.id, message: msg });

    if (i === dividerIndex) {
      items.push({ type: 'unread', key: 'unread-separator', count: unreadCount });
    }

    const older = messages[i + 1];
    if (!older || dayKey(older.createdAt) !== dayKey(msg.createdAt)) {
      items.push({ type: 'date', key: `date-${msg.id}`, label: dateSeparatorLabel(new Date(msg.createdAt).getTime()) });
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
  onImagePress: (images: string[], index: number) => void;
  onRetry: (id: string) => void;
  onDismissFailed: (id: string) => void;
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
  onImagePress,
  onRetry,
  onDismissFailed,
}: Props) {
  const { colors, spacing } = useTheme();
  const messageById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const items = useMemo(() => buildListItems(messages, initialUnreadCount), [messages, initialUnreadCount]);

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
              images: replyMessage?.images ?? [],
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
            onImagePress={onImagePress}
            onRetry={onRetry}
            onDismissFailed={onDismissFailed}
          />
        );
      }}
    />
  );
}
