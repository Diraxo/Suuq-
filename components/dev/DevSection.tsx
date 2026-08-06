import { useState } from 'react';
import { View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from '@/components/Text';

export function DevSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const { colors, spacing, radius } = useTheme();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View style={{ marginBottom: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface, overflow: 'hidden' }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={`${title} section, ${open ? 'expanded' : 'collapsed'}`}
        style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.sm }}
      >
        <Text variant="bodyMedium" style={{ flex: 1 }}>
          {title}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
      </Pressable>
      {open && <View style={{ padding: spacing.sm, paddingTop: 0 }}>{children}</View>}
    </View>
  );
}
