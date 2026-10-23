import { useEffect, useRef, useState } from 'react';
import { View, TextInput, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from '@/components/Text';
import type { ChatMessage } from '@/hooks/useConversationChannel';

type Props = {
  onSend: (input: { text?: string; replyToId?: string | null }) => void;
  onTyping: (typing: boolean) => void;
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
  editing: ChatMessage | null;
  onCancelEdit: () => void;
  onSubmitEdit: (id: string, text: string) => void;
  disabled?: boolean;
};

export function MessageComposer({ onSend, onTyping, replyTo, onCancelReply, editing, onCancelEdit, onSubmitEdit, disabled }: Props) {
  const { colors, spacing, radius } = useTheme();
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (editing) {
      setText(editing.text ?? '');
      inputRef.current?.focus();
    }
  }, [editing]);

  const canSend = text.trim().length > 0;

  const handleSend = () => {
    if (!canSend) return;
    if (editing) {
      onSubmitEdit(editing.id, text.trim());
      setText('');
      return;
    }
    onSend({
      text: text.trim(),
      replyToId: replyTo?.id ?? null,
    });
    setText('');
    onCancelReply();
    onTyping(false);
  };

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}>
      {editing && (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.xs }}>
          <View style={{ flex: 1, borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: spacing.xs }}>
            <Text variant="tiny" color="brand">
              {t('chat.editingMessage')}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              onCancelEdit();
              setText('');
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('chat.cancelEdit')}
            style={{ padding: spacing.xs }}
          >
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      )}

      {!editing && replyTo && (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.xs }}>
          <View style={{ flex: 1, borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: spacing.xs }}>
            <Text variant="tiny" color="brand">
              {t('chat.replyingTo')}
            </Text>
            <Text variant="caption" color="secondary" numberOfLines={1}>
              {replyTo.text || (replyTo.legacyPhoto ? t('chat.photo') : '')}
            </Text>
          </View>
          <Pressable onPress={onCancelReply} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('chat.cancelReply')} style={{ padding: spacing.xs }}>
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', padding: spacing.sm, gap: spacing.xs }}>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={(v) => {
            setText(v);
            onTyping(v.length > 0);
          }}
          onBlur={() => onTyping(false)}
          placeholder={editing ? t('chat.editMessagePlaceholder') : t('chat.typeMessage')}
          placeholderTextColor={colors.textMuted}
          multiline
          editable={!disabled}
          style={{
            flex: 1,
            maxHeight: 100,
            paddingHorizontal: spacing.sm,
            paddingVertical: 8,
            borderRadius: radius.lg,
            backgroundColor: colors.inputBackground,
            color: colors.textPrimary,
            fontSize: 15,
          }}
        />

        <Pressable
          onPress={handleSend}
          disabled={!canSend || disabled}
          accessibilityRole="button"
          accessibilityLabel={t('chat.sendMessage')}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: canSend ? colors.primary : colors.inputBackground,
          }}
        >
          <Ionicons name={editing ? 'checkmark' : 'arrow-up'} size={18} color={canSend ? colors.primaryText : colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}
