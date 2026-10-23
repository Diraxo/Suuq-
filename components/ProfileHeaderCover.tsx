import { ReactNode } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeContext';
import { ProfileMode } from '@/lib/profileIdentity';
import { imageUrl } from '@/lib/r2';

// Text always sits on the card below the banner, so it uses the normal theme colours. `ringed` is true when the avatar overlaps a banner and
// needs a surface-coloured ring to separate it from the image.
export type CoverColors = { ringed: boolean; primary: string; secondary: string };

type Props = {
  mode: ProfileMode;
  /** Business banner. Only drawn in business mode; with none, a default gradient is used. */
  bannerUrl?: string | null;
  children: (c: CoverColors) => ReactNode;
};

// Banners are cropped to 16:9 on upload (lib/imagePipeline.ts), so the panel uses the same ratio and shows the whole image.
const BANNER_ASPECT = 16 / 9;
// Half of the avatar (84-88px) rides on the banner, the other half hangs below it.
const AVATAR_OVERLAP = 44;

// The one profile header (avatar, name, bio) for both modes. Personal mode is a plain header. Business mode puts a banner panel at the top and
// the same avatar straddles its bottom edge (half on the banner, half below), with the name and details underneath on the card.
export function ProfileHeaderCover({ mode, bannerUrl, children }: Props) {
  const { colors, spacing, isDark } = useTheme();
  const banner = mode === 'business';
  const palette: CoverColors = { ringed: banner, primary: colors.textPrimary, secondary: colors.textSecondary };
  if (!banner) {
    return <View style={{ paddingVertical: spacing.lg, paddingHorizontal: spacing.md, marginTop: spacing.sm }}>{children(palette)}</View>;
  }
  return (
    <View style={{ marginTop: spacing.sm, borderRadius: 24, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingBottom: spacing.md }}>
      <View style={{ width: '100%', aspectRatio: BANNER_ASPECT, backgroundColor: colors.primary }}>
        {bannerUrl ? (
          <Image source={{ uri: imageUrl(bannerUrl, { width: 900 }) }} style={{ width: '100%', height: '100%' }} contentFit="cover" cachePolicy="memory-disk" transition={200} accessibilityIgnoresInvertColors />
        ) : (
          <LinearGradient colors={[colors.primary, isDark ? '#312E81' : '#4338CA']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'flex-end', justifyContent: 'flex-start', padding: spacing.sm }}>
            <Ionicons name="storefront" size={64} color="rgba(255,255,255,0.14)" />
          </LinearGradient>
        )}
        {/* Fades any banner (a bright one especially) into the dark card so the avatar ring and the edge sit cleanly. */}
        <LinearGradient pointerEvents="none" colors={['transparent', colors.surface]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' }} />
      </View>
      <View style={{ marginTop: -AVATAR_OVERLAP, paddingHorizontal: spacing.md }}>{children(palette)}</View>
    </View>
  );
}
