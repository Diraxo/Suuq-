import { useCallback, useState } from 'react';
import { View, Pressable, ActivityIndicator, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';
import { LocIndex, LocNode, Lang, countryOf, displayName } from '@/lib/locationTree';
import { LocateResult, locateNearestPlace } from '@/lib/geoLocate';
import { useLocationsStore } from '@/store/locations';
import { Text } from './Text';

// "Find listings near me" — suggests a place, never imposes one. Location is
// requested only when the user taps the button (a one-off, foreground,
// approximate fix; see lib/geoLocate.ts), the result is shown for confirmation,
// and only the chosen directory place is applied. Coordinates are not kept.
// Independent of the notification permission.

type Phase =
  | { name: 'idle' }
  | { name: 'locating' }
  | { name: 'result'; result: Exclude<LocateResult, { status: 'match' }> }
  | { name: 'confirm'; node: LocNode };

type Props = {
  index: LocIndex;
  lang: Lang;
  /** The user confirmed (or picked a nearby suggestion): apply this directory place. */
  onApply: (node: LocNode) => void;
  /** Open the full manual country/city picker. */
  onChooseManually: () => void;
  /** Hide the card (stored, so the first-launch card does not return). */
  onClose: () => void;
};

export function NearMeCard({ index, lang, onApply, onChooseManually, onClose }: Props) {
  const { colors, spacing, radius } = useTheme();
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });

  const label = (n: LocNode) => {
    const country = countryOf(index, n.id);
    return country && country.id !== n.id ? `${displayName(n, lang)}, ${displayName(country, lang)}` : displayName(n, lang);
  };

  const find = useCallback(async () => {
    setPhase({ name: 'locating' });
    // Verified coordinates (migration 0061) if they have loaded; waits briefly, then falls back to the built-in list.
    const coords = await useLocationsStore.getState().ensureCoords();
    const result = await locateNearestPlace(index, coords);
    if (result.status === 'match') setPhase({ name: 'confirm', node: result.match.node });
    else setPhase({ name: 'result', result });
  }, [index]);

  const link = (text: string, onPress: () => void, tone: 'brand' | 'secondary' = 'brand') => (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={6}>
      <Text variant="bodyMedium" color={tone}>
        {text}
      </Text>
    </Pressable>
  );

  let title = t('nearMe.title');
  let message: string | null = t('nearMe.message');
  let actions: React.ReactNode = (
    <>
      {link(t('nearMe.findNear'), () => void find())}
      {link(t('nearMe.chooseManually'), onChooseManually, 'secondary')}
    </>
  );
  let extra: React.ReactNode = null;

  if (phase.name === 'locating') {
    message = t('nearMe.locating');
    actions = <ActivityIndicator color={colors.primary} />;
  } else if (phase.name === 'confirm') {
    title = label(phase.node);
    message = t('nearMe.confirmMessage');
    actions = (
      <>
        {link(t('nearMe.useThis'), () => onApply(phase.node))}
        {link(t('nearMe.change'), onChooseManually, 'secondary')}
      </>
    );
  } else if (phase.name === 'result') {
    const r = phase.result;
    title = t('nearMe.noMatchTitle');
    if (r.status === 'denied') {
      title = t('nearMe.deniedTitle');
      message = t('nearMe.deniedMessage');
      actions = (
        <>
          {!r.canAskAgain && link(t('nearMe.openSettings'), () => Linking.openSettings())}
          {link(t('nearMe.chooseManually'), onChooseManually)}
        </>
      );
    } else if (r.status === 'unsupported') {
      title = t('nearMe.unsupportedTitle');
      message = t('nearMe.unsupportedMessage');
      actions = link(t('nearMe.chooseManually'), onChooseManually);
    } else if (r.status === 'no-match') {
      message = t(r.match.reason === 'border' ? 'nearMe.borderMessage' : r.match.reason === 'outside' ? 'nearMe.outsideMessage' : 'nearMe.noMatchMessage');
      actions = link(t('nearMe.chooseManually'), onChooseManually);
      if (r.match.nearby.length) {
        extra = (
          <View style={{ marginTop: spacing.sm }}>
            <Text variant="caption" color="secondary">
              {t('nearMe.nearbyMarkets')}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
              {r.match.nearby.map(({ node }) => (
                <Pressable
                  key={node.id}
                  onPress={() => onApply(node)}
                  accessibilityRole="button"
                  accessibilityLabel={t('home.showListingsIn', { name: displayName(node, lang) })}
                  style={{ paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary }}
                >
                  <Text variant="caption" color="brand">
                    {label(node)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        );
      }
    } else {
      title = t('nearMe.unavailableTitle');
      message = t(r.status === 'timeout' ? 'nearMe.timeoutMessage' : r.status === 'services-off' ? 'nearMe.servicesOffMessage' : 'nearMe.errorMessage');
      actions = (
        <>
          {link(t('nearMe.tryAgain'), () => void find())}
          {link(t('nearMe.chooseManually'), onChooseManually, 'secondary')}
        </>
      );
    }
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary + '1A', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="location-outline" size={18} color={colors.primary} />
      </View>
      <View style={{ flex: 1, marginLeft: spacing.sm }}>
        <Text variant="bodyMedium">{title}</Text>
        {message && (
          <Text variant="caption" color="secondary" style={{ marginTop: 2 }}>
            {message}
          </Text>
        )}
        {extra}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: spacing.sm, gap: spacing.lg }}>{actions}</View>
      </View>
      <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('nearMe.dismissA11y')} hitSlop={8}>
        <Ionicons name="close" size={18} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}
