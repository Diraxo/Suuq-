import { useEffect, useState } from 'react';
import { View, FlatList, Alert, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Skeleton } from '@/components/Skeleton';
import { EmptyState } from '@/components/EmptyState';
import { useTheme } from '@/theme/ThemeContext';
import { useOfferStore, Offer, OfferThread } from '@/store/offers';
import { useListingsStore, resolveListing } from '@/store/listings';
import { useAuthStore } from '@/store/auth';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { imageUrl } from '@/lib/r2';
import { formatBirr } from '@/lib/currency';

const toneFor = (s: Offer['status']): 'success' | 'warning' | 'brand' | 'neutral' => {
  if (s === 'accepted' || s === 'sold') return 'success';
  if (s === 'rejected' || s === 'cancelled' || s === 'expired') return 'warning';
  return 'brand';
};

function OfferInbox() {
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
          Offers
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
              {f}
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
          ListEmptyComponent={<EmptyState icon="pricetag-outline" title="No offers yet" message="Offers you send or receive on listings will show up here." />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openThread(item)}
              accessibilityRole="button"
              accessibilityLabel={`${item.role === 'buyer' ? 'Your offer to' : 'Offer from'} ${item.counterpartyName} on ${item.listingTitle}`}
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm }}
            >
              <Image
                source={{ uri: item.listingImage ? imageUrl(item.listingImage, { width: 160 }) : `https://picsum.photos/seed/${item.listingId}/160/160` }}
                accessibilityLabel={`Photo of ${item.listingTitle}`}
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
                  {item.role === 'buyer' ? 'You' : item.counterpartyName} Â· {formatBirr(item.amount)}
                </Text>
              </View>
              <Badge label={item.status} tone={toneFor(item.status)} />
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

function OfferThreadScreen({ listingId }: { listingId: string }) {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const globalListings = useListingsStore((s) => s.listings);
  const listing = resolveListing(listingId, globalListings);
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

  const [amountDraft, setAmountDraft] = useState('');
  const [counteringId, setCounteringId] = useState<string | null>(null);
  const [counterDraft, setCounterDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadForListing(listingId);
    const unsubscribe = subscribeListing(listingId);
    return unsubscribe;
  }, [listingId]);

  const latest = offers[offers.length - 1];
  const canRespond = latest?.status === 'pending' && !latest.fromMe;
  const canMakeNewOffer = !isOwner && (!latest || (latest.fromMe && ['rejected', 'cancelled', 'expired', 'sold'].includes(latest.status)));

  const submitOffer = async () => {
    const amount = Number(amountDraft);
    if (!amount || amount <= 0) return;
    setBusy(true);
    const { error } = await createOffer(listingId, amount);
    setBusy(false);
    if (error) Alert.alert('Could not send offer', error);
    else setAmountDraft('');
  };

  const submitCounter = async (offerId: string) => {
    const amount = Number(counterDraft);
    if (!amount || amount <= 0) return;
    setBusy(true);
    const { error } = await counter(offerId, amount);
    setBusy(false);
    if (error) Alert.alert('Could not send counter offer', error);
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
    if (error) Alert.alert('Could not update offer', error);
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} noPadding>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, paddingHorizontal: spacing.md }} keyboardVerticalOffset={insets.top}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          Offers
        </Text>
      </View>

      {listing && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
          <Text variant="caption" color="secondary" numberOfLines={1} style={{ flex: 1, marginRight: spacing.sm }}>
            {listing.title}
          </Text>
          <Text variant="bodyMedium" color="brand">
            Listing price: {formatBirr(listing.price)}
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
              title="No offers yet"
              message={isOwner ? "You'll see offers from buyers here." : 'Enter an amount below to make the first offer.'}
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
                  {item.fromMe ? 'You offered' : 'They offered'}
                </Text>
                <Text variant="h3" color={item.fromMe ? 'inverse' : 'primary'}>
                  {formatBirr(item.amount)}
                </Text>
                {diff !== null && (
                  <Text variant="tiny" color={item.fromMe ? 'inverse' : 'secondary'}>
                    {diff === 0 ? 'Matches asking price' : `${diff > 0 ? '+' : '-'}${formatBirr(Math.abs(diff))} ${diff > 0 ? 'above' : 'below'} asking`}
                  </Text>
                )}
                {item.message ? (
                  <Text variant="caption" color={item.fromMe ? 'inverse' : 'secondary'} style={{ marginTop: 2 }}>
                    {item.message}
                  </Text>
                ) : null}
                <Badge label={item.status} tone={toneFor(item.status)} />
              </View>
            );
          }}
        />
      )}

      {hasHydrated && canRespond && (
        <View style={{ marginTop: spacing.md }}>
          {counteringId === latest.id ? (
            <View style={{ gap: spacing.xs }}>
              <Input placeholder="Counter amount (Birr)" keyboardType="numeric" value={counterDraft} onChangeText={setCounterDraft} />
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                <Button label="Send Counter" onPress={() => submitCounter(latest.id)} loading={busy} style={{ flex: 1 }} />
                <Button label="Cancel" variant="ghost" onPress={() => setCounteringId(null)} style={{ flex: 1 }} />
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              <Button label="Accept" onPress={() => respond('accept')} loading={busy} style={{ flex: 1 }} />
              <Button label="Counter" variant="outline" onPress={() => setCounteringId(latest.id)} style={{ flex: 1 }} />
              <Button label="Decline" variant="ghost" onPress={() => respond('decline')} loading={busy} style={{ flex: 1 }} />
            </View>
          )}
        </View>
      )}

      {hasHydrated && canMakeNewOffer && (
        <View style={{ marginTop: spacing.md, gap: spacing.xs, marginBottom: spacing.md }}>
          <Input placeholder="Your offer amount (Birr)" keyboardType="numeric" value={amountDraft} onChangeText={setAmountDraft} />
          <Button label="Send Offer" onPress={submitOffer} loading={busy} fullWidth />
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
  const { listingId } = useLocalSearchParams<{ listingId?: string }>();
  if (!authed) return <Screen />;
  if (!listingId) return <OfferInbox />;
  return <OfferThreadScreen listingId={listingId} />;
}
