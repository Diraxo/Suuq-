import { useState } from 'react';
import { View, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from '@/components/Text';
import { imageUrl } from '@/lib/r2';
import type { ChatMessage, ReactionType } from '@/hooks/useConversationChannel';
import { REACTION_EMOJI } from './reactions';

type ReplyPreview = { text: string | null; images: string[]; senderIsMine: boolean } | null;

type Props = {
  message: ChatMessage;
  isMine: boolean;
  groupStart: boolean;
  showTail: boolean;
  seen: boolean;
  replyPreview: ReplyPreview;
  onLongPress: (message: ChatMessage) => void;
  onImagePress: (images: string[], index: number) => void;
  onRetry: (id: string) => void;
  onDismissFailed: (id: string) => void;
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function aggregateReactions(reactions: ChatMessage['reactions']): { reaction: ReactionType; count: number }[] {
  const counts = new Map<ReactionType, number>();
  for (const r of reactions) counts.set(r.reaction, (counts.get(r.reaction) ?? 0) + 1);
  return Array.from(counts.entries()).map(([reaction, count]) => ({ reaction, count }));
}

export function MessageBubble({ message, isMine, groupStart, showTail, seen, replyPreview, onLongPress, onImagePress, onRetry, onDismissFailed }: Props) {
  const { colors, spacing, radius } = useTheme();
  const { t } = useTranslation();
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  if (message.deletedAt) {
    return (
      <View style={{ alignItems: isMine ? 'flex-end' : 'flex-start', marginTop: groupStart ? spacing.sm : 2, paddingHorizontal: spacing.md }}>
        <View
          style={{
            maxWidth: '78%',
            paddingHorizontal: spacing.sm,
            paddingVertical: 8,
            borderRadius: radius.lg,
            backgroundColor: colors.inputBackground,
          }}
        >
          <Text variant="caption" color="muted" style={{ fontStyle: 'italic' }}>
            {t('chat.messageDeleted')}
          </Text>
        </View>
      </View>
    );
  }

  const bubbleColor = isMine ? colors.primary : colors.surfaceElevated;
  const textColor = isMine ? 'inverse' : 'primary';
  const reactions = aggregateReactions(message.reactions);
  const failed = message.status === 'failed';

  return (
    <View style={{ alignItems: isMine ? 'flex-end' : 'flex-start', marginTop: groupStart ? spacing.sm : 2, paddingHorizontal: spacing.md }}>
      <Pressable
        onLongPress={() => onLongPress(message)}
        disabled={message.status === 'sending'}
        style={{
          maxWidth: '78%',
          opacity: message.status === 'sending' ? 0.6 : 1,
          borderRadius: radius.lg,
          backgroundColor: bubbleColor,
          borderBottomRightRadius: isMine && showTail ? radius.sm : radius.lg,
          borderBottomLeftRadius: !isMine && showTail ? radius.sm : radius.lg,
          overflow: 'hidden',
        }}
      >
        {replyPreview && (
          <View
            style={{
              margin: 6,
              marginBottom: 0,
              padding: spacing.xs,
              borderRadius: radius.sm,
              borderLeftWidth: 3,
              borderLeftColor: isMine ? colors.primaryText : colors.primary,
              backgroundColor: isMine ? 'rgba(255,255,255,0.15)' : colors.inputBackground,
            }}
          >
            <Text variant="tiny" color={isMine ? 'inverse' : 'brand'} numberOfLines={1}>
              {replyPreview.senderIsMine ? t('chat.you') : ''}
            </Text>
            <Text variant="caption" color={isMine ? 'inverse' : 'secondary'} numberOfLines={1}>
              {replyPreview.text || (replyPreview.images.length ? t('chat.photo') : t('chat.originalMessage'))}
            </Text>
          </View>
        )}

        {message.images.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 4, gap: 4 }}>
            {message.images.map((uri, i) => {
              const size = message.images.length === 1 ? 220 : 100;
              const failed = failedImages.has(uri);
              return (
                <Pressable
                  key={uri + i}
                  onPress={() => !failed && onImagePress(message.images, i)}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={t('chat.openPhoto')}
                >
                  {failed ? (
                    <View
                      style={{
                        width: size,
                        height: size,
                        borderRadius: radius.sm,
                        backgroundColor: colors.skeleton,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons name="image-outline" size={24} color={colors.textMuted} />
                    </View>
                  ) : (
                    <Image
                      source={{ uri: imageUrl(uri, { width: message.images.length === 1 ? 400 : 200 }) }}
                      style={{
                        width: size,
                        height: size,
                        borderRadius: radius.sm,
                        backgroundColor: colors.skeleton,
                      }}
                      cachePolicy="memory-disk"
                      transition={150}
                      onError={(e) => {
                        if (__DEV__) console.error('[MessageBubble] failed to load image', uri, e.error);
                        setFailedImages((prev) => new Set(prev).add(uri));
                      }}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
        )}

        {message.text && (
          <Text variant="body" color={textColor} style={{ paddingHorizontal: spacing.sm, paddingTop: spacing.xs }}>
            {message.text}
          </Text>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: spacing.sm, paddingVertical: 4, paddingTop: 2 }}>
          {message.editedAt && (
            <Text variant="tiny" color={isMine ? 'inverse' : 'muted'} style={{ opacity: 0.75, marginRight: 4 }}>
              {t('chat.edited')}
            </Text>
          )}
          <Text variant="tiny" color={isMine ? 'inverse' : 'muted'} style={{ opacity: 0.75 }}>
            {formatTime(message.createdAt)}
          </Text>
          {isMine && showTail && (
            <Ionicons
              name={seen ? 'checkmark-done' : message.status === 'sending' ? 'time-outline' : 'checkmark'}
              size={13}
              color={seen ? colors.success : colors.primaryText}
              style={{ marginLeft: 4, opacity: 0.85 }}
            />
          )}
        </View>
      </Pressable>

      {reactions.length > 0 && (
        <View
          style={{
            flexDirection: 'row',
            marginTop: -6,
            backgroundColor: colors.surface,
            borderRadius: radius.pill,
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          {reactions.map(({ reaction, count }) => (
            <Text key={reaction} variant="tiny" style={{ marginHorizontal: 2 }}>
              {REACTION_EMOJI[reaction]}
              {count > 1 ? count : ''}
            </Text>
          ))}
        </View>
      )}

      {failed && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
          <Text variant="tiny" color="error">
            {t('chat.failedToSend')}
          </Text>
          <Pressable onPress={() => onRetry(message.id)} hitSlop={6} style={{ marginLeft: spacing.xs }}>
            <Text variant="tiny" color="brand">
              {t('chat.retry')}
            </Text>
          </Pressable>
          <Pressable onPress={() => onDismissFailed(message.id)} hitSlop={6} style={{ marginLeft: spacing.xs }}>
            <Text variant="tiny" color="muted">
              {t('chat.dismiss')}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
