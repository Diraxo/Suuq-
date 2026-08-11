import { View, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from '@/components/Text';
import type { ReactionType } from '@/hooks/useConversationChannel';
import { REACTION_TYPES, REACTION_EMOJI } from './reactions';

type Props = {
  selected: ReactionType | null;
  onSelect: (reaction: ReactionType) => void;
};

/** Inline row of the 6 supported reactions — used inside MessageActionSheet. */
export function ReactionPicker({ selected, onSelect }: Props) {
  const { colors, spacing, radius } = useTheme();
  const { t } = useTranslation();

  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
      {REACTION_TYPES.map((reaction) => (
        <Pressable
          key={reaction}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            onSelect(reaction);
          }}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t('chat.reactions.reactWith', { reaction: t(`chat.reactions.types.${reaction}`) })}
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: selected === reaction ? colors.primary + '1A' : 'transparent',
          }}
        >
          <Text style={{ fontSize: 22, lineHeight: 26 }}>{REACTION_EMOJI[reaction]}</Text>
        </Pressable>
      ))}
    </View>
  );
}
