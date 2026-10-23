import { useEffect, useState } from 'react';
import { View, FlatList, Alert, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { idParam } from '@/lib/routeParams';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Input } from '@/components/Input';
import { Skeleton } from '@/components/Skeleton';
import { EmptyState } from '@/components/EmptyState';
import { closeKind } from '@/data/sellRules';
import { useTheme } from '@/theme/ThemeContext';
import { useOfferStore, Offer, OfferThread } from '@/store/offers';
import { useMyListingsStore } from '@/store/myListings';
import { useListing } from '@/hooks/useListings';
import { useAuthStore } from '@/store/auth';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { imageUrl } from '@/lib/r2';
import { formatBirr, currencyLabel } from '@/lib/currency';

const toneFor = (s: Offer['status']): 'success' | 'warning' | 'brand' | 'neutral' => {
  if (s === 'accepted' || s === 'sold') return 'success';
  if (s === 'rejected' || s === 'cancelled' || s === 'expired') return 'warning';
  return 'brand';
};

function OfferInbox() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const inbox = useOfferStore((s) => s.inbox);
  const hasHydratedInbox = useOfferStore((s) => s.hasHydratedInbox);
  const loadInbox = useOfferStore((s) => s.loadInbox);
  const [filter, setFilter] = useState<'all' | 'pending' | 'accepted' | 'rejected' | 'countered'>('all');

  useEffect(() => {
    loadInbox();
  }, []);

  const filtered = inbox.filter((t) => {
    if (filter === 'all') return true;
    if (filter === 'rejected') return t.status === 'rejected' || t.status === 'cancelled' || t.status === 'expired';
    return t.status === filter;
  });

  const openThread = (t: OfferThread) => router.push(`/offers?listingId=${t.listingId}&currency=${t.currency}` as any);

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {t('offers.title')}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md }}>
        {(['all', 'pending', 'accepted', 'countered', 'rejected'] as const).map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={{
              paddingHorizontal: spacing.sm,
              paddingVertical: 6,
              borderRadius: radius.pill,
              backgroundColor: filter === f ? colors.primary : colors.surface,
            }}
          >
            <Text variant="caption" color={filter === f ? 'inverse' : 'secondary'} style={{ textTransform: 'capitalize' }}>
              {t(`offers.filters.${f}`)}
            </Text>
          </Pressable>
        ))}
      </View>

      {!hasHydratedInbox ? (
        <View style={{ gap: spacing.sm }}>
          <Skeleton height={72} />
          <Skeleton height={72} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(t) => `${t.listingId}:${t.buyerId}`}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={<EmptyState icon="pricetag-outline" title={t('offers.emptyTitle')} message={t('offers.emptyMessage')} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openThread(item)}
              accessibilityRole="button"
              accessibilityLabel={
                item.role === 'buyer'
                  ? t('offers.yourOfferToA11y', { name: item.counterpartyName, title: item.listingTitle })
                  : t('offers.offerFromA11y', { name: item.counterpartyName, title: item.listingTitle })
              }
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm }}
            >
              <Image
                source={{ uri: item.listingImage ? imageUrl(item.listingImage, { width: 160 }) : `https://picsum.photos/seed/${item.listingId}/160/160` }}
                accessibilityLabel={t('components.listingCard.photoOf', { title: item.listingTitle })}
                style={{ width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.skeleton }}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={200}
              />
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
                <Text variant="bodyMedium" numberOfLines={1}>
                  {item.listingTitle}
                </Text>
                <Text variant="caption" color="secondary" numberOfLines={1}>
                  {t('offers.rowSummary', { who: item.role === 'buyer' ? t('common.you') : item.counterpartyName, amount: formatBirr(item.amount, item.currency) })}
                </Text>
              </View>
              <Badge label={t(`offers.status.${item.status}`)} tone={toneFor(item.status)} />
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

