import type { ReactionType } from '@/hooks/useConversationChannel';

// One reaction per user per message (tapback-style, like iMessage).
export const REACTION_TYPES: ReactionType[] = ['like', 'love', 'haha', 'wow', 'sad', 'clap'];

export const REACTION_EMOJI: Record<ReactionType, string> = {
  like: '👍',
  love: '❤️',
  haha: '😂',
  wow: '😮',
  sad: '😢',
  clap: '👏',
};
