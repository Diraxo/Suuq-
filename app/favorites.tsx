import { useMemo, useState } from 'react';
import { View, FlatList, Pressable, RefreshControl, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Input } from '@/components/Input';
import { ListingCard } from '@/components/ListingCard';
import { EmptyState } from '@/components/EmptyState';
import { useTheme } from '@/theme/ThemeContext';
import { useFavoritesStore } from '@/store/favorites';
import { useListingsStore, resolveAllListings } from '@/store/listings';
import { useCollectionsStore } from '@/store/collections';
import { useResponsiveColumns } from '@/hooks/useResponsiveColumns';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { useBlockedEitherWayIds, filterBlockedSellers } from '@/lib/blocking';

export default function Favorites() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const authed = useRequireAuthScreen();
  const numColumns = useResponsiveColumns();
  const [active, setActive] = useState('All');
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<{ mode: 'create' | 'rename'; target?: string } | null>(null);
  const [draftName, setDraftName] = useState('');
  const favoritedIds = useFavoritesStore((s) => s.favoritedIds);
  const allListings = useListingsStore((s) => s.listings);
  const collections = useCollectionsStore((s) => s.collections);
  const addCollection = useCollectionsStore((s) => s.addCollection);
  const renameCollection = useCollectionsStore((s) => s.renameCollection);
  const deleteCollection = useCollectionsStore((s) => s.deleteCollection);

  // Collections currently just organize the tab list — assigning individual
  // favorites into a collection isn't modeled yet, so every tab shows the
  // same favorited listings until that's built.
  const blockedIds = useBlockedEitherWayIds();
  const favorited = useMemo(
    () => filterBlockedSellers(resolveAllListings(allListings), blockedIds).filter((l) => favoritedIds.has(l.id)),
    [allListings, blockedIds, favoritedIds]
  );

  const startCreate = () => {
    setDraftName('');
    setEditing({ mode: 'create' });
  };

  const longPressCollection = (name: string) => {
    Alert.alert(name, undefined, [
      {
        text: 'Rename',
        onPress: () => {
          setDraftName(name);
          setEditing({ mode: 'rename', target: name });
        },
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteCollection(name);
          if (active === name) setActive('All');
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const confirmEdit = () => {
    if (!editing) return;
    const name = draftName.trim();
    if (!name) {
      setEditing(null);
      return;
    }
    if (editing.mode === 'create') {
      addCollection(name);
      setActive(name);
    } else if (editing.target) {
      renameCollection(editing.target, name);
      if (active === editing.target) setActive(name);
    }
    setEditing(null);
  };

  if (!authed) return <Screen />;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          Favorites
        </Text>
      </View>

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={['All', ...collections]}
        keyExtractor={(c) => c}
        style={{ flexGrow: 0, flexShrink: 0 }}
        contentContainerStyle={{ gap: spacing.xs, marginBottom: spacing.sm, alignItems: 'center' }}
        ListFooterComponent={
          <Pressable
            onPress={startCreate}
            accessibilityRole="button"
            accessibilityLabel="Create a new collection"
            style={{
              width: 28,
              height: 28,
              borderRadius: radius.pill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Ionicons name="add" size={16} color={colors.textSecondary} />
          </Pressable>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => setActive(item)}
            onLongPress={() => item !== 'All' && longPressCollection(item)}
            accessibilityRole="button"
            accessibilityLabel={`Show ${item} collection`}
            style={{
              paddingHorizontal: spacing.sm,
              paddingVertical: 6,
              borderRadius: radius.pill,
              backgroundColor: active === item ? colors.primary : colors.surface,
              borderWidth: 1,
              borderColor: active === item ? colors.primary : colors.border,
            }}
          >
            <Text variant="caption" color={active === item ? 'inverse' : 'secondary'}>
              {item}
            </Text>
          </Pressable>
        )}
      />

      {editing && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Input value={draftName} onChangeText={setDraftName} placeholder="Collection name" autoFocus onSubmitEditing={confirmEdit} />
          </View>
          <Pressable onPress={confirmEdit} hitSlop={8} accessibilityRole="button" accessibilityLabel="Save collection name">
            <Ionicons name="checkmark-circle" size={28} color={colors.primary} />
          </Pressable>
          <Pressable onPress={() => setEditing(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel">
            <Ionicons name="close-circle" size={28} color={colors.textMuted} />
          </Pressable>
        </View>
      )}

      <FlatList
        key={numColumns}
        data={favorited}
        keyExtractor={(l) => l.id}
        numColumns={numColumns}
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        columnWrapperStyle={{ gap: spacing.sm }}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              Promise.all([useListingsStore.getState().load(), useFavoritesStore.getState().load()]).finally(() => setRefreshing(false));
            }}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item }) => (
          <View style={{ flex: 1 }}>
            <ListingCard listing={item} />
          </View>
        )}
        ListEmptyComponent={
          <EmptyState icon="heart-outline" title="No favorites yet" message="Tap the heart on any listing to save it here." />
        }
      />
    </Screen>
  );
}
