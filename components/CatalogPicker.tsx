import { useMemo, useState } from 'react';
import { View, Pressable, ScrollView, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';
import { searchCatalog } from '@/data/brandCatalog';
import { Text } from './Text';
import { KeyboardSheet } from './KeyboardSheet';

type Props = {
  label: string;
  required?: boolean;
  /** Names listed first (editorial seed — labelled "Common", never "Most sold"). */
  common: string[];
  /** Every name A–Z. */
  all: string[];
  value: string;
  onChange: (value: string) => void;
  error?: string;
  /** When set the picker is locked and shows this instead of opening (e.g. "Choose the brand first"). */
  disabledHint?: string;
};

// Searchable picker for brand / model (data/brandCatalog.ts). Names are shown exactly as stored — never translated.
// The seller can always accept what they typed in the search box ("Use ..."), so a brand or model missing from the
// catalog never blocks a listing.
export function CatalogPicker({ label, required, common, all, value, onChange, error, disabledHint }: Props) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;
  const results = useMemo(() => (searching ? searchCatalog(all, query) : []), [all, query, searching]);
  const exact = results.some((r) => r.toLowerCase() === query.trim().toLowerCase());

  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const pick = (name: string) => {
    onChange(name);
    close();
  };

  const row = (name: string) => (
    <Pressable
      key={name}
      onPress={() => pick(name)}
      accessibilityRole="button"
      accessibilityState={{ selected: name === value }}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm }}
    >
      <Text variant="body">{name}</Text>
      {name === value ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
    </Pressable>
  );
  const heading = (text: string) => (
    <Text variant="caption" color="muted" style={{ marginTop: spacing.sm, fontWeight: '700' }}>
      {text}
    </Text>
  );

  return (
    <View style={{ width: '100%' }}>
      <Text variant="caption" color="secondary" style={{ marginBottom: spacing.xs, fontWeight: '700' }}>
        {value ? '✓ ' : ''}
        {required ? `${label} *` : label}
      </Text>
      <Pressable
        onPress={() => !disabledHint && setOpen(true)}
        disabled={!!disabledHint}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || disabledHint || t('post.catalog.choose')}`}
        accessibilityState={{ disabled: !!disabledHint }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: colors.inputBackground,
          borderRadius: radius.sm,
          paddingHorizontal: spacing.sm,
          minHeight: 50,
          opacity: disabledHint ? 0.6 : 1,
          borderWidth: error ? 1 : 0,
          borderColor: error ? colors.error : undefined,
        }}
      >
        <Text variant="body" color={value ? 'primary' : 'muted'}>
          {value || disabledHint || t('post.catalog.choose')}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>
      {error ? (
        <Text variant="caption" color="error" style={{ marginTop: spacing.xxs }}>
          {error}
        </Text>
      ) : null}

      <KeyboardSheet visible={open} onClose={close}>
        <Text variant="h3" style={{ marginBottom: spacing.sm }}>
          {label}
        </Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('post.catalog.search')}
          placeholderTextColor={colors.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="done"
          onSubmitEditing={() => searching && !exact && pick(query.trim())}
          accessibilityLabel={t('post.catalog.search')}
          style={{ backgroundColor: colors.inputBackground, color: colors.textPrimary, borderRadius: radius.sm, paddingHorizontal: spacing.sm, minHeight: 46 }}
        />
        <ScrollView keyboardShouldPersistTaps="handled" style={{ marginTop: spacing.xs }}>
          {searching ? (
            <>
              {results.map(row)}
              {results.length === 0 ? (
                <Text variant="caption" color="muted" style={{ paddingVertical: spacing.sm }}>
                  {t('post.catalog.noMatch')}
                </Text>
              ) : null}
              {!exact ? (
                <Pressable
                  onPress={() => pick(query.trim())}
                  accessibilityRole="button"
                  style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm }}
                >
                  <Ionicons name="create-outline" size={18} color={colors.primary} />
                  <Text variant="body" color="brand">
                    {t('post.catalog.useTyped', { value: query.trim() })}
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            <>
              {common.length > 0 ? heading(t('post.catalog.common')) : null}
              {common.map(row)}
              {heading(t('post.catalog.all'))}
              {all.map(row)}
              <Text variant="caption" color="muted" style={{ paddingVertical: spacing.sm }}>
                {t('post.catalog.typeHint')}
              </Text>
            </>
          )}
        </ScrollView>
      </KeyboardSheet>
    </View>
  );
}