function OfferThreadScreen({ listingId }: { listingId: string }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Fetched by id. Until it is known (loading / failed) the screen must not guess who owns it.
  const { listing, status: listingStatus } = useListing(listingId);
  const ownershipKnown = listingStatus === 'ready' || listingStatus === 'missing';
  const uid = useAuthStore((s) => s.session?.user.id);
  const isOwner = !!listing && listing.seller.id === uid;

  const offers = useOfferStore((s) => s.offers);
  const hasHydrated = useOfferStore((s) => s.hasHydrated);
  const loadForListing = useOfferStore((s) => s.loadForListing);
  const subscribeListing = useOfferStore((s) => s.subscribeListing);
  const createOffer = useOfferStore((s) => s.createOffer);
  const accept = useOfferStore((s) => s.accept);
  const decline = useOfferStore((s) => s.decline);
  const counter = useOfferStore((s) => s.counter);
  const markSold = useMyListingsStore((s) => s.markSold);

  const [amountDraft, setAmountDraft] = useState('');
  const [counteringId, setCounteringId] = useState<string | null>(null);
  const [counterDraft, setCounterDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [marking, setMarking] = useState(false);
  const [soldOpen, setSoldOpen] = useState(false);
  const [acceptedOpen, setAcceptedOpen] = useState(false);

  useEffect(() => {
    loadForListing(listingId);
    const unsubscribe = subscribeListing(listingId);
    return unsubscribe;
  }, [listingId]);

  const latest = offers[offers.length - 1];
  const canRespond = latest?.status === 'pending' && !latest.fromMe;
  const canMakeNewOffer = ownershipKnown && !isOwner && (!latest || (latest.fromMe && ['rejected', 'cancelled', 'expired', 'sold'].includes(latest.status)));

  const kind = listing ? closeKind(listing) : 'sold';
  const canMarkSold = isOwner && latest?.status === 'accepted' && listing?.status !== 'sold';

  // An offer can never be higher than the asking price (also enforced in the database, migration 0065).
  const overAsking = (amount: number) => {
    if (!listing || listing.price <= 0 || amount <= listing.price) return false;
    Alert.alert(t('offers.sendFailedTitle'), t('offers.exceedsAsking', { price: formatBirr(listing.price, listing.currency) }));
    return true;
  };

  const confirmMarkSold = () => {
    if (!marking) setSoldOpen(true);
  };

  const runMarkSold = async () => {
    setSoldOpen(false);
    if (!listing || marking) return;
    setMarking(true);
    const ok = await markSold(listing.id);
    setMarking(false);
    if (!ok) Alert.alert(t(`listing.close.${kind}.errorTitle`), t('listing.markSoldErrorMessage'));
    else loadForListing(listingId);
  };

  const submitOffer = async () => {
    const amount = Number(amountDraft);
    if (!amount || amount <= 0 || overAsking(amount)) return;
    setBusy(true);
    const { error } = await createOffer(listingId, amount);
    setBusy(false);
    if (error) Alert.alert(t('offers.sendFailedTitle'), error);
    else setAmountDraft('');
  };

  const submitCounter = async (offerId: string) => {
    const amount = Number(counterDraft);
    if (!amount || amount <= 0 || overAsking(amount)) return;
    setBusy(true);
    const { error } = await counter(offerId, amount);
    setBusy(false);
    if (error) Alert.alert(t('offers.counterFailedTitle'), error);
    else {
      setCounteringId(null);
      setCounterDraft('');
    }
  };

  const respond = async (action: 'accept' | 'decline') => {
    if (!latest) return;
    setBusy(true);
    const { error } = action === 'accept' ? await accept(latest.id) : await decline(latest.id);
    setBusy(false);
    if (error) Alert.alert(t('offers.updateFailedTitle'), error);
    else if (action === 'accept' && isOwner) setAcceptedOpen(true);
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} noPadding>
      <ConfirmDialog
        visible={acceptedOpen}
        icon="checkmark-circle-outline"
        title={t('offers.acceptedTitle')}
        message={t('offers.acceptedMessage')}
        confirmLabel={t(`listing.close.${kind}.mark`)}
        onCancel={() => setAcceptedOpen(false)}
        onConfirm={() => {
          setAcceptedOpen(false);
          setSoldOpen(true);
        }}
      />
      <ConfirmDialog
        visible={soldOpen}
        icon="checkmark-circle-outline"
        title={t(`listing.close.${kind}.confirmTitle`)}
        message={t(`listing.close.${kind}.confirmMessage`)}
        confirmLabel={t(`listing.close.${kind}.confirmYes`)}
        onCancel={() => setSoldOpen(false)}
        onConfirm={runMarkSold}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, paddingHorizontal: spacing.md }} keyboardVerticalOffset={insets.top}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {t('offers.title')}
        </Text>
      </View>

      {listing && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
          <Text variant="caption" color="secondary" numberOfLines={1} style={{ flex: 1, marginRight: spacing.sm }}>
            {listing.title}
          </Text>
          <Text variant="bodyMedium" color="brand">
            {t('offers.listingPrice', { price: formatBirr(listing.price, listing.currency) })}
          </Text>
        </View>
      )}

      {!hasHydrated ? (
        <View style={{ gap: spacing.sm }}>
          <Skeleton height={60} />
          <Skeleton height={60} width="70%" />
        </View>
      ) : (
        <FlatList
          data={offers}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ gap: spacing.sm }}
          ListEmptyComponent={
            <EmptyState
              icon="pricetag-outline"
              title={t('offers.emptyTitle')}
              message={isOwner ? t('offers.emptyMessageOwner') : t('offers.emptyMessageBuyer')}
            />
          }
          renderItem={({ item }) => {
            const diff = listing ? item.amount - listing.price : null;
            return (
              <View
                style={{
                  alignSelf: item.fromMe ? 'flex-end' : 'flex-start',
                  backgroundColor: item.fromMe ? colors.primary : colors.surface,
                  borderRadius: radius.md,
                  padding: spacing.sm,
                  maxWidth: '75%',
                }}
              >
                <Text variant="caption" color={item.fromMe ? 'inverse' : 'muted'}>
                  {item.fromMe ? t('offers.youOffered') : t('offers.theyOffered')}
                </Text>
                <Text variant="h3" color={item.fromMe ? 'inverse' : 'primary'}>
                  {formatBirr(item.amount, listing?.currency)}
                </Text>
                {diff !== null && (
                  <Text variant="tiny" color={item.fromMe ? 'inverse' : 'secondary'}>
                    {diff === 0
                      ? t('offers.matchesAsking')
                      : diff > 0
                      ? t('offers.aboveAsking', { amount: formatBirr(Math.abs(diff), listing?.currency) })
                      : t('offers.belowAsking', { amount: formatBirr(Math.abs(diff), listing?.currency) })}
                  </Text>
                )}
                {item.message ? (
                  <Text variant="caption" color={item.fromMe ? 'inverse' : 'secondary'} style={{ marginTop: 2 }}>
                    {item.message}
                  </Text>
                ) : null}
                <Badge label={t(`offers.status.${item.status}`)} tone={toneFor(item.status)} />
              </View>
            );
          }}
        />
      )}

      {hasHydrated && canRespond && (
        <View style={{ marginTop: spacing.md }}>
          {counteringId === latest.id ? (
            <View style={{ gap: spacing.xs }}>
              <Input placeholder={t('offers.counterAmountPlaceholder', { currency: currencyLabel(listing?.currency) })} keyboardType="numeric" value={counterDraft} onChangeText={setCounterDraft} />
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                <Button label={t('offers.sendCounter')} onPress={() => submitCounter(latest.id)} loading={busy} style={{ flex: 1 }} />
                <Button label={t('common.cancel')} variant="ghost" onPress={() => setCounteringId(null)} style={{ flex: 1 }} />
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              <Button label={t('offers.accept')} onPress={() => respond('accept')} loading={busy} style={{ flex: 1 }} />
              <Button label={t('offers.counter')} variant="outline" onPress={() => setCounteringId(latest.id)} style={{ flex: 1 }} />
              <Button label={t('offers.decline')} variant="ghost" onPress={() => respond('decline')} loading={busy} style={{ flex: 1 }} />
            </View>
          )}
        </View>
      )}

      {hasHydrated && canMarkSold && (
        <View style={{ marginTop: spacing.md, gap: spacing.xs, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm }}>
          <Text variant="bodyMedium">{t('offers.soldBannerTitle')}</Text>
          <Text variant="caption" color="secondary">{t('offers.soldBannerMessage')}</Text>
          <Button label={t(`listing.close.${kind}.mark`)} onPress={confirmMarkSold} loading={marking} fullWidth />
        </View>
      )}

      {hasHydrated && canMakeNewOffer && (
        <View style={{ marginTop: spacing.md, gap: spacing.xs, marginBottom: spacing.md }}>
          <Input placeholder={t('offers.yourOfferPlaceholder', { currency: currencyLabel(listing?.currency) })} keyboardType="numeric" value={amountDraft} onChangeText={setAmountDraft} />
          <Button label={t('offers.sendOffer')} onPress={submitOffer} loading={busy} fullWidth />
        </View>
      )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

// With a listingId param, shows that one negotiation thread (existing
// behavior â€” also where notification taps for offer_* types land, see
// lib/push.ts's navigateForPush). Without one (opened from the Profile menu),
// shows the cross-listing inbox instead of the old "No listing selected" dead end.
export default function OfferHistory() {
  const authed = useRequireAuthScreen();
  const { listingId: rawListingId } = useLocalSearchParams<{ listingId?: string }>();
  const listingId = idParam(rawListingId) || undefined;
  if (!authed) return <Screen />;
  if (!listingId) return <OfferInbox />;
  return <OfferThreadScreen listingId={listingId} />;
}
