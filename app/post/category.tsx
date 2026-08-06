import { FlatList, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Screen } from '@/components/Screen';
import { StepHeader } from '@/components/StepHeader';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme/ThemeContext';
import { categories } from '@/data/categories';
import { usePostDraft } from '@/store/postDraft';
import { usePostExitGuard } from '@/hooks/usePostExitGuard';

export default function ChooseCategory() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const { category, subcategory, categoryDrillId, setField } = usePostDraft();
  const confirmLeave = usePostExitGuard('category');

  const activeCategory = categories.find((c) => c.id === categoryDrillId);

  // Selecting only highlights a row and (when the category has subcategories)
  // drills into that list — it never advances the wizard on its own. The
  // seller always has to review their pick and press Continue, including
  // when a previous draft already restored a selection here.
  const selectCategory = (id: string) => {
    const chosen = categories.find((c) => c.id === id);
    setField('category', id);
    setField('subcategory', undefined);
    if (chosen?.subcategories?.length) {
      setField('categoryDrillId', id);
    }
  };

  const selectSubcategory = (sub: string) => {
    setField('subcategory', sub);
  };

  if (activeCategory) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <StepHeader step={2} totalSteps={6} title={activeCategory.name} onClose={() => setField('categoryDrillId', undefined)} />
        <Pressable
          onPress={() => setField('categoryDrillId', undefined)}
          style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs, marginBottom: spacing.md }}
        >
          <Ionicons name="chevron-back" size={16} color={colors.primary} />
          <Text variant="caption" color="brand" style={{ marginLeft: 2 }}>
            All categories
          </Text>
        </Pressable>
        <FlatList
          data={activeCategory.subcategories}
          keyExtractor={(s) => s.name}
          contentContainerStyle={{ gap: spacing.xs, paddingTop: spacing.xs }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => selectSubcategory(item.name)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                padding: spacing.sm,
                borderRadius: radius.md,
                backgroundColor: subcategory === item.name ? colors.primary + '0D' : colors.surface,
              }}
            >
              <CategoryIcon icon={item.icon} size={20} color={colors.primary} />
              <Text variant="body" style={{ marginLeft: spacing.sm, flex: 1 }}>
                {item.name}
              </Text>
              {subcategory === item.name ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
              ) : (
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              )}
            </Pressable>
          )}
        />
        <Button
          label="Continue"
          onPress={() => router.push('/post/details')}
          disabled={!subcategory}
          fullWidth
          size="lg"
          style={{ marginTop: spacing.sm }}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <StepHeader step={2} totalSteps={6} title="Choose a category" onClose={confirmLeave} />
      <FlatList
        data={categories}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ gap: spacing.xs, paddingTop: spacing.xs }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => selectCategory(item.id)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              padding: spacing.sm,
              borderRadius: radius.md,
              backgroundColor: category === item.id ? colors.primary + '0D' : colors.surface,
            }}
          >
            <CategoryIcon icon={item.icon} size={20} color={colors.primary} />
            <Text variant="body" style={{ marginLeft: spacing.sm, flex: 1 }}>
              {item.name}
            </Text>
            {category === item.id && !item.subcategories?.length ? (
              <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
            ) : (
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            )}
          </Pressable>
        )}
      />
      {!!category && !categories.find((c) => c.id === category)?.subcategories?.length && (
        <Button
          label="Continue"
          onPress={() => router.push('/post/details')}
          fullWidth
          size="lg"
          style={{ marginTop: spacing.sm }}
        />
      )}
    </Screen>
  );
}
