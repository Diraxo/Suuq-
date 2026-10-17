import { useEffect, useMemo, useState } from 'react';
import { View, Pressable, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';
import { Badge } from './Badge';
import { Button } from './Button';
import { Input } from './Input';
import { useLocationsStore, submitLocationRequest } from '@/store/locations';
import {
  LocNode,
  activeCountries,
  ancestors,
  childrenOf,
  displayName,
  effectiveFor,
  hasChildren,
  otherCountries,
  pathLabel,
  searchLocations,
  searchNodes,
  toLang,
} from '@/lib/locationTree';

export type PickedLocation = {
  /** Directory id of the chosen place (for a pending request: the new request's id). */
  id: string;
  /** Canonical English name — what gets stored on the listing. */
  name: string;
  /** Value for listings.region. */
  regionLabel: string;
  /** Currencies a seller may price in at this place. */
  currencies: string[];
  defaultCurrency: string;
  /** True when the admin hasn't approved this location yet — it still works for the listing. */
  pending: boolean;
};

type Props = {
  selected?: string;
  onSelect: (location: PickedLocation) => void;
  /** Hide the "Can't find your location?" flow (e.g. when only filtering). */
  allowRequest?: boolean;
};

type Row =
  | { type: 'header'; key: string; label: string }
  | { type: 'notice'; key: string; label: string }
  | { type: 'use'; key: string; node: LocNode }
  | { type: 'node'; key: string; node: LocNode; subtitle?: string };

// Shared by the Sell location step, the CityPicker sheet and the Home filter:
// a country-first, searchable browser over the admin-managed directory
// (country → region → city) plus the "add a missing location" request flow.
export function LocationList({ selected, onSelect, allowRequest = true }: Props) {
  const { t, i18n } = useTranslation();
  const lang = toLang(i18n.language);
  const { colors, spacing, radius } = useTheme();
  const index = useLocationsStore((s) => s.index);
  const status = useLocationsStore((s) => s.status);
  const load = useLocationsStore((s) => s.load);

  const [stack, setStack] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [addCountryId, setAddCountryId] = useState<string | undefined>();
  const [addRegionId, setAddRegionId] = useState<string | undefined>();
  const [countryQuery, setCountryQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();

  useEffect(() => {
    if (status === 'idle') load();
  }, [status, load]);

  const currentId = stack[stack.length - 1] as string | undefined;
  const current = currentId ? index.byId.get(currentId) : undefined;
  const searching = query.trim().length > 0;

  const pick = (node: LocNode, pending = false) => {
    const eff = effectiveFor(index, node.id);
    onSelect({ id: node.id, name: node.name, regionLabel: eff.regionLabel, currencies: eff.currencies, defaultCurrency: eff.defaultCurrency, pending });
  };

  const openNode = (node: LocNode) => {
    if (hasChildren(index, node.id)) {
      setStack(ancestors(index, node.id).map((a) => a.id).concat(node.id));
      setQuery('');
    } else {
      pick(node);
    }
  };

  const rows = useMemo<Row[]>(() => {
    if (searching) {
      const found = searchLocations(index, query, lang);
      const toRow = (node: LocNode): Row => ({ type: 'node', key: node.id, node, subtitle: pathLabel(index, node.id, lang) });
      if (found.matches.length) return found.matches.map(toRow);
      // Nothing contains the typed text: offer real directory places it might have meant, clearly labelled and never auto-selected.
      if (found.suggestions.length) return [{ type: 'notice', key: 'n-suggest', label: t('components.locationList.noExactMatch', { query: query.trim() }) } as Row, ...found.suggestions.map(toRow)];
      return [];
    }
    if (current) {
      const out: Row[] = [{ type: 'use', key: `use-${current.id}`, node: current }];
      for (const node of childrenOf(index, current.id, lang)) out.push({ type: 'node', key: node.id, node });
      return out;
    }
    const out: Row[] = [];
    const active = activeCountries(index, lang);
    if (active.length) {
      out.push({ type: 'header', key: 'h-active', label: t('components.locationList.activeHeader') });
      for (const node of active) out.push({ type: 'node', key: node.id, node });
    }
    const others = otherCountries(index, lang);
    if (others.length) out.push({ type: 'header', key: 'h-all', label: t('components.locationList.allCountriesHeader') });
    for (const node of others) out.push({ type: 'node', key: node.id, node });
    return out;
  }, [index, searching, query, lang, current, t]);

  const startAdding = () => {
    setNewName(query.trim());
    setFormError(undefined);
    setCountryQuery('');
    const country = current ? (current.kind === 'country' ? current : ancestors(index, current.id).find((a) => a.kind === 'country')) : undefined;
    setAddCountryId(country?.id);
    setAddRegionId(current?.kind === 'region' ? current.id : current?.kind === 'city' ? current.parentId ?? undefined : undefined);
    setAdding(true);
  };

  const submit = async () => {
    if (newName.trim().length < 2) {
      setFormError(t('components.locationList.nameRequired'));
      return;
    }
    const parentId = addRegionId ?? addCountryId;
    if (!parentId) {
      setFormError(t('components.locationList.countryRequired'));
      return;
    }
    setSubmitting(true);
    setFormError(undefined);
    try {
      const res = await submitLocationRequest(newName, parentId);
      onSelect({ id: res.id, name: res.name, regionLabel: res.regionLabel, currencies: res.currencies, defaultCurrency: res.defaultCurrency, pending: res.status !== 'approved' });
      setAdding(false);
      setQuery('');
    } catch (e) {
      const message = (e as { message?: string })?.message ?? '';
      setFormError(message.includes('Too many') ? t('components.locationList.tooMany') : t('components.locationList.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const chip = (active: boolean) => ({
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: active ? colors.primary : colors.border,
    backgroundColor: active ? colors.primary + '0D' : colors.surface,
  });

  if (adding) {
    const country = addCountryId ? index.byId.get(addCountryId) : undefined;
    const regions = country ? childrenOf(index, country.id, lang).filter((c) => c.kind === 'region') : [];
    const countryMatches = !country ? (countryQuery.trim() ? searchNodes(index, countryQuery, lang, 12).filter((n) => n.kind === 'country') : activeCountries(index, lang)) : [];
    return (
      <View style={{ gap: spacing.sm }}>
        <Text variant="h3">{t('components.locationList.addTitle')}</Text>
        <Text variant="caption" color="secondary">
          {t('components.locationList.addHint')}
        </Text>
        <View>
          <Text variant="caption" color="secondary" style={{ marginBottom: spacing.xs }}>
            {t('components.locationList.countryLabel')}
          </Text>
          {country ? (
            <Pressable
              onPress={() => {
                setAddCountryId(undefined);
                setAddRegionId(undefined);
              }}
              accessibilityRole="button"
              style={[chip(true), { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: spacing.xs }]}
            >
              <Text variant="bodyMedium">{displayName(country, lang)}</Text>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          ) : (
            <View style={{ gap: spacing.xs }}>
              <Input value={countryQuery} onChangeText={setCountryQuery} placeholder={t('components.locationList.searchPlaceholder')} autoCorrect={false} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {countryMatches.map((c) => (
                  <Pressable key={c.id} onPress={() => setAddCountryId(c.id)} accessibilityRole="button" style={chip(false)}>
                    <Text variant="bodyMedium">{displayName(c, lang)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </View>
        {regions.length > 0 && (
          <View>
            <Text variant="caption" color="secondary" style={{ marginBottom: spacing.xs }}>
              {t('components.locationList.regionLabel')}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {regions.map((r) => (
                <Pressable key={r.id} onPress={() => setAddRegionId(addRegionId === r.id ? undefined : r.id)} accessibilityRole="button" accessibilityState={{ selected: addRegionId === r.id }} style={chip(addRegionId === r.id)}>
                  <Text variant="bodyMedium">{displayName(r, lang)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
        <Input label={t('components.locationList.nameLabel')} value={newName} onChangeText={setNewName} maxLength={80} autoCapitalize="words" error={formError} />
        <Button label={t('components.locationList.submit')} onPress={submit} loading={submitting} fullWidth />
        <Button label={t('common.cancel')} variant="ghost" onPress={() => setAdding(false)} fullWidth />
      </View>
    );
  }

  return (
    <View style={{ flexShrink: 1 }}>
      <Input
        value={query}
        onChangeText={setQuery}
        placeholder={t('components.locationList.searchPlaceholder')}
        leftIcon={<Ionicons name="search" size={16} color={colors.textMuted} />}
        autoCorrect={false}
        accessibilityLabel={t('components.locationList.searchPlaceholder')}
      />
      {!searching && current && (
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: spacing.xs, gap: 4 }}>
          <Pressable onPress={() => setStack(stack.slice(0, -1))} accessibilityRole="button" accessibilityLabel={t('common.back')} style={{ padding: 4 }}>
            <Ionicons name="chevron-back" size={20} color={colors.primary} />
          </Pressable>
          <Pressable onPress={() => setStack([])} accessibilityRole="button">
            <Text variant="caption" color="primary">
              {t('components.locationList.allCountries')}
            </Text>
          </Pressable>
          {stack.map((id, i) => {
            const n = index.byId.get(id);
            if (!n) return null;
            return (
              <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="chevron-forward" size={12} color={colors.textMuted} />
                <Pressable onPress={() => setStack(stack.slice(0, i + 1))} accessibilityRole="button">
                  <Text variant="caption" color={i === stack.length - 1 ? 'secondary' : 'primary'}>
                    {displayName(n, lang)}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}
      <View style={{ height: spacing.xs }} />
      {status === 'loading' || status === 'idle' ? (
        <Text variant="body" color="secondary" style={{ paddingVertical: spacing.md }}>
          {t('components.locationList.loading')}
        </Text>
      ) : status === 'error' ? (
        <View style={{ paddingVertical: spacing.md, gap: spacing.xs }}>
          <Text variant="body" color="secondary">
            {t('components.locationList.loadFailed')}
          </Text>
          <Button label={t('common.retry')} variant="secondary" onPress={() => load()} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ gap: spacing.xs, paddingBottom: spacing.md }}
          ListEmptyComponent={
            <Text variant="body" color="secondary" style={{ paddingVertical: spacing.sm }}>
              {t('components.locationList.noMatches')}
            </Text>
          }
          ListFooterComponent={
            allowRequest ? (
              <Pressable onPress={startAdding} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm }}>
                <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                <Text variant="bodyMedium" color="primary">
                  {t('components.locationList.cantFind')}
                </Text>
              </Pressable>
            ) : null
          }
          renderItem={({ item }) => {
            if (item.type === 'notice') {
              return (
                <Text variant="caption" color="secondary" accessibilityRole="header" accessibilityLiveRegion="polite" style={{ paddingVertical: spacing.xs }}>
                  {item.label}
                </Text>
              );
            }
            if (item.type === 'header') {
              return (
                <Text variant="caption" color="muted" style={{ marginTop: spacing.xs, textTransform: 'uppercase' }}>
                  {item.label}
                </Text>
              );
            }
            if (item.type === 'use') {
              const isSelected = selected === item.node.name;
              return (
                <Pressable
                  onPress={() => pick(item.node)}
                  accessibilityRole="button"
                  style={[chip(isSelected), { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md }]}
                >
                  <Text variant="bodyMedium" color="primary">
                    {t('components.locationList.useWhole', { name: displayName(item.node, lang) })}
                  </Text>
                  {isSelected && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
                </Pressable>
              );
            }
            const node = item.node;
            const isSelected = selected === node.name;
            const branch = hasChildren(index, node.id);
            return (
              <Pressable
                onPress={() => openNode(node)}
                accessibilityRole="button"
                accessibilityLabel={displayName(node, lang)}
                style={[chip(isSelected), { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md }]}
              >
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                    <Ionicons name={node.kind === 'country' ? 'earth-outline' : 'location-outline'} size={18} color={colors.textSecondary} />
                    <Text variant="bodyMedium">{displayName(node, lang)}</Text>
                    {node.isFeatured && <Badge label={t('components.cityPicker.launchCity')} tone="brand" />}
                  </View>
                  {item.subtitle ? (
                    <Text variant="caption" color="muted" style={{ marginLeft: 26 }}>
                      {item.subtitle}
                    </Text>
                  ) : null}
                </View>
                {isSelected ? (
                  <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                ) : branch ? (
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
