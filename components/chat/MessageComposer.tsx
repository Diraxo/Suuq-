import { useEffect, useRef, useState } from 'react';
import { View, TextInput, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { launchImageLibraryAsync } from '@/lib/imagePickerSafe';
import { useImageUpload } from '@/hooks/useImageUpload';
import { mapWithConcurrency } from '@/lib/concurrency';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from '@/components/Text';
import { imageUrl } from '@/lib/r2';
import type { ChatMessage } from '@/hooks/useConversationChannel';

const MAX_IMAGES = 4;

type PendingImage = { localUri: string; uploadedUrl?: string; uploadedKey?: string; uploading: boolean; failed: boolean };

type Props = {
  onSend: (input: { text?: string; images?: string[]; imageKeys?: string[]; replyToId?: string | null }) => void;
  onTyping: (typing: boolean) => void;
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
  editing: ChatMessage | null;
  onCancelEdit: () => void;
  onSubmitEdit: (id: string, text: string) => void;
  uploadFolder: string;
  disabled?: boolean;
};

export function MessageComposer({ onSend, onTyping, replyTo, onCancelReply, editing, onCancelEdit, onSubmitEdit, uploadFolder, disabled }: Props) {
  const { colors, spacing, radius } = useTheme();
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [pending, setPending] = useState<PendingImage[]>([]);
  const { upload } = useImageUpload(uploadFolder, { skipMinDimension: true });
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (editing) {
      setText(editing.text ?? '');
      inputRef.current?.focus();
    }
  }, [editing]);

  const uploading = pending.some((p) => p.uploading);
  const ready = pending.filter((p) => p.uploadedUrl);
  const readyImages = ready.map((p) => p.uploadedUrl!);
  const readyImageKeys = ready.map((p) => p.uploadedKey!);
  const canSend = editing ? text.trim().length > 0 : !uploading && (text.trim().length > 0 || readyImages.length > 0);

  const uploadAsset = async (asset: ImagePicker.ImagePickerAsset) => {
    const result = await upload(asset);
    setPending((prev) =>
      prev.map((p) =>
        p.localUri === asset.uri ? { ...p, uploading: false, uploadedUrl: result?.url, uploadedKey: result?.publicId, failed: !result } : p
      )
    );
  };

  const pickImages = async () => {
    const remaining = MAX_IMAGES - pending.length;
    if (remaining <= 0) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('chat.photoAccessNeededTitle'), t('chat.photoAccessNeededMessage'));
      return;
    }
    const result = await launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: remaining, quality: 1 });
    if (result.canceled || result.assets.length === 0) return;

    const assets = result.assets.slice(0, remaining);
    setPending((prev) => [...prev, ...assets.map((a) => ({ localUri: a.uri, uploading: true, failed: false }))]);
    await mapWithConcurrency(assets, 2, uploadAsset);
  };

  const removePending = (localUri: string) => setPending((prev) => prev.filter((p) => p.localUri !== localUri));
  const retryPending = async (item: PendingImage) => {
    setPending((prev) => prev.map((p) => (p.localUri === item.localUri ? { ...p, uploading: true, failed: false } : p)));
    await uploadAsset({ uri: item.localUri } as ImagePicker.ImagePickerAsset);
  };

  const handleSend = () => {
    if (!canSend) return;
    if (editing) {
      onSubmitEdit(editing.id, text.trim());
      setText('');
      return;
    }
    onSend({
      text: text.trim() || undefined,
      images: readyImages.length ? readyImages : undefined,
      imageKeys: readyImages.length ? readyImageKeys : undefined,
      replyToId: replyTo?.id ?? null,
    });
    setText('');
    setPending([]);
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
              {replyTo.text || (replyTo.images.length ? t('chat.photo') : '')}
            </Text>
          </View>
          <Pressable onPress={onCancelReply} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('chat.cancelReply')} style={{ padding: spacing.xs }}>
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      )}

      {!editing && pending.length > 0 && (
        <View style={{ flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.xs }}>
          {pending.map((item) => (
            <View key={item.localUri} style={{ width: 56, height: 56 }}>
              <Image source={{ uri: imageUrl(item.localUri, { width: 120 }) }} style={{ width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.skeleton }} />
              {item.uploading && (
                <View style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: radius.sm }]}>
                  <ActivityIndicator size="small" color="#fff" />
                </View>
              )}
              {item.failed && (
                <Pressable onPress={() => retryPending(item)} style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: radius.sm }]}>
                  <Ionicons name="refresh" size={18} color="#fff" />
                </Pressable>
              )}
              <Pressable
                onPress={() => removePending(item.localUri)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={t('chat.removePhoto')}
                style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center' }}
              >
                <Ionicons name="close" size={12} color="#fff" />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', padding: spacing.sm, gap: spacing.xs }}>
        {!editing && (
          <Pressable
            onPress={pickImages}
            disabled={disabled || pending.length >= MAX_IMAGES}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('chat.attachPhoto')}
            style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', opacity: pending.length >= MAX_IMAGES ? 0.4 : 1 }}
          >
            <Ionicons name="image-outline" size={22} color={colors.primary} />
          </Pressable>
        )}

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
