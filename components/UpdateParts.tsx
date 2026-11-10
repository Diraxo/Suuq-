import React from 'react';
import { Image, Linking, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeContext';
import { ChangelogItem } from '@/lib/appUpdate';

// Brand indigo, the same field as the splash (app/index.tsx).
export const BRAND_BG = '#4F46E5';

/** The app mark on the brand field. */
export function UpdateLogo({ size = 72 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: BRAND_BG, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Image source={require('@/assets/images/fursad-splash.png')} style={{ width: size * 0.72, height: size * 0.72 }} resizeMode="contain" />
    </View>
  );
}

/** One "label  value" line of the version summary. */
export function VersionRow({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  const { spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 6 }}>
      <Text variant="caption" color="secondary" style={{ flexShrink: 1 }}>{label}</Text>
      <Text variant="caption" color={emphasis ? 'brand' : 'primary'} style={{ fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

/** The "What's new" list. Icons come only from the safe, predefined map (lib/appUpdate.ts); nothing from the database is rendered as a component. */
export function WhatsNewList({ items, withIcons, max }: { items: ChangelogItem[]; withIcons: boolean; max?: number }) {
  const { colors, spacing, radius } = useTheme();
  const shown = max ? items.slice(0, max) : items;
  if (shown.length === 0) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      {shown.map((item, i) => (
        <View key={`${i}-${item.title}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
          {withIcons ? (
            <View style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={item.icon} size={20} color={BRAND_BG} />
            </View>
          ) : (
            <Ionicons name="checkmark-circle" size={18} color={BRAND_BG} style={{ marginTop: 2 }} />
          )}
          <View style={{ flex: 1 }}>
            <Text variant="bodyMedium">{item.title}</Text>
            {item.description ? <Text variant="caption" color="secondary">{item.description}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/** Opens an https/mailto link; false when it cannot be opened. */
export async function openLink(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
