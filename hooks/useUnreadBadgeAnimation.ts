import { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';

/** Shared mount/scale/opacity spring used by every unread-count badge (tab icon, chat rows) so they all enter/exit the same way. */
export function useUnreadBadgeAnimation(visible: boolean) {
  const [mounted, setMounted] = useState(visible);
  const scale = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6, tension: 90 }),
        Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(scale, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, scale, opacity]);

  return { mounted, scale, opacity };
}
