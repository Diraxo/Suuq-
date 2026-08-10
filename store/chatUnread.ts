import { create } from 'zustand';
import { useChatConversationsStore, formatUnreadCount } from '@/store/chatConversations';

export { formatUnreadCount };

type ChatUnreadState = {
  count: number;
};

// Thin selector over store/chatConversations.ts's row list, kept as its own
// store only because components/ChatUnreadBadge.tsx already imports it by
// name. Sums the same per-row unread counts the chat list itself renders,
// so the two can never disagree.
export const useChatUnreadStore = create<ChatUnreadState>(() => ({
  count: 0,
}));

useChatConversationsStore.subscribe((state) => {
  const total = (state.rows ?? []).reduce((sum, row) => sum + row.unread, 0);
  useChatUnreadStore.setState((prev) => (prev.count === total ? prev : { count: total }));
});
