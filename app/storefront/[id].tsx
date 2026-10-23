import { useEffect, useState } from 'react';
import { openExternal } from '@/lib/openLink';
import { View, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { idParam } from '@/lib/routeParams';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { ErrorState } from '@/components/ErrorState';
import { EmptyState } from '@/components/EmptyState';
import { ListingCard } from '@/components/ListingCard';
import { Skeleton } from '@/components/Skeleton';
import { useTheme } from '@/theme/ThemeContext';
import { supabase } from '@/lib/supabase';
import { imageUrl } from '@/lib/r2';
import { useBlockedEitherWayIds } from '@/lib/blocking';
import { useSellerListings } from '@/hooks/useSellerListings';
import { STOREFRONTS_ENABLED } from '@/lib/storefrontFlag';
import { PUBLIC_STOREFRONT_COLUMNS, PublicStorefront, hoursLines, isStorefrontId, safeWebsiteHref } from '@/lib/storefront';

// A render error in this route shows a friendly retry screen instead of closing the app.
export { ErrorFallback as ErrorBoundary } from '@/components/ErrorFallback';

// Public storefront: reads ONLY the public_storefronts view (published storefronts of owners in good standing). A draft,
// suspended or banned-owner storefront, an unknown id and a malformed id all produce the same "unavailable" page, so the
// screen reveals nothing about whether a private storefront exists. The owner's listings come from the block-aware
// seller_listings() path, and a blocked pair (either direction) sees the same "unavailable" page.
export default function PublicStorefrontScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = idParam(rawId);
  type Phase = { phase: 'loading' } | { phase: 'error' } | { phase: 'missing' } | { phase: 'ready'; store: PublicStorefront };
  // The result is keyed by the request that produced it, so a stale answer is never shown for another id or after a retry.
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${id}|${attempt}`;
  const [result, setResult] = useState<{ key: string; state: Phase } | null>(null);
  const state: Phase = !isStorefrontId(id) ? { phase: 'missing' } : result?.key === requestKey ? result.state : { phase: 'loading' };
  const blockedIds = useBlockedEitherWayIds();
  const ownerId = state.phase === 'ready' ? state.store.owner_id : undefined;
  const sellerListings = useSellerListings(ownerId);

  useEffect(() => {
    if (!STOREFRONTS_ENABLED) return;
    if (!isStorefrontId(id)) return;
    let cancelled = false;
    supabase
      .from('public_storefronts')
      .select(PUBLIC_STOREFRONT_COLUMNS)
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        const next: Phase = error ? { phase: 'error' } : data ? { phase: 'ready', store: data as PublicStorefront } : { phase: 'missing' };
        setResult({ key: requestKey, state: next });
      });
    return () => {
      cancelled = true;
    };
  }, [id, requestKey]);

  if (!STOREFRONTS_ENABLED) return <Redirect href="/(tabs)/home" />;

  const header = (
    <View style={{ paddingTop: spacing.sm, paddingBottom: spacing.md }}>
      <BackButton onPress={() => router.back()} />
    </View>
  );

  if (state.phase === 'loading') {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        {header}
        <Skeleton width="100%" height={120} radius={radius.md} />
        <Skeleton width="60%" height={24} style={{ marginTop: spacing.md }} />
      </Screen>
    );
  }
  if (state.phase === 'error') {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        {header}
        <ErrorState title={t('storefront.public.loadFailedTitle')} message={t('storefront.public.loadFailed')} onRetry={() => setAttempt((n) => n + 1)} />
      </Screen>
    );
  }
  if (state.phase === 'missing' || blockedIds.has(state.store.owner_id)) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        {header}
        <EmptyState icon="storefront-outline" title={t('storefront.public.unavailableTitle')} message={t('storefront.public.unavailable')} />
      </Screen>
    );
  }

  const store = state.store;
  const hours = hoursLines(store.hours);
  const website = safeWebsiteHref(store.website);

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <FlatList
        data={sellerListings.listings}
        keyExtractor={(l) => l.id}
        numColumns={2}
        showsVerticalScrollIndicator={false}
        columnWrapperStyle={{ gap: spacing.sm }}
        ListHeaderComponent={
          <View style={{ paddingBottom: spacing.md }}>
            {header}
            {store.banner_url ? (
              <Image cachePolicy="memory-disk" source={{ uri: imageUrl(store.banner_url, { width: 800 }) }} style={{ width: '100%', height: 130, borderRadius: radius.md, marginBottom: spacing.md }} contentFit="cover" accessibilityLabel={t('storefront.bannerImageLabel')} />
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              {store.logo_url ? (
                <Image cachePolicy="memory-disk" source={{ uri: imageUrl(store.logo_url, { width: 200 }) }} style={{ width: 64, height: 64, borderRadius: 14 }} contentFit="contain" accessibilityLabel={t('storefront.logoImageLabel')} />
              ) : null}
              <View style={{ flex: 1 }}>
                <Text variant="h2" accessibilityRole="header">
                  {store.name}
                </Text>
                {store.verified ? <Badge label={t('storefront.verification.verified')} tone="success" icon="shield-checkmark-outline" /> : null}
              </View>
            </View>
            {store.description ? (
              <Text variant="body" color="secondary" style={{ marginTop: spacing.sm }}>
                {store.description}
              </Text>
            ) : null}
            {store.address ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm }}>
                <Ionicons name="location-outline" size={16} color={colors.textMuted} />
                <Text variant="caption" color="muted" style={{ marginLeft: spacing.xs, flex: 1 }}>
                  {store.address}
                </Text>
              </View>
            ) : null}
            {website ? (
              <Button label={t('storefront.public.visitWebsite')} variant="outline" size="sm" onPress={() => openExternal(website)} style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }} />
            ) : null}
            {hours.days.length > 0 || hours.note ? (
              <Card elevated={false} style={{ marginTop: spacing.md }}>
                <Text variant="bodyMedium" style={{ marginBottom: spacing.xs }}>
                  {t('storefront.hoursLabel')}
                </Text>
                {hours.days.map((d) => (
                  <View key={d.day} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text variant="caption" color="secondary">
                      {t(`components.businessHoursEditor.days.${d.day}`)}
                    </Text>
                    <Text variant="caption">{d.closed ? t('components.businessHoursEditor.closed') : `${d.open} – ${d.close}`}</Text>
                  </View>
                ))}
                {hours.note ? <Text variant="caption">{hours.note}</Text> : null}
              </Card>
            ) : null}
            <Button label={t('storefront.public.viewSeller')} variant="ghost" size="sm" onPress={() => router.push(`/seller/${store.owner_id}` as any)} style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }} />
            <Text variant="h3" style={{ marginTop: spacing.md }}>
              {t('storefront.public.listings')}
            </Text>
          </View>
        }
        renderItem={({ item }) => <ListingCard listing={item} />}
        ListEmptyComponent={
          sellerListings.loading ? null : sellerListings.failed ? (
            <ErrorState message={t('storefront.public.listingsFailed')} onRetry={sellerListings.retry} />
          ) : (
            <Text variant="body" color="muted">
              {t('storefront.public.noListings')}
            </Text>
          )
        }
        contentContainerStyle={{ paddingBottom: spacing.xl }}
      />
    </Screen>
  );
}
