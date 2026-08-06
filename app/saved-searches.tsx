import { View, FlatList, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { useTheme } from '@/theme/ThemeContext';
import { useSavedSearchStore } from '@/store/savedSearches';
import { useListingsStore, resolveAllListings } from '@/store/listings';
import { useBlockedEitherWayIds, filterBlockedSellers } from '@/lib/blocking';

export default function SavedSearches() {
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const SAVED = useSavedSearchStore((s) => s.searches);
  const removeSearch = useSavedSearchStore((s) => s.remove);
  const globalListings = useListingsStore((s) => s.listings);
  const blockedIds = useBlockedEitherWayIds();
  const allListings = filterBlockedSellers(resolveAllListings(globalListings), blockedIds);
  const matchCount = (query: string) => allListings.filter((l) => l.title.toLowerCase().includes(query.toLowerCase())).length;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          Saved Searches
        </Text>
      </View>

      <FlatList
        data={SAVED}
        keyExtractor={(s) => s.id}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/(tabs)/search?category=${item.query}` as any)}>
            <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View
                style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary + '1A', alignItems: 'center', justifyContent: 'center' }}
              >
                <Ionicons name="bookmark" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
                <Text variant="bodyMedium">{item.query}</Text>
                <Text variant="caption" color="secondary">
                  {item.filter}
                </Text>
              </View>
              {matchCount(item.query) > 0 && (
                <View style={{ backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Text variant="tiny" color="inverse">
                    {matchCount(item.query)} match{matchCount(item.query) === 1 ? '' : 'es'}
                  </Text>
                </View>
              )}
              <Pressable
                onPress={() => removeSearch(item.id)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove saved search for ${item.query}`}
                style={{ marginLeft: spacing.xs }}
              >
                <Ionicons name="close-circle-outline" size={20} color={colors.textMuted} />
              </Pressable>
            </Card>
          </Pressable>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="bookmark-outline"
            title="No saved searches"
            message="Save a search from the Search tab and we'll notify you when something matches."
          />
        }
      />
    </Screen>
  );
}
