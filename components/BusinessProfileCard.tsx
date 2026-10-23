import { useState } from 'react';
import { openExternal } from '@/lib/openLink';
import { View, Pressable, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme/ThemeContext';
import { BUSINESS_GOLD } from '@/lib/profileIdentity';
import { SOCIAL_KEYS, normalizeSocial } from '@/lib/profileRules';
import { safeWebsiteHref, hoursLines, isOpenNow, hoursDayOf, formatTime12 } from '@/lib/storefront';
import { categories } from '@/data/categories';
import { Profile } from '@/types';

const SOCIAL_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  facebook: 'logo-facebook',
  instagram: 'logo-instagram',
  tiktok: 'logo-tiktok',
  whatsapp: 'logo-whatsapp',
  telegram: 'paper-plane-outline',
};
// Third-party brand names are never translated.
const SOCIAL_NAMES: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', whatsapp: 'WhatsApp', telegram: 'Telegram' };

/** The gold badge. Rendered only for a business staff have verified; uploading a banner never earns it. */
export function VerifiedBusinessBadge() {
  const { isDark, radius } = useTheme();
  const { t } = useTranslation();
  return (
    <View
      accessibilityLabel={t('business.verifiedBusiness')}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: BUSINESS_GOLD + '26', borderColor: BUSINESS_GOLD + '80', borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 }}
    >
      <Ionicons name="shield-checkmark" size={14} color={BUSINESS_GOLD} />
      <Text variant="tiny" style={{ color: isDark ? '#F2CB5C' : '#7A5800', fontWeight: '700' }}>
        {t('business.verifiedBusiness')}
      </Text>
    </View>
  );
}

type Props = {
  profile: Profile;
  /** The number the viewer may call under the business (from get_contact_phone, 0072). The card never reads a number off the profile row. */
  phone?: string | null;
  /** Staff-verified storefront. Never derived from the profile's own fields. */
  verified: boolean;
  isSelf: boolean;
  /** Present only when there is something to message about. */
  onContact?: () => void;
  onVisitStorefront?: () => void;
  onEdit?: () => void;
};

