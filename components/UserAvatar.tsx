import { useEffect, useState } from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '@/theme/ThemeContext';
import { Text } from './Text';

type Props = {
  uri?: string | null;
  name?: string | null;
  size: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

// Placeholder images are never shown as a person's face: a missing or broken photo is the first letter of their name on a plain circle,
// the same on every phone and on the website.
const isPlaceholderUrl = (uri: string) => uri.includes('picsum.photos');

export function UserAvatar({ uri, name, size, style, accessibilityLabel }: Props) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  // The photo stays invisible until it has fully loaded, so a slow download never shows as a half-drawn picture over an empty circle.
  const [loaded, setLoaded] = useState(false);
  const real = uri && !isPlaceholderUrl(uri) ? uri : null;
  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [real]);
  const initial = (name ?? '').trim().charAt(0).toUpperCase() || '?';

  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: colors.skeleton, alignItems: 'center', justifyContent: 'center' }, style]}>
      {(!real || failed || !loaded) && (
        <Text variant="h2" color="secondary" style={{ fontSize: size * 0.42, lineHeight: size * 0.5 }}>
          {initial}
        </Text>
      )}
      {real && !failed && (
        <Image
          source={{ uri: real }}
          accessibilityLabel={accessibilityLabel}
          style={{ position: 'absolute', top: 0, left: 0, width: size, height: size, opacity: loaded ? 1 : 0 }}
          contentFit="cover"
          cachePolicy="memory-disk"
          priority="high"
          transition={200}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </View>
  );
}
