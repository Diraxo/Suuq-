// Web port of components/chat/reactions.ts on mobile — same 6-emoji,
// one-reaction-per-user-per-message (tapback-style) set, same values.
import type { ReactionType } from '@/hooks/useConversationChannel';

export const REACTION_TYPES: ReactionType[] = ['like', 'love', 'haha', 'wow', 'sad', 'clap'];

export const REACTION_EMOJI: Record<ReactionType, string> = {
  like: '👍',
  love: '❤️',
  haha: '😂',
  wow: '😮',
  sad: '😢',
  clap: '👏',
};
