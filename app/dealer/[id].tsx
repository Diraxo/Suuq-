import { useEffect, useMemo, useState } from 'react';
import { View, FlatList } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { ListingCard } from '@/components/ListingCard';
import { useTheme } from '@/theme/ThemeContext';
import { mockSellers, mockListings } from '@/data/mockListings';
import { useFollowStore } from '@/store/follow';
import { requireAuth } from '@/store/authPrompt';
import { cldUrl } from '@/lib/cloudinary';
import { useListingsStore } from '@/store/listings';
import { supabase } from '@/lib/supabase';
import { getSellerStats, profileToSeller } from '@/lib/sellerStats';
import { Seller } from '@/types';

export default function DealerProfile() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const globalListings = useListingsStore((s) => s.listings);

  const [realDealer, setRealDealer] = useState<Seller | null>(null);
  useEffect(() => {
    let cancelled = false;
    setRealDealer(null);
    if (!id) return;
    (async () => {
      const { data: profile } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
      if (cancelled || !profile) return;
      const stats = await getSellerStats(id);
      if (cancelled) return;
      setRealDealer(profileToSeller(profile, stats));
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const isRealDealer = !!realDealer;
  const dealer = realDealer ?? mockSellers.find((s) => s.id === id) ?? mockSellers[2];
  const listings = useMemo(
    () => (isRealDealer ? globalListings.filter((l) => l.seller.id === dealer.id) : mockListings.filter((l) => l.seller.id === dealer.id)),
    [isRealDealer, globalListings, dealer.id]
  );
  const isFollowing = useFollowStore((s) => s.isFollowing(dealer.id));
  const toggleFollow = useFollowStore((s) => s.toggle);

  return (
    <Screen edges={['top', 'left', 'right']} noPadding>
      <View style={{ height: 100, backgroundColor: colors.primary }} />
      <View style={{ paddingHorizontal: spacing.md, marginTop: -40 }}>
        <BackButton onPress={() => router.back()} color="#fff" style={{ marginBottom: 8, marginLeft: -12 }} />
        <Image
          source={{ uri: cldUrl(dealer.avatar, { width: 240 }) }}
          accessibilityLabel={`${dealer.name}'s profile photo`}
          style={{ width: 80, height: 80, borderRadius: radius.md, borderWidth: 3, borderColor: colors.background }}
          cachePolicy="memory-disk"
          transition={200}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm }}>
          <Text variant="h2">{dealer.name}</Text>
          {dealer.verified && <Ionicons name="checkmark-circle" size={18} color={colors.primary} />}
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4 }}>
          <Badge label="Business account" tone="brand" icon="business-outline" />
          <Badge label={`⭐ ${dealer.rating.toFixed(1)}`} tone="neutral" />
        </View>
        <Text variant="caption" color="secondary" style={{ marginTop: spacing.xs }}>
          {dealer.city} · {dealer.listingsCount} active listings · {dealer.soldCount} sold
        </Text>
        <Button
          label={isFollowing ? 'Following store' : 'Follow store'}
          variant={isFollowing ? 'outline' : 'primary'}
          onPress={() => requireAuth(() => toggleFollow(dealer.id))}
          style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}
          icon={isFollowing ? undefined : <Ionicons name="storefront-outline" size={16} color={colors.primaryText} />}
        />
      </View>

      <FlatList
        data={listings}
        keyExtractor={(l) => l.id}
        numColumns={2}
        showsVerticalScrollIndicator={false}
        columnWrapperStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md }}
        contentContainerStyle={{ paddingTop: spacing.lg }}
        renderItem={({ item }) => (
          <View style={{ flex: 1 }}>
            <ListingCard listing={item} />
          </View>
        )}
      />
    </Screen>
  );
}
