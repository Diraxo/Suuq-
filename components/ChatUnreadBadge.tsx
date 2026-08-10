import { useChatUnreadStore } from '@/store/chatUnread';
import { UnreadCountBadge } from './UnreadCountBadge';

/** Small coral count badge for the Chats tab icon — total unread across all conversations, from store/chatUnread.ts (summed from the chat list's own per-row counts). */
export function ChatUnreadBadge() {
  const count = useChatUnreadStore((s) => s.count);
  return <UnreadCountBadge count={count} />;
}
