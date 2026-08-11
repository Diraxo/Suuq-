import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';
import { Seller } from '@/types';

type Props = {
  seller: Seller;
  size?: number;
};

// Shared "N stars + count" renderer for anywhere a listing/seller card needs
// to show a rating at a glance (currently the Compare screen's cards and
// attribute table). Reviews are the only source of truth for a rating — a
// seller with zero reviews gets the same "no ratings yet" copy used on the
// seller profile screen instead of a fake 0.0/empty-star row.
export function SellerRatingInline({ seller, size = 13 }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  if (!seller.reviewCount) {
    return (
      <Text variant="tiny" color="muted">
        {t('compare.noRatingsYet')}
      </Text>
    );
  }

  const rounded = Math.round(seller.rating);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ flexDirection: 'row' }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Ionicons key={i} name={i < rounded ? 'star' : 'star-outline'} size={size} color={colors.warning} />
        ))}
      </View>
      <Text variant="tiny" color="muted" style={{ marginLeft: 4 }}>
        {seller.rating.toFixed(1)} ({seller.reviewCount})
      </Text>
    </View>
  );
}
