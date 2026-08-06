import React, { useEffect, useRef } from 'react';
import { Animated, ViewStyle } from 'react-native';
import { useTheme } from '@/theme/ThemeContext';

type Props = {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
};

export function Skeleton({ width = '100%', height = 16, radius, style }: Props) {
  const { colors, radius: r, motion } = useTheme();
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: motion.slow, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: motion.slow, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius ?? r.sm,
          backgroundColor: colors.skeleton,
          opacity,
        },
        style,
      ]}
    />
  );
}
