import { useWindowDimensions } from 'react-native';

const BREAKPOINTS = [
  { width: 900, columns: 4 },
  { width: 600, columns: 3 },
];

// Listing grids (Home, Search) hard-coded numColumns={2}, which wastes most
// of a tablet's width. FlatList can't change numColumns on the fly — pass
// this value as both the `numColumns` prop and part of the list's `key` so
// it remounts cleanly when the breakpoint changes (e.g. rotation).
export function useResponsiveColumns(): number {
  const { width } = useWindowDimensions();
  return BREAKPOINTS.find((bp) => width >= bp.width)?.columns ?? 2;
}
