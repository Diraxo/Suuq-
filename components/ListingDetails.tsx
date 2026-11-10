import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeContext';
import type { ListingDetail } from '@/data/listingDetail';

const SECTIONS_OPEN = 3; // the first sections are open; the rest wait behind "Show more"

/** The few facts a buyer decides on, as tiles: two to a row, wrapping, so a long value never pushes a tile off the screen. */
function FactTiles({ facts }: { facts: ListingDetail['facts'] }) {
  const { colors, spacing, radius } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md }}>
      {facts.map((f) => (
        <View
          key={f.key}
          accessible
          accessibilityLabel={`${f.label}: ${f.value}`}
          style={{ flexGrow: 1, flexBasis: '47%', minWidth: 0, flexDirection: 'row', alignItems: 'center', padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primary + '0F', borderWidth: 1, borderColor: colors.border }}
        >
          <View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.primary + '1A', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={f.icon as any} size={18} color={colors.primary} />
          </View>
          <View style={{ flex: 1, minWidth: 0, marginLeft: spacing.xs }}>
            <Text variant="bodyMedium" numberOfLines={2}>
              {f.value}
            </Text>
            <Text variant="tiny" color="muted" numberOfLines={1}>
              {f.label}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** Label left, value right, a hairline between rows. The label may shrink and the value wraps, so nothing is ever clipped. */
function SpecRows({ rows }: { rows: { key: string; label: string; value: string }[] }) {
  const { colors, spacing } = useTheme();
  return (
    <View>
      {rows.map((r, i) => (
        <View
          key={r.key}
          style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: spacing.xs, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}
        >
          <Text variant="caption" color="secondary" style={{ flexShrink: 1, maxWidth: '42%' }}>
            {r.label}
          </Text>
          <Text variant="caption" color="primary" style={{ flex: 1, textAlign: 'right' }} selectable>
            {r.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Key facts, then the grouped sections of an ordinary (non-service) listing. */
export function ListingDetails({ detail }: { detail: ListingDetail }) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? detail.sections : detail.sections.slice(0, SECTIONS_OPEN);
  const hidden = detail.sections.length - shown.length;

  return (
    <>
      {detail.facts.length > 0 && <FactTiles facts={detail.facts} />}
      {shown.map((s) => (
        <Card key={s.id} style={{ marginTop: spacing.md }} elevated={false}>
          <Text variant="bodyMedium" style={{ marginBottom: spacing.xxs }}>
            {s.title}
          </Text>
          <SpecRows rows={s.rows} />
        </Card>
      ))}
      {detail.sections.length > SECTIONS_OPEN && (
        <Pressable
          onPress={() => setShowAll((v) => !v)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={showAll ? t('listing.showFewerDetails') : t('listing.showMoreDetails')}
          style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginTop: spacing.sm }}
        >
          <Text variant="caption" color="brand">
            {showAll ? t('listing.showLess') : t('listing.showMore', { count: hidden })}
          </Text>
          <Ionicons name={showAll ? 'chevron-up' : 'chevron-down'} size={14} color={colors.primary} style={{ marginLeft: 2 }} />
        </Pressable>
      )}
    </>
  );
}