// The business-specific part of a profile: category, description, address, hours, links, storefront. It sits under the shared header
// (the one avatar, name and bio of the account) and never renders a name or avatar of its own. It reads only business details, so
// nothing here can become a second identity. The legacy business_name / business_logo_url columns are not read at all.
export function BusinessProfileCard({ profile, phone: callPhone, verified, isSelf, onContact, onVisitStorefront, onEdit }: Props) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const [hoursOpen, setHoursOpen] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const name = profile.full_name?.trim() ?? '';
  const allDays = hoursLines(profile.business_hours).days;
  const days = allDays.some((h) => !h.closed) ? allDays : [];
  const open = days.length > 0 ? isOpenNow(days) : null;
  const today = hoursDayOf(new Date());
  const todayHours = days.find((h) => h.day === today);
  const website = safeWebsiteHref(profile.business_website);
  // Only a number the database released for this business (the owner opted in); the account phone stays private otherwise.
  const phone = callPhone ?? null;
  const socials = SOCIAL_KEYS.map((key) => ({ key, href: normalizeSocial(key, profile.social_links?.[key] ?? '') })).filter((s) => !!s.href);
  const hasInfo = !!profile.business_address || days.length > 0 || !!website || socials.length > 0;
  const shownCategories = (profile.business_categories ?? []).map((id) => categories.find((c) => c.id === id)).filter((c): c is (typeof categories)[number] => !!c);

  const iconButton = (icon: keyof typeof Ionicons.glyphMap, label: string, onPress: () => void) => (
    <Pressable
      key={label}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: pressed ? colors.inputBackground : colors.surface })}
    >
      <Ionicons name={icon} size={20} color={colors.primary} />
    </Pressable>
  );

  const todos = isSelf
    ? [
        !profile.business_banner_url ? t('business.todoBanner') : null,
        !profile.business_categories?.length ? t('business.todoCategory') : null,
        !profile.business_description ? t('business.todoDescription') : null,
        !profile.business_address ? t('business.todoAddress') : null,
        days.length === 0 ? t('business.todoHours') : null,
        !website && socials.length === 0 ? t('business.todoLinks') : null,
      ].filter(Boolean) as string[]
    : [];
  const share = () => Share.share({ message: t('business.shareMessage', { name }) }).catch(() => {});
  const hasBadges = verified || shownCategories.length > 0 || open !== null;
  const hasActions = (!isSelf && (!!onContact || !!phone)) || (isSelf && !!onEdit);
  const hasMain = hasBadges || !!profile.business_description || hasActions || !!onVisitStorefront;
  if (!hasMain && !hasInfo && todos.length === 0) return null;

  return (
    <View style={{ marginTop: spacing.sm }}>
      {hasMain ? (
        <View style={{ borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: spacing.md }}>
          {hasBadges ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs }}>
              {verified ? <VerifiedBusinessBadge /> : null}
              {shownCategories.map((category) => (
                <View key={category.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.inputBackground }}>
                  <Ionicons name={(category.icon.includes(':') ? 'pricetag-outline' : category.icon) as keyof typeof Ionicons.glyphMap} size={13} color={colors.textSecondary} />
                  <Text variant="tiny" color="secondary">{category.name}</Text>
                </View>
              ))}
              {open !== null ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: (open ? colors.success : colors.error) + '1A' }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: open ? colors.success : colors.error }} />
                  <Text variant="tiny" style={{ color: open ? colors.success : colors.error }}>{open ? t('seller.hours.openNow') : t('seller.hours.closedNow')}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {profile.business_description ? (
            <Pressable onPress={() => setDescOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: descOpen }}>
              <Text variant="body" color="secondary" numberOfLines={descOpen ? undefined : 3} style={{ marginTop: hasBadges ? spacing.sm : 0 }}>{profile.business_description}</Text>
              {profile.business_description.length > 140 ? <Text variant="caption" color="brand" style={{ marginTop: 2, fontWeight: '600' }}>{descOpen ? t('business.showLess') : t('business.readMore')}</Text> : null}
            </Pressable>
          ) : null}

          {hasActions ? (
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: hasBadges || profile.business_description ? spacing.md : 0, alignItems: 'center' }}>
              {!isSelf && onContact ? (
                <Pressable
                  onPress={onContact}
                  accessibilityRole="button"
                  style={({ pressed }) => ({ flex: 1, height: 48, borderRadius: radius.md, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primary, backgroundColor: pressed ? colors.inputBackground : colors.surface })}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primary} />
                  <Text variant="bodyMedium" color="brand">{t('business.message')}</Text>
                </Pressable>
              ) : null}
              {!isSelf && phone ? iconButton('call-outline', t('seller.call'), () => openExternal(`tel:${phone}`)) : null}
              {iconButton('share-outline', t('business.share'), share)}
              {isSelf && onEdit ? (
                <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={t('business.editBusiness')} style={{ marginLeft: 'auto', paddingVertical: 12, paddingHorizontal: 16, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border }}>
                  <Text variant="caption" color="brand" style={{ fontWeight: '600' }}>{t('business.editBusiness')}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {onVisitStorefront ? (
            <Pressable onPress={onVisitStorefront} accessibilityRole="button" style={{ marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 }}>
              <Ionicons name="storefront-outline" size={16} color={colors.primary} />
              <Text variant="bodyMedium" color="brand">{t('storefront.public.visitStorefront')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {todos.length > 0 && onEdit ? (
        <Pressable onPress={onEdit} accessibilityRole="button" style={{ marginTop: spacing.sm, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary + '55', padding: spacing.md, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
            <Text variant="bodyMedium" style={{ flex: 1 }}>{t('business.completeTitle')}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </View>
          <Text variant="caption" color="secondary">{t('business.completeSub')}</Text>
          {todos.map((x) => (
            <View key={x} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="ellipse-outline" size={14} color={colors.textMuted} />
              <Text variant="caption" color="secondary">{x}</Text>
            </View>
          ))}
        </Pressable>
      ) : null}

      {hasInfo ? (
        <View style={{ marginTop: spacing.sm, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm }}>
          <Text variant="bodyMedium">{t('business.details')}</Text>
          {profile.business_address ? (
            <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'flex-start' }}>
              <Ionicons name="location-outline" size={18} color={colors.textSecondary} style={{ marginTop: 2 }} />
              <Text variant="body" color="secondary" style={{ flex: 1 }}>{profile.business_address}</Text>
            </View>
          ) : null}
          {days.length > 0 ? (
            <View>
              <Pressable onPress={() => setHoursOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: hoursOpen }} style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
                <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
                <Text variant="body" color="secondary" style={{ flex: 1 }}>
                  {todayHours ? (todayHours.closed ? `${t(`components.businessHoursEditor.days.${today}`)} · ${t('seller.hours.closed')}` : `${t(`components.businessHoursEditor.days.${today}`)} · ${formatTime12(todayHours.open!)} – ${formatTime12(todayHours.close!)}`) : t('seller.hours.title')}
                </Text>
                <Ionicons name={hoursOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
              </Pressable>
              {hoursOpen ? (
                <View style={{ marginTop: spacing.xs, marginLeft: 26 }}>
                  {days.map((h) => {
                    const isToday = h.day === today;
                    return (
                      <View key={h.day} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                        <Text variant={isToday ? 'bodyMedium' : 'caption'} color={isToday ? 'primary' : 'secondary'}>{t(`components.businessHoursEditor.days.${h.day}`)}</Text>
                        <Text variant={isToday ? 'bodyMedium' : 'caption'} color={h.closed ? 'muted' : isToday ? 'primary' : 'secondary'}>
                          {h.closed ? t('seller.hours.closed') : `${formatTime12(h.open!)} – ${formatTime12(h.close!)}`}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ) : null}
          {website || socials.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {website ? (
                <Pressable onPress={() => openExternal(website)} accessibilityRole="link" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.inputBackground }}>
                  <Ionicons name="globe-outline" size={16} color={colors.primary} />
                  <Text variant="caption" color="brand" style={{ fontWeight: '600' }}>{t('business.website')}</Text>
                </Pressable>
              ) : null}
              {socials.map(({ key, href }) => (
                <Pressable key={key} onPress={() => openExternal(href!)} accessibilityRole="link" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.inputBackground }}>
                  <Ionicons name={SOCIAL_ICONS[key]} size={16} color={colors.primary} />
                  <Text variant="caption" color="brand" style={{ fontWeight: '600' }}>{SOCIAL_NAMES[key]}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
