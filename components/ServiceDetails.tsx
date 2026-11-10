import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeContext';
import { categories } from '@/data/categories';
import { categoryLabel, subcategoryLabel } from '@/data/categoryNames';
import { summarizeDays, subcategoryIcon, type DetailRow, type ServiceDetail } from '@/data/serviceDetail';

/** The service's own icon, its trade and the kind of provider — sits above the title. */
export function ServiceIdentity({ subcategory, providerKindLabel }: { subcategory?: string | null; providerKindLabel?: string }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const label = subcategory ? subcategoryLabel(t, 'services', subcategory) : categoryLabel(t, 'services', 'Services');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm }}>
      <View style={{ width: 28, height: 28, borderRadius: radius.sm, backgroundColor: colors.primary + '1A', alignItems: 'center', justifyContent: 'center' }}>
        <CategoryIcon icon={subcategoryIcon(categories, 'services', subcategory)} size={16} color={colors.primary} />
      </View>
      <Text variant="caption" color="secondary" style={{ marginLeft: spacing.xs, flexShrink: 1 }} numberOfLines={1}>
        {label}
      </Text>
      {providerKindLabel ? (
        <View style={{ marginLeft: spacing.xs, paddingHorizontal: spacing.xs, paddingVertical: 2, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}>
          <Text variant="tiny" color="secondary">
            {providerKindLabel}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// Label above value: a long value (service area, specialties) wraps under its label instead of being pushed off the screen.
function Rows({ rows }: { rows: DetailRow[] }) {
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      {rows.map((r) => (
        <View key={r.key}>
          <Text variant="tiny" color="muted">
            {r.label}
          </Text>
          <Text variant="body" color="primary" style={{ flexShrink: 1 }} selectable>
            {r.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { spacing } = useTheme();
  return (
    <Card style={{ marginTop: spacing.md }} elevated={false}>
      <Text variant="bodyMedium" style={{ marginBottom: spacing.xs }}>
        {title}
      </Text>
      {children}
    </Card>
  );
}

function Chip({ label }: { label: string }) {
  const { colors, spacing, radius } = useTheme();
  return (
    <View style={{ paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.primary + '1A', borderWidth: 1, borderColor: colors.border, maxWidth: '100%' }}>
      <Text variant="caption" color="primary" style={{ flexShrink: 1 }}>
        {label}
      </Text>
    </View>
  );
}

/** Overview, highlights, availability, provider and the remaining details of a service. `extra` rows (location, posted...) join the collapsible "more". */
export function ServiceDetails({ detail, extra }: { detail: ServiceDetail; extra: DetailRow[] }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const [allDays, setAllDays] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const days = allDays ? { shown: detail.days, hidden: 0 } : summarizeDays(detail.days);
  const more = [...detail.more, ...extra];
  const hasAvailability = detail.days.length > 0 || !!detail.hours || detail.availability.length > 0;

  return (
    <>
      {detail.specialties.length > 0 && (
        <Section title={t('listing.service.overview', { defaultValue: 'What this provider offers' })}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {detail.specialties.map((s) => (
              <Chip key={s} label={s} />
            ))}
          </View>
        </Section>
      )}

      {detail.highlights.length > 0 && (
        <Section title={t('listing.service.highlights', { defaultValue: 'Service highlights' })}>
          <Rows rows={detail.highlights} />
        </Section>
      )}

      {hasAvailability && (
        <Section title={t('listing.service.availability', { defaultValue: 'Availability' })}>
          {detail.days.length > 0 && (
            <View accessible accessibilityLabel={`${t('post.fieldLabels.Available days', { defaultValue: 'Available days' })}: ${detail.days.join(', ')}`}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {days.shown.map((d) => (
                  <Chip key={d} label={d} />
                ))}
                {days.hidden > 0 && (
                  <Pressable onPress={() => setAllDays(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('listing.service.moreDays', { count: days.hidden, defaultValue: `+${days.hidden} more` })}>
                    <Text variant="caption" color="brand" style={{ paddingVertical: 4, paddingHorizontal: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary + '66' }}>
                      {t('listing.service.moreDays', { count: days.hidden, defaultValue: `+${days.hidden} more` })}
                    </Text>
                  </Pressable>
                )}
                {allDays && detail.days.length > 4 && (
                  <Pressable onPress={() => setAllDays(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('listing.showLess')}>
                    <Text variant="caption" color="brand" style={{ paddingVertical: 4 }}>
                      {t('listing.showLess')}
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}
          <View style={{ marginTop: detail.days.length > 0 ? spacing.sm : 0 }}>
            <Rows rows={[...(detail.hours ? [{ key: 'hours', label: t('post.serviceDisplay.hours', { defaultValue: 'Working hours' }), value: detail.hours }] : []), ...detail.availability]} />
          </View>
        </Section>
      )}

      {detail.provider.length > 0 && (
        <Section title={t('listing.service.provider', { defaultValue: 'Provider' })}>
          <Rows rows={detail.provider} />
        </Section>
      )}

      {more.length > 0 && (
        <Section title={t('listing.service.more', { defaultValue: 'Additional details' })}>
          {showMore ? <Rows rows={more} /> : <Rows rows={more.slice(0, 2)} />}
          {more.length > 2 && (
            <Pressable
              onPress={() => setShowMore((v) => !v)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={showMore ? t('listing.showFewerDetails') : t('listing.showMoreDetails')}
              style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm }}
            >
              <Text variant="caption" color="brand">
                {showMore ? t('listing.showLess') : t('listing.showMore', { count: more.length - 2 })}
              </Text>
              <Ionicons name={showMore ? 'chevron-up' : 'chevron-down'} size={14} color={colors.primary} style={{ marginLeft: 2 }} />
            </Pressable>
          )}
        </Section>
      )}
    </>
  );
}
