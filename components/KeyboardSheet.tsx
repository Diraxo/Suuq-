import React from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';

type Props = {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

// A bottom sheet that stays usable while the keyboard is open (the location
// pickers have a search box). The KeyboardAvoidingView measures how much of
// itself the keyboard actually covers, so it shrinks the sheet's space by that
// amount on every device — and adds nothing when the OS already resized the
// window — instead of relying on a fixed offset. The sheet is capped relative
// to the space left (never a pixel height) and the list inside scrolls, so the
// search box and the first results stay above the keyboard.
export function KeyboardSheet({ visible, onClose, children }: Props) {
  const { colors, spacing, radius } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <Pressable
          style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end', paddingTop: insets.top }}
          onPress={onClose}
          accessibilityLabel={t('common.close')}
          accessibilityRole="button"
        >
          <Pressable
            style={{
              backgroundColor: colors.background,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              maxHeight: '85%',
              flexShrink: 1,
              padding: spacing.md,
              paddingBottom: spacing.md + insets.bottom,
            }}
            onPress={(e) => e.stopPropagation()}
          >
            {children}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
