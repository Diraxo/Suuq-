import { Modal, View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from '@/components/Text';
import { showSnackbar } from '@/lib/snackbar';
import type { ChatMessage, ReactionType } from '@/hooks/useConversationChannel';
import { ReactionPicker } from './ReactionPicker';

type Props = {
  message: ChatMessage | null;
  isMine: boolean;
  myReaction: ReactionType | null;
  onClose: () => void;
  onReply: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onReact: (message: ChatMessage, reaction: ReactionType) => void;
};

/** Long-press action menu for a message bubble: copy/reply/edit/delete/react. */
export function MessageActionSheet({ message, isMine, myReaction, onClose, onReply, onEdit, onDelete, onReact }: Props) {
  const { colors, spacing, radius, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const visible = !!message;

  const canCopy = !!message?.text && !message.deletedAt;
  const canEdit = isMine && !!message?.text && !message.deletedAt;
  const canDelete = isMine && !message?.deletedAt;
  const canReact = !!message && !message.deletedAt;
  const canReply = !!message && !message.deletedAt;

  const handleCopy = async () => {
    if (!message?.text) return;
    await Clipboard.setStringAsync(message.text);
    showSnackbar('Message copied');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay }}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss" />
        <View
          style={[
            {
              backgroundColor: colors.surfaceElevated,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              paddingBottom: insets.bottom + spacing.md,
              paddingTop: spacing.sm,
            },
            shadow.md,
          ]}
        >
          {canReact && message && <ReactionPicker selected={myReaction} onSelect={(reaction) => onReact(message, reaction)} />}

          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.xs }} />

          {canReply && (
            <ActionRow icon="arrow-undo-outline" label="Reply" onPress={() => message && onReply(message)} />
          )}
          {canCopy && <ActionRow icon="copy-outline" label="Copy" onPress={handleCopy} />}
          {canEdit && <ActionRow icon="create-outline" label="Edit" onPress={() => message && onEdit(message)} />}
          {canDelete && (
            <ActionRow icon="trash-outline" label="Delete" tone="error" onPress={() => message && onDelete(message)} />
          )}
        </View>
      </View>
    </Modal>
  );
}

function ActionRow({
  icon,
  label,
  tone = 'default',
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone?: 'default' | 'error';
  onPress: () => void;
}) {
  const { colors, spacing } = useTheme();
  const color = tone === 'error' ? colors.error : colors.textPrimary;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}
    >
      <Ionicons name={icon} size={20} color={color} style={{ width: 28 }} />
      <Text variant="body" style={{ color, marginLeft: spacing.sm }}>
        {label}
      </Text>
    </Pressable>
  );
}
